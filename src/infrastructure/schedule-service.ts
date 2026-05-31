import { getSqlite } from './database.js';
import { getRealtimeClient } from './realtime-client.js';
import { getStationService } from './station-service.js';
import { createModuleLogger } from '../logger.js';
import { ROUTE_NAMES } from '../config.js';
import type { DepartureInfo, TripDetails, TripStop } from '../domain/gtfs.js';

const logger = createModuleLogger('schedule-service');

interface ScheduleRow {
  trip_id: string;
  trip_short_name: string | null;
  route_id: string;
  route_long_name: string;
  trip_headsign: string | null;
  direction_id: number | null;
  departure_time: string;
  arrival_time: string;
  stop_sequence: number;
  service_id: string;
}

interface TripStopRow {
  stop_name: string;
  stop_id: string;
  arrival_time: string;
  departure_time: string;
  stop_sequence: number;
}

export class ScheduleService {
  /**
   * Get active service IDs for a given date
   */
  getActiveServiceIds(date: Date = new Date()): string[] {
    const sqlite = getSqlite();
    const dayOfWeek = date.getDay();
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayColumn = dayNames[dayOfWeek];

    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');

    // Get services from calendar that are active today
    const calendarServices = sqlite
      .prepare(
        `SELECT service_id FROM calendar
         WHERE ${dayColumn} = 1
         AND start_date <= ?
         AND end_date >= ?`
      )
      .all(dateStr, dateStr) as Array<{ service_id: string }>;

    const serviceIds = new Set(calendarServices.map((s) => s.service_id));

    // Apply calendar_dates exceptions
    const exceptions = sqlite
      .prepare(
        `SELECT service_id, exception_type FROM calendar_dates
         WHERE date = ?`
      )
      .all(dateStr) as Array<{ service_id: string; exception_type: number }>;

    for (const ex of exceptions) {
      if (ex.exception_type === 1) {
        // Service added
        serviceIds.add(ex.service_id);
      } else if (ex.exception_type === 2) {
        // Service removed
        serviceIds.delete(ex.service_id);
      }
    }

    return Array.from(serviceIds);
  }

  /**
   * Get departures from a station
   */
  async getDepartures(
    stationName: string,
    direction: 'inbound' | 'outbound' | 'all' = 'all',
    limit: number = 10,
    includeRealtime: boolean = true
  ): Promise<DepartureInfo[]> {
    const stationService = getStationService();
    const station = await stationService.findStationByName(stationName);

    if (!station) {
      logger.warn({ stationName }, 'Station not found');
      return [];
    }

    const sqlite = getSqlite();
    const now = new Date();
    const currentTime = now.toTimeString().slice(0, 8);
    const serviceIds = this.getActiveServiceIds(now);

    if (serviceIds.length === 0) {
      logger.warn('No active services found for today');
      return [];
    }

    // Build direction filter
    let directionFilter = '';
    if (direction === 'inbound') {
      directionFilter = 'AND t.direction_id = 1';
    } else if (direction === 'outbound') {
      directionFilter = 'AND t.direction_id = 0';
    }

    const query = `
      SELECT
        t.trip_id,
        t.trip_short_name,
        t.route_id,
        r.route_long_name,
        t.trip_headsign,
        t.direction_id,
        st.departure_time,
        st.arrival_time,
        st.stop_sequence,
        t.service_id
      FROM stop_times st
      JOIN trips t ON t.trip_id = st.trip_id
      JOIN routes r ON r.route_id = t.route_id
      WHERE st.stop_id = ?
        AND t.service_id IN (${serviceIds.map(() => '?').join(',')})
        AND st.departure_time >= ?
        ${directionFilter}
      ORDER BY st.departure_time
      LIMIT ?
    `;

    const params = [station.stop_id, ...serviceIds, currentTime, limit * 2];
    const rows = sqlite.prepare(query).all(...params) as ScheduleRow[];

    // Get realtime delays if available
    const realtimeClient = getRealtimeClient();
    const departures: DepartureInfo[] = [];

    for (const row of rows) {
      let delayMinutes: number | null = null;
      let status: DepartureInfo['status'] = 'unknown';

      if (includeRealtime && realtimeClient.isAvailable()) {
        // Use trip_short_name (train number) to match realtime data
        const realtimeInfo = await realtimeClient.getRealtimeInfoForTripAtStop(
          row.trip_id, 
          station.stop_id,
          row.departure_time,
          row.trip_short_name || undefined
        );
        
        if (realtimeInfo.delaySeconds !== null) {
          delayMinutes = Math.round(realtimeInfo.delaySeconds / 60);
        }
        status = realtimeInfo.status as DepartureInfo['status'];
      }

      // Get destination stops
      const stops = await this.getTripStopNames(row.trip_id, row.stop_sequence);

      // Calculate actual departure time
      let actualDeparture: string | null = null;
      if (delayMinutes !== null) {
        const [hours, mins] = row.departure_time.split(':').map(Number);
        const depDate = new Date();
        depDate.setHours(hours, mins + delayMinutes, 0, 0);
        actualDeparture = depDate.toTimeString().slice(0, 5);
      }

      departures.push({
        trip_id: row.trip_id,
        route_name: ROUTE_NAMES[row.route_id] || row.route_long_name,
        destination: row.trip_headsign || 'Unknown',
        scheduled_departure: row.departure_time.slice(0, 5),
        actual_departure: actualDeparture,
        delay_minutes: delayMinutes,
        platform: null,
        status,
        stops,
      });

      if (departures.length >= limit) break;
    }

    return departures;
  }

