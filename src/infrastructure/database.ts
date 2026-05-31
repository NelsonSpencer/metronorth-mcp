import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { config } from '../config.js';
import { createModuleLogger } from '../logger.js';
import * as schema from './schema.js';
import path from 'path';
import fs from 'fs';

const logger = createModuleLogger('database');

let db: ReturnType<typeof drizzle> | null = null;
let sqlite: Database.Database | null = null;

export function getDatabase() {
  if (db) return db;

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

  db = drizzle(sqlite, { schema });

  // Initialize schema
  initializeSchema();

  return db;
}

export function getSqlite(): Database.Database {
  if (!sqlite) {
    getDatabase();
  }
  return sqlite!;
}

export function closeDatabase() {
  if (sqlite) {
    logger.info('Closing database connection');
    sqlite.close();
    sqlite = null;
    db = null;
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
    CREATE INDEX IF NOT EXISTS idx_realtime_trip ON realtime_updates(trip_id);
    CREATE INDEX IF NOT EXISTS idx_realtime_updated_at ON realtime_updates(updated_at);
  `);

  logger.info('Database schema initialized');
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
