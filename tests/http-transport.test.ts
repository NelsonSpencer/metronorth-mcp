/**
 * Integration tests for the opt-in Streamable HTTP transport.
 *
 * Boot strategy:  Call {@link runHttp} in-process inside `beforeAll` so tests
 * run without a pre-built server binary.  To keep the suite network-free and
 * fast the following infrastructure modules are mocked:
 *
 * - `server.js`         – `initializeData` → no-op (no GTFS fetch / DB open);
 *                         `setupShutdownHandlers` → no-op (no process.exit in tests).
 *                         `createMcpServer` is kept real so full MCP protocol
 *                         works through the mocked tool/resource infrastructure.
 * - `database.js`       – fully mocked (no SQLite file needed).
 * - `cache.js`          – fully mocked (no Redis connection).
 * - `realtime-client.js`– fully mocked (no MTA GTFS-RT fetch).
 * - `station-service.js`– fully mocked (returns empty station lists).
 * - `gtfs-loader.js`    – fully mocked (needsUpdate → false, no network).
 *
 * Teardown: the handle returned by `runHttp` closes the listening socket (and
 * all transports) so vitest can exit cleanly after the suite.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any static imports of the mocked
// modules.  vitest hoists vi.mock() calls automatically.
// ---------------------------------------------------------------------------

vi.mock('../src/server.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/server.js')>();
  return {
    ...original,
    // No-op: prevents getDatabase() / GTFS network access during test boot.
    initializeData: vi.fn().mockResolvedValue(undefined),
    // No-op: prevents SIGINT/SIGTERM handlers from calling process.exit().
    setupShutdownHandlers: vi.fn(),
    // Keep createMcpServer real so full MCP protocol is exercised.
  };
});

vi.mock('../src/infrastructure/database.js', () => ({
  getDatabase: vi.fn(),
  getSqlite: vi.fn(() => ({
    prepare: vi.fn(() => ({
      all: vi.fn(() => []),
      get: vi.fn(() => undefined),
      run: vi.fn(),
    })),
    exec: vi.fn(),
    transaction: vi.fn((fn: () => unknown) => fn),
  })),
  closeDatabase: vi.fn(),
  runQuery: vi.fn(() => []),
  getMetadata: vi.fn(() => null),
  setMetadata: vi.fn(),
  transaction: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('../src/infrastructure/cache.js', () => ({
  getCache: vi.fn(() => ({
    get: vi.fn(() => null),
    set: vi.fn(),
    delete: vi.fn(),
  })),
  shutdownCache: vi.fn(),
  CACHE_KEYS: {
    stations: 'stations:all',
    tripUpdates: 'realtime:trip_updates',
    serviceAlerts: 'realtime:alerts',
  },
}));

vi.mock('../src/infrastructure/realtime-client.js', () => ({
  getRealtimeClient: vi.fn(() => ({
    isAvailable: vi.fn(() => false),
    getTripUpdates: vi.fn(() => Promise.resolve([])),
    getDelayForTripAtStopFromUpdates: vi.fn(() => 0),
    getDelayForTripFromUpdates: vi.fn(() => 0),
    getRealtimeInfoForTripAtStopFromUpdates: vi.fn(() => null),
  })),
}));

vi.mock('../src/infrastructure/station-service.js', () => ({
  getStationService: vi.fn(() => ({
    findStationByName: vi.fn(() => Promise.resolve(null)),
    getStationInfo: vi.fn(() => Promise.resolve(null)),
    searchStations: vi.fn(() => Promise.resolve([])),
    getAllStations: vi.fn(() => Promise.resolve([])),
  })),
}));

vi.mock('../src/infrastructure/gtfs-loader.js', () => ({
  getGTFSLoader: vi.fn(() => ({
    needsUpdate: vi.fn(() => Promise.resolve(false)),
    updateStaticData: vi.fn(() => Promise.resolve()),
  })),
}));

// ---------------------------------------------------------------------------
// Static imports (after vi.mock declarations so mocks are in place)
// ---------------------------------------------------------------------------

import { runHttp, type RunHttpHandle } from '../src/http-server.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_TOKEN = 'http-transport-test-token';

/** Bind port 0 on loopback and resolve with the assigned port. */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as { port: number };
      srv.close((err) => (err ? reject(err) : resolve(addr.port)));
    });
    srv.on('error', reject);
  });
}

/**
 * Open a real MCP session with a raw `initialize` POST.
 *
 * The SDK requires the Accept header to list both `application/json` and
 * `text/event-stream`; the response is an SSE stream carrying the init result
 * and the `mcp-session-id` header. Returns the raw {@link Response} so callers
 * can read the status / session-id header before draining the body.
 */
function rawInitialize(targetPort: number, token?: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${targetPort}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'http-transport-test', version: '1.0.0' },
      },
    }),
  });
}

// ---------------------------------------------------------------------------
// Suite state
// ---------------------------------------------------------------------------

