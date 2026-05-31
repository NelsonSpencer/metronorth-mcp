import { describe, expect, it, vi } from 'vitest';
import { handleToolCall } from '../src/tools/index.js';

vi.mock('../src/infrastructure/database.js', () => ({
  getMetadata: vi.fn((key: string) => {
    const values: Record<string, string> = {
      gtfs_last_update: '2026-05-31T00:00:00.000Z',
      gtfs_stops_count: '114',
      gtfs_trips_count: '34148',
    };
    return values[key] || null;
  }),
}));

const pairTrips = [
  {
    trip_id: 'trip-1',
    route_name: 'Harlem',
    destination: 'Southeast',
    direction: 'outbound',
    origin_station: 'Grand Central Terminal',
    destination_station: 'White Plains',
    scheduled_origin_departure: '17:00',
    actual_origin_departure: '17:05',
    scheduled_destination_arrival: '17:38',
    actual_destination_arrival: '17:43',
    duration_minutes: 38,
    origin_delay_minutes: 5,
    destination_delay_minutes: 5,
    status: 'delayed' as const,
  },
  {
    trip_id: 'trip-2',
    route_name: 'Harlem',
    destination: 'Southeast',
    direction: 'outbound',
    origin_station: 'Grand Central Terminal',
    destination_station: 'White Plains',
    scheduled_origin_departure: '17:30',
    actual_origin_departure: null,
    scheduled_destination_arrival: '18:08',
    actual_destination_arrival: null,
    duration_minutes: 38,
    origin_delay_minutes: null,
    destination_delay_minutes: null,
    status: 'unknown' as const,
  },
];

vi.mock('../src/infrastructure/schedule-service.js', () => ({
  getScheduleService: vi.fn(() => ({
    getStationPairSchedule: vi.fn((originStationName: string) =>
      Promise.resolve(originStationName.includes('Unknown') ? [] : pairTrips)
    ),
    getFirstLastTrains: vi.fn(() =>
      Promise.resolve({
        service_date: '2026-05-31',
        origin_station: 'Grand Central',
        destination_station: 'White Plains',
        first_train: pairTrips[0],
        last_train: pairTrips[1],
        total_direct_trips: 2,
      })
    ),
  })),
}));

vi.mock('../src/infrastructure/station-service.js', () => ({
  getStationService: vi.fn(() => ({
    findStationByName: vi.fn((stationName: string) =>
      Promise.resolve({
        stop_id: stationName.toLowerCase().includes('white') ? 'WP' : 'GCT',
        stop_name: stationName,
      })
    ),
  })),
}));

vi.mock('../src/infrastructure/gtfs-loader.js', () => ({
  getGTFSLoader: vi.fn(() => ({
    needsUpdate: vi.fn(() => Promise.resolve(false)),
  })),
}));

vi.mock('../src/infrastructure/realtime-client.js', () => ({
  getRealtimeClient: vi.fn(() => ({
    isAvailable: vi.fn(() => true),
    getServiceAlerts: vi.fn(() =>
      Promise.resolve([
        {
          alert_id: 'alert-1',
          header_text: 'Harlem Line service change',
          description_text: 'Expect schedule changes.',
          cause: 'maintenance',
          effect: 'modified_service',
          informed_entities: [{ route_id: '2', stop_id: null }],
        },
      ])
    ),
  })),
}));

describe('trip-planning MCP tools', () => {
  it('lists trip-planning tools in tool definitions', async () => {
    const { toolDefinitions } = await import('../src/tools/index.js');
    const toolNames = toolDefinitions.map((tool) => tool.name);

    expect(toolNames).toContain('get_station_pair_schedule');
    expect(toolNames).toContain('get_first_last_trains');
    expect(toolNames).toContain('plan_metro_north_trip');
  });

  it('returns station-pair schedule options', async () => {
    const result = await handleToolCall('get_station_pair_schedule', {
      origin_station: 'Grand Central',
      destination_station: 'White Plains',
      depart_after: '17:00',
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.trips).toHaveLength(2);
    expect(result.structuredContent?.realtime_available).toBe(true);
  });

  it('returns structured not_found for no direct station-pair trips', async () => {
    const result = await handleToolCall('get_station_pair_schedule', {
      origin_station: 'Unknown Origin',
      destination_station: 'White Plains',
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent?.error).toMatchObject({
      code: 'not_found',
      tool: 'get_station_pair_schedule',
    });
  });

  it('returns first and last trains', async () => {
    const result = await handleToolCall('get_first_last_trains', {
      origin_station: 'Grand Central',
      destination_station: 'White Plains',
    });

    expect(result.structuredContent?.first_train).toMatchObject({ trip_id: 'trip-1' });
    expect(result.structuredContent?.last_train).toMatchObject({ trip_id: 'trip-2' });
    expect(result.structuredContent?.no_service).toBeNull();
  });

  it('returns a trip plan with options, alerts, freshness, and realtime caveat', async () => {
    const result = await handleToolCall('plan_metro_north_trip', {
      origin_station: 'Grand Central',
      destination_station: 'White Plains',
      limit: 2,
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.recommended_option).toMatchObject({ trip_id: 'trip-1' });
    expect(result.structuredContent?.alternate_options).toHaveLength(1);
    expect(result.structuredContent?.alerts).toHaveLength(1);
    expect(result.structuredContent?.data_freshness).toMatchObject({ stops: 114 });
    expect(result.structuredContent?.realtime).toMatchObject({ available: true });
  });
});