  /**
   * Get stop names for a trip after a given stop sequence
   */
  private async getTripStopNames(tripId: string, afterSequence: number): Promise<string[]> {
    const sqlite = getSqlite();
    const stops = sqlite
      .prepare(
        `SELECT s.stop_name
         FROM stop_times st
         JOIN stops s ON s.stop_id = st.stop_id
         WHERE st.trip_id = ?
           AND st.stop_sequence > ?
         ORDER BY st.stop_sequence`
      )
      .all(tripId, afterSequence) as Array<{ stop_name: string }>;

    return stops.map((s) => s.stop_name);
  }

  /**
   * Get full details for a specific trip
   */
  async getTripDetails(tripId: string, includeRealtime: boolean = true): Promise<TripDetails | null> {
    const sqlite = getSqlite();

    // Get trip info
    const trip = sqlite
      .prepare(
        `SELECT t.trip_id, t.route_id, t.trip_headsign, t.direction_id, t.service_id,
                r.route_long_name
         FROM trips t
         JOIN routes r ON r.route_id = t.route_id
         WHERE t.trip_id = ?`
      )
      .get(tripId) as {
        trip_id: string;
        route_id: string;
        trip_headsign: string | null;
        direction_id: number | null;
        service_id: string;
        route_long_name: string;
      } | undefined;

    if (!trip) {
      return null;
    }

    // Get service days
    const calendar = sqlite
      .prepare(`SELECT * FROM calendar WHERE service_id = ?`)
      .get(trip.service_id) as {
        monday: number;
        tuesday: number;
        wednesday: number;
        thursday: number;
        friday: number;
        saturday: number;
        sunday: number;
      } | undefined;

    const serviceDays: string[] = [];
    if (calendar) {
      if (calendar.monday) serviceDays.push('Monday');
      if (calendar.tuesday) serviceDays.push('Tuesday');
      if (calendar.wednesday) serviceDays.push('Wednesday');
      if (calendar.thursday) serviceDays.push('Thursday');
      if (calendar.friday) serviceDays.push('Friday');
      if (calendar.saturday) serviceDays.push('Saturday');
      if (calendar.sunday) serviceDays.push('Sunday');
    }

    // Get all stops
    const stopRows = sqlite
      .prepare(
        `SELECT s.stop_name, s.stop_id, st.arrival_time, st.departure_time, st.stop_sequence
         FROM stop_times st
         JOIN stops s ON s.stop_id = st.stop_id
         WHERE st.trip_id = ?
         ORDER BY st.stop_sequence`
      )
      .all(tripId) as TripStopRow[];

    // Get realtime data if available
    const realtimeClient = getRealtimeClient();
    let realtimeStatus = null;

    const stops: TripStop[] = [];
    for (const row of stopRows) {
      let delayMinutes: number | null = null;

      if (includeRealtime && realtimeClient.isAvailable()) {
        delayMinutes = await realtimeClient.getDelayForTripAtStop(tripId, row.stop_id);
        if (delayMinutes !== null) {
          delayMinutes = Math.round(delayMinutes / 60);
        }
      }

      stops.push({
        stop_name: row.stop_name,
        stop_id: row.stop_id,
        arrival_time: row.arrival_time.slice(0, 5),
        departure_time: row.departure_time.slice(0, 5),
        stop_sequence: row.stop_sequence,
        delay_minutes: delayMinutes,
      });
    }

    // Get overall trip delay
    if (includeRealtime && realtimeClient.isAvailable()) {
      const tripDelay = await realtimeClient.getDelayForTrip(tripId);
      if (tripDelay !== null) {
        realtimeStatus = {
          delay_minutes: Math.round(tripDelay / 60),
          last_updated: new Date().toISOString(),
          current_stop: null,
          next_stop: null,
        };
      }
    }

    return {
      trip_id: trip.trip_id,
      route_name: ROUTE_NAMES[trip.route_id] || trip.route_long_name,
      direction: trip.direction_id === 1 ? 'Inbound' : 'Outbound',
      service_days: serviceDays,
      stops,
      realtime_status: realtimeStatus,
    };
  }

