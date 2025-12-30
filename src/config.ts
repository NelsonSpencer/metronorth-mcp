import { z } from 'zod';

// Environment variable validation schema
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  MTA_API_KEY: z.string().optional(),
  REDIS_URL: z.string().url().optional(),
  DB_PATH: z.string().default('./db/metronorth.db'),
  GTFS_UPDATE_INTERVAL_HOURS: z.coerce.number().default(24),
  REALTIME_POLL_INTERVAL_MS: z.coerce.number().default(30000),
  HTTP_PORT: z.coerce.number().default(6767),
  CACHE_TTL_SECONDS: z.coerce.number().default(300),
});

// Parse and validate environment
function loadConfig() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Invalid environment configuration:', result.error.format());
    // Return defaults for missing vars
    return envSchema.parse({});
  }

  return result.data;
}

export const config = loadConfig();

// GTFS Data Sources
export const GTFS_STATIC_URL = 'http://web.mta.info/developers/data/mnr/google_transit.zip';

export const getRealtimeFeedUrl = (apiKey: string) =>
  `https://mnorth.prod.acquia-sites.com/wse/gtfsrtwebapi/v1/gtfsrt/${apiKey}/getfeed`;

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
