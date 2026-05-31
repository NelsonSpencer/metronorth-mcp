import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryLog = vi.hoisted(() => ({
  queries: [] as string[],
  params: [] as unknown[][],
}));

const realtimeMocks = vi.hoisted(() => ({
  isAvailable: vi.fn(() => true),
  getTripUpdates: vi.fn(() => Promise.resolve([])),
  getRealtimeInfoForTripAtStopFromUpdates: vi.fn(() => ({
    delaySeconds: 300,
    status: 'delayed',
    actualTime: null,
  })),
}));

const stationPairRows = vi.hoisted(() => [
  {
    trip_id: 'trip-pair-1',
    trip_short_name: '456',
    route_id: '2',
    route_long_name: 'Harlem',
    trip_headsign: 'Southeast',
    direction_id: 0,
    origin_stop_id: 'GCT',
    origin_stop_name: 'Grand Central Terminal',
    destination_stop_id: 'WP',
    destination_stop_name: 'White Plains',
    origin_departure_time: '24:40:00',
    destination_arrival_time: '25:10:00',
    origin_sequence: 1,
    destination_sequence: 4,
    service_id: 'weekday',
  },
  {
    trip_id: 'trip-pair-2',
    trip_short_name: '789',
    route_id: '2',
    route_long_name: 'Harlem',
    trip_headsign: 'Southeast',
    direction_id: 0,
    origin_stop_id: 'GCT',
    origin_stop_name: 'Grand Central Terminal',
    destination_stop_id: 'WP',
    destination_stop_name: 'White Plains',
    origin_departure_time: '26:00:00',
    destination_arrival_time: '26:35:00',
    origin_sequence: 1,
    destination_sequence: 4,
    service_id: 'weekday',
  },
]);

vi.mock('../src/infrastructure/database.js', () => {
  const prepare = vi.fn((query: string) => {
    queryLog.queries.push(query);

    if (query.includes('FROM calendar') && query.includes('start_date')) {
      return {
        all: vi.fn(() => [{ service_id: 'weekday' }]),
      };
    }

    if (query.includes('FROM calendar_dates')) {
      return {
        all: vi.fn(() => []),
      };
    }

    if (query.includes('COUNT(*) AS total_direct_trips')) {
      return {
        get: vi.fn((...params: unknown[]) => {
          queryLog.params.push(params);
          return { total_direct_trips: stationPairRows.length };
        }),
      };
    }

    if (query.includes('origin_st') && query.includes('destination_st')) {
      return {
        all: vi.fn((...params: unknown[]) => {
          queryLog.params.push(params);
          if (query.includes('ORDER BY origin_st.departure_time DESC')) {
            return [stationPairRows[1]];
          }
          if (!query.includes('origin_st.departure_time >= ?')) {
            return [stationPairRows[0]];
          }
          return stationPairRows;
        }),
      };
    }

    if (query.includes('FROM stop_times st') && query.includes('JOIN trips t')) {
      return {
        all: vi.fn(() => [
          {
            trip_id: 'trip-1',
            trip_short_name: '123',
            route_id: '1',
            route_long_name: 'Hudson',
            trip_headsign: 'Poughkeepsie',
            direction_id: 0,
            departure_time: '12:00:00',
            arrival_time: '11:59:00',
            stop_sequence: 1,
            service_id: 'weekday',
          },
        ]),
      };
    }

    if (query.includes('SELECT s.stop_name')) {
      return {
        all: vi.fn(() => [{ stop_name: 'Harlem-125th Street' }]),
      };
    }

    return {
      all: vi.fn(() => []),
      get: vi.fn(() => undefined),
      run: vi.fn(),
    };
  });

  return {
    getSqlite: vi.fn(() => ({ prepare })),
  };
});

vi.mock('../src/infrastructure/station-service.js', () => ({
  getStationService: vi.fn(() => ({
    findStationByName: vi.fn((stationName: string) =>
      Promise.resolve(
        stationName.toLowerCase().includes('white')
          ? {
              stop_id: 'WP',
              stop_name: 'White Plains',
            }
          : {
              stop_id: 'GCT',
              stop_name: 'Grand Central Terminal',
            }
      )
    ),
  })),
}));

vi.mock('../src/infrastructure/realtime-client.js', () => ({
  getRealtimeClient: vi.fn(() => ({
    isAvailable: realtimeMocks.isAvailable,
    getTripUpdates: realtimeMocks.getTripUpdates,
    getRealtimeInfoForTripAtStopFromUpdates:
      realtimeMocks.getRealtimeInfoForTripAtStopFromUpdates,
  })),
}));