let port: number;
/** Handle to the long-lived suite server (token-authenticated, loopback). */
let serverHandle: RunHttpHandle;
/** MCP client authenticated with TEST_TOKEN. */
let mcpClient: Client;

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll(async () => {
  port = await getFreePort();

  // Boot the HTTP server in-process on the ephemeral port with a bearer token.
  serverHandle = await runHttp({ host: '127.0.0.1', port, token: TEST_TOKEN });
  // The handle reports the actual bound port (important for `--port 0`).
  port = serverHandle.port;

  // Build and connect an authenticated MCP client.
  mcpClient = new Client(
    { name: 'http-transport-test', version: '1.0.0' },
    { capabilities: {} }
  );

  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${port}/mcp`),
    {
      requestInit: {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      },
    }
  );

  await mcpClient.connect(transport);
});

afterAll(async () => {
  // Close the MCP client first so the underlying HTTP connection is released.
  await mcpClient.close().catch(() => {});
  // Then close the HTTP server (transports + listener) so vitest can exit.
  await serverHandle.close();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCP protocol over HTTP', () => {
  it('tools/list returns the expected 10 tools', async () => {
    const result = await mcpClient.listTools();

    // Canary: the exact count (10) and the named tools below pin the public MCP
    // surface exposed over HTTP. If a tool is added/removed/renamed, update both
    // this count and the smoke scripts deliberately — a drift here means the
    // wire contract changed.
    expect(result.tools).toHaveLength(10);
    const names = result.tools.map((t) => t.name);
    expect(names).toContain('get_departures');
    expect(names).toContain('search_stations');
    expect(names).toContain('get_system_status');
    expect(names).toContain('plan_metro_north_trip');
  });

  it('tool call (search_stations) returns structured content without error', async () => {
    const result = await mcpClient.callTool(
      { name: 'search_stations', arguments: { query: 'Grand', limit: 5 } }
    );

    // Must have content and not be an error.
    expect(result.isError).toBeFalsy();
    expect(result.content).toBeDefined();
    expect(Array.isArray(result.content)).toBe(true);

    // Structured content shape: { query, results, total }
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured).toBeDefined();
    expect(typeof structured.query).toBe('string');
    expect(Array.isArray(structured.results)).toBe(true);
    expect(typeof structured.total).toBe('number');
  });
});

describe('HTTP routing', () => {
  it('GET /health returns 200 with {status:"ok"}', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    const body = await res.json() as { status: string };

    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
  });

  it('unknown path returns 404', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/not-a-real-path`);

    expect(res.status).toBe(404);
  });

  it('POST /mcp with no session and non-initialize body returns 400', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_TOKEN}`,
      },
      // A valid JSON-RPC call but NOT an initialize request — no session yet.
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      }),
    });

    expect(res.status).toBe(400);
  });
});

describe('bearer-token authentication', () => {
  it('POST /mcp with missing Authorization header returns 401', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });

    expect(res.status).toBe(401);
  });

  it('POST /mcp with wrong token returns 401', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer wrong-token',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });

    expect(res.status).toBe(401);
  });

  it('correct token allows authenticated access', async () => {
    // The established mcpClient already uses the correct token; verify it can
    // still make successful calls (proves the token is accepted end-to-end).
    const result = await mcpClient.listTools();

    expect(result.tools.length).toBeGreaterThan(0);
  });

  it('GET /health is accessible without a token (liveness probe)', async () => {
    // /health is intentionally unauthenticated for tunnels and proxies.
    const res = await fetch(`http://127.0.0.1:${port}/health`);

    expect(res.status).toBe(200);
  });
});

describe('unauthenticated loopback', () => {
  it('permits requests when no token is set (the intended tunnel case)', async () => {
    const p = await getFreePort();
    // Loopback + no token must still start and serve traffic.
    const handle = await runHttp({ host: '127.0.0.1', port: p });

    try {
      const health = await fetch(`http://127.0.0.1:${handle.port}/health`);
      expect(health.status).toBe(200);

      // A full MCP client connects WITHOUT any Authorization header and works.
      const client = new Client(
        { name: 'no-token-test', version: '1.0.0' },
        { capabilities: {} }
      );
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${handle.port}/mcp`)
      );
      await client.connect(transport);

      const tools = await client.listTools();
      expect(tools.tools.length).toBeGreaterThan(0);

      await client.close().catch(() => {});
    } finally {
      await handle.close();
    }
  });
});

describe('session bounding', () => {
  it('returns 503 once the session cap is exceeded', async () => {
    const p = await getFreePort();
    // Lower the cap via a test-only option; the production default stays at 256.
    const handle = await runHttp({
      host: '127.0.0.1',
      port: p,
      token: TEST_TOKEN,
      maxSessions: 1,
    });

    try {
      // First initialize fills the single available session slot.
      const first = await rawInitialize(handle.port, TEST_TOKEN);
      expect(first.status).toBe(200);
      expect(first.headers.get('mcp-session-id')).toBeTruthy();
      await first.text(); // drain the SSE response so the socket is released

      // Second initialize exceeds the cap and is refused before a transport
      // is created.
      const second = await rawInitialize(handle.port, TEST_TOKEN);
      expect(second.status).toBe(503);
      const body = (await second.json()) as { error: string };
      expect(body.error).toBe('too_many_sessions');
    } finally {
      await handle.close();
    }
  });

  it('evicts idle sessions after the TTL', async () => {
    const p = await getFreePort();
    // Tiny TTL / sweep interval so eviction is observable within the test.
    const handle = await runHttp({
      host: '127.0.0.1',
      port: p,
      token: TEST_TOKEN,
      idleTimeoutMs: 40,
      sweepIntervalMs: 20,
    });

    try {
      const initRes = await rawInitialize(handle.port, TEST_TOKEN);
      expect(initRes.status).toBe(200);
      const sessionId = initRes.headers.get('mcp-session-id');
      expect(sessionId).toBeTruthy();
      await initRes.text(); // drain the SSE response so the session goes idle

      // Wait well past the idle TTL plus a sweep cycle.
      await new Promise((r) => setTimeout(r, 200));

      // The sweeper closed and removed the session: a GET with its id now 404s
      // (before eviction this id was valid, proving it was actually evicted).
      const gone = await fetch(`http://127.0.0.1:${handle.port}/mcp`, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${TEST_TOKEN}`,
          'Mcp-Session-Id': sessionId as string,
        },
      });
      expect(gone.status).toBe(404);
      await gone.text();
    } finally {
      await handle.close();
    }
  });
});
