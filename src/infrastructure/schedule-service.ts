import { getSqlite } from './database.js';
import { getRealtimeClient } from './realtime-client.js';
import { getStationService } from './station-service.js';
import { createModuleLogger } from '../logger.js';
import { ROUTE_NAMES } from '../config.js';
import type {
  DepartureInfo,
  FareClass,
  FirstLastTrains,
  StationPairTrip,
  StopNote,
  TransferItinerary,
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

// Raw note columns as joined from the notes table (aliases vary per query, so
// callers pass the resolved values into buildNote).
interface NoteColumns {
  note_mark: string | null;
  note_title: string | null;
  note_desc: string | null;
}

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
  track: string | null;
  // Trip-level peak/off-peak flag (1 = peak, 0 = off-peak, null = unclassified).
  peak_offpeak: number | null;
  // Note joined via the origin stop_time (departures only; null on route rows
  // that do not join notes).
  note_mark: string | null;
  note_title: string | null;
  note_desc: string | null;
}

interface TripStopRow {
  stop_name: string;
  stop_id: string;
  arrival_time: string;
  departure_time: string;
  stop_sequence: number;
  track: string | null;
  note_mark: string | null;
  note_title: string | null;
  note_desc: string | null;
}

// Map the GTFS trips.peak_offpeak flag to the exposed fare_class. Anything other
// than the two known values (including NULL / undefined pre-migration rows) is
// reported as null rather than guessed.
function mapFareClass(peakOffpeak: number | null | undefined): FareClass {
  if (peakOffpeak === 1) return 'peak';
  if (peakOffpeak === 0) return 'off_peak';
  return null;
}

// Build a StopNote from raw note columns. Prefers note_desc, falls back to
// note_title, and returns null when neither carries text (so empty notes are
// omitted rather than surfaced with a blank description).
function buildNote(columns: Partial<NoteColumns> | null | undefined): StopNote | null {
  if (!columns) return null;
  const description = firstNonEmpty(columns.note_desc, columns.note_title);
  if (!description) return null;
  return { mark: columns.note_mark ?? null, description };
}

function firstNonEmpty(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const trimmed = (value ?? '').trim();
    if (trimmed) return trimmed;
  }
  return '';
}

// Merge a realtime track assignment (when present) with the scheduled track.
// Realtime wins; track_source records which source produced the resolved value.
function resolveTrack(
  realtimeTrack: string | null,
  scheduledTrack: string | null
): {
  track: string | null;
  scheduled_track: string | null;
  track_source: 'realtime' | 'scheduled' | null;
} {
  if (realtimeTrack) {
    return { track: realtimeTrack, scheduled_track: scheduledTrack, track_source: 'realtime' };
  }
  if (scheduledTrack) {
    return { track: scheduledTrack, scheduled_track: scheduledTrack, track_source: 'scheduled' };
  }
  return { track: null, scheduled_track: null, track_source: null };
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
  origin_track: string | null;
  // Trip-level peak/off-peak flag (1 = peak, 0 = off-peak, null = unclassified).
  peak_offpeak: number | null;
  // Note joined via the origin stop_time.
  origin_note_mark: string | null;
  origin_note_title: string | null;
  origin_note_desc: string | null;
}

// One candidate one-transfer itinerary as joined from the transfers table. Holds
// both legs' columns (leg1 = origin -> hub on the arriving trip, leg2 = hub ->
// destination on the connecting trip) plus the hub/transfer metadata so each leg
// can be rebuilt into a StationPairRow and reuse the existing mapping/realtime
// enrichment path. The `hub_*` columns describe the shared transfer station.
interface TransferItineraryRow {
  // Leg 1: the arriving trip (origin -> hub).
  leg1_trip_id: string;
  leg1_trip_short_name: string | null;
  leg1_route_id: string;
  leg1_route_long_name: string;
  leg1_trip_headsign: string | null;
  leg1_direction_id: number | null;
  leg1_service_id: string;
  leg1_peak_offpeak: number | null;
  origin_stop_id: string;
  origin_stop_name: string;
  origin_departure_time: string;
  origin_sequence: number;
  origin_track: string | null;
  origin_note_mark: string | null;
  origin_note_title: string | null;
  origin_note_desc: string | null;
  // Transfer hub (from_stop_id == to_stop_id for every Metro-North transfer).
  hub_stop_id: string;
  hub_stop_name: string;
  hub_arrival_time: string;
  hub_arrival_sequence: number;
  hub_departure_time: string;
  hub_departure_sequence: number;
  hub_track: string | null;
  hub_note_mark: string | null;
  hub_note_title: string | null;
  hub_note_desc: string | null;
  transfer_type: number;
  // Leg 2: the connecting trip (hub -> destination).
  leg2_trip_id: string;
  leg2_trip_short_name: string | null;
  leg2_route_id: string;
  leg2_route_long_name: string;
  leg2_trip_headsign: string | null;
  leg2_direction_id: number | null;
  leg2_service_id: string;
  leg2_peak_offpeak: number | null;
  destination_stop_id: string;
  destination_stop_name: string;
  destination_arrival_time: string;
  destination_sequence: number;
}

