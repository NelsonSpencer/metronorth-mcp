import axios from 'axios';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { GTFS_REALTIME_URL, GTFS_ALERTS_URL } from '../config.js';
import { createModuleLogger } from '../logger.js';
import { getSqlite, transaction } from './database.js';
import { getCache, CACHE_KEYS } from './cache.js';
import { packageMetadata } from '../package-metadata.js';
import type { TripUpdate, ServiceAlert } from '../domain/gtfs.js';

const { transit_realtime } = GtfsRealtimeBindings;

const logger = createModuleLogger('realtime');

// GTFS-RT feed types (protobuf JSON representation)
interface FeedMessage {
  header: {
    gtfsRealtimeVersion: string;
    incrementality: number;
    timestamp: string;
  };
  entity: FeedEntity[];
}

interface FeedEntity {
  id: string;
  isDeleted?: boolean;
  tripUpdate?: GTFSRTTripUpdate;
  vehicle?: GTFSRTVehicle;
  alert?: GTFSRTAlert;
}

interface GTFSRTTripUpdate {
  trip: {
    tripId: string;
    routeId?: string;
    startTime?: string;
    startDate?: string;
    scheduleRelationship?: string;
  };
  vehicle?: {
    id?: string;
    label?: string;
  };
  stopTimeUpdate?: GTFSRTStopTimeUpdate[];
  timestamp?: string;
}

interface GTFSRTStopTimeUpdate {
  stopSequence?: number;
  stopId?: string;
  arrival?: {
    delay?: number;
    time?: string;
  };
  departure?: {
    delay?: number;
    time?: string;
  };
  scheduleRelationship?: string;
}

interface GTFSRTVehicle {
  trip?: {
    tripId?: string;
    routeId?: string;
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
  currentStopSequence?: number;
  currentStatus?: string;
  timestamp?: string;
}

interface GTFSRTAlert {
  activePeriod?: { start?: string; end?: string }[];
  informedEntity?: {
    agencyId?: string;
    routeId?: string;
    routeType?: number;
    trip?: { tripId?: string };
    stopId?: string;
  }[];
  cause?: string;
  effect?: string;
  url?: { translation?: { text: string; language?: string }[] };
  headerText?: { translation?: { text: string; language?: string }[] };
  descriptionText?: { translation?: { text: string; language?: string }[] };
}

export class MetroNorthRealtime {
  constructor() {
    logger.info('Metro-North realtime client initialized (public API - no key required)');
  }

  isAvailable(): boolean {
    // Public API is always available
    return true;
  }

  private async fetchTripUpdates(): Promise<FeedMessage | null> {
    try {
      const response = await axios.get(GTFS_REALTIME_URL, {
        timeout: 15000,
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': packageMetadata.userAgent,
        },
      });

      // Decode protobuf response
      const feed = transit_realtime.FeedMessage.decode(new Uint8Array(response.data));
      
      // Convert to our internal format
      return {
        header: {
          gtfsRealtimeVersion: feed.header?.gtfsRealtimeVersion || '2.0',
          incrementality: feed.header?.incrementality || 0,
          timestamp: String(feed.header?.timestamp || ''),
        },
        entity: (feed.entity || []).map((e) => ({
          id: e.id || '',
          isDeleted: e.isDeleted || false,
          tripUpdate: e.tripUpdate ? {
            trip: {
              tripId: e.tripUpdate.trip?.tripId || '',
              routeId: e.tripUpdate.trip?.routeId || undefined,
              startTime: e.tripUpdate.trip?.startTime || undefined,
              startDate: e.tripUpdate.trip?.startDate || undefined,
              scheduleRelationship: String(e.tripUpdate.trip?.scheduleRelationship || ''),
            },
            vehicle: e.tripUpdate.vehicle ? {
              id: e.tripUpdate.vehicle.id || undefined,
              label: e.tripUpdate.vehicle.label || undefined,
            } : undefined,
            stopTimeUpdate: (e.tripUpdate.stopTimeUpdate || []).map((stu) => ({
              stopSequence: stu.stopSequence || undefined,
              stopId: stu.stopId || undefined,
              arrival: stu.arrival ? {
                delay: stu.arrival.delay || undefined,
                time: stu.arrival.time ? String(stu.arrival.time) : undefined,
              } : undefined,
              departure: stu.departure ? {
                delay: stu.departure.delay || undefined,
                time: stu.departure.time ? String(stu.departure.time) : undefined,
              } : undefined,
              scheduleRelationship: String(stu.scheduleRelationship || ''),
            })),
            timestamp: e.tripUpdate.timestamp ? String(e.tripUpdate.timestamp) : undefined,
          } : undefined,
          alert: e.alert ? {
            activePeriod: (e.alert.activePeriod || []).map((ap) => ({
              start: ap.start ? String(ap.start) : undefined,
              end: ap.end ? String(ap.end) : undefined,
            })),
            informedEntity: (e.alert.informedEntity || []).map((ie) => ({
              agencyId: ie.agencyId || undefined,
              routeId: ie.routeId || undefined,
              routeType: ie.routeType || undefined,
              trip: ie.trip ? { tripId: ie.trip.tripId || undefined } : undefined,
              stopId: ie.stopId || undefined,
            })),
            cause: String(e.alert.cause || ''),
            effect: String(e.alert.effect || ''),
            headerText: e.alert.headerText ? {
              translation: (e.alert.headerText.translation || []).map((t) => ({
                text: t.text || '',
                language: t.language || undefined,
              })),
            } : undefined,
            descriptionText: e.alert.descriptionText ? {
              translation: (e.alert.descriptionText.translation || []).map((t) => ({
                text: t.text || '',
                language: t.language || undefined,
              })),
            } : undefined,
          } : undefined,
        })),
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error(
          { status: error.response?.status, message: error.message, url: GTFS_REALTIME_URL },
          'Failed to fetch trip updates'
        );
      } else {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error({ error: msg }, 'Failed to fetch/parse trip updates');
      }
      return null;
    }
  }

