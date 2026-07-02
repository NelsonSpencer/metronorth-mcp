import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { createModuleLogger } from '../logger.js';

const logger = createModuleLogger('database');

let sqlite: Database.Database | null = null;

// Current database schema version. Bump this (and add a migration branch in
// runMigrations) whenever the GTFS schema changes so that databases created by
// older versions upgrade in place. Databases predating schema versioning report
// no `schema_version` metadata and are treated as version 1.
export const SCHEMA_VERSION = 2;

// Metadata key holding the applied schema version.
const SCHEMA_VERSION_KEY = 'schema_version';

// Metadata flag set by a migration to force a one-time GTFS re-ingest so that
// newly added columns/tables get populated. Consumed by GTFSLoader.needsUpdate.
export const GTFS_FORCE_REFRESH_KEY = 'gtfs_force_refresh';

export function getDatabase(): Database.Database {
  if (sqlite) return sqlite;

  // Ensure db directory exists
  const dbDir = path.dirname(config.DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  logger.info({ path: config.DB_PATH }, 'Initializing SQLite database');

  sqlite = new Database(config.DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('cache_size = 10000');
  sqlite.pragma('temp_store = MEMORY');

  // Initialize schema
  initializeSchema();

  return sqlite;
}

export function getSqlite(): Database.Database {
  return sqlite ?? getDatabase();
}

export function closeDatabase() {
  if (sqlite) {
    logger.info('Closing database connection');
    sqlite.close();
    sqlite = null;
  }
}

function initializeSchema() {
  if (!sqlite) return;

  logger.info('Initializing database schema');

  sqlite.exec(`
    -- Agency table
    CREATE TABLE IF NOT EXISTS agency (
      agency_id TEXT PRIMARY KEY,
      agency_name TEXT NOT NULL,
      agency_url TEXT NOT NULL,
      agency_timezone TEXT NOT NULL,
      agency_lang TEXT,
      agency_phone TEXT,
      agency_fare_url TEXT
    );

    -- Stops table
    CREATE TABLE IF NOT EXISTS stops (
      stop_id TEXT PRIMARY KEY,
      stop_code TEXT,
      stop_name TEXT NOT NULL,
      stop_desc TEXT,
      stop_lat REAL NOT NULL,
      stop_lon REAL NOT NULL,
      zone_id TEXT,
      stop_url TEXT,
      location_type INTEGER DEFAULT 0,
      parent_station TEXT,
      stop_timezone TEXT,
      wheelchair_boarding INTEGER
    );

    -- Routes table
    CREATE TABLE IF NOT EXISTS routes (
      route_id TEXT PRIMARY KEY,
      agency_id TEXT,
      route_short_name TEXT,
      route_long_name TEXT NOT NULL,
      route_desc TEXT,
      route_type INTEGER NOT NULL,
      route_url TEXT,
      route_color TEXT,
      route_text_color TEXT
    );

    -- Trips table
    CREATE TABLE IF NOT EXISTS trips (
      trip_id TEXT PRIMARY KEY,
      route_id TEXT NOT NULL,
      service_id TEXT NOT NULL,
      trip_headsign TEXT,
      trip_short_name TEXT,
      direction_id INTEGER,
      block_id TEXT,
      shape_id TEXT,
      wheelchair_accessible INTEGER,
      bikes_allowed INTEGER,
      peak_offpeak INTEGER,
      FOREIGN KEY (route_id) REFERENCES routes(route_id)
    );

    -- Stop times table
    CREATE TABLE IF NOT EXISTS stop_times (
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
      track TEXT,
      note_id TEXT,
      PRIMARY KEY (trip_id, stop_sequence),
      FOREIGN KEY (trip_id) REFERENCES trips(trip_id),
      FOREIGN KEY (stop_id) REFERENCES stops(stop_id)
    );

    -- Calendar table
    CREATE TABLE IF NOT EXISTS calendar (
      service_id TEXT PRIMARY KEY,
      monday INTEGER NOT NULL,
      tuesday INTEGER NOT NULL,
      wednesday INTEGER NOT NULL,
      thursday INTEGER NOT NULL,
      friday INTEGER NOT NULL,
      saturday INTEGER NOT NULL,
      sunday INTEGER NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL
    );

    -- Calendar dates table
    CREATE TABLE IF NOT EXISTS calendar_dates (
      service_id TEXT NOT NULL,
      date TEXT NOT NULL,
      exception_type INTEGER NOT NULL,
      PRIMARY KEY (service_id, date)
    );

    -- Transfers table (same-station trip-to-trip timed transfers)
    CREATE TABLE IF NOT EXISTS transfers (
      from_stop_id TEXT NOT NULL,
      to_stop_id TEXT NOT NULL,
      from_route_id TEXT,
      to_route_id TEXT,
      from_trip_id TEXT NOT NULL,
      to_trip_id TEXT NOT NULL,
      transfer_type INTEGER NOT NULL DEFAULT 1,
      min_transfer_time INTEGER,
      PRIMARY KEY (from_trip_id, to_trip_id, from_stop_id)
    );

    -- Notes table (GTFS note reference codes, e.g. "H" = departs early)
    CREATE TABLE IF NOT EXISTS notes (
      note_id TEXT PRIMARY KEY,
      note_mark TEXT,
      note_title TEXT,
      note_desc TEXT
    );

    -- Realtime updates table
    CREATE TABLE IF NOT EXISTS realtime_updates (
      trip_id TEXT NOT NULL,
      stop_id TEXT NOT NULL,
      arrival_delay INTEGER,
      departure_delay INTEGER,
      schedule_relationship TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (trip_id, stop_id)
    );

    -- Metadata table for tracking GTFS updates
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Create indexes for performance
    CREATE INDEX IF NOT EXISTS idx_stops_name ON stops(stop_name);
    CREATE INDEX IF NOT EXISTS idx_stops_parent ON stops(parent_station);
    CREATE INDEX IF NOT EXISTS idx_stop_times_stop ON stop_times(stop_id);
    CREATE INDEX IF NOT EXISTS idx_stop_times_trip ON stop_times(trip_id);
    CREATE INDEX IF NOT EXISTS idx_stop_times_departure ON stop_times(departure_time);
    CREATE INDEX IF NOT EXISTS idx_trips_route ON trips(route_id);
    CREATE INDEX IF NOT EXISTS idx_trips_service ON trips(service_id);
    CREATE INDEX IF NOT EXISTS idx_calendar_dates_date ON calendar_dates(date);
    CREATE INDEX IF NOT EXISTS idx_transfers_from_trip ON transfers(from_trip_id);
    CREATE INDEX IF NOT EXISTS idx_transfers_to_trip ON transfers(to_trip_id);
    CREATE INDEX IF NOT EXISTS idx_realtime_trip ON realtime_updates(trip_id);
    CREATE INDEX IF NOT EXISTS idx_realtime_updated_at ON realtime_updates(updated_at);
  `);

  runMigrations();

  logger.info('Database schema initialized');
}

// Apply in-place schema migrations for databases created by older versions.
// initializeSchema has already added any brand-new tables/columns via
// CREATE TABLE IF NOT EXISTS, so this only backfills columns that must be
// ALTERed onto pre-existing tables and records the new schema version.
function runMigrations() {
  if (!sqlite) return;

  const currentVersion = Number(getMetadata(SCHEMA_VERSION_KEY) ?? '1');
  if (currentVersion >= SCHEMA_VERSION) return;

  logger.info({ from: currentVersion, to: SCHEMA_VERSION }, 'Migrating database schema');

  // v1 -> v2: surface GTFS fields the loader previously dropped. New tables
  // (transfers, notes) already exist via CREATE TABLE IF NOT EXISTS above; these
  // columns must be ALTERed onto tables that predate v2.
  addColumnIfMissing('stop_times', 'track', 'TEXT');
  addColumnIfMissing('stop_times', 'note_id', 'TEXT');
  addColumnIfMissing('trips', 'peak_offpeak', 'INTEGER');

  setMetadata(SCHEMA_VERSION_KEY, String(SCHEMA_VERSION));
  // Force a one-time GTFS re-ingest so the newly added columns/tables populate.
  setMetadata(GTFS_FORCE_REFRESH_KEY, '1');

  logger.info(
    { version: SCHEMA_VERSION },
    'Database schema migration complete; GTFS refresh forced'
  );
}

// Add a column only when it is absent so the migration is idempotent and safe
// against both freshly created databases (column already present via CREATE
// TABLE) and older ones that need the ALTER.
function addColumnIfMissing(table: string, column: string, definition: string) {
  const columns = runQuery<{ name: string }>(`PRAGMA table_info(${table})`);
  if (columns.some((c) => c.name === column)) return;
  getSqlite().exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

// Utility function to run raw queries
export function runQuery<T>(query: string, params: unknown[] = []): T[] {
  const sqlite = getSqlite();
  const stmt = sqlite.prepare(query);
  return stmt.all(...params) as T[];
}

// Utility function to run insert/update
export function runStatement(query: string, params: unknown[] = []) {
  const sqlite = getSqlite();
  const stmt = sqlite.prepare(query);
  return stmt.run(...params);
}

// Transaction helper
export function transaction<T>(fn: () => T): T {
  const sqlite = getSqlite();
  return sqlite.transaction(fn)();
}

// Get metadata value
export function getMetadata(key: string): string | null {
  const result = runQuery<{ value: string }>(
    'SELECT value FROM metadata WHERE key = ?',
    [key]
  );
  return result[0]?.value ?? null;
}

// Set metadata value
export function setMetadata(key: string, value: string) {
  runStatement(
    `INSERT INTO metadata (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [key, value]
  );
}

// Delete metadata value (no-op when the key is absent)
export function deleteMetadata(key: string) {
  runStatement('DELETE FROM metadata WHERE key = ?', [key]);
}
