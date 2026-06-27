import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer, initializeData, setupShutdownHandlers } from './server.js';
import { createModuleLogger } from './logger.js';

const logger = createModuleLogger('http');

/** Maximum accepted request body size (1 MiB). Larger bodies get a 413. */
const MAX_BODY_BYTES = 1024 * 1024;
/** Abort sockets whose request is not fully received in time. */
const REQUEST_TIMEOUT_MS = 30_000;
/** Abort sockets that do not send headers in time. */
const HEADERS_TIMEOUT_MS = 20_000;

export interface RunHttpOptions {
  host: string;
  port: number;
  token?: string;
  allowedHosts?: string[];
  allowedOrigins?: string[];
}

class BodyTooLargeError extends Error {}

/**
 * Run the server over the opt-in Streamable HTTP transport.
 *
 * Safe-by-default posture:
 * - binds the caller-provided host (CLI/env default `127.0.0.1`, never `0.0.0.0`);
 * - enables the SDK's DNS-rebinding protection with an explicit Host allow-list;
 * - optional bearer-token auth, with a prominent warning when none is set;
 * - caps request bodies and sets request/headers timeouts;
 * - never leaks error details to clients (generic 500).
 */
export async function runHttp(opts: RunHttpOptions): Promise<void> {
  if (!opts.token) {
    logger.warn(
      'HTTP transport is UNAUTHENTICATED — set --token (or MCP_HTTP_TOKEN) before exposing it beyond loopback'
    );
  }

  await initializeData();

  const transports = new Map<string, StreamableHTTPServerTransport>();

  // DNS-rebinding protection is off in the SDK unless an allow-list is set, so
  // we always provide one. The default covers loopback; a tunnel that rewrites
  // the Host header can widen it via --allowed-hosts / MCP_HTTP_ALLOWED_HOSTS.
  const allowedHosts = opts.allowedHosts ?? [
    '127.0.0.1',
    'localhost',
    `127.0.0.1:${opts.port}`,
    `localhost:${opts.port}`,
  ];

  const httpServer = createServer((req, res) => {
    void handleRequest(req, res, opts, transports, allowedHosts);
  });

  httpServer.requestTimeout = REQUEST_TIMEOUT_MS;
  httpServer.headersTimeout = HEADERS_TIMEOUT_MS;

  setupShutdownHandlers(async () => {
    await closeServer(httpServer);
    for (const transport of transports.values()) {
      await transport.close();
    }
    transports.clear();
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(opts.port, opts.host, () => {
      httpServer.off('error', reject);
      logger.info(
        { host: opts.host, port: opts.port, authenticated: Boolean(opts.token) },
        `Metro-North MCP Server running on http://${opts.host}:${opts.port}/mcp`
      );
      resolve();
    });
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: RunHttpOptions,
  transports: Map<string, StreamableHTTPServerTransport>,
  allowedHosts: string[]
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
    if (opts.token && !isAuthorized(req, opts.token)) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }

    if (req.method === 'POST') {
      await handleMcpPost(req, res, opts, transports, allowedHosts);
      return;
    }

    if (req.method === 'GET' || req.method === 'DELETE') {
      const transport = getTransport(req, transports);
      if (!transport) {
        sendJson(res, 404, { error: 'session_not_found' });
        return;
      }
      await transport.handleRequest(req, res);
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
  opts: RunHttpOptions,
  transports: Map<string, StreamableHTTPServerTransport>,
  allowedHosts: string[]
): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      sendJson(res, 413, { error: 'payload_too_large' });
      return;
    }
    sendJson(res, 400, { error: 'invalid_request' });
    return;
  }

  const existing = getTransport(req, transports);
  if (existing) {
    await existing.handleRequest(req, res, body);
    return;
  }

  // No session yet — only an `initialize` request may open one.
  if (!isInitializeRequest(body)) {
    sendJson(res, 400, { error: 'invalid_session' });
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableDnsRebindingProtection: true,
    allowedHosts,
    allowedOrigins: opts.allowedOrigins,
    onsessioninitialized: (sessionId: string) => {
      transports.set(sessionId, transport);
    },
  });

  transport.onclose = () => {
    const sessionId = transport.sessionId;
    if (sessionId) {
      transports.delete(sessionId);
    }
  };

  const server = createMcpServer();
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

function getTransport(
  req: IncomingMessage,
  transports: Map<string, StreamableHTTPServerTransport>
): StreamableHTTPServerTransport | undefined {
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

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
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
  });
}