  private async fetchAlerts(): Promise<FeedMessage | null> {
    try {
      const response = await axios.get(GTFS_ALERTS_URL, {
        timeout: 15000,
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': packageMetadata.userAgent,
        },
      });

      // Decode protobuf response
      const feed = transit_realtime.FeedMessage.decode(new Uint8Array(response.data));
      
      return {
        header: {
          gtfsRealtimeVersion: feed.header?.gtfsRealtimeVersion || '2.0',
          incrementality: feed.header?.incrementality || 0,
          timestamp: String(feed.header?.timestamp || ''),
        },
        entity: (feed.entity || []).map((e) => ({
          id: e.id || '',
          isDeleted: e.isDeleted || false,
          alert: e.alert ? {
            activePeriod: (e.alert.activePeriod || []).map((ap) => ({
              start: ap.start ? String(ap.start) : undefined,
              end: ap.end ? String(ap.end) : undefined,
            })),
            informedEntity: (e.alert.informedEntity || []).map((ie) => ({
              agencyId: ie.agencyId || undefined,
              routeId: ie.routeId || undefined,
              routeType: ie.routeType || undefined,
              trip: ie.trip ? { tripId: ie.trip.tripId || undefined } : undefined,
              stopId: ie.stopId || undefined,
            })),
            cause: String(e.alert.cause || ''),
            effect: String(e.alert.effect || ''),
            url: e.alert.url ? {
              translation: (e.alert.url.translation || []).map((t) => ({
                text: t.text || '',
                language: t.language || undefined,
              })),
            } : undefined,
            headerText: e.alert.headerText ? {
              translation: (e.alert.headerText.translation || []).map((t) => ({
                text: t.text || '',
                language: t.language || undefined,
              })),
            } : undefined,
            descriptionText: e.alert.descriptionText ? {
              translation: (e.alert.descriptionText.translation || []).map((t) => ({
                text: t.text || '',
                language: t.language || undefined,
              })),
            } : undefined,
          } : undefined,
        })),
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error(
          { status: error.response?.status, message: error.message },
          'Failed to fetch alerts'
        );
      } else {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error({ error: msg }, 'Failed to fetch/parse alerts');
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

    const feed = await this.fetchTripUpdates();
    if (!feed || !feed.entity) {
      // Return cached data from database as fallback
      return this.getTripUpdatesFromDB();
    }

    const updates: TripUpdate[] = [];

    for (const entity of feed.entity) {
      if (entity.tripUpdate) {
        const tu = entity.tripUpdate;
        updates.push({
          train_number: entity.id, // The entity ID is the train number for MNR
          trip_id: tu.trip.tripId,
          route_id: tu.trip.routeId || null,
          start_time: tu.trip.startTime || null,
          start_date: tu.trip.startDate || null,
          schedule_relationship: tu.trip.scheduleRelationship || null,
          stop_time_updates: (tu.stopTimeUpdate || []).map((stu) => ({
            stop_sequence: stu.stopSequence || null,
            stop_id: stu.stopId || null,
            arrival_delay: stu.arrival?.delay || null,
            departure_delay: stu.departure?.delay || null,
            schedule_relationship: stu.scheduleRelationship || null,
          })),
          timestamp: tu.timestamp ? parseInt(tu.timestamp) : null,
          vehicle_id: tu.vehicle?.id || null,
        });
      }
    }

    logger.info({ count: updates.length }, 'Fetched trip updates from MTA API');

    // Cache for 30 seconds
    await cache.set(CACHE_KEYS.tripUpdates, updates, 30);

    // Also persist to database for fallback
    if (updates.length > 0) {
      this.persistTripUpdates(updates);
    }

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
          train_number: row.trip_id, // Use trip_id as fallback for train_number
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

    const feed = await this.fetchAlerts();
    if (!feed || !feed.entity) {
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

        // Filter for Metro-North related alerts
        const mnrEntities = (a.informedEntity || []).filter(
          (ie) => ie.agencyId === 'MNR' || ie.routeId?.startsWith('1') || ie.routeId?.startsWith('2') || ie.routeId?.startsWith('3')
        );

        if (mnrEntities.length > 0 || !a.informedEntity?.length) {
          alerts.push({
            alert_id: entity.id,
            cause: a.cause || null,
            effect: a.effect || null,
            header_text: getText(a.headerText) || 'Service Alert',
            description_text: getText(a.descriptionText),
            url: getText(a.url),
            active_period_start: a.activePeriod?.[0]?.start ? parseInt(a.activePeriod[0].start) : null,
            active_period_end: a.activePeriod?.[0]?.end ? parseInt(a.activePeriod[0].end) : null,
            informed_entities: (a.informedEntity || []).map((ie) => ({
              agency_id: ie.agencyId || null,
              route_id: ie.routeId || null,
              route_type: ie.routeType || null,
              trip_id: ie.trip?.tripId || null,
              stop_id: ie.stopId || null,
            })),
          });
        }
      }
    }

    logger.info({ count: alerts.length }, 'Fetched service alerts from MTA API');

    // Cache for 2 minutes
    await cache.set(CACHE_KEYS.serviceAlerts, alerts, 120);

    return alerts;
  }

