import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdmZip from 'adm-zip';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Exercises the real GTFS loader against a real better-sqlite3 database using an
// in-memory ZIP built from small CSV fixtures. Verifies that the columns and
// optional files added in schema v2 are parsed and persisted.

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mnr-loader-'));
  return path.join(dir, 'metronorth.db');
}

const AGENCY_CSV = [
  'agency_id,agency_name,agency_url,agency_timezone',
  'MNR,Metro-North Railroad,https://mta.info,America/New_York',
  '',
].join('\n');

const STOPS_CSV = [
  'stop_id,stop_name,stop_lat,stop_lon',
  'GCT,Grand Central Terminal,40.7527,-73.9772',
  'WP,White Plains,41.0339,-73.7743',
  '',
].join('\n');

const ROUTES_CSV = ['route_id,route_long_name,route_type', '2,Harlem,2', ''].join('\n');

const TRIPS_CSV = [
  'trip_id,route_id,service_id,trip_headsign,wheelchair_accessible,peak_offpeak',
  'T1,2,WKD,White Plains,1,0',
  'T2,2,WKD,Southeast,1,1',
  '',
].join('\n');

// Header matches the live feed: track and note_id are the trailing columns.
const STOP_TIMES_CSV = [
  'trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type,track,note_id',
  'T1,10:00:00,10:00:00,GCT,1,0,0,,',
  'T1,10:40:00,10:40:00,WP,2,0,0,4,H',
  '',
].join('\n');

// Same-station trip-to-trip timed transfer; route ids and min_transfer_time
// are empty, exactly like the live feed.
const TRANSFERS_CSV = [
  'from_stop_id,to_stop_id,from_route_id,to_route_id,from_trip_id,to_trip_id,transfer_type,min_transfer_time',
  'GCT,GCT,,,T1,T2,1,',
  '',
].join('\n');

const NOTES_CSV = [
  'note_id,note_mark,note_title,note_desc',
  'H,H,Early departure,Train may depart 5 minutes earlier than the time shown',
  'B,B,Bus,Bus',
  '',
].join('\n');

function buildZip(files: Record<string, string>): Buffer {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) {
    zip.addFile(name, Buffer.from(content, 'utf-8'));
  }
  return zip.toBuffer();
}

const baseFiles: Record<string, string> = {
  'agency.txt': AGENCY_CSV,
  'stops.txt': STOPS_CSV,
  'routes.txt': ROUTES_CSV,
  'trips.txt': TRIPS_CSV,
  'stop_times.txt': STOP_TIMES_CSV,
};

describe('GTFSLoader import', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('DB_PATH', makeTempDbPath());
    vi.stubEnv('REDIS_URL', '');
    vi.stubEnv('NODE_ENV', 'test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('parses and persists transfers, notes, and the new stop_times/trips columns', async () => {
    const { getDatabase, getSqlite, closeDatabase } = await import(
      '../src/infrastructure/database.js'
    );
    const { getGTFSLoader } = await import('../src/infrastructure/gtfs-loader.js');

    getDatabase();
    const loader = getGTFSLoader();

    const parsed = await loader.extractAndParse(
      buildZip({ ...baseFiles, 'transfers.txt': TRANSFERS_CSV, 'notes.txt': NOTES_CSV })
    );
    expect(parsed.transfers).toHaveLength(1);
    expect(parsed.notes).toHaveLength(2);

    await loader.importToDatabase(parsed);

    const sqlite = getSqlite();

    // stop_times.track / note_id populated where present, null where blank.
    const wp = sqlite
      .prepare(`SELECT track, note_id FROM stop_times WHERE trip_id = 'T1' AND stop_id = 'WP'`)
      .get() as { track: string | null; note_id: string | null };
    expect(wp.track).toBe('4');
    expect(wp.note_id).toBe('H');

    const gct = sqlite
      .prepare(`SELECT track, note_id FROM stop_times WHERE trip_id = 'T1' AND stop_id = 'GCT'`)
      .get() as { track: string | null; note_id: string | null };
    expect(gct.track).toBeNull();
    expect(gct.note_id).toBeNull();

    // trips.peak_offpeak parsed as an integer flag (0 stays 0, not null).
    const trips = sqlite
      .prepare(`SELECT trip_id, peak_offpeak FROM trips ORDER BY trip_id`)
      .all() as { trip_id: string; peak_offpeak: number | null }[];
    expect(trips).toEqual([
      { trip_id: 'T1', peak_offpeak: 0 },
      { trip_id: 'T2', peak_offpeak: 1 },
    ]);

    // transfers: empty route ids and min_transfer_time become null; default type.
    const transfer = sqlite
      .prepare(`SELECT * FROM transfers WHERE from_trip_id = 'T1' AND to_trip_id = 'T2'`)
      .get() as {
      from_route_id: string | null;
      to_route_id: string | null;
      transfer_type: number;
      min_transfer_time: number | null;
    };
    expect(transfer.from_route_id).toBeNull();
    expect(transfer.to_route_id).toBeNull();
    expect(transfer.transfer_type).toBe(1);
    expect(transfer.min_transfer_time).toBeNull();

    // notes persisted.
    const note = sqlite
      .prepare(`SELECT note_desc FROM notes WHERE note_id = 'H'`)
      .get() as { note_desc: string | null };
    expect(note.note_desc).toContain('5 minutes earlier');

    closeDatabase();
  });

  it('imports successfully when transfers.txt and notes.txt are absent', async () => {
    const { getDatabase, getSqlite, closeDatabase } = await import(
      '../src/infrastructure/database.js'
    );
    const { getGTFSLoader } = await import('../src/infrastructure/gtfs-loader.js');

    getDatabase();
    const loader = getGTFSLoader();

    const parsed = await loader.extractAndParse(buildZip(baseFiles));
    expect(parsed.transfers).toHaveLength(0);
    expect(parsed.notes).toHaveLength(0);

    await loader.importToDatabase(parsed);

    const sqlite = getSqlite();
    const transfers = sqlite.prepare(`SELECT COUNT(*) AS n FROM transfers`).get() as {
      n: number;
    };
    const notes = sqlite.prepare(`SELECT COUNT(*) AS n FROM notes`).get() as { n: number };
    expect(transfers.n).toBe(0);
    expect(notes.n).toBe(0);

    closeDatabase();
  });
});
