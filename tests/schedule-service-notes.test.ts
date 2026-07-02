import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ScheduleService } from '../src/infrastructure/schedule-service.js';

// Exercises the real ScheduleService against a real better-sqlite3 database
// seeded with peak_offpeak flags and notes rows, so the actual SQL joins for
// fare_class labelling (Feature D) and train-note passthrough (Feature G) run
// end to end. Realtime and station lookup are mocked so the tests stay
// deterministic and offline.

vi.mock('../src/infrastructure/realtime-client.js', () => ({
  getRealtimeClient: vi.fn(() => ({
    isAvailable: vi.fn(() => false),
    getTripUpdates: vi.fn(() => Promise.resolve([])),
    getDelayForTripAtStopFromUpdates: vi.fn(() => null),
    getDelayForTripFromUpdates: vi.fn(() => null),
    getRealtimeInfoForTripAtStopFromUpdates: vi.fn(() => ({
      delaySeconds: null,
      status: 'unknown',
      actualTime: null,
      track: null,
      trainStatus: null,
    })),
  })),
}));

vi.mock('../src/infrastructure/station-service.js', () => ({
  getStationService: vi.fn(() => ({
    findStationByName: vi.fn((name: string) =>
      Promise.resolve(
        name.toLowerCase().includes('white')
          ? { stop_id: 'WP', stop_name: 'White Plains' }
          : { stop_id: 'GCT', stop_name: 'Grand Central Terminal' }
      )
    ),
  })),
}));

const H_DESCRIPTION = 'Train may depart 5 minutes earlier than the time shown';

// Origin departures sit at GTFS "after-midnight" 27:xx so they are always at or
// after the current service query time regardless of when the suite runs.
function seed(sqlite: Database.Database): void {
  sqlite.exec(`
    INSERT INTO stops (stop_id, stop_name, stop_lat, stop_lon) VALUES
      ('GCT','Grand Central Terminal',40.75,-73.97),
      ('FOR','Fordham',40.86,-73.89),
      ('MTV','Mount Vernon East',40.91,-73.83),
      ('HAR','Harlem-125th Street',40.80,-73.93),
      ('CRE','Crestwood',40.96,-73.82),
      ('WP','White Plains',41.03,-73.77);

    INSERT INTO routes (route_id, route_long_name, route_type) VALUES
      ('2','Harlem',2);

    INSERT INTO calendar
      (service_id, monday, tuesday, wednesday, thursday, friday, saturday, sunday, start_date, end_date)
      VALUES ('WKD',1,1,1,1,1,1,1,'20000101','20991231');

    -- H: text in note_desc. B: text in both. T: only note_title (fallback).
    -- E: no text at all (must be omitted entirely).
    INSERT INTO notes (note_id, note_mark, note_title, note_desc) VALUES
      ('H','H',NULL,'${H_DESCRIPTION}'),
      ('B','B','Bus','Bus'),
      ('T','T','Title only',NULL),
      ('E','E',NULL,NULL);

    INSERT INTO trips (trip_id, route_id, service_id, trip_headsign, direction_id, peak_offpeak) VALUES
      ('T_PEAK','2','WKD','White Plains',0,1),
      ('T_OFF','2','WKD','White Plains',0,0),
      ('T_NULL','2','WKD','White Plains',0,NULL),
      ('T_DETAIL','2','WKD','White Plains',0,1);

    INSERT INTO stop_times
      (trip_id, arrival_time, departure_time, stop_id, stop_sequence, note_id) VALUES
      ('T_PEAK','27:00:00','27:00:00','GCT',1,'H'),
      ('T_PEAK','27:40:00','27:40:00','WP',2,NULL),
      ('T_OFF','27:10:00','27:10:00','GCT',1,NULL),
      ('T_OFF','27:50:00','27:50:00','WP',2,NULL),
      ('T_NULL','27:20:00','27:20:00','GCT',1,'B'),
      ('T_DETAIL','18:00:00','18:00:00','FOR',1,'H'),
      ('T_DETAIL','18:10:00','18:10:00','MTV',2,'H'),
      ('T_DETAIL','18:20:00','18:20:00','HAR',3,'T'),
      ('T_DETAIL','18:30:00','18:30:00','CRE',4,'E'),
      ('T_DETAIL','18:40:00','18:40:00','WP',5,NULL);
  `);
}

