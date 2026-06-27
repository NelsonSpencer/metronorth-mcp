import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer, initializeData, setupShutdownHandlers } from './server.js';
import { createModuleLogger } from './logger.js';

const logger = createModuleLogger('http');

/** Maximum accepted request body size (1 MiB). Larger bodies get a 413. */
const MAX_BODY_BYTES = 1024 * 1024;

/** Hosts that are safe to bind without a token (the tunnel case). */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

/** Hard ceiling on concurrent MCP sessions before new ones are rejected. */
const MAX_SESSIONS = 256;
/** A session is evicted after this long without any routed request. */
const SESSION_IDLE_TTL_MS = 10 * 60 * 1000;
/** How often the idle-session sweeper runs. */
const SESSION_SWEEP_INTERVAL_MS = 60 * 1000;
/** Cheap connection cap (not a rate limiter — that is intentionally out of scope). */
const MAX_CONNECTIONS = 64;

/** Abort sockets whose request is not fully received in time. */
const REQUEST_TIMEOUT_MS = 30_000;
/** Abort sockets that do not send headers in time. */
const HEADERS_TIMEOUT_MS = 20_000;

/**
 * Is `host` a loopback bind address that is safe to expose without a token?
 *
 * Only the canonical loopback names qualify; anything else (`0.0.0.0`, a LAN
 * IP, a public interface) must carry a bearer token before it will start.
 */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.trim().toLowerCase());
}

export interface RunHttpOptions {
  host: string;
  port: number;
  token?: string;
  allowedHosts?: string[];
  allowedOrigins?: string[];
  /** Test-only override of the session cap. Defaults to {@link MAX_SESSIONS}. */
  maxSessions?: number;
  /** Test-only override of the idle eviction TTL. Defaults to {@link SESSION_IDLE_TTL_MS}. */
  idleTimeoutMs?: number;
  /** Test-only override of the sweeper interval. Defaults to {@link SESSION_SWEEP_INTERVAL_MS}. */
  sweepIntervalMs?: number;
}

/** Handle returned by {@link runHttp} once the server is listening. */
export interface RunHttpHandle {
  /** Actual bound port (resolves `--port 0` to the ephemeral port). */
  port: number;
  /** Idempotent ordered shutdown: transports → map → sweeper → listener. */
  close: () => Promise<void>;
}

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  /** Epoch ms of the most recent request routed to this session. */
  lastActivity: number;
}

interface ServerContext {
  opts: RunHttpOptions;
  transports: Map<string, SessionEntry>;
  allowedHosts: string[];
  allowedOrigins: string[];
  maxSessions: number;
}

class BodyTooLargeError extends Error {}

/**
 * Run the server over the opt-in Streamable HTTP transport.
 *
 * Safe-by-default posture:
 * - binds the caller-provided host (CLI/env default `127.0.0.1`, never `0.0.0.0`);
 * - **fails closed**: a non-loopback bind without a token throws before listening;
 * - enables the SDK's DNS-rebinding protection with explicit Host and Origin
 *   allow-lists (the Origin check only fires when a browser sends an Origin
 *   header, so header-less clients still pass);
 * - optional bearer-token auth, with a prominent warning when none is set;
 * - bounds the session map (cap + idle eviction) and the connection count;
 * - caps request bodies and sets request/headers timeouts;
 * - never leaks error details to clients (generic 500).
 *
 * @returns a handle exposing the actual bound port and an idempotent `close()`.
 */
