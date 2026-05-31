import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/infrastructure/database.js', () => {
  const prepare = vi.fn((query: string) => {
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
    findStationByName: vi.fn(() =>
      Promise.resolve({
        stop_id: 'GCT',
        stop_name: 'Grand Central Terminal',
      })
    ),
  })),
}));

vi.mock('../src/infrastructure/realtime-client.js', () => ({
  getRealtimeClient: vi.fn(() => ({
    isAvailable: vi.fn(() => true),
    getRealtimeInfoForTripAtStop: vi.fn(() =>
      Promise.resolve({
        delaySeconds: 300,
        status: 'delayed',
      })
    ),
  })),
}));

describe('ScheduleService', () => {
  it('returns realtime departure delays in minutes', async () => {
    const { ScheduleService } = await import('../src/infrastructure/schedule-service.js');
    const service = new ScheduleService();

    const departures = await service.getDepartures('Grand Central', 'outbound', 1, true);

    expect(departures).toHaveLength(1);
    expect(departures[0].delay_minutes).toBe(5);
    expect(departures[0].actual_departure).toBe('12:05');
    expect(departures[0].status).toBe('delayed');
  });
});
