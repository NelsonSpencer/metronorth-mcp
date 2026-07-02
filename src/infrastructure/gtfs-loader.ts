import axios from 'axios';
import AdmZip from 'adm-zip';
import csv from 'csv-parser';
import { Readable } from 'node:stream';
import { config, GTFS_STATIC_URL } from '../config.js';
import { createModuleLogger } from '../logger.js';
import {
  getSqlite,
  transaction,
  setMetadata,
  getMetadata,
  deleteMetadata,
  GTFS_FORCE_REFRESH_KEY,
} from './database.js';
import { packageMetadata } from '../package-metadata.js';
import type {
  Stop,
  Route,
  Trip,
  StopTime,
  Calendar,
  CalendarDate,
  Agency,
  Transfer,
  TripNote,
} from '../domain/gtfs.js';

const logger = createModuleLogger('gtfs-loader');

// Required GTFS files
const REQUIRED_FILES = [
  'agency.txt',
  'stops.txt',
  'routes.txt',
  'trips.txt',
  'stop_times.txt',
];

// Optional files: calendar.txt, calendar_dates.txt (at least one should be
// present), transfers.txt, and notes.txt (absent in some feed drops).

// Parse a possibly-empty CSV value into an integer, mapping blank/invalid
// values to null. csv-parser yields '' (not undefined) for empty cells, which
// parseInt would turn into NaN.
function parseIntOrNull(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const str = String(value).trim();
  if (str === '') return null;
  const parsed = Number.parseInt(str, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

interface ParsedGTFS {
  agency: Agency[];
  stops: Stop[];
  routes: Route[];
  trips: Trip[];
  stopTimes: StopTime[];
  calendar: Calendar[];
  calendarDates: CalendarDate[];
  transfers: Transfer[];
  notes: TripNote[];
}

export class GTFSLoader {
  async needsUpdate(): Promise<boolean> {
    // A schema migration can force a re-ingest so newly added columns and
    // tables get populated. The flag is cleared only after a successful import
    // (see importToDatabase), so a transient download failure retries on the
    // next startup instead of silently leaving the new columns empty.
    if (getMetadata(GTFS_FORCE_REFRESH_KEY)) {
      return true;
    }

    const lastUpdate = getMetadata('gtfs_last_update');
    if (!lastUpdate) return true;

    const lastUpdateTime = new Date(lastUpdate).getTime();
    const now = Date.now();
    const hoursSinceUpdate = (now - lastUpdateTime) / (1000 * 60 * 60);

    return hoursSinceUpdate > config.GTFS_UPDATE_INTERVAL_HOURS;
  }

  async downloadGTFS(): Promise<Buffer> {
    logger.info({ url: GTFS_STATIC_URL }, 'Downloading GTFS static data');

    const response = await axios.get<ArrayBuffer>(GTFS_STATIC_URL, {
      responseType: 'arraybuffer',
      timeout: 60000,
      headers: {
        'User-Agent': packageMetadata.userAgent,
      },
    });

    const data = Buffer.from(response.data);
    logger.info({ size: data.length }, 'GTFS download complete');
    return data;
  }

  async extractAndParse(zipBuffer: Buffer): Promise<ParsedGTFS> {
    logger.info('Extracting GTFS ZIP file');

    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();

    // Validate required files exist
    const fileNames = entries.map((e) => e.entryName);
    for (const required of REQUIRED_FILES) {
      if (!fileNames.includes(required)) {
        throw new Error(`Missing required GTFS file: ${required}`);
      }
    }

    const parsed: ParsedGTFS = {
      agency: [],
      stops: [],
      routes: [],
      trips: [],
      stopTimes: [],
      calendar: [],
      calendarDates: [],
      transfers: [],
      notes: [],
    };

    // Parse each file
    for (const entry of entries) {
      const content = entry.getData().toString('utf-8');

      switch (entry.entryName) {
        case 'agency.txt':
          parsed.agency = await this.parseCSV<Agency>(content);
          break;
        case 'stops.txt':
          parsed.stops = await this.parseCSV<Stop>(content);
          break;
        case 'routes.txt':
          parsed.routes = await this.parseCSV<Route>(content);
          break;
        case 'trips.txt':
          parsed.trips = await this.parseCSV<Trip>(content);
          break;
        case 'stop_times.txt':
          parsed.stopTimes = await this.parseCSV<StopTime>(content);
          break;
        case 'calendar.txt':
          parsed.calendar = await this.parseCSV<Calendar>(content);
          break;
        case 'calendar_dates.txt':
          parsed.calendarDates = await this.parseCSV<CalendarDate>(content);
          break;
        case 'transfers.txt':
          parsed.transfers = await this.parseCSV<Transfer>(content);
          break;
        case 'notes.txt':
          parsed.notes = await this.parseCSV<TripNote>(content);
          break;
      }
    }

    logger.info(
      {
        agencies: parsed.agency.length,
        stops: parsed.stops.length,
        routes: parsed.routes.length,
        trips: parsed.trips.length,
        stopTimes: parsed.stopTimes.length,
        calendar: parsed.calendar.length,
        calendarDates: parsed.calendarDates.length,
        transfers: parsed.transfers.length,
        notes: parsed.notes.length,
      },
      'GTFS data parsed'
    );

    return parsed;
  }

  private parseCSV<T>(content: string): Promise<T[]> {
    return new Promise((resolve, reject) => {
      const results: T[] = [];
      const stream = Readable.from(content);

      stream
        .pipe(csv())
        .on('data', (data: T) => results.push(data))
        .on('end', () => resolve(results))
        .on('error', reject);
    });
  }

  async importToDatabase(data: ParsedGTFS): Promise<void> {
    logger.info('Importing GTFS data to database');
    const sqlite = getSqlite();

    transaction(() => {
      // Clear existing data. trip_ids are regenerated on every feed drop, so
      // transfers (which reference them) must be cleared and reloaded in the
      // same transaction as trips/stop_times.
      sqlite.exec(`
        DELETE FROM stop_times;
        DELETE FROM transfers;
        DELETE FROM trips;
        DELETE FROM notes;
        DELETE FROM routes;
        DELETE FROM stops;
        DELETE FROM calendar;
        DELETE FROM calendar_dates;
        DELETE FROM agency;
      `);

      // Import agency
      const insertAgency = sqlite.prepare(`
        INSERT INTO agency (agency_id, agency_name, agency_url, agency_timezone, agency_lang, agency_phone, agency_fare_url)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const agency of data.agency) {
        insertAgency.run(
          agency.agency_id || 'MNR',
          agency.agency_name,
          agency.agency_url,
          agency.agency_timezone,
          agency.agency_lang || null,
          agency.agency_phone || null,
          agency.agency_fare_url || null
        );
      }

      // Import stops
      const insertStop = sqlite.prepare(`
        INSERT INTO stops (stop_id, stop_code, stop_name, stop_desc, stop_lat, stop_lon, zone_id, stop_url, location_type, parent_station, stop_timezone, wheelchair_boarding)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const stop of data.stops) {
        insertStop.run(
          stop.stop_id,
          stop.stop_code || null,
          stop.stop_name,
          stop.stop_desc || null,
          parseFloat(String(stop.stop_lat)),
          parseFloat(String(stop.stop_lon)),
          stop.zone_id || null,
          stop.stop_url || null,
          parseInt(String(stop.location_type)) || 0,
          stop.parent_station || null,
          stop.stop_timezone || null,
          stop.wheelchair_boarding != null ? parseInt(String(stop.wheelchair_boarding)) : null
        );
      }

      // Import routes
      const insertRoute = sqlite.prepare(`
        INSERT INTO routes (route_id, agency_id, route_short_name, route_long_name, route_desc, route_type, route_url, route_color, route_text_color)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const route of data.routes) {
        insertRoute.run(
          route.route_id,
          route.agency_id || null,
          route.route_short_name || null,
          route.route_long_name,
          route.route_desc || null,
          parseInt(String(route.route_type)),
          route.route_url || null,
          route.route_color || null,
          route.route_text_color || null
        );
      }

      // Import trips
      const insertTrip = sqlite.prepare(`
        INSERT INTO trips (trip_id, route_id, service_id, trip_headsign, trip_short_name, direction_id, block_id, shape_id, wheelchair_accessible, bikes_allowed, peak_offpeak)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const trip of data.trips) {
        insertTrip.run(
          trip.trip_id,
          trip.route_id,
          trip.service_id,
          trip.trip_headsign || null,
          trip.trip_short_name || null,
          trip.direction_id != null ? parseInt(String(trip.direction_id)) : null,
          trip.block_id || null,
          trip.shape_id || null,
          trip.wheelchair_accessible != null ? parseInt(String(trip.wheelchair_accessible)) : null,
          trip.bikes_allowed != null ? parseInt(String(trip.bikes_allowed)) : null,
          parseIntOrNull(trip.peak_offpeak)
        );
      }

      // Import stop times (batch for performance)
      const insertStopTime = sqlite.prepare(`
        INSERT INTO stop_times (trip_id, arrival_time, departure_time, stop_id, stop_sequence, stop_headsign, pickup_type, drop_off_type, shape_dist_traveled, timepoint, track, note_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const st of data.stopTimes) {
        insertStopTime.run(
          st.trip_id,
          st.arrival_time,
          st.departure_time,
          st.stop_id,
          parseInt(String(st.stop_sequence)),
          st.stop_headsign || null,
          st.pickup_type != null ? parseInt(String(st.pickup_type)) : null,
          st.drop_off_type != null ? parseInt(String(st.drop_off_type)) : null,
          st.shape_dist_traveled != null ? parseFloat(String(st.shape_dist_traveled)) : null,
          st.timepoint != null ? parseInt(String(st.timepoint)) : null,
          st.track || null,
          st.note_id || null
        );
      }

      // Import calendar
      const insertCalendar = sqlite.prepare(`
        INSERT INTO calendar (service_id, monday, tuesday, wednesday, thursday, friday, saturday, sunday, start_date, end_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const cal of data.calendar) {
        insertCalendar.run(
          cal.service_id,
          parseInt(String(cal.monday)),
          parseInt(String(cal.tuesday)),
          parseInt(String(cal.wednesday)),
          parseInt(String(cal.thursday)),
          parseInt(String(cal.friday)),
          parseInt(String(cal.saturday)),
          parseInt(String(cal.sunday)),
          cal.start_date,
          cal.end_date
        );
      }

      // Import calendar dates
      if (data.calendarDates.length > 0) {
        const insertCalendarDate = sqlite.prepare(`
          INSERT INTO calendar_dates (service_id, date, exception_type)
          VALUES (?, ?, ?)
        `);
        for (const cd of data.calendarDates) {
          insertCalendarDate.run(
            cd.service_id,
            cd.date,
            parseInt(String(cd.exception_type))
          );
        }
      }

      // Import transfers (optional file; trip-to-trip timed transfers). OR
      // IGNORE guards against duplicate (from_trip_id, to_trip_id, from_stop_id)
      // keys aborting the whole import.
      const insertTransfer = sqlite.prepare(`
        INSERT OR IGNORE INTO transfers (from_stop_id, to_stop_id, from_route_id, to_route_id, from_trip_id, to_trip_id, transfer_type, min_transfer_time)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const transfer of data.transfers) {
        insertTransfer.run(
          transfer.from_stop_id,
          transfer.to_stop_id,
          transfer.from_route_id || null,
          transfer.to_route_id || null,
          transfer.from_trip_id,
          transfer.to_trip_id,
          parseIntOrNull(transfer.transfer_type) ?? 1,
          parseIntOrNull(transfer.min_transfer_time)
        );
      }

      // Import notes (optional file; GTFS note reference codes)
      const insertNote = sqlite.prepare(`
        INSERT OR IGNORE INTO notes (note_id, note_mark, note_title, note_desc)
        VALUES (?, ?, ?, ?)
      `);
      for (const note of data.notes) {
        insertNote.run(
          note.note_id,
          note.note_mark || null,
          note.note_title || null,
          note.note_desc || null
        );
      }
    });

    // Update metadata. Clearing the force-refresh flag here (after the import
    // transaction committed) makes the migration-forced refresh "once, until it
    // works": failures before this point leave the flag set so the next
    // startup retries, and the manual gtfs:update path consumes it too.
    setMetadata('gtfs_last_update', new Date().toISOString());
    setMetadata('gtfs_stops_count', String(data.stops.length));
    setMetadata('gtfs_trips_count', String(data.trips.length));
    setMetadata('gtfs_transfers_count', String(data.transfers.length));
    deleteMetadata(GTFS_FORCE_REFRESH_KEY);

    logger.info(
      {
        transfers: data.transfers.length,
        notes: data.notes.length,
      },
      'GTFS data imported successfully'
    );
  }

  async updateStaticData(force: boolean = false): Promise<boolean> {
    try {
      if (!force && !(await this.needsUpdate())) {
        logger.info('GTFS data is up to date');
        return false;
      }

      const zipBuffer = await this.downloadGTFS();
      const data = await this.extractAndParse(zipBuffer);
      await this.importToDatabase(data);

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, 'Failed to update GTFS static data');
      throw error;
    }
  }
}

// Singleton instance
let loaderInstance: GTFSLoader | null = null;

export function getGTFSLoader(): GTFSLoader {
  if (!loaderInstance) {
    loaderInstance = new GTFSLoader();
  }
  return loaderInstance;
}
