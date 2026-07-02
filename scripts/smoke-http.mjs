#!/usr/bin/env node

/**
 * Smoke test for the opt-in HTTP transport.
 *
 * Mirrors smoke-mcp.mjs but drives the server over Streamable HTTP instead of
 * stdio. Requires a built server (npm run build) in ./build/.
 *
 * Usage: node scripts/smoke-http.mjs
 * (called via `npm run smoke:http` which runs `npm run build` first)
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SMOKE_TOKEN = 'metronorth-smoke-http-token';
const HEALTH_POLL_INTERVAL_MS = 100;
const HEALTH_POLL_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return an unused loopback port by briefly binding port 0. */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {{ port: number }} */ (server.address());
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on('error', reject);
  });
}

/**
 * Poll GET /health until 200 or timeout.
 *
 * `getSpawnError` is checked each cycle so a failed spawn surfaces immediately
 * as a rejection here instead of as an uncaught exception thrown from the
 * child process 'error' listener.
 */
async function waitForHealth(port, getSpawnError) {
  const deadline = Date.now() + HEALTH_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const spawnError = getSpawnError?.();
    if (spawnError) {
      throw new Error(`Failed to spawn server: ${spawnError.message}`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.status === 200) return;
    } catch {
      // server not ready yet
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS));
  }
  throw new Error(`Server at port ${port} did not become healthy within ${HEALTH_POLL_TIMEOUT_MS}ms`);
}

function assertIncludes(values, expected, message) {
  if (!values.includes(expected)) {
    throw new Error(`${message}. Found: ${values.join(', ')}`);
  }
}

// ---------------------------------------------------------------------------
// Database seeding (same logic as smoke-mcp.mjs)
// ---------------------------------------------------------------------------