export async function runHttp(opts: RunHttpOptions): Promise<RunHttpHandle> {
  // Fail closed: refuse to expose a non-loopback address without a token.
  if (!isLoopbackHost(opts.host) && !opts.token) {
    throw new Error(
      `Refusing to bind the HTTP transport to non-loopback host "${opts.host}" without a token. ` +
        'Set a token (--token / MCP_HTTP_TOKEN) to require Bearer auth before exposing it.'
    );
  }

  if (!opts.token) {
    // Loopback + no token is the intended local tunnel case; warn but allow it.
    logger.warn(
      'HTTP transport is UNAUTHENTICATED — set --token (or MCP_HTTP_TOKEN) before exposing it beyond loopback'
    );
  }

  await initializeData();

  const transports = new Map<string, SessionEntry>();
  const maxSessions = opts.maxSessions ?? MAX_SESSIONS;
  const idleTtlMs = opts.idleTimeoutMs ?? SESSION_IDLE_TTL_MS;
  const sweepIntervalMs = opts.sweepIntervalMs ?? SESSION_SWEEP_INTERVAL_MS;

  // Allow-lists are filled in after binding so the actual port (relevant for
  // `--port 0`) is reflected in the loopback Host/Origin defaults.
  const ctx: ServerContext = {
    opts,
    transports,
    allowedHosts: [],
    allowedOrigins: [],
    maxSessions,
  };

  const httpServer = createServer((req, res) => {
    void handleRequest(req, res, ctx);
  });

  httpServer.maxConnections = MAX_CONNECTIONS;
  httpServer.requestTimeout = REQUEST_TIMEOUT_MS;
  httpServer.headersTimeout = HEADERS_TIMEOUT_MS;

  // Idle-session sweeper. `.unref()` so it never keeps the process alive; it is
  // cleared during shutdown. Expired sessions are collected first, then closed,
  // to avoid mutating the map while iterating it.
  const sweeper = setInterval(() => {
    const now = Date.now();
    const expired: string[] = [];
    for (const [sessionId, entry] of transports) {
      if (now - entry.lastActivity > idleTtlMs) {
        expired.push(sessionId);
      }
    }
    for (const sessionId of expired) {
      const entry = transports.get(sessionId);
      if (entry) {
        transports.delete(sessionId);
        void entry.transport.close();
      }
    }
  }, sweepIntervalMs);
  sweeper.unref();

  // Ordered, idempotent shutdown: close every transport FIRST, clear the map,
  // clear the sweeper, THEN close the listener (force-closing keep-alive sockets
  // so it can't hang).
  let closed = false;
  const closeAll = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    for (const entry of [...transports.values()]) {
      await entry.transport.close();
    }
    transports.clear();
    clearInterval(sweeper);
    await closeServer(httpServer);
  };

  setupShutdownHandlers(closeAll);

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(opts.port, opts.host, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  const address = httpServer.address();
  const boundPort = address && typeof address === 'object' ? address.port : opts.port;

  // DNS-rebinding protection is off in the SDK unless allow-lists are set, so we
  // always provide them. Defaults cover loopback; a tunnel that rewrites the
  // Host/Origin can widen them via --allowed-hosts / --allowed-origins.
  ctx.allowedHosts = opts.allowedHosts ?? [
    '127.0.0.1',
    'localhost',
    `127.0.0.1:${boundPort}`,
    `localhost:${boundPort}`,
  ];
  ctx.allowedOrigins = opts.allowedOrigins ?? [
    `http://127.0.0.1:${boundPort}`,
    `http://localhost:${boundPort}`,
  ];

  logger.info(
    { host: opts.host, port: boundPort, authenticated: Boolean(opts.token) },
    `Metro-North MCP Server running on http://${opts.host}:${boundPort}/mcp`
  );

  return { port: boundPort, close: closeAll };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext
): Promise<void> {
  try {
    const pathname = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
      .pathname;

    // Liveness probe — intentionally unauthenticated for tunnels/proxies.
    if (pathname === '/health') {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'method_not_allowed' });
        return;
      }
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    if (pathname !== '/mcp') {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }

    // Optional bearer-token auth guards every /mcp method.
    if (ctx.opts.token && !isAuthorized(req, ctx.opts.token)) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }

    if (req.method === 'POST') {
      await handleMcpPost(req, res, ctx);
      return;
    }

    if (req.method === 'GET' || req.method === 'DELETE') {
      const session = getSession(req, ctx.transports);
      if (!session) {
        sendJson(res, 404, { error: 'session_not_found' });
        return;
      }
      session.lastActivity = Date.now();
      await session.transport.handleRequest(req, res);
      return;
    }

    sendJson(res, 405, { error: 'method_not_allowed' });
  } catch (error) {
    // Never leak error details/stack traces over HTTP.
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'HTTP request handling error'
    );
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'internal_server_error' });
    } else {
      res.end();
    }
  }
}

async function handleMcpPost(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext
): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      sendJson(res, 413, { error: 'payload_too_large' });
      // Free the socket promptly instead of waiting for the request timeout.
      req.destroy();
      return;
    }
    sendJson(res, 400, { error: 'invalid_request' });
    return;
  }

  const existing = getSession(req, ctx.transports);
  if (existing) {
    existing.lastActivity = Date.now();
    await existing.transport.handleRequest(req, res, body);
    return;
  }

  // No session yet — only an `initialize` request may open one.
  if (!isInitializeRequest(body)) {
    sendJson(res, 400, { error: 'invalid_session' });
    return;
  }

  // Bound the session map: refuse new sessions once the cap is reached.
  if (ctx.transports.size >= ctx.maxSessions) {
    sendJson(res, 503, { error: 'too_many_sessions' });
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableDnsRebindingProtection: true,
    allowedHosts: ctx.allowedHosts,
    allowedOrigins: ctx.allowedOrigins,
    onsessioninitialized: (sessionId: string) => {
      ctx.transports.set(sessionId, { transport, lastActivity: Date.now() });
    },
  });

  transport.onclose = () => {
    const sessionId = transport.sessionId;
    if (sessionId) {
      ctx.transports.delete(sessionId);
    }
  };

  const server = createMcpServer();
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

function getSession(
  req: IncomingMessage,
  transports: Map<string, SessionEntry>
): SessionEntry | undefined {
  const header = req.headers['mcp-session-id'];
  const sessionId = Array.isArray(header) ? header[0] : header;
  return sessionId ? transports.get(sessionId) : undefined;
}

function isAuthorized(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization;
  if (typeof header !== 'string') {
    return false;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    return false;
  }
  return safeEqual(match[1], token);
}

/**
 * Constant-time string comparison that does not leak length.
 *
 * Both inputs are hashed to fixed-length SHA-256 digests before
 * {@link timingSafeEqual}, so there is no length-based early return and the
 * comparison is always over equal-length buffers.
 */
function safeEqual(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a).digest();
  const digestB = createHash('sha256').update(b).digest();
  return timingSafeEqual(digestA, digestB);
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      fn();
    };

    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        finish(() => reject(new BodyTooLargeError()));
        return;
      }
      chunks.push(chunk);
    };

    const onEnd = () => {
      finish(() => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (raw.length === 0) {
          resolve(undefined);
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error('Invalid JSON body'));
        }
      });
    };

    const onError = (error: Error) => {
      finish(() => reject(error));
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function closeServer(server: HttpServer): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    // Force-close lingering keep-alive sockets so close() can't hang
    // (Node >= 18.2; this project requires >= 22).
    server.closeAllConnections();
  });
}
