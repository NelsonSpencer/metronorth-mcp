import { z } from 'zod';
import path from 'node:path';
import { homedir } from 'node:os';

function getDefaultDbPath(): string {
  const cacheRoot = process.env.XDG_CACHE_HOME || path.join(homedir(), '.cache');
  return path.join(cacheRoot, 'metronorth-mcp', 'metronorth.db');
}

function emptyStringToUndefined(value: unknown): unknown {
  return value === '' ? undefined : value;
}

function envFlagToBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function csvToList(value: unknown): string[] | undefined {
  if (typeof value !== 'string') return undefined;
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : undefined;
}

// Environment variable validation schema
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  REDIS_URL: z.preprocess(emptyStringToUndefined, z.string().url().optional()),
  DB_PATH: z.preprocess(emptyStringToUndefined, z.string().default(getDefaultDbPath())),
  GTFS_UPDATE_INTERVAL_HOURS: z.coerce.number().default(24),
  CACHE_TTL_SECONDS: z.coerce.number().default(300),
  // Opt-in HTTP transport (stdio remains the default). CLI flags override these.
  // envFlagToBoolean always yields a boolean (unset -> false), so no Zod default is needed.
  MCP_HTTP: z.preprocess(envFlagToBoolean, z.boolean()),
  MCP_HTTP_HOST: z.preprocess(emptyStringToUndefined, z.string().default('127.0.0.1')),
  MCP_HTTP_PORT: z.preprocess(
    emptyStringToUndefined,
    z.coerce.number().int().min(0).max(65535).default(8000)
  ),
  MCP_HTTP_TOKEN: z.preprocess(emptyStringToUndefined, z.string().optional()),
  MCP_HTTP_ALLOWED_HOSTS: z.preprocess(csvToList, z.array(z.string()).optional()),
  MCP_HTTP_ALLOWED_ORIGINS: z.preprocess(csvToList, z.array(z.string()).optional()),
});

// Parse and validate environment
function loadConfig() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    // Fail fast. Silently re-parsing `{}` would substitute all defaults and
    // could, for example, drop an HTTP opt-in (`MCP_HTTP=1`) when an unrelated
    // value like MCP_HTTP_PORT is invalid, booting stdio instead of failing the
    // HTTP deployment. A bad value should stop startup, not change transports.
    console.error(
      'Invalid environment configuration:',
      JSON.stringify(result.error.format(), null, 2)
    );
    process.exit(1);
  }

  return result.data;
}

export const config = loadConfig();

// GTFS Data Sources (MTA public feeds - no API key required)
// Static data from MTA S3 bucket (updated frequently)
export const GTFS_STATIC_URL = 'https://rrgtfsfeeds.s3.amazonaws.com/gtfsmnr.zip';
// Realtime GTFS-RT feeds (protobuf format, no API key required)
export const GTFS_REALTIME_URL = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/mnr%2Fgtfs-mnr';
export const GTFS_ALERTS_URL = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fall-alerts';

// Metro-North Route Mappings
export const ROUTE_NAMES: Record<string, string> = {
  '1': 'Hudson',
  '2': 'Harlem',
  '3': 'New Haven',
  '4': 'New Canaan',
  '5': 'Danbury',
  '6': 'Waterbury',
  '7': 'Pascack Valley',
  '8': 'Port Jervis',
};

export const ROUTE_IDS_BY_NAME: Record<string, string[]> = {
  hudson: ['1'],
  harlem: ['2'],
  'new haven': ['3'],
  'new canaan': ['4'],
  danbury: ['5'],
  waterbury: ['6'],
  'pascack valley': ['7'],
  'port jervis': ['8'],
};

// Major stations for reference
export const MAJOR_STATIONS = [
  'Grand Central Terminal',
  'Harlem-125th Street',
  'Croton-Harmon',
  'Poughkeepsie',
  'White Plains',
  'Brewster',
  'New Haven',
  'Stamford',
];

// Database table names
export const DB_TABLES = {
  stops: 'stops',
  routes: 'routes',
  trips: 'trips',
  stop_times: 'stop_times',
  calendar: 'calendar',
  calendar_dates: 'calendar_dates',
  transfers: 'transfers',
  notes: 'notes',
  agency: 'agency',
  realtime_updates: 'realtime_updates',
  metadata: 'metadata',
} as const;

// Cache keys
export const CACHE_KEYS = {
  stations: 'stations:all',
  routes: 'routes:all',
  stationByName: (name: string) => `station:name:${name.toLowerCase()}`,
  departures: (stationId: string) => `departures:${stationId}`,
  tripUpdates: 'realtime:trip_updates',
  serviceAlerts: 'realtime:alerts',
  gtfsLastUpdate: 'gtfs:last_update',
} as const;

// Time constants
export const TIME = {
  SECOND: 1000,
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
} as const;