describe('ScheduleService', () => {
  beforeEach(() => {
    queryLog.queries = [];
    queryLog.params = [];
    realtimeMocks.isAvailable.mockClear();
    realtimeMocks.getTripUpdates.mockClear();
    realtimeMocks.getTripUpdates.mockResolvedValue([]);
    realtimeMocks.getRealtimeInfoForTripAtStopFromUpdates.mockClear();
    realtimeMocks.getRealtimeInfoForTripAtStopFromUpdates.mockReturnValue({
      delaySeconds: 300,
      status: 'delayed',
      actualTime: null,
    });
  });

  it('returns realtime departure delays in minutes', async () => {
    const { ScheduleService } = await import('../src/infrastructure/schedule-service.js');
    const service = new ScheduleService();

    const departures = await service.getDepartures('Grand Central', 'outbound', 1, true);

    expect(departures).toHaveLength(1);
    expect(departures[0].delay_minutes).toBe(5);
    expect(departures[0].actual_departure).toBe('12:05');
    expect(departures[0].status).toBe('delayed');
    expect(realtimeMocks.getTripUpdates).toHaveBeenCalledTimes(1);
    expect(realtimeMocks.getRealtimeInfoForTripAtStopFromUpdates).toHaveBeenCalledTimes(1);
  });

  it('filters outbound trips using Metro-North direction_id 0', async () => {
    queryLog.queries = [];
    const { ScheduleService } = await import('../src/infrastructure/schedule-service.js');
    const service = new ScheduleService();

    await service.getDepartures('Grand Central', 'outbound', 1, false);

    const departureQuery = queryLog.queries.find(
      (query) => query.includes('FROM stop_times st') && query.includes('JOIN trips t')
    );
    expect(departureQuery).toContain('AND t.direction_id = 0');
  });

  it('returns direct station-pair trips where the destination follows the origin', async () => {
    queryLog.queries = [];
    const { ScheduleService } = await import('../src/infrastructure/schedule-service.js');
    const service = new ScheduleService();

    const trips = await service.getStationPairSchedule('Grand Central', 'White Plains', {
      date: '2024-01-01',
      departAfter: '24:00',
      limit: 2,
      includeRealtime: false,
    });

    const pairQuery = queryLog.queries.find((query) => query.includes('origin_st'));
    expect(pairQuery).toContain('destination_st.stop_sequence > origin_st.stop_sequence');
    expect(trips).toHaveLength(2);
    expect(trips[0].origin_station).toBe('Grand Central Terminal');
    expect(trips[0].destination_station).toBe('White Plains');
  });

  it('handles after-midnight GTFS times for station-pair trips', async () => {
    const { ScheduleService } = await import('../src/infrastructure/schedule-service.js');
    const service = new ScheduleService();

    const trips = await service.getStationPairSchedule('Grand Central', 'White Plains', {
      date: '2024-01-01',
      departAfter: '24:00',
      limit: 1,
      includeRealtime: false,
    });

    expect(trips[0].scheduled_origin_departure).toBe('00:40');
    expect(trips[0].scheduled_destination_arrival).toBe('01:10');
    expect(trips[0].duration_minutes).toBe(30);
  });

  it('fetches realtime updates once for station-pair rows', async () => {
    const { ScheduleService } = await import('../src/infrastructure/schedule-service.js');
    const service = new ScheduleService();

    const trips = await service.getStationPairSchedule('Grand Central', 'White Plains', {
      date: '2024-01-01',
      departAfter: '24:00',
      limit: 2,
      includeRealtime: true,
    });

    expect(trips).toHaveLength(2);
    expect(realtimeMocks.getTripUpdates).toHaveBeenCalledTimes(1);
    expect(realtimeMocks.getRealtimeInfoForTripAtStopFromUpdates).toHaveBeenCalledTimes(4);
  });

  it('passes depart_after through to the station-pair query', async () => {
    queryLog.params = [];
    const { ScheduleService } = await import('../src/infrastructure/schedule-service.js');
    const service = new ScheduleService();

    await service.getStationPairSchedule('Grand Central', 'White Plains', {
      date: '2024-01-01',
      departAfter: '25:00',
      limit: 1,
      includeRealtime: false,
    });

    expect(queryLog.params.at(-1)).toContain('25:00:00');
  });

  it('returns first and last direct trains for a service date', async () => {
    const { ScheduleService } = await import('../src/infrastructure/schedule-service.js');
    const service = new ScheduleService();

    const result = await service.getFirstLastTrains(
      'Grand Central',
      'White Plains',
      '2024-01-01',
      false
    );

    expect(result.first_train?.trip_id).toBe('trip-pair-1');
    expect(result.last_train?.trip_id).toBe('trip-pair-2');
    expect(result.total_direct_trips).toBe(2);
    expect(queryLog.queries.some((query) => query.includes('COUNT(*) AS total_direct_trips'))).toBe(
      true
    );
    expect(
      queryLog.queries.some((query) =>
        query.includes('ORDER BY origin_st.departure_time ASC')
      )
    ).toBe(true);
    expect(
      queryLog.queries.some((query) =>
        query.includes('ORDER BY origin_st.departure_time DESC')
      )
    ).toBe(true);
    expect(queryLog.params.flat()).not.toContain(1000);
  });
});
