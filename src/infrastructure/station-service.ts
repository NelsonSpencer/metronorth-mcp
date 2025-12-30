import Fuse from 'fuse.js';
import { getSqlite } from './database.js';
import { getCache, CACHE_KEYS } from './cache.js';
import { createModuleLogger } from '../logger.js';
import type { StationInfo } from '../domain/gtfs.js';

const logger = createModuleLogger('station-service');

interface StationRow {
  stop_id: string;
  stop_name: string;
  stop_lat: number;
  stop_lon: number;
  zone_id: string | null;
  wheelchair_boarding: number | null;
  parent_station: string | null;
  location_type: number;
}

export class StationService {
  private fuse: Fuse<StationRow> | null = null;

  async getAllStations(): Promise<StationRow[]> {
    const cache = await getCache();
    const cached = await cache.get<StationRow[]>(CACHE_KEYS.stations);

    if (cached) {
      return cached;
    }

    const sqlite = getSqlite();
    const stations = sqlite
      .prepare(
        `SELECT stop_id, stop_name, stop_lat, stop_lon, zone_id, wheelchair_boarding, parent_station, location_type
         FROM stops
         WHERE location_type = 0 OR location_type = 1
         ORDER BY stop_name`
      )
      .all() as StationRow[];

    // Cache for 1 hour
    await cache.set(CACHE_KEYS.stations, stations, 3600);

    return stations;
  }

  private async initializeFuzzySearch(): Promise<void> {
    if (this.fuse) return;

    const stations = await this.getAllStations();

    this.fuse = new Fuse(stations, {
      keys: ['stop_name'],
      threshold: 0.3,
      distance: 100,
      includeScore: true,
    });

    logger.info({ count: stations.length }, 'Fuzzy search initialized');
  }

  async searchStations(query: string, limit: number = 5): Promise<StationRow[]> {
    await this.initializeFuzzySearch();

    const results = this.fuse!.search(query, { limit });
    return results.map((r) => r.item);
  }

  async findStationByName(name: string): Promise<StationRow | null> {
    // First try exact match
    const sqlite = getSqlite();
    const exact = sqlite
      .prepare(
        `SELECT stop_id, stop_name, stop_lat, stop_lon, zone_id, wheelchair_boarding, parent_station, location_type
         FROM stops
         WHERE LOWER(stop_name) = LOWER(?)
         AND (location_type = 0 OR location_type = 1)
         LIMIT 1`
      )
      .get(name) as StationRow | undefined;

    if (exact) {
      return exact;
    }

    // Try fuzzy match
    const results = await this.searchStations(name, 1);
    return results[0] || null;
  }

  async findStationById(stopId: string): Promise<StationRow | null> {
    const sqlite = getSqlite();
    const station = sqlite
      .prepare(
        `SELECT stop_id, stop_name, stop_lat, stop_lon, zone_id, wheelchair_boarding, parent_station, location_type
         FROM stops
         WHERE stop_id = ?`
      )
      .get(stopId) as StationRow | undefined;

    return station || null;
  }

  async getStationInfo(stationName: string): Promise<StationInfo | null> {
    const station = await this.findStationByName(stationName);
    if (!station) return null;

    const sqlite = getSqlite();

    // Get routes serving this station
    const routeRows = sqlite
      .prepare(
        `SELECT DISTINCT r.route_long_name
         FROM routes r
         JOIN trips t ON t.route_id = r.route_id
         JOIN stop_times st ON st.trip_id = t.trip_id
         WHERE st.stop_id = ?
         ORDER BY r.route_long_name`
      )
      .all(station.stop_id) as Array<{ route_long_name: string }>;

    return {
      stop_id: station.stop_id,
      name: station.stop_name,
      latitude: station.stop_lat,
      longitude: station.stop_lon,
      zone_id: station.zone_id,
      routes: routeRows.map((r) => r.route_long_name),
      wheelchair_accessible: station.wheelchair_boarding === 1,
    };
  }

  async getStationsByRoute(routeId: string): Promise<StationRow[]> {
    const sqlite = getSqlite();
    const stations = sqlite
      .prepare(
        `SELECT DISTINCT s.stop_id, s.stop_name, s.stop_lat, s.stop_lon, s.zone_id, s.wheelchair_boarding, s.parent_station, s.location_type
         FROM stops s
         JOIN stop_times st ON st.stop_id = s.stop_id
         JOIN trips t ON t.trip_id = st.trip_id
         WHERE t.route_id = ?
         ORDER BY s.stop_name`
      )
      .all(routeId) as StationRow[];

    return stations;
  }
}

// Singleton instance
let serviceInstance: StationService | null = null;

export function getStationService(): StationService {
  if (!serviceInstance) {
    serviceInstance = new StationService();
  }
  return serviceInstance;
}
