import axios from 'axios';
import { config, getRealtimeFeedUrl } from '../config.js';
import { createModuleLogger } from '../logger.js';
import { getSqlite, transaction } from './database.js';
import { getCache, CACHE_KEYS } from './cache.js';
import type { TripUpdate, ServiceAlert } from '../domain/gtfs.js';

const logger = createModuleLogger('realtime');

// GTFS-RT feed types
interface FeedMessage {
  header: {
    gtfs_realtime_version: string;
    incrementality: number;
    timestamp: number;
  };
  entity: FeedEntity[];
}

interface FeedEntity {
  id: string;
  is_deleted?: boolean;
  trip_update?: GTFSRTTripUpdate;
  vehicle?: GTFSRTVehicle;
  alert?: GTFSRTAlert;
}

interface GTFSRTTripUpdate {
  trip: {
    trip_id: string;
    route_id?: string;
    start_time?: string;
    start_date?: string;
    schedule_relationship?: number;
  };
  vehicle?: {
    id?: string;
    label?: string;
  };
  stop_time_update?: GTFSRTStopTimeUpdate[];
  timestamp?: number;
}

interface GTFSRTStopTimeUpdate {
  stop_sequence?: number;
  stop_id?: string;
  arrival?: {
    delay?: number;
    time?: number;
  };
  departure?: {
    delay?: number;
    time?: number;
  };
  schedule_relationship?: number;
}

interface GTFSRTVehicle {
  trip?: {
    trip_id?: string;
    route_id?: string;
  };
  vehicle?: {
    id: string;
    label?: string;
  };
  position?: {
    latitude: number;
    longitude: number;
    bearing?: number;
    speed?: number;
  };
  current_stop_sequence?: number;
  current_status?: number;
  timestamp?: number;
  congestion_level?: number;
  occupancy_status?: number;
}

interface GTFSRTAlert {
  active_period?: { start?: number; end?: number }[];
  informed_entity?: {
    agency_id?: string;
    route_id?: string;
    route_type?: number;
    trip?: { trip_id?: string };
    stop_id?: string;
  }[];
  cause?: number;
  effect?: number;
  url?: { translation?: { text: string; language?: string }[] };
  header_text?: { translation?: { text: string; language?: string }[] };
  description_text?: { translation?: { text: string; language?: string }[] };
}

// Schedule relationship enum
const SCHEDULE_RELATIONSHIP = {
  0: 'SCHEDULED',
  1: 'ADDED',
  2: 'UNSCHEDULED',
  3: 'CANCELED',
} as const;

// Vehicle status: 0=INCOMING_AT, 1=STOPPED_AT, 2=IN_TRANSIT_TO

export class MetroNorthRealtime {
  private apiKey: string | null;

  constructor() {
    this.apiKey = config.MTA_API_KEY || null;

    if (!this.apiKey) {
      logger.warn('No MTA API key configured - realtime features will be limited');
    }
  }

  isAvailable(): boolean {
    return this.apiKey !== null;
  }

