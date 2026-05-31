import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { handleToolCall, toolDefinitions } from '../src/tools/index.js';

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

describe('Tool Definitions', () => {
  it('should have all required tools', () => {
    const toolNames = toolDefinitions.map((t) => t.name);

    expect(toolNames).toContain('get_departures');
    expect(toolNames).toContain('get_trip_details');
    expect(toolNames).toContain('get_route_schedule');
    expect(toolNames).toContain('get_service_alerts');
    expect(toolNames).toContain('search_stations');
    expect(toolNames).toContain('get_station_info');
    expect(toolNames).toContain('get_system_status');
    expect(toolNames).toContain('get_station_pair_schedule');
    expect(toolNames).toContain('get_first_last_trains');
    expect(toolNames).toContain('plan_metro_north_trip');
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
      expect(status.server.version).toBe('2.0.0');
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
    const result = await handleToolCall('get_departures', {
      station_name: 'Grand Central',
      direction: 'invalid_direction',
    });

    const text = result.content[0].text;
    expect(text).toContain('Error');
    expect(result.isError).toBe(true);
    expect(result.structuredContent?.error).toMatchObject({
      code: 'invalid_arguments',
      tool: 'get_departures',
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
