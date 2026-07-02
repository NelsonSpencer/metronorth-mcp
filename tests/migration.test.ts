import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// These tests exercise the real better-sqlite3 module (no mock) against
// throwaway temp databases to verify the versioned schema migration.

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mnr-migration-'));
  return path.join(dir, 'metronorth.db');
}

// Recreate the v1 (pre-versioning) schema: no schema_version metadata, no
// track/note_id/peak_offpeak columns, and no transfers/notes tables.
function createV1Database(dbPath: string): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE trips (
      trip_id TEXT PRIMARY KEY,
      route_id TEXT NOT NULL,
      service_id TEXT NOT NULL,
      trip_headsign TEXT,
      trip_short_name TEXT,
      direction_id INTEGER,
      block_id TEXT,
      shape_id TEXT,
      wheelchair_accessible INTEGER,
      bikes_allowed INTEGER
    );
    CREATE TABLE stop_times (
      trip_id TEXT NOT NULL,
      arrival_time TEXT NOT NULL,
      departure_time TEXT NOT NULL,
      stop_id TEXT NOT NULL,
      stop_sequence INTEGER NOT NULL,
      stop_headsign TEXT,
      pickup_type INTEGER,
      drop_off_type INTEGER,
      shape_dist_traveled REAL,
      timepoint INTEGER,
      PRIMARY KEY (trip_id, stop_sequence)
    );
  `);
  // Simulate an install that already ingested GTFS recently so that the only
  // driver of a refresh is the migration-forced flag.
  db.prepare(`INSERT INTO metadata (key, value) VALUES ('gtfs_last_update', ?)`).run(
    new Date().toISOString()
  );
  db.close();
}

// Recreate a v2 database: schema_version = 2 and a realtime_updates table that
// predates the v3 track/train_status columns.
function createV2Database(dbPath: string): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE realtime_updates (
      trip_id TEXT NOT NULL,
      stop_id TEXT NOT NULL,
      arrival_delay INTEGER,
      departure_delay INTEGER,
      schedule_relationship TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (trip_id, stop_id)
    );
  `);
  db.prepare(`INSERT INTO metadata (key, value) VALUES ('schema_version', '2')`).run();
  db.prepare(`INSERT INTO metadata (key, value) VALUES ('gtfs_last_update', ?)`).run(
    new Date().toISOString()
  );
  db.close();
}

function columnNames(sqlite: Database.Database, table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (c) => c.name
  );
}

function tableNames(sqlite: Database.Database): string[] {
  return (
    sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as {
      name: string;
    }[]
  ).map((t) => t.name);
}

describe('schema migration', () => {
  let dbPath: string;

  beforeEach(() => {
    vi.resetModules();
    dbPath = makeTempDbPath();
    vi.stubEnv('DB_PATH', dbPath);
    vi.stubEnv('REDIS_URL', '');
    vi.stubEnv('NODE_ENV', 'test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('upgrades a v1 database in place and forces a one-time GTFS refresh', async () => {
    createV1Database(dbPath);

    const { getDatabase, getSqlite, getMetadata, closeDatabase, SCHEMA_VERSION, GTFS_FORCE_REFRESH_KEY } =
      await import('../src/infrastructure/database.js');

    getDatabase();
    const sqlite = getSqlite();

    // New columns added to pre-existing tables.
    expect(columnNames(sqlite, 'stop_times')).toEqual(
      expect.arrayContaining(['track', 'note_id'])
    );
    expect(columnNames(sqlite, 'trips')).toContain('peak_offpeak');

    // New tables created.
    expect(tableNames(sqlite)).toEqual(expect.arrayContaining(['transfers', 'notes']));

    // Schema version recorded and a refresh forced so the columns get populated.
    expect(getMetadata('schema_version')).toBe(String(SCHEMA_VERSION));
    expect(getMetadata(GTFS_FORCE_REFRESH_KEY)).toBe('1');

    closeDatabase();
  });

  it('adds v3 realtime columns in place without forcing a GTFS refresh', async () => {
    createV2Database(dbPath);

    const { getDatabase, getSqlite, getMetadata, closeDatabase, SCHEMA_VERSION, GTFS_FORCE_REFRESH_KEY } =
      await import('../src/infrastructure/database.js');

    getDatabase();
    const sqlite = getSqlite();

    // Transient realtime columns ALTERed onto the pre-existing table.
    expect(columnNames(sqlite, 'realtime_updates')).toEqual(
      expect.arrayContaining(['track', 'train_status'])
    );

    // Schema version advances, but a transient-table change must NOT force a
    // one-time GTFS re-ingest.
    expect(getMetadata('schema_version')).toBe(String(SCHEMA_VERSION));
    expect(getMetadata(GTFS_FORCE_REFRESH_KEY)).toBeNull();

    closeDatabase();
  });

  it('initializes a fresh database at the current version without a refresh loop', async () => {
    const {
      getDatabase,
      getMetadata,
      setMetadata,
      closeDatabase,
      SCHEMA_VERSION,
      GTFS_FORCE_REFRESH_KEY,
    } = await import('../src/infrastructure/database.js');
    const { getGTFSLoader } = await import('../src/infrastructure/gtfs-loader.js');

    getDatabase();

    expect(getMetadata('schema_version')).toBe(String(SCHEMA_VERSION));

    // Pretend GTFS was ingested moments ago so the ONLY reason to refresh is the
    // migration-forced flag; this isolates the "force once, then clear" contract
    // from the normal time-based freshness check.
    setMetadata('gtfs_last_update', new Date().toISOString());

    const loader = getGTFSLoader();
    expect(await loader.needsUpdate()).toBe(true); // consumes the forced-refresh flag
    expect(getMetadata(GTFS_FORCE_REFRESH_KEY)).toBeNull();
    expect(await loader.needsUpdate()).toBe(false); // no forced-refresh loop

    closeDatabase();
  });
});