async function seedSmokeDatabase() {
  const {
    closeDatabase,
    getDatabase,
    runStatement,
    setMetadata,
    transaction,
  } = await import('../build/infrastructure/database.js');
  const { getMetroNorthServiceContext } = await import('../build/domain/transit-time.js');
  const { serviceDate, serviceDateCompact } = getMetroNorthServiceContext();
  const now = new Date().toISOString();

  getDatabase();

  transaction(() => {
    runStatement('DELETE FROM stop_times');
    runStatement('DELETE FROM trips');
    runStatement('DELETE FROM routes');
    runStatement('DELETE FROM stops');
    runStatement('DELETE FROM calendar');
    runStatement('DELETE FROM calendar_dates');
    runStatement('DELETE FROM agency');
    runStatement('DELETE FROM metadata');

    runStatement(
      `INSERT INTO agency (agency_id, agency_name, agency_url, agency_timezone)
       VALUES (?, ?, ?, ?)`,
      ['MNR', 'Metro-North Railroad', 'https://new.mta.info/agency/metro-north-railroad', 'America/New_York']
    );

    runStatement(
      `INSERT INTO stops (stop_id, stop_name, stop_lat, stop_lon, location_type, wheelchair_boarding)
       VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)`,
      [
        'GCT', 'Grand Central Terminal', 40.7527, -73.9772, 1, 1,
        'WP',  'White Plains',           41.033,  -73.7757, 1, 1,
      ]
    );

    runStatement(
      `INSERT INTO routes (route_id, agency_id, route_long_name, route_type)
       VALUES (?, ?, ?, ?)`,
      ['2', 'MNR', 'Harlem', 2]
    );

    runStatement(
      `INSERT INTO calendar (
         service_id, monday, tuesday, wednesday, thursday, friday, saturday, sunday, start_date, end_date
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['SMOKE', 1, 1, 1, 1, 1, 1, 1, serviceDateCompact, serviceDateCompact]
    );

    runStatement(
      `INSERT INTO trips (
         trip_id, route_id, service_id, trip_headsign, trip_short_name, direction_id
       )
       VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)`,
      [
        'smoke-http-trip-1', '2', 'SMOKE', 'White Plains', '9001', 0,
        'smoke-http-trip-2', '2', 'SMOKE', 'White Plains', '9002', 0,
      ]
    );

    runStatement(
      `INSERT INTO stop_times (
         trip_id, arrival_time, departure_time, stop_id, stop_sequence
       )
       VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`,
      [
        'smoke-http-trip-1', '05:00:00', '05:00:00', 'GCT', 1,
        'smoke-http-trip-1', '05:42:00', '05:42:00', 'WP',  2,
        'smoke-http-trip-2', '06:00:00', '06:00:00', 'GCT', 1,
        'smoke-http-trip-2', '06:42:00', '06:42:00', 'WP',  2,
      ]
    );
  });

  setMetadata('gtfs_last_update', now);
  setMetadata('gtfs_stops_count', '2');
  setMetadata('gtfs_trips_count', '2');
  setMetadata('gtfs_smoke_http_service_date', serviceDate);

  closeDatabase();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const smokeDir = mkdtempSync(path.join(tmpdir(), 'metronorth-mcp-smoke-http-'));
  const smokeDbPath = path.join(smokeDir, 'metronorth.db');

  // Must be set before seeding so the DB module uses the right path.
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
  process.env.DB_PATH = smokeDbPath;
  delete process.env.REDIS_URL;

  let serverProcess = null;
  let client = null;

  try {
    // Seed the database before spawning the server.
    await seedSmokeDatabase();

    const port = await getFreePort();

    // Spawn the built server in HTTP mode.
    serverProcess = spawn(
      process.execPath,
      ['build/index.js', '--http', '--port', String(port), '--token', SMOKE_TOKEN],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: 'test',
          LOG_LEVEL: 'error',
          DB_PATH: smokeDbPath,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    let serverStderr = '';
    serverProcess.stderr?.on('data', (chunk) => {
      serverStderr += chunk.toString();
    });

    // Capture a spawn failure rather than throwing inside the listener (which
    // would become an uncaught exception). waitForHealth rejects on it.
    let spawnError = null;
    serverProcess.on('error', (err) => {
      spawnError = err;
    });

    // Wait for the server to become healthy.
    await waitForHealth(port, () => spawnError);

    // Connect the MCP client over HTTP with bearer-token auth.
    client = new Client(
      { name: 'metronorth-mcp-smoke-http', version: '1.0.0' },
      { capabilities: {} }
    );

    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
      {
        requestInit: {
          headers: { Authorization: `Bearer ${SMOKE_TOKEN}` },
        },
      }
    );

    await client.connect(transport);

    // Protocol assertions
    const tools = await client.listTools();
    const resources = await client.listResources();
    const resourceTemplates = await client.listResourceTemplates();
    const prompts = await client.listPrompts();

    if (tools.tools.length !== 10) {
      throw new Error(`Expected 10 tools, got ${tools.tools.length}: ${tools.tools.map((t) => t.name).join(', ')}`);
    }
    if (resources.resources.length !== 5) {
      throw new Error(`Expected 5 resources, got ${resources.resources.length}`);
    }
    if (prompts.prompts.length !== 3) {
      throw new Error(`Expected 3 prompts, got ${prompts.prompts.length}`);
    }

    assertIncludes(
      tools.tools.map((t) => t.name),
      'get_system_status',
      'tools/list did not include get_system_status'
    );
    assertIncludes(
      tools.tools.map((t) => t.name),
      'search_stations',
      'tools/list did not include search_stations'
    );
    assertIncludes(
      tools.tools.map((t) => t.name),
      'plan_metro_north_trip',
      'tools/list did not include plan_metro_north_trip'
    );
    assertIncludes(
      resources.resources.map((r) => r.uri),
      'metronorth://system/status',
      'resources/list did not include system status'
    );
    assertIncludes(
      resources.resources.map((r) => r.uri),
      'metronorth://usage',
      'resources/list did not include usage guide'
    );
    assertIncludes(
      resourceTemplates.resourceTemplates.map((t) => t.uriTemplate),
      'metronorth://station/{station_name}',
      'resources/templates/list did not include station template'
    );
    assertIncludes(
      prompts.prompts.map((p) => p.name),
      'plan-metro-north-trip',
      'prompts/list did not include plan-metro-north-trip'
    );
    assertIncludes(
      prompts.prompts.map((p) => p.name),
      'use-metro-north-mcp',
      'prompts/list did not include use-metro-north-mcp'
    );

    // Tool call: get_system_status
    const status = await client.callTool(
      { name: 'get_system_status', arguments: {} },
      CallToolResultSchema
    );
    if (!status.structuredContent || status.isError) {
      throw new Error('get_system_status did not return structured successful content');
    }

    // Tool call: search_stations (the featured HTTP-transport call)
    const stations = await client.callTool(
      { name: 'search_stations', arguments: { query: 'Grand', limit: 5 } },
      CallToolResultSchema
    );
    if (!stations.structuredContent || stations.isError) {
      throw new Error('search_stations did not return structured successful content');
    }
    const stationContent = /** @type {{ results: unknown[] }} */ (stations.structuredContent);
    if (!Array.isArray(stationContent.results)) {
      throw new Error('search_stations did not return a results array');
    }

    console.log('Metro-North MCP HTTP transport smoke check passed.');
    console.log(`Tools: ${tools.tools.length}`);
    console.log(`Resources: ${resources.resources.length}`);
    console.log(`Resource templates: ${resourceTemplates.resourceTemplates.length}`);
    console.log(`Prompts: ${prompts.prompts.length}`);
    console.log(`search_stations results for "Grand": ${stationContent.results.length}`);
  } catch (error) {
    console.error('Smoke test FAILED:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    if (client) {
      await client.close().catch(() => {});
    }
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      // Give it a moment to exit cleanly before the process ends.
      await new Promise((r) => setTimeout(r, 300));
    }
    rmSync(smokeDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
