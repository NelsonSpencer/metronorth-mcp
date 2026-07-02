import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleToolCall } from '../src/tools/index.js';
import type { StationPairTrip, TransferItinerary } from '../src/domain/gtfs.js';

const scheduleMocks = vi.hoisted(() => ({
  getStationPairSchedule: vi.fn(),
  getTransferItineraries: vi.fn(),
}));

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

vi.mock('../src/infrastructure/schedule-service.js', () => ({
  getScheduleService: vi.fn(() => ({
    getStationPairSchedule: scheduleMocks.getStationPairSchedule,
    getTransferItineraries: scheduleMocks.getTransferItineraries,
    getFirstLastTrains: vi.fn(),
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
    getServiceAlerts: vi.fn(() => Promise.resolve([])),
  })),
}));

function makeDirect(id: string): StationPairTrip {
  return {
    trip_id: id,
    route_name: 'Harlem',
    destination: 'Southeast',
    direction: 'outbound',
    origin_station: 'Grand Central Terminal',
    destination_station: 'White Plains',
    scheduled_origin_departure: '17:00',
    actual_origin_departure: null,
    scheduled_destination_arrival: '17:38',
    actual_destination_arrival: null,
    duration_minutes: 38,
    origin_delay_minutes: null,
    destination_delay_minutes: null,
    track: null,
    scheduled_track: null,
    track_source: null,
    train_status: null,
    fare_class: 'peak',
    note: null,
    status: 'unknown',
  };
}

function makeTransfer(finalTripId: string): TransferItinerary {
  const leg1 = makeDirect('L1');
  const leg2 = { ...makeDirect(finalTripId), route_name: 'New Canaan' };
  return {
    itinerary_type: 'one_transfer',
    legs: [leg1, leg2],
    transfer: {
      station: 'Stamford',
      arrive: '10:30',
      depart: '10:45',
      wait_minutes: 15,
      guaranteed: true,
    },
    total_duration_minutes: 70,
    connection_at_risk: false,
  };
}

describe('plan_metro_north_trip with transfers', () => {
  beforeEach(() => {
    scheduleMocks.getStationPairSchedule.mockReset();
    scheduleMocks.getTransferItineraries.mockReset();
  });

  it('merges direct options with transfer itineraries when direct does not fill the limit', async () => {
    scheduleMocks.getStationPairSchedule.mockResolvedValue([makeDirect('D1')]);
    scheduleMocks.getTransferItineraries.mockResolvedValue([makeTransfer('X1')]);

    const result = await handleToolCall('plan_metro_north_trip', {
      origin_station: 'Grand Central',
      destination_station: 'White Plains',
      limit: 3,
    });

    expect(result.isError).toBeUndefined();
    expect(scheduleMocks.getTransferItineraries).toHaveBeenCalledTimes(1);
    expect(result.structuredContent?.recommended_option).toMatchObject({
      itinerary_type: 'direct',
      trip_id: 'D1',
    });
    expect(result.structuredContent?.alternate_options).toHaveLength(0);
    expect(result.structuredContent?.transfer_options).toHaveLength(1);
    const transfers = result.structuredContent?.transfer_options as Array<Record<string, unknown>>;
    expect(transfers[0].itinerary_type).toBe('one_transfer');
    // Legs are normalized to the direct-option shape: `route` present,
    // raw StationPairTrip field names (route_name/origin_station) absent.
    const legs = transfers[0].legs as Array<Record<string, unknown>>;
    expect(legs[0].route).toBe('Harlem');
    expect(legs[0].route_name).toBeUndefined();
    expect(legs[0].origin).toBe('Grand Central Terminal');
    expect(legs[0].origin_station).toBeUndefined();
    expect(legs[0].origin_departure).toMatchObject({ scheduled: '17:00' });
    // Itinerary-level fields still pass through unchanged.
    expect(transfers[0].total_duration_minutes).toBe(70);
    expect(transfers[0].connection_at_risk).toBe(false);
    expect(transfers[0].transfer).toMatchObject({ station: 'Stamford', wait_minutes: 15 });
  });

  it('recommends the best transfer itinerary when no direct trip exists', async () => {
    scheduleMocks.getStationPairSchedule.mockResolvedValue([]);
    scheduleMocks.getTransferItineraries.mockResolvedValue([
      makeTransfer('X1'),
      makeTransfer('X2'),
    ]);

    const result = await handleToolCall('plan_metro_north_trip', {
      origin_station: 'New Canaan',
      destination_station: 'White Plains',
      limit: 3,
    });

    expect(result.isError).toBeUndefined();
    const recommended = result.structuredContent?.recommended_option as Record<string, unknown>;
    expect(recommended).toMatchObject({ itinerary_type: 'one_transfer' });
    // The recommended transfer's legs are formatted like direct options.
    const recommendedLegs = recommended.legs as Array<Record<string, unknown>>;
    expect(recommendedLegs[0].route).toBe('Harlem');
    expect(recommendedLegs[0].route_name).toBeUndefined();
    // Alternates are direct-only, so they are empty when no direct train exists.
    // Transfers are never duplicated into alternate_options.
    expect(result.structuredContent?.alternate_options).toHaveLength(0);
    expect(result.structuredContent?.transfer_options).toHaveLength(2);
  });

  it('returns a not_found error when neither direct nor transfer options exist', async () => {
    scheduleMocks.getStationPairSchedule.mockResolvedValue([]);
    scheduleMocks.getTransferItineraries.mockResolvedValue([]);

    const result = await handleToolCall('plan_metro_north_trip', {
      origin_station: 'Grand Central',
      destination_station: 'White Plains',
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent?.error).toMatchObject({
      code: 'not_found',
      tool: 'plan_metro_north_trip',
    });
  });

  it('short-circuits the transfer query when direct options fill the limit', async () => {
    scheduleMocks.getStationPairSchedule.mockResolvedValue([
      makeDirect('D1'),
      makeDirect('D2'),
      makeDirect('D3'),
    ]);

    const result = await handleToolCall('plan_metro_north_trip', {
      origin_station: 'Grand Central',
      destination_station: 'White Plains',
      limit: 3,
    });

    expect(result.isError).toBeUndefined();
    expect(scheduleMocks.getTransferItineraries).not.toHaveBeenCalled();
    expect(result.structuredContent?.transfer_options).toHaveLength(0);
    expect(result.structuredContent?.recommended_option).toMatchObject({ trip_id: 'D1' });
    expect(result.structuredContent?.alternate_options).toHaveLength(2);
  });
});