  async getDelayForTrip(tripId: string, trainNumber?: string): Promise<number | null> {
    const updates = await this.getTripUpdates();
    
    // Try matching by train number (entity ID) first, then trip_id
    let tripUpdate = trainNumber 
      ? updates.find((u) => u.train_number === trainNumber)
      : null;
    
    if (!tripUpdate) {
      tripUpdate = updates.find((u) => u.trip_id === tripId);
    }

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

  async getDelayForTripAtStop(tripId: string, stopId: string, trainNumber?: string): Promise<number | null> {
    const updates = await this.getTripUpdates();
    
    // Try matching by train number (entity ID) first, then trip_id  
    let tripUpdate = trainNumber 
      ? updates.find((u) => u.train_number === trainNumber)
      : null;
    
    if (!tripUpdate) {
      tripUpdate = updates.find((u) => u.trip_id === tripId);
    }

    if (!tripUpdate) return null;

    const stopUpdate = tripUpdate.stop_time_updates.find((stu) => stu.stop_id === stopId);

    if (!stopUpdate) return null;

    // MTA provides delay in seconds, or we can calculate from absolute timestamps
    if (stopUpdate.departure_delay !== null && stopUpdate.departure_delay !== undefined) {
      return stopUpdate.departure_delay;
    }
    if (stopUpdate.arrival_delay !== null && stopUpdate.arrival_delay !== undefined) {
      return stopUpdate.arrival_delay;
    }
    
    return null;
  }
  
  /**
   * Get realtime arrival/departure info for a trip at a stop
   * Returns status info including whether the train is on time, delayed, etc.
   */
  async getRealtimeInfoForTripAtStop(
    tripId: string, 
    stopId: string, 
    _scheduledDepartureTime: string,
    trainNumber?: string
  ): Promise<{ delaySeconds: number | null; status: string; actualTime: string | null }> {
    const updates = await this.getTripUpdates();
    
    // Try matching by train number (entity ID) first
    let tripUpdate = trainNumber 
      ? updates.find((u) => u.train_number === trainNumber)
      : null;
    
    if (!tripUpdate) {
      tripUpdate = updates.find((u) => u.trip_id === tripId);
    }

    if (!tripUpdate) {
      return { delaySeconds: null, status: 'unknown', actualTime: null };
    }

    const stopUpdate = tripUpdate.stop_time_updates.find((stu) => stu.stop_id === stopId);

    if (!stopUpdate) {
      // Train exists in realtime but this stop not found - assume on time
      return { delaySeconds: 0, status: 'on_time', actualTime: null };
    }

    // Check for explicit delay values first
    const delaySeconds = stopUpdate.departure_delay ?? stopUpdate.arrival_delay ?? null;
    
    if (delaySeconds !== null) {
      const status = delaySeconds <= 60 ? 'on_time' : 'delayed';
      return { delaySeconds, status, actualTime: null };
    }

    // No explicit delay - train is tracked and on time
    return { delaySeconds: 0, status: 'on_time', actualTime: null };
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
