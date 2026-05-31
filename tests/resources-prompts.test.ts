import { describe, expect, it, vi } from 'vitest';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import {
  handleReadResource,
  resourceDefinitions,
  resourceTemplateDefinitions,
} from '../src/resources.js';
import { handleToolCall } from '../src/tools/index.js';
import { handleGetPrompt, promptDefinitions } from '../src/prompts.js';
import { packageMetadata } from '../src/package-metadata.js';

interface StatusPayload {
  status: string;
  gtfs_data: unknown;
  realtime: unknown;
  server: {
    name: string;
    version: string;
  };
}

vi.mock('../src/infrastructure/database.js', () => ({
  getMetadata: vi.fn((key: string) => {
    const values: Record<string, string> = {
      gtfs_last_update: '2026-05-31T00:00:00.000Z',
      gtfs_stops_count: '2',
      gtfs_trips_count: '3',
    };
    return values[key] || null;
  }),
}));

vi.mock('../src/infrastructure/gtfs-loader.js', () => ({
  getGTFSLoader: vi.fn(() => ({
    needsUpdate: vi.fn(() => Promise.resolve(false)),
  })),
}));

vi.mock('../src/infrastructure/realtime-client.js', () => ({
  getRealtimeClient: vi.fn(() => ({
    isAvailable: vi.fn(() => true),
  })),
}));

vi.mock('../src/infrastructure/station-service.js', () => ({
  getStationService: vi.fn(() => ({
    getAllStations: vi.fn(() =>
      Promise.resolve([
        {
          stop_id: 'GCT',
          stop_name: 'Grand Central Terminal',
          zone_id: '1',
        },
        {
          stop_id: 'WP',
          stop_name: 'White Plains',
          zone_id: '4',
        },
      ])
    ),
    getStationInfo: vi.fn((stationName: string) =>
      stationName.toLowerCase().includes('grand')
        ? Promise.resolve({
            stop_id: 'GCT',
            name: 'Grand Central Terminal',
            latitude: 40.7527,
            longitude: -73.9772,
            zone_id: '1',
            routes: ['Hudson', 'Harlem', 'New Haven'],
            wheelchair_accessible: true,
          })
        : Promise.resolve(null)
    ),
  })),
}));

describe('MCP resources', () => {
  it('lists the static resources and station template', () => {
    expect(resourceDefinitions.map((resource) => resource.uri)).toEqual([
      'metronorth://usage',
      'metronorth://examples',
      'metronorth://system/status',
      'metronorth://routes',
      'metronorth://stations',
    ]);
    expect(resourceDefinitions).toHaveLength(5);
    expect(resourceTemplateDefinitions[0].uriTemplate).toBe(
      'metronorth://station/{station_name}'
    );
    expect(resourceTemplateDefinitions).toHaveLength(1);
  });

  it('reads agent usage resources as markdown', async () => {
    const usage = await handleReadResource('metronorth://usage');
    const examples = await handleReadResource('metronorth://examples');

    expect(usage.contents[0].mimeType).toBe('text/markdown');
    expect(usage.contents[0].text).toContain('search_stations');
    expect(usage.contents[0].text).toContain('realtime');
    expect(examples.contents[0].mimeType).toBe('text/markdown');
    expect(examples.contents[0].text).toContain('get_departures');
    expect(examples.contents[0].text).toContain('invalid station names');
  });

  it('reads the system status resource as JSON', async () => {
    const result = await handleReadResource('metronorth://system/status');
    const payload = JSON.parse(result.contents[0].text);

    expect(payload.gtfs_data.stops).toBe(2);
    expect(payload.gtfs_data.needs_update).toBe(false);
    expect(payload.realtime.available).toBe(true);
    expect(payload.server.version).toBe(packageMetadata.version);
  });

  it('returns the same core system status shape from resource and tool', async () => {
    const resourceResult = await handleReadResource('metronorth://system/status');
    const resourcePayload = JSON.parse(resourceResult.contents[0].text) as StatusPayload;
    const toolResult = await handleToolCall(
      'get_system_status',
      {},
      { requestId: 'status-test' }
    );
    const toolPayload = toolResult.structuredContent as StatusPayload;

    const normalize = (payload: StatusPayload) => ({
      status: payload.status,
      gtfs_data: payload.gtfs_data,
      realtime: payload.realtime,
      server: {
        name: payload.server.name,
        version: payload.server.version,
      },
    });

    expect(normalize(resourcePayload)).toEqual(normalize(toolPayload));
  });

  it('reads the stations and station detail resources', async () => {
    const stations = await handleReadResource('metronorth://stations');
    const stationList = JSON.parse(stations.contents[0].text);
    const station = await handleReadResource('metronorth://station/Grand%20Central');
    const stationDetail = JSON.parse(station.contents[0].text);

    expect(stationList.total).toBe(2);
    expect(stationDetail.station.name).toBe('Grand Central Terminal');
  });

  it('returns MCP errors for unknown resources', async () => {
    await expect(handleReadResource('metronorth://station/Unknown')).rejects.toMatchObject({
      code: ErrorCode.InvalidRequest,
    } satisfies Partial<McpError>);
  });
});

describe('MCP prompts', () => {
  it('lists the prompt templates', () => {
    expect(promptDefinitions.map((prompt) => prompt.name)).toEqual([
      'use-metro-north-mcp',
      'plan-metro-north-trip',
      'summarize-service-status',
    ]);
    expect(promptDefinitions).toHaveLength(3);
  });

  it('returns the MCP usage prompt without arguments', () => {
    const prompt = handleGetPrompt('use-metro-north-mcp');

    expect(prompt.messages[0].content.type).toBe('text');
    expect(prompt.messages[0].content.text).toContain('Search stations first');
    expect(prompt.messages[0].content.text).toContain('metronorth://system/status');
  });

  it('returns the trip-planning prompt with provided arguments', () => {
    const prompt = handleGetPrompt('plan-metro-north-trip', {
      origin: 'Grand Central',
      destination: 'White Plains',
    });

    expect(prompt.messages[0].content.type).toBe('text');
    expect(prompt.messages[0].content.text).toContain('Grand Central');
    expect(prompt.messages[0].content.text).toContain('White Plains');
  });

  it('validates required prompt arguments', () => {
    expect(() => handleGetPrompt('plan-metro-north-trip', {})).toThrow(
      'Missing required prompt argument'
    );
  });
});