  private async fetchFeed(): Promise<FeedMessage | null> {
    if (!this.apiKey) {
      return null;
    }

    const url = getRealtimeFeedUrl(this.apiKey);

    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 10000,
        headers: {
          'User-Agent': 'MetroNorth-MCP/2.0.0',
          Accept: 'application/x-protobuf',
        },
      });

      // Parse protobuf response
      // Note: In production, use gtfs-realtime-bindings for proper protobuf parsing
      // For now, we'll try JSON if the API supports it, or implement a simple parser

      // Some MTA feeds support JSON format
      try {
        const jsonData = JSON.parse(response.data.toString());
        return jsonData as FeedMessage;
      } catch {
        // If not JSON, we need protobuf parsing
        logger.warn('Protobuf parsing not implemented - install gtfs-realtime-bindings');
        return null;
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error({ status: error.response?.status, message: error.message }, 'Failed to fetch realtime feed');
      } else {
        logger.error({ error }, 'Failed to fetch realtime feed');
      }
      return null;
    }
  }

  async getTripUpdates(): Promise<TripUpdate[]> {
    const cache = await getCache();
    const cached = await cache.get<TripUpdate[]>(CACHE_KEYS.tripUpdates);

    if (cached) {
      return cached;
    }

    const feed = await this.fetchFeed();
    if (!feed) {
      // Return cached data from database as fallback
      return this.getTripUpdatesFromDB();
    }

    const updates: TripUpdate[] = [];

    for (const entity of feed.entity) {
      if (entity.trip_update) {
        const tu = entity.trip_update;
        updates.push({
          trip_id: tu.trip.trip_id,
          route_id: tu.trip.route_id || null,
          start_time: tu.trip.start_time || null,
          start_date: tu.trip.start_date || null,
          schedule_relationship: tu.trip.schedule_relationship != null
            ? SCHEDULE_RELATIONSHIP[tu.trip.schedule_relationship as keyof typeof SCHEDULE_RELATIONSHIP] || null
            : null,
          stop_time_updates: (tu.stop_time_update || []).map((stu) => ({
            stop_sequence: stu.stop_sequence || null,
            stop_id: stu.stop_id || null,
            arrival_delay: stu.arrival?.delay || null,
            departure_delay: stu.departure?.delay || null,
            schedule_relationship: stu.schedule_relationship != null
              ? SCHEDULE_RELATIONSHIP[stu.schedule_relationship as keyof typeof SCHEDULE_RELATIONSHIP] || null
              : null,
          })),
          timestamp: tu.timestamp || null,
          vehicle_id: tu.vehicle?.id || null,
        });
      }
    }

    // Cache for 30 seconds
    await cache.set(CACHE_KEYS.tripUpdates, updates, 30);

    // Also persist to database for fallback
    this.persistTripUpdates(updates);

    return updates;
  }

  private getTripUpdatesFromDB(): TripUpdate[] {
    const sqlite = getSqlite();
    const rows = sqlite
      .prepare(
        `SELECT trip_id, stop_id, arrival_delay, departure_delay, schedule_relationship
         FROM realtime_updates
         WHERE updated_at > datetime('now', '-5 minutes')`
      )
      .all() as Array<{
        trip_id: string;
        stop_id: string;
        arrival_delay: number | null;
        departure_delay: number | null;
        schedule_relationship: string | null;
      }>;

    // Group by trip_id
    const grouped = new Map<string, TripUpdate>();

    for (const row of rows) {
      if (!grouped.has(row.trip_id)) {
        grouped.set(row.trip_id, {
          trip_id: row.trip_id,
          route_id: null,
          start_time: null,
          start_date: null,
          schedule_relationship: row.schedule_relationship,
          stop_time_updates: [],
          timestamp: null,
          vehicle_id: null,
        });
      }

      grouped.get(row.trip_id)!.stop_time_updates.push({
        stop_sequence: null,
        stop_id: row.stop_id,
        arrival_delay: row.arrival_delay,
        departure_delay: row.departure_delay,
        schedule_relationship: row.schedule_relationship,
      });
    }

    return Array.from(grouped.values());
  }

  private persistTripUpdates(updates: TripUpdate[]): void {
    const sqlite = getSqlite();

    transaction(() => {
      const insert = sqlite.prepare(`
        INSERT OR REPLACE INTO realtime_updates (trip_id, stop_id, arrival_delay, departure_delay, schedule_relationship, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `);

      for (const update of updates) {
        for (const stu of update.stop_time_updates) {
          if (stu.stop_id) {
            insert.run(
              update.trip_id,
              stu.stop_id,
              stu.arrival_delay,
              stu.departure_delay,
              stu.schedule_relationship
            );
          }
        }
      }
    });
  }

  async getServiceAlerts(): Promise<ServiceAlert[]> {
    const cache = await getCache();
    const cached = await cache.get<ServiceAlert[]>(CACHE_KEYS.serviceAlerts);

    if (cached) {
      return cached;
    }

    const feed = await this.fetchFeed();
    if (!feed) {
      return [];
    }

    const alerts: ServiceAlert[] = [];

    for (const entity of feed.entity) {
      if (entity.alert) {
        const a = entity.alert;

        const getText = (field?: { translation?: { text: string; language?: string }[] }) => {
          if (!field?.translation?.length) return null;
          // Prefer English
          const en = field.translation.find((t) => t.language === 'en');
          return en?.text || field.translation[0]?.text || null;
        };

        alerts.push({
          alert_id: entity.id,
          cause: a.cause?.toString() || null,
          effect: a.effect?.toString() || null,
          header_text: getText(a.header_text) || 'Service Alert',
          description_text: getText(a.description_text),
          url: getText(a.url),
          active_period_start: a.active_period?.[0]?.start || null,
          active_period_end: a.active_period?.[0]?.end || null,
          informed_entities: (a.informed_entity || []).map((ie) => ({
            agency_id: ie.agency_id || null,
            route_id: ie.route_id || null,
            route_type: ie.route_type || null,
            trip_id: ie.trip?.trip_id || null,
            stop_id: ie.stop_id || null,
          })),
        });
      }
    }

    // Cache for 2 minutes
    await cache.set(CACHE_KEYS.serviceAlerts, alerts, 120);

    return alerts;
  }

  async getDelayForTrip(tripId: string): Promise<number | null> {
    const updates = await this.getTripUpdates();
    const tripUpdate = updates.find((u) => u.trip_id === tripId);

    if (!tripUpdate || tripUpdate.stop_time_updates.length === 0) {
      return null;
    }

    // Get the average delay across all stops
    const delays = tripUpdate.stop_time_updates
      .map((stu) => stu.departure_delay ?? stu.arrival_delay)
      .filter((d): d is number => d !== null);

    if (delays.length === 0) return null;

    // Return the max delay (most relevant for passengers)
    return Math.max(...delays);
  }

  async getDelayForTripAtStop(tripId: string, stopId: string): Promise<number | null> {
    const updates = await this.getTripUpdates();
    const tripUpdate = updates.find((u) => u.trip_id === tripId);

    if (!tripUpdate) return null;

    const stopUpdate = tripUpdate.stop_time_updates.find((stu) => stu.stop_id === stopId);

    if (!stopUpdate) return null;

    return stopUpdate.departure_delay ?? stopUpdate.arrival_delay ?? null;
  }
}

// Singleton instance
let realtimeInstance: MetroNorthRealtime | null = null;

export function getRealtimeClient(): MetroNorthRealtime {
  if (!realtimeInstance) {
    realtimeInstance = new MetroNorthRealtime();
  }
  return realtimeInstance;
}
