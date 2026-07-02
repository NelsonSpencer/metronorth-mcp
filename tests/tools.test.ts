import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { handleToolCall, toolDefinitions } from '../src/tools/index.js';
import { toolHandlers } from '../src/tools/handlers.js';
import { packageMetadata } from '../src/package-metadata.js';

// Mock the database and services for testing
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
  deleteMetadata: vi.fn(),
  transaction: vi.fn((fn: () => unknown) => fn()),
  SCHEMA_VERSION: 2,
  GTFS_FORCE_REFRESH_KEY: 'gtfs_force_refresh',
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

describe('Tool Definitions', () => {
  it('should have all required tools', () => {
    const toolNames = toolDefinitions.map((t) => t.name);

    expect(toolDefinitions).toHaveLength(10);
    expect(toolNames).toEqual([
      'get_departures',
      'get_trip_details',
      'get_route_schedule',
      'get_service_alerts',
      'search_stations',
      'get_station_info',
      'get_system_status',
      'get_station_pair_schedule',
      'get_first_last_trains',
      'plan_metro_north_trip',
    ]);
  });

  it('should have valid input schemas', () => {
    for (const tool of toolDefinitions) {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties).toBeDefined();
    }
  });

  it('should have descriptions for all tools', () => {
    for (const tool of toolDefinitions) {
      expect(tool.description).toBeDefined();
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });

  it('keeps tool definitions and handlers in sync', () => {
    expect(Object.keys(toolHandlers).sort()).toEqual(
      toolDefinitions.map((tool) => tool.name).sort()
    );
  });
});

describe('Tool Result Contract', () => {
  it('returns the stable structured success shape with explicit services', async () => {
    const stationService = {
      findStationByName: vi.fn(),
      getStationInfo: vi.fn(),
      searchStations: vi.fn(async () => [
        {
          stop_id: 'GCT',
          stop_name: 'Grand Central Terminal',
          zone_id: '1',
        },
      ]),
    };
    const structuredContent = {
      query: 'Grand',
      results: [
        {
          stop_id: 'GCT',
          name: 'Grand Central Terminal',
          zone: '1',
        },
      ],
      total: 1,
    };

    const result = await handleToolCall(
      'search_stations',
      {
        query: 'Grand',
        limit: 1,
      },
      { stationService }
    );

    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify(structuredContent, null, 2),
        },
      ],
      structuredContent,
    });
    expect(result.isError).toBeUndefined();
    expect(stationService.searchStations).toHaveBeenCalledWith('Grand', 1);
  });

  it('returns the stable structured error shape', async () => {
    const result = await handleToolCall('get_departures', {});
    const error = result.structuredContent?.error as Record<string, unknown>;

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      error: {
        code: 'invalid_arguments',
        message: error.message,
        tool: 'get_departures',
        request_id: expect.any(String),
      },
    });
    expect(result.content).toEqual([
      {
        type: 'text',
        text: `Error: ${error.message}`,
      },
    ]);
  });
});

describe('Tool Handlers', () => {
  describe('get_departures', () => {
    it('should require station_name parameter', async () => {
      const result = await handleToolCall('get_departures', {});
      const text = result.content[0].text;

      expect(text).toContain('Error');
    });

    it('should accept valid parameters', async () => {
      const result = await handleToolCall('get_departures', {
        station_name: 'Grand Central',
        limit: 5,
      });

      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe('text');
    });
  });

  describe('search_stations', () => {
    it('should require query parameter', async () => {
      const result = await handleToolCall('search_stations', {});
      const text = result.content[0].text;

      expect(text).toContain('Error');
    });

    it('should accept valid query', async () => {
      const result = await handleToolCall('search_stations', {
        query: 'Grand',
        limit: 3,
      });

      expect(result.content).toBeDefined();
    });
  });

  describe('get_system_status', () => {
    it('should return system status', async () => {
      const result = await handleToolCall('get_system_status', {});
      const text = result.content[0].text;
      const status = JSON.parse(text);

      expect(status.status).toBe('operational');
      expect(result.structuredContent?.status).toBe('operational');
      expect(status.server).toBeDefined();
      expect(status.server.version).toBe(packageMetadata.version);
      expect(result.structuredContent?.server).toMatchObject({
        name: packageMetadata.name,
        version: packageMetadata.version,
      });
    });
  });

  describe('unknown tool', () => {
    it('should throw for unknown tool so the server can return a protocol error', async () => {
      await expect(handleToolCall('unknown_tool', {})).rejects.toThrow('unknown_tool');
    });
  });
});

describe('Input Validation', () => {
  it('should validate direction enum', async () => {
    const result = await handleToolCall(
      'get_departures',
      {
        station_name: 'Grand Central',
        direction: 'invalid_direction',
      },
      { requestId: 'validation-test' }
    );

    const text = result.content[0].text;
    expect(text).toContain('Error');
    expect(result.isError).toBe(true);
    expect(result.structuredContent?.error).toMatchObject({
      code: 'invalid_arguments',
      tool: 'get_departures',
      request_id: 'validation-test',
    });
  });

  it('should validate limit range', async () => {
    const result = await handleToolCall('get_departures', {
      station_name: 'Grand Central',
      limit: 100, // Over max of 50
    });

    const text = result.content[0].text;
    expect(text).toContain('Error');
  });

  it('should accept boolean include_realtime', async () => {
    const result = await handleToolCall('get_departures', {
      station_name: 'Grand Central',
      include_realtime: false,
    });

    expect(result.content).toBeDefined();
  });
});
