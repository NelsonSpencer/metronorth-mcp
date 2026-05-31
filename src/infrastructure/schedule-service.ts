import { getSqlite } from './database.js';
import { getRealtimeClient } from './realtime-client.js';
import { getStationService } from './station-service.js';
import { createModuleLogger } from '../logger.js';
import { ROUTE_NAMES } from '../config.js';
import type {
  DepartureInfo,
  FirstLastTrains,
  StationPairTrip,
  TripDetails,
  TripStop,
} from '../domain/gtfs.js';
import {
  addMinutesToGtfsTime,
  compactServiceDate,
  formatGtfsTimeForDisplay,
  getMetroNorthServiceContext,
  parseGtfsTime,
} from '../domain/transit-time.js';

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

interface StationPairRow {
  trip_id: string;
  trip_short_name: string | null;
  route_id: string;
  route_long_name: string;
  trip_headsign: string | null;
  direction_id: number | null;
  origin_stop_id: string;
  origin_stop_name: string;
  destination_stop_id: string;
  destination_stop_name: string;
  origin_departure_time: string;
  destination_arrival_time: string;
  origin_sequence: number;
  destination_sequence: number;
  service_id: string;
}

type StationPairScheduleOptions = {
  date?: string;
  departAfter?: string;
  limit?: number;
  includeRealtime?: boolean;
};

type StationPairOrder = 'ASC' | 'DESC';

function normalizeGtfsTimeInput(value: string): string {
  const parts = value.split(':');
  return parts.length === 2 ? `${value}:00` : value;
}

function getDefaultDepartAfter(date: string | undefined): string {
  const now = getMetroNorthServiceContext();
  if (!date || date === now.serviceDate) {
    return now.queryTime;
  }

  return '00:00:00';
}

