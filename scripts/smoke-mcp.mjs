#!/usr/bin/env node

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const client = new Client(
  {
    name: 'metronorth-mcp-smoke',
    version: '1.0.0',
  },
  {
    capabilities: {},
  }
);

const smokeDir = mkdtempSync(path.join(tmpdir(), 'metronorth-mcp-smoke-'));
const smokeDbPath = path.join(smokeDir, 'metronorth.db');

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
process.env.DB_PATH = smokeDbPath;
delete process.env.REDIS_URL;

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['build/index.js'],
  cwd: process.cwd(),
  stderr: 'pipe',
});

async function main() {
  let stderr = '';
  transport.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await seedSmokeDatabase();
    await client.connect(transport);

    const tools = await client.listTools();
    const resources = await client.listResources();
    const resourceTemplates = await client.listResourceTemplates();
    const prompts = await client.listPrompts();

    assertIncludes(
      tools.tools.map((tool) => tool.name),
      'get_system_status',
      'tools/list did not include get_system_status'
    );
    assertIncludes(
      tools.tools.map((tool) => tool.name),
      'plan_metro_north_trip',
      'tools/list did not include plan_metro_north_trip'
    );
    assertIncludes(
      resources.resources.map((resource) => resource.uri),
      'metronorth://system/status',
      'resources/list did not include system status'
    );
    assertIncludes(
      resources.resources.map((resource) => resource.uri),
      'metronorth://usage',
      'resources/list did not include usage guide'
    );
    assertIncludes(
      resourceTemplates.resourceTemplates.map((template) => template.uriTemplate),
      'metronorth://station/{station_name}',
      'resources/templates/list did not include station template'
    );
    assertIncludes(
      prompts.prompts.map((prompt) => prompt.name),
      'plan-metro-north-trip',
      'prompts/list did not include plan-metro-north-trip'
    );
    assertIncludes(
      prompts.prompts.map((prompt) => prompt.name),
      'use-metro-north-mcp',
      'prompts/list did not include use-metro-north-mcp'
    );

    const status = await client.callTool(
      {
        name: 'get_system_status',
        arguments: {},
      },
      CallToolResultSchema
    );
    if (!status.structuredContent || status.isError) {
      throw new Error('get_system_status did not return structured successful content');
    }

    const tripPlan = await client.callTool(
      {
        name: 'plan_metro_north_trip',
        arguments: {
          origin_station: 'Grand Central',
          destination_station: 'White Plains',
          depart_after: '00:00',
          limit: 2,
          include_realtime: false,
          include_alerts: false,
        },
      },
      CallToolResultSchema
    );
    if (!tripPlan.structuredContent || tripPlan.isError) {
      throw new Error('plan_metro_north_trip did not return structured successful content');
    }
    if (!tripPlan.structuredContent.recommended_option) {
      throw new Error('plan_metro_north_trip did not return a recommended option');
    }

    const systemResource = await client.readResource({
      uri: 'metronorth://system/status',
    });
    if (!systemResource.contents[0]?.text.includes('gtfs_data')) {
      throw new Error('system status resource did not include GTFS data');
    }

    const usageResource = await client.readResource({
      uri: 'metronorth://usage',
    });
    if (!usageResource.contents[0]?.text.includes('search_stations')) {
      throw new Error('usage resource did not include station-search guidance');
    }

    const usagePrompt = await client.getPrompt({
      name: 'use-metro-north-mcp',
      arguments: {},
    });
    if (!usagePrompt.messages[0]?.content || usagePrompt.messages[0].content.type !== 'text') {
      throw new Error('use-metro-north-mcp did not return a text prompt message');
    }

    const prompt = await client.getPrompt({
      name: 'plan-metro-north-trip',
      arguments: {
        origin: 'Grand Central',
        destination: 'White Plains',
      },
    });
    if (!prompt.messages[0]?.content || prompt.messages[0].content.type !== 'text') {
      throw new Error('plan-metro-north-trip did not return a text prompt message');
    }

    console.log('Metro-North MCP protocol smoke check passed.');
    console.log(`Tools: ${tools.tools.length}`);
    console.log(`Resources: ${resources.resources.length}`);
    console.log(`Resource templates: ${resourceTemplates.resourceTemplates.length}`);
    console.log(`Prompts: ${prompts.prompts.length}`);
  } catch (error) {
    if (stderr.trim()) {
      console.error(stderr.trim());
    }
    throw error;
  } finally {
    await client.close();
    rmSync(smokeDir, { recursive: true, force: true });
  }
}

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
        'GCT',
        'Grand Central Terminal',
        40.7527,
        -73.9772,
        1,
        1,
        'WP',
        'White Plains',
        41.033,
        -73.7757,
        1,
        1,
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
        'smoke-trip-1',
        '2',
        'SMOKE',
        'White Plains',
        '9001',
        0,
        'smoke-trip-2',
        '2',
        'SMOKE',
        'White Plains',
        '9002',
        0,
      ]
    );

    runStatement(
      `INSERT INTO stop_times (
         trip_id, arrival_time, departure_time, stop_id, stop_sequence
       )
       VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`,
      [
        'smoke-trip-1',
        '05:00:00',
        '05:00:00',
        'GCT',
        1,
        'smoke-trip-1',
        '05:42:00',
        '05:42:00',
        'WP',
        2,
        'smoke-trip-2',
        '06:00:00',
        '06:00:00',
        'GCT',
        1,
        'smoke-trip-2',
        '06:42:00',
        '06:42:00',
        'WP',
        2,
      ]
    );
  });

  setMetadata('gtfs_last_update', now);
  setMetadata('gtfs_stops_count', '2');
  setMetadata('gtfs_trips_count', '2');
  setMetadata('gtfs_smoke_service_date', serviceDate);

  closeDatabase();
}

function assertIncludes(values, expected, message) {
  if (!values.includes(expected)) {
    throw new Error(`${message}. Found: ${values.join(', ')}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