// Project one leg of a transfer candidate onto the StationPairRow shape so it can
// flow through mapStationPairRows unchanged. Leg 1 runs origin -> hub; leg 2 runs
// hub -> destination, so the hub acts as each leg's destination/origin respectively.
function transferLegToStationPairRow(
  row: TransferItineraryRow,
  leg: 'leg1' | 'leg2'
): StationPairRow {
  if (leg === 'leg1') {
    return {
      trip_id: row.leg1_trip_id,
      trip_short_name: row.leg1_trip_short_name,
      route_id: row.leg1_route_id,
      route_long_name: row.leg1_route_long_name,
      trip_headsign: row.leg1_trip_headsign,
      direction_id: row.leg1_direction_id,
      origin_stop_id: row.origin_stop_id,
      origin_stop_name: row.origin_stop_name,
      destination_stop_id: row.hub_stop_id,
      destination_stop_name: row.hub_stop_name,
      origin_departure_time: row.origin_departure_time,
      destination_arrival_time: row.hub_arrival_time,
      origin_sequence: row.origin_sequence,
      destination_sequence: row.hub_arrival_sequence,
      service_id: row.leg1_service_id,
      origin_track: row.origin_track,
      peak_offpeak: row.leg1_peak_offpeak,
      origin_note_mark: row.origin_note_mark,
      origin_note_title: row.origin_note_title,
      origin_note_desc: row.origin_note_desc,
    };
  }

  return {
    trip_id: row.leg2_trip_id,
    trip_short_name: row.leg2_trip_short_name,
    route_id: row.leg2_route_id,
    route_long_name: row.leg2_route_long_name,
    trip_headsign: row.leg2_trip_headsign,
    direction_id: row.leg2_direction_id,
    origin_stop_id: row.hub_stop_id,
    origin_stop_name: row.hub_stop_name,
    destination_stop_id: row.destination_stop_id,
    destination_stop_name: row.destination_stop_name,
    origin_departure_time: row.hub_departure_time,
    destination_arrival_time: row.destination_arrival_time,
    origin_sequence: row.hub_departure_sequence,
    destination_sequence: row.destination_sequence,
    service_id: row.leg2_service_id,
    origin_track: row.hub_track,
    peak_offpeak: row.leg2_peak_offpeak,
    origin_note_mark: row.hub_note_mark,
    origin_note_title: row.hub_note_title,
    origin_note_desc: row.hub_note_desc,
  };
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
        t.service_id,
        st.track,
        t.peak_offpeak,
        n.note_mark,
        n.note_title,
        n.note_desc
      FROM stop_times st
      JOIN trips t ON t.trip_id = st.trip_id
      JOIN routes r ON r.route_id = t.route_id
      LEFT JOIN notes n ON n.note_id = st.note_id
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
      let realtimeTrack: string | null = null;
      let trainStatus: string | null = null;

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
        realtimeTrack = realtimeInfo.track;
        trainStatus = realtimeInfo.trainStatus;
      }

      // Get destination stops
      const stops = await this.getTripStopNames(row.trip_id, row.stop_sequence);

      // Calculate actual departure time
      const actualDeparture =
        delayMinutes !== null ? addMinutesToGtfsTime(row.departure_time, delayMinutes) : null;

      const { track, scheduled_track, track_source } = resolveTrack(realtimeTrack, row.track);

      departures.push({
        trip_id: row.trip_id,
        route_name: ROUTE_NAMES[row.route_id] || row.route_long_name,
        destination: row.trip_headsign || 'Unknown',
        scheduled_departure: formatGtfsTimeForDisplay(row.departure_time),
        actual_departure: actualDeparture,
        delay_minutes: delayMinutes,
        platform: track,
        track,
        scheduled_track,
        track_source,
        train_status: trainStatus,
        fare_class: mapFareClass(row.peak_offpeak),
        note: buildNote(row),
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
                t.peak_offpeak, r.route_long_name
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
        peak_offpeak: number | null;
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

    // Get all stops. LEFT JOIN notes so each stop can surface its note (if any)
    // without an N+1 lookup; the trip-level rollup is derived from these rows.
    const stopRows = sqlite
      .prepare(
        `SELECT s.stop_name, s.stop_id, st.arrival_time, st.departure_time, st.stop_sequence, st.track,
                n.note_mark, n.note_title, n.note_desc
         FROM stop_times st
         JOIN stops s ON s.stop_id = st.stop_id
         LEFT JOIN notes n ON n.note_id = st.note_id
         WHERE st.trip_id = ?
         ORDER BY st.stop_sequence`
      )
      .all(tripId) as TripStopRow[];

    // Get realtime data if available
    const realtimeClient = getRealtimeClient();
    const realtimeUpdates =
      includeRealtime && realtimeClient.isAvailable() ? await realtimeClient.getTripUpdates() : null;
    let realtimeStatus = null;

    const stops: TripStop[] = [];
    for (const row of stopRows) {
      let delayMinutes: number | null = null;
      let realtimeTrack: string | null = null;
      let trainStatus: string | null = null;

      if (realtimeUpdates) {
        delayMinutes = realtimeClient.getDelayForTripAtStopFromUpdates(
          realtimeUpdates,
          tripId,
          row.stop_id
        );
        if (delayMinutes !== null) {
          delayMinutes = Math.round(delayMinutes / 60);
        }

        // Realtime track and train status come from the stop-level info; delay is
        // kept from the dedicated helper so absent updates stay null (rather than
        // collapsing to an on-time 0) for stops the train has not reached.
        const realtimeInfo = realtimeClient.getRealtimeInfoForTripAtStopFromUpdates(
          realtimeUpdates,
          tripId,
          row.stop_id,
          row.departure_time
        );
        realtimeTrack = realtimeInfo.track;
        trainStatus = realtimeInfo.trainStatus;
      }

      const { track, scheduled_track, track_source } = resolveTrack(realtimeTrack, row.track);

      stops.push({
        stop_name: row.stop_name,
        stop_id: row.stop_id,
        arrival_time: formatGtfsTimeForDisplay(row.arrival_time),
        departure_time: formatGtfsTimeForDisplay(row.departure_time),
        stop_sequence: row.stop_sequence,
        delay_minutes: delayMinutes,
        track,
        scheduled_track,
        track_source,
        train_status: trainStatus,
        note: buildNote(row),
      });
    }

    // Roll up the distinct notes referenced along the trip, keyed on mark +
    // description so a note repeated at multiple stops appears once.
    const tripNotes: StopNote[] = [];
    const seenNotes = new Set<string>();
    for (const stop of stops) {
      if (!stop.note) continue;
      const key = `${stop.note.mark ?? ''}|${stop.note.description}`;
      if (seenNotes.has(key)) continue;
      seenNotes.add(key);
      tripNotes.push(stop.note);
    }

    // Get overall trip delay
    if (realtimeUpdates) {
      const tripDelay = realtimeClient.getDelayForTripFromUpdates(realtimeUpdates, tripId);
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
      fare_class: mapFareClass(trip.peak_offpeak),
      stops,
      notes: tripNotes,
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
        t.service_id,
        t.peak_offpeak
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
      track: null,
      scheduled_track: null,
      track_source: null,
      train_status: null,
      fare_class: mapFareClass(row.peak_offpeak),
      note: null,
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
        t.service_id,
        origin_st.track AS origin_track,
        t.peak_offpeak,
        origin_note.note_mark AS origin_note_mark,
        origin_note.note_title AS origin_note_title,
        origin_note.note_desc AS origin_note_desc
      FROM trips t
      JOIN routes r ON r.route_id = t.route_id
      JOIN stop_times origin_st ON origin_st.trip_id = t.trip_id
      JOIN stop_times destination_st ON destination_st.trip_id = t.trip_id
      JOIN stops origin_stop ON origin_stop.stop_id = origin_st.stop_id
      JOIN stops destination_stop ON destination_stop.stop_id = destination_st.stop_id
      LEFT JOIN notes origin_note ON origin_note.note_id = origin_st.note_id
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

  /**
   * Find one-transfer itineraries between two stations using the MTA's timed
   * (guaranteed) trip-to-trip transfers at hub stations. Mirrors
   * getStationPairSchedule's service-date/serviceIds handling and GTFS
   * string-time conventions. Each returned itinerary carries two StationPairTrip
   * legs (enriched with realtime in a single pass) plus the transfer window.
   */
  async getTransferItineraries(
    originStationName: string,
    destinationStationName: string,
    options: StationPairScheduleOptions = {}
  ): Promise<TransferItinerary[]> {
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

    const rows = this.getTransferItineraryRows(
      originStation.stop_id,
      destinationStation.stop_id,
      serviceIds,
      { departAfter, limit }
    );
    if (rows.length === 0) return [];

    // Flatten both legs of every candidate into one StationPairRow[] so the shared
    // mapping + realtime enrichment runs once (a single realtime fetch) and applies
    // per leg. Legs stay paired by their interleaved order (leg1, leg2, leg1, ...).
    const legRows: StationPairRow[] = [];
    for (const row of rows) {
      legRows.push(transferLegToStationPairRow(row, 'leg1'));
      legRows.push(transferLegToStationPairRow(row, 'leg2'));
    }
    const mappedLegs = await this.mapStationPairRows(legRows, options.includeRealtime ?? true);

    const itineraries: TransferItinerary[] = [];
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const leg1 = mappedLegs[i * 2];
      const leg2 = mappedLegs[i * 2 + 1];

      const waitMinutes = Math.round(
        (parseGtfsTime(row.hub_departure_time) - parseGtfsTime(row.hub_arrival_time)) / 60
      );
      const totalDurationMinutes = Math.round(
        (parseGtfsTime(row.destination_arrival_time) - parseGtfsTime(row.origin_departure_time)) / 60
      );
      // The delay that decides whether the scheduled transfer window survives is
      // leg 1's arrival delay at the hub; fall back to its boarding delay when the
      // hub has no realtime data yet, and to 0 (on time) when there is none at all.
      const leg1Delay = leg1.destination_delay_minutes ?? leg1.origin_delay_minutes ?? 0;

      itineraries.push({
        itinerary_type: 'one_transfer',
        legs: [leg1, leg2],
        transfer: {
          station: row.hub_stop_name,
          arrive: formatGtfsTimeForDisplay(row.hub_arrival_time),
          depart: formatGtfsTimeForDisplay(row.hub_departure_time),
          wait_minutes: waitMinutes,
          guaranteed: row.transfer_type === 1,
        },
        total_duration_minutes: totalDurationMinutes,
        connection_at_risk: leg1Delay >= waitMinutes,
      });
    }

    return itineraries;
  }

  private getTransferItineraryRows(
    originStopId: string,
    destinationStopId: string,
    serviceIds: string[],
    options: { departAfter?: string; limit?: number } = {}
  ): TransferItineraryRow[] {
    const sqlite = getSqlite();
    const servicePlaceholders = serviceIds.map(() => '?').join(',');
    const departAfterFilter = options.departAfter ? 'AND o.departure_time >= ?' : '';
    const limitClause = options.limit ? 'LIMIT ?' : '';

    // transfers is trip-to-trip and same-station (from_stop_id == to_stop_id), so
    // the joins pin leg 1 to the arriving trip (origin -> hub) and leg 2 to the
    // connecting trip (hub -> destination). Sequence guards keep each leg forward
    // in time; the NOT EXISTS drops itineraries where the arriving train itself
    // continues to the destination (a same-train ride beats a needless transfer).
    const query = `
      SELECT
        t1.trip_id AS leg1_trip_id,
        t1.trip_short_name AS leg1_trip_short_name,
        t1.route_id AS leg1_route_id,
        r1.route_long_name AS leg1_route_long_name,
        t1.trip_headsign AS leg1_trip_headsign,
        t1.direction_id AS leg1_direction_id,
        t1.service_id AS leg1_service_id,
        t1.peak_offpeak AS leg1_peak_offpeak,
        o.stop_id AS origin_stop_id,
        origin_stop.stop_name AS origin_stop_name,
        o.departure_time AS origin_departure_time,
        o.stop_sequence AS origin_sequence,
        o.track AS origin_track,
        origin_note.note_mark AS origin_note_mark,
        origin_note.note_title AS origin_note_title,
        origin_note.note_desc AS origin_note_desc,
        x.from_stop_id AS hub_stop_id,
        hub_stop.stop_name AS hub_stop_name,
        xa.arrival_time AS hub_arrival_time,
        xa.stop_sequence AS hub_arrival_sequence,
        xd.departure_time AS hub_departure_time,
        xd.stop_sequence AS hub_departure_sequence,
        xd.track AS hub_track,
        hub_note.note_mark AS hub_note_mark,
        hub_note.note_title AS hub_note_title,
        hub_note.note_desc AS hub_note_desc,
        x.transfer_type AS transfer_type,
        t2.trip_id AS leg2_trip_id,
        t2.trip_short_name AS leg2_trip_short_name,
        t2.route_id AS leg2_route_id,
        r2.route_long_name AS leg2_route_long_name,
        t2.trip_headsign AS leg2_trip_headsign,
        t2.direction_id AS leg2_direction_id,
        t2.service_id AS leg2_service_id,
        t2.peak_offpeak AS leg2_peak_offpeak,
        d.stop_id AS destination_stop_id,
        destination_stop.stop_name AS destination_stop_name,
        d.arrival_time AS destination_arrival_time,
        d.stop_sequence AS destination_sequence
      FROM transfers x
      JOIN trips t1 ON t1.trip_id = x.from_trip_id
      JOIN trips t2 ON t2.trip_id = x.to_trip_id
      JOIN routes r1 ON r1.route_id = t1.route_id
      JOIN routes r2 ON r2.route_id = t2.route_id
      JOIN stop_times o  ON o.trip_id  = t1.trip_id AND o.stop_id  = ?
      JOIN stop_times xa ON xa.trip_id = t1.trip_id AND xa.stop_id = x.from_stop_id
                         AND xa.stop_sequence > o.stop_sequence
      JOIN stop_times xd ON xd.trip_id = t2.trip_id AND xd.stop_id = x.to_stop_id
      JOIN stop_times d  ON d.trip_id  = t2.trip_id AND d.stop_id  = ?
                         AND d.stop_sequence > xd.stop_sequence
      JOIN stops origin_stop ON origin_stop.stop_id = o.stop_id
      JOIN stops hub_stop ON hub_stop.stop_id = x.from_stop_id
      JOIN stops destination_stop ON destination_stop.stop_id = d.stop_id
      LEFT JOIN notes origin_note ON origin_note.note_id = o.note_id
      LEFT JOIN notes hub_note ON hub_note.note_id = xd.note_id
      WHERE t1.service_id IN (${servicePlaceholders})
        AND t2.service_id IN (${servicePlaceholders})
        ${departAfterFilter}
        AND xd.departure_time >= xa.arrival_time
        AND NOT EXISTS (
          SELECT 1 FROM stop_times same_trip
          WHERE same_trip.trip_id = t1.trip_id
            AND same_trip.stop_id = ?
            AND same_trip.stop_sequence > o.stop_sequence
        )
      ORDER BY d.arrival_time ASC
      ${limitClause}
    `;

    const params: Array<string | number> = [
      originStopId,
      destinationStopId,
      ...serviceIds,
      ...serviceIds,
    ];
    if (options.departAfter) {
      params.push(options.departAfter);
    }
    params.push(destinationStopId);
    if (options.limit) {
      params.push(options.limit);
    }

    return sqlite.prepare(query).all(...params) as TransferItineraryRow[];
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
      let originRealtimeTrack: string | null = null;
      let trainStatus: string | null = null;

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
        originRealtimeTrack = originRealtime.track;
        trainStatus = originRealtime.trainStatus;
      }

      const durationMinutes = Math.round(
        (parseGtfsTime(row.destination_arrival_time) - parseGtfsTime(row.origin_departure_time)) /
          60
      );

      // Boarding track is the origin-station track (realtime assignment wins).
      const { track, scheduled_track, track_source } = resolveTrack(
        originRealtimeTrack,
        row.origin_track
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
        track,
        scheduled_track,
        track_source,
        train_status: trainStatus,
        fare_class: mapFareClass(row.peak_offpeak),
        note: buildNote({
          note_mark: row.origin_note_mark,
          note_title: row.origin_note_title,
          note_desc: row.origin_note_desc,
        }),
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