  /**
   * Get schedule for an entire route
   */
  async getRouteSchedule(
    routeName: string,
    date: Date = new Date(),
    direction: 'inbound' | 'outbound' | 'all' = 'all'
  ): Promise<DepartureInfo[]> {
    const sqlite = getSqlite();

    // Find route by name
    const route = sqlite
      .prepare(
        `SELECT route_id, route_long_name FROM routes
         WHERE LOWER(route_long_name) LIKE LOWER(?)
         LIMIT 1`
      )
      .get(`%${routeName}%`) as { route_id: string; route_long_name: string } | undefined;

    if (!route) {
      logger.warn({ routeName }, 'Route not found');
      return [];
    }

    const serviceIds = this.getActiveServiceIds(date);
    if (serviceIds.length === 0) return [];

    let directionFilter = '';
    if (direction === 'inbound') {
      directionFilter = 'AND t.direction_id = 1';
    } else if (direction === 'outbound') {
      directionFilter = 'AND t.direction_id = 0';
    }

    // Get first stop of each trip (origin station)
    const query = `
      SELECT DISTINCT
        t.trip_id,
        t.route_id,
        r.route_long_name,
        t.trip_headsign,
        t.direction_id,
        st.departure_time,
        st.arrival_time,
        st.stop_sequence,
        t.service_id
      FROM trips t
      JOIN routes r ON r.route_id = t.route_id
      JOIN stop_times st ON st.trip_id = t.trip_id
      WHERE t.route_id = ?
        AND t.service_id IN (${serviceIds.map(() => '?').join(',')})
        AND st.stop_sequence = 1
        ${directionFilter}
      ORDER BY st.departure_time
    `;

    const rows = sqlite.prepare(query).all(route.route_id, ...serviceIds) as ScheduleRow[];

    return rows.map((row) => ({
      trip_id: row.trip_id,
      route_name: ROUTE_NAMES[row.route_id] || row.route_long_name,
      destination: row.trip_headsign || 'Unknown',
      scheduled_departure: row.departure_time.slice(0, 5),
      actual_departure: null,
      delay_minutes: null,
      platform: null,
      status: 'unknown' as const,
      stops: [],
    }));
  }
}

// Singleton instance
let serviceInstance: ScheduleService | null = null;

export function getScheduleService(): ScheduleService {
  if (!serviceInstance) {
    serviceInstance = new ScheduleService();
  }
  return serviceInstance;
}