describe('ScheduleService peak/off-peak labelling and train notes', () => {
  let service: ScheduleService;
  let closeDb: () => void;

  beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mnr-notes-'));
    vi.stubEnv('DB_PATH', path.join(dir, 'metronorth.db'));
    vi.stubEnv('REDIS_URL', '');
    vi.stubEnv('NODE_ENV', 'test');

    const db = await import('../src/infrastructure/database.js');
    db.getDatabase();
    seed(db.getSqlite());
    closeDb = db.closeDatabase;

    const { ScheduleService } = await import('../src/infrastructure/schedule-service.js');
    service = new ScheduleService();
  });

  afterAll(() => {
    closeDb?.();
    vi.unstubAllEnvs();
  });

  it('labels departures with fare_class and passes through the origin note', async () => {
    const departures = await service.getDepartures('Grand Central', 'all', 10, false);
    const byId = Object.fromEntries(departures.map((d) => [d.trip_id, d]));

    expect(byId.T_PEAK.fare_class).toBe('peak');
    expect(byId.T_PEAK.note).toEqual({ mark: 'H', description: H_DESCRIPTION });

    expect(byId.T_OFF.fare_class).toBe('off_peak');
    expect(byId.T_OFF.note).toBeNull();

    // NULL peak_offpeak stays null rather than being guessed.
    expect(byId.T_NULL.fare_class).toBeNull();
    expect(byId.T_NULL.note).toEqual({ mark: 'B', description: 'Bus' });
  });

  it('exposes trip-level fare_class, per-stop notes, and a distinct note rollup', async () => {
    const details = await service.getTripDetails('T_DETAIL', false);

    expect(details?.fare_class).toBe('peak');

    const stops = details?.stops ?? [];
    expect(stops[0].note).toEqual({ mark: 'H', description: H_DESCRIPTION });
    expect(stops[1].note).toEqual({ mark: 'H', description: H_DESCRIPTION });
    // note_desc empty -> falls back to note_title.
    expect(stops[2].note).toEqual({ mark: 'T', description: 'Title only' });
    // Empty note text is omitted entirely.
    expect(stops[3].note).toBeNull();
    // No note reference at all.
    expect(stops[4].note).toBeNull();

    // Rollup is distinct across stops: the repeated H collapses to one entry and
    // the empty E note never appears.
    expect(details?.notes).toEqual([
      { mark: 'H', description: H_DESCRIPTION },
      { mark: 'T', description: 'Title only' },
    ]);
  });

  it('carries fare_class and the origin note onto station-pair trips', async () => {
    const trips = await service.getStationPairSchedule('Grand Central', 'White Plains', {
      date: '2026-07-15',
      departAfter: '00:00',
      limit: 5,
      includeRealtime: false,
    });
    const byId = Object.fromEntries(trips.map((t) => [t.trip_id, t]));

    expect(byId.T_PEAK.fare_class).toBe('peak');
    expect(byId.T_PEAK.note).toEqual({ mark: 'H', description: H_DESCRIPTION });
    expect(byId.T_OFF.fare_class).toBe('off_peak');
    expect(byId.T_OFF.note).toBeNull();
  });

  it('labels route-schedule trips with fare_class and no notes', async () => {
    const schedule = await service.getRouteSchedule('Harlem', '2026-07-15', 'all');
    const byId = Object.fromEntries(schedule.map((t) => [t.trip_id, t]));

    expect(byId.T_PEAK.fare_class).toBe('peak');
    expect(byId.T_OFF.fare_class).toBe('off_peak');
    expect(byId.T_NULL.fare_class).toBeNull();
    expect(byId.T_DETAIL.fare_class).toBe('peak');
    // Route schedule does not join notes.
    expect(byId.T_PEAK.note).toBeNull();
  });
});
