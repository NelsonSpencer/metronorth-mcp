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
 * Teardown: `_closeActiveHttpServer()` closes the listening socket so vitest
 * can exit cleanly after the suite.
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

import { runHttp, _closeActiveHttpServer } from '../src/http-server.js';

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

// ---------------------------------------------------------------------------
// Suite state
// ---------------------------------------------------------------------------

let port: number;
/** MCP client authenticated with TEST_TOKEN. */
let mcpClient: Client;

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll(async () => {
  port = await getFreePort();

  // Boot the HTTP server in-process on the ephemeral port with a bearer token.
  await runHttp({ host: '127.0.0.1', port, token: TEST_TOKEN });

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
  // Then close the HTTP server so the event loop can drain and vitest exits.
  await _closeActiveHttpServer();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCP protocol over HTTP', () => {
  it('tools/list returns the expected 10 tools', async () => {
    const result = await mcpClient.listTools();

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
