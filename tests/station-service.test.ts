import { describe, expect, it, vi } from 'vitest';

const stationFixtures = [
  {
    stop_id: 'GCT',
    stop_name: 'Grand Central Terminal',
    stop_lat: 40.7527,
    stop_lon: -73.9772,
    zone_id: '1',
    wheelchair_boarding: 1,
    parent_station: null,
    location_type: 1,
  },
  {
    stop_id: 'WP',
    stop_name: 'White Plains',
    stop_lat: 41.0339,
    stop_lon: -73.7743,
    zone_id: '4',
    wheelchair_boarding: 1,
    parent_station: null,
    location_type: 1,
  },
];

vi.mock('../src/infrastructure/database.js', () => ({
  getSqlite: vi.fn(() => ({
    prepare: vi.fn(() => ({
      all: vi.fn(() => stationFixtures),
      get: vi.fn(() => undefined),
    })),
  })),
}));

vi.mock('../src/infrastructure/cache.js', () => ({
  getCache: vi.fn(() =>
    Promise.resolve({
      get: vi.fn(() => null),
      set: vi.fn(),
    })
  ),
  CACHE_KEYS: {
    stations: 'stations:all',
  },
}));

describe('StationService', () => {
  it('searches station fixtures by partial name', async () => {
    const { StationService } = await import('../src/infrastructure/station-service.js');
    const service = new StationService();

    const results = await service.searchStations('Grand', 1);

    expect(results).toHaveLength(1);
    expect(results[0].stop_name).toBe('Grand Central Terminal');
  });
});