export class ScheduleService {
  /**
   * Get active service IDs for a given date
   */
  getActiveServiceIds(date: Date | string = new Date()): string[] {
    const sqlite = getSqlite();
    const serviceDate =
      typeof date === 'string' ? date : getMetroNorthServiceContext(date).serviceDate;
    const dayOfWeek = new Date(`${serviceDate}T12:00:00Z`).getUTCDay();
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayColumn = dayNames[dayOfWeek];

    const dateStr = compactServiceDate(serviceDate);

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
    const now = getMetroNorthServiceContext();
    const serviceIds = this.getActiveServiceIds(now.serviceDate);

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

    const params = [station.stop_id, ...serviceIds, now.queryTime, limit * 2];
    const rows = sqlite.prepare(query).all(...params) as ScheduleRow[];

    const realtimeClient = getRealtimeClient();
    const realtimeUpdates =
      includeRealtime && realtimeClient.isAvailable() ? await realtimeClient.getTripUpdates() : null;
    const departures: DepartureInfo[] = [];

    for (const row of rows) {
      let delayMinutes: number | null = null;
      let status: DepartureInfo['status'] = 'unknown';

      if (realtimeUpdates) {
        // Use trip_short_name (train number) to match realtime data
        const realtimeInfo = realtimeClient.getRealtimeInfoForTripAtStopFromUpdates(
          realtimeUpdates,
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
      const actualDeparture =
        delayMinutes !== null ? addMinutesToGtfsTime(row.departure_time, delayMinutes) : null;

      departures.push({
        trip_id: row.trip_id,
        route_name: ROUTE_NAMES[row.route_id] || row.route_long_name,
        destination: row.trip_headsign || 'Unknown',
        scheduled_departure: formatGtfsTimeForDisplay(row.departure_time),
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
        arrival_time: formatGtfsTimeForDisplay(row.arrival_time),
        departure_time: formatGtfsTimeForDisplay(row.departure_time),
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
    date: string = getMetroNorthServiceContext().serviceDate,
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
      scheduled_departure: formatGtfsTimeForDisplay(row.departure_time),
      actual_departure: null,
      delay_minutes: null,
      platform: null,
      status: 'unknown' as const,
      stops: [],
    }));
  }

  async getStationPairSchedule(
    originStationName: string,
    destinationStationName: string,
    options: StationPairScheduleOptions = {}
  ): Promise<StationPairTrip[]> {
    const stationService = getStationService();
    const [originStation, destinationStation] = await Promise.all([
      stationService.findStationByName(originStationName),
      stationService.findStationByName(destinationStationName),
    ]);

    if (!originStation || !destinationStation) {
      logger.warn({ originStationName, destinationStationName }, 'Station pair not found');
      return [];
    }

    const serviceDate = options.date || getMetroNorthServiceContext().serviceDate;
    const serviceIds = this.getActiveServiceIds(serviceDate);
    if (serviceIds.length === 0) return [];

    const departAfter = normalizeGtfsTimeInput(
      options.departAfter || getDefaultDepartAfter(options.date)
    );
    const limit = options.limit || 5;

    const rows = this.getStationPairRows(originStation.stop_id, destinationStation.stop_id, serviceIds, {
      departAfter,
      limit,
      order: 'ASC',
    });

    return this.mapStationPairRows(rows, options.includeRealtime ?? true);
  }

  private getStationPairRows(
    originStopId: string,
    destinationStopId: string,
    serviceIds: string[],
    options: { departAfter?: string; limit?: number; order?: StationPairOrder } = {}
  ): StationPairRow[] {
    const sqlite = getSqlite();
    const order = options.order || 'ASC';
    const departAfterFilter = options.departAfter ? 'AND origin_st.departure_time >= ?' : '';
    const limitClause = options.limit ? 'LIMIT ?' : '';

    const query = `
      SELECT
        t.trip_id,
        t.trip_short_name,
        t.route_id,
        r.route_long_name,
        t.trip_headsign,
        t.direction_id,
        origin_st.stop_id AS origin_stop_id,
        origin_stop.stop_name AS origin_stop_name,
        destination_st.stop_id AS destination_stop_id,
        destination_stop.stop_name AS destination_stop_name,
        origin_st.departure_time AS origin_departure_time,
        destination_st.arrival_time AS destination_arrival_time,
        origin_st.stop_sequence AS origin_sequence,
        destination_st.stop_sequence AS destination_sequence,
        t.service_id
      FROM trips t
      JOIN routes r ON r.route_id = t.route_id
      JOIN stop_times origin_st ON origin_st.trip_id = t.trip_id
      JOIN stop_times destination_st ON destination_st.trip_id = t.trip_id
      JOIN stops origin_stop ON origin_stop.stop_id = origin_st.stop_id
      JOIN stops destination_stop ON destination_stop.stop_id = destination_st.stop_id
      WHERE origin_st.stop_id = ?
        AND destination_st.stop_id = ?
        AND destination_st.stop_sequence > origin_st.stop_sequence
        AND t.service_id IN (${serviceIds.map(() => '?').join(',')})
        ${departAfterFilter}
      ORDER BY origin_st.departure_time ${order}
      ${limitClause}
    `;

    const params: Array<string | number> = [originStopId, destinationStopId, ...serviceIds];
    if (options.departAfter) {
      params.push(options.departAfter);
    }
    if (options.limit) {
      params.push(options.limit);
    }

    return sqlite.prepare(query).all(...params) as StationPairRow[];
  }

  private countStationPairTrips(
    originStopId: string,
    destinationStopId: string,
    serviceIds: string[]
  ): number {
    const sqlite = getSqlite();
    const row = sqlite
      .prepare(
        `SELECT COUNT(*) AS total_direct_trips
         FROM trips t
         JOIN stop_times origin_st ON origin_st.trip_id = t.trip_id
         JOIN stop_times destination_st ON destination_st.trip_id = t.trip_id
         WHERE origin_st.stop_id = ?
           AND destination_st.stop_id = ?
           AND destination_st.stop_sequence > origin_st.stop_sequence
           AND t.service_id IN (${serviceIds.map(() => '?').join(',')})`
      )
      .get(originStopId, destinationStopId, ...serviceIds) as
      | { total_direct_trips: number }
      | undefined;

    return row?.total_direct_trips || 0;
  }

  async getFirstLastTrains(
    originStationName: string,
    destinationStationName: string,
    date?: string,
    includeRealtime: boolean = true
  ): Promise<FirstLastTrains> {
    const serviceDate = date || getMetroNorthServiceContext().serviceDate;
    const stationService = getStationService();
    const [originStation, destinationStation] = await Promise.all([
      stationService.findStationByName(originStationName),
      stationService.findStationByName(destinationStationName),
    ]);

    if (!originStation || !destinationStation) {
      logger.warn({ originStationName, destinationStationName }, 'Station pair not found');
      return {
        service_date: serviceDate,
        origin_station: originStationName,
        destination_station: destinationStationName,
        first_train: null,
        last_train: null,
        total_direct_trips: 0,
      };
    }

    const serviceIds = this.getActiveServiceIds(serviceDate);
    if (serviceIds.length === 0) {
      return {
        service_date: serviceDate,
        origin_station: originStationName,
        destination_station: destinationStationName,
        first_train: null,
        last_train: null,
        total_direct_trips: 0,
      };
    }

    const totalDirectTrips = this.countStationPairTrips(
      originStation.stop_id,
      destinationStation.stop_id,
      serviceIds
    );

    if (totalDirectTrips === 0) {
      return {
        service_date: serviceDate,
        origin_station: originStationName,
        destination_station: destinationStationName,
        first_train: null,
        last_train: null,
        total_direct_trips: 0,
      };
    }

    const firstRow = this.getStationPairRows(
      originStation.stop_id,
      destinationStation.stop_id,
      serviceIds,
      {
        limit: 1,
        order: 'ASC',
      }
    )[0];
    const lastRow = this.getStationPairRows(
      originStation.stop_id,
      destinationStation.stop_id,
      serviceIds,
      {
        limit: 1,
        order: 'DESC',
      }
    )[0];

    const rowsToMap = [firstRow, lastRow].filter((row, index): row is StationPairRow => {
      if (!row) return false;
      return index === 0 || row.trip_id !== firstRow?.trip_id;
    });
    const trips = await this.mapStationPairRows(rowsToMap, includeRealtime);
    const firstTrain = trips[0] || null;
    const lastTrain = lastRow?.trip_id === firstRow?.trip_id ? firstTrain : trips[1] || null;

    return {
      service_date: serviceDate,
      origin_station: originStationName,
      destination_station: destinationStationName,
      first_train: firstTrain,
      last_train: lastTrain,
      total_direct_trips: totalDirectTrips,
    };
  }

  private async mapStationPairRows(
    rows: StationPairRow[],
    includeRealtime: boolean
  ): Promise<StationPairTrip[]> {
    const realtimeClient = getRealtimeClient();
    const realtimeUpdates =
      includeRealtime && realtimeClient.isAvailable() ? await realtimeClient.getTripUpdates() : null;
    const trips: StationPairTrip[] = [];

    for (const row of rows) {
      let originDelayMinutes: number | null = null;
      let destinationDelayMinutes: number | null = null;
      let status: StationPairTrip['status'] = 'unknown';

      if (realtimeUpdates) {
        const originRealtime = realtimeClient.getRealtimeInfoForTripAtStopFromUpdates(
          realtimeUpdates,
          row.trip_id,
          row.origin_stop_id,
          row.origin_departure_time,
          row.trip_short_name || undefined
        );
        const destinationRealtime = realtimeClient.getRealtimeInfoForTripAtStopFromUpdates(
          realtimeUpdates,
          row.trip_id,
          row.destination_stop_id,
          row.destination_arrival_time,
          row.trip_short_name || undefined
        );

        if (originRealtime.delaySeconds !== null) {
          originDelayMinutes = Math.round(originRealtime.delaySeconds / 60);
        }
        if (destinationRealtime.delaySeconds !== null) {
          destinationDelayMinutes = Math.round(destinationRealtime.delaySeconds / 60);
        }
        status = originRealtime.status as StationPairTrip['status'];
      }

      const durationMinutes = Math.round(
        (parseGtfsTime(row.destination_arrival_time) - parseGtfsTime(row.origin_departure_time)) /
          60
      );

      trips.push({
        trip_id: row.trip_id,
        route_name: ROUTE_NAMES[row.route_id] || row.route_long_name,
        destination: row.trip_headsign || row.destination_stop_name,
        direction: row.direction_id === 1 ? 'inbound' : 'outbound',
        origin_station: row.origin_stop_name,
        destination_station: row.destination_stop_name,
        scheduled_origin_departure: formatGtfsTimeForDisplay(row.origin_departure_time),
        actual_origin_departure:
          originDelayMinutes !== null
            ? addMinutesToGtfsTime(row.origin_departure_time, originDelayMinutes)
            : null,
        scheduled_destination_arrival: formatGtfsTimeForDisplay(row.destination_arrival_time),
        actual_destination_arrival:
          destinationDelayMinutes !== null
            ? addMinutesToGtfsTime(row.destination_arrival_time, destinationDelayMinutes)
            : null,
        duration_minutes: durationMinutes,
        origin_delay_minutes: originDelayMinutes,
        destination_delay_minutes: destinationDelayMinutes,
        status,
      });
    }

    return trips;
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
