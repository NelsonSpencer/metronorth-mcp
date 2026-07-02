import { z } from 'zod';

// ============================================================================
// GTFS Static Data Types
// ============================================================================

export interface Stop {
  stop_id: string;
  stop_code: string | null;
  stop_name: string;
  stop_desc: string | null;
  stop_lat: number;
  stop_lon: number;
  zone_id: string | null;
  stop_url: string | null;
  location_type: number;
  parent_station: string | null;
  stop_timezone: string | null;
  wheelchair_boarding: number | null;
}

export interface Route {
  route_id: string;
  agency_id: string | null;
  route_short_name: string;
  route_long_name: string;
  route_desc: string | null;
  route_type: number;
  route_url: string | null;
  route_color: string | null;
  route_text_color: string | null;
}

export interface Trip {
  trip_id: string;
  route_id: string;
  service_id: string;
  trip_headsign: string | null;
  trip_short_name: string | null;
  direction_id: number | null;
  block_id: string | null;
  shape_id: string | null;
  wheelchair_accessible: number | null;
  bikes_allowed: number | null;
  peak_offpeak: number | null;
}

export interface StopTime {
  trip_id: string;
  arrival_time: string;
  departure_time: string;
  stop_id: string;
  stop_sequence: number;
  stop_headsign: string | null;
  pickup_type: number | null;
  drop_off_type: number | null;
  shape_dist_traveled: number | null;
  timepoint: number | null;
  track: string | null;
  note_id: string | null;
}

export interface Transfer {
  from_stop_id: string;
  to_stop_id: string;
  from_route_id: string | null;
  to_route_id: string | null;
  from_trip_id: string;
  to_trip_id: string;
  transfer_type: number;
  min_transfer_time: number | null;
}

export interface TripNote {
  note_id: string;
  note_mark: string | null;
  note_title: string | null;
  note_desc: string | null;
}

export interface Calendar {
  service_id: string;
  monday: number;
  tuesday: number;
  wednesday: number;
  thursday: number;
  friday: number;
  saturday: number;
  sunday: number;
  start_date: string;
  end_date: string;
}

export interface CalendarDate {
  service_id: string;
  date: string;
  exception_type: number;
}

export interface Agency {
  agency_id: string;
  agency_name: string;
  agency_url: string;
  agency_timezone: string;
  agency_lang: string | null;
  agency_phone: string | null;
  agency_fare_url: string | null;
}

// ============================================================================
// GTFS Real-time Types
// ============================================================================

export interface TripUpdate {
  trip_id: string;
  route_id: string | null;
  start_time: string | null;
  start_date: string | null;
  schedule_relationship: string | null;
  stop_time_updates: StopTimeUpdate[];
  timestamp: number | null;
  vehicle_id: string | null;
  train_number: string; // The entity ID from GTFS-RT, which is the train number for MNR
}

export interface StopTimeUpdate {
  stop_sequence: number | null;
  stop_id: string | null;
  arrival_delay: number | null;
  departure_delay: number | null;
  // Absolute predicted times in epoch seconds (GTFS-RT StopTimeEvent.time).
  // MNR populates these even when the relative delay is omitted, so they are
  // the basis for the absolute-time delay fallback in the realtime client.
  arrival_time: number | null;
  departure_time: number | null;
  schedule_relationship: string | null;
  // MTA Railroad extension (field 1005): assigned track and raw train status.
  track: string | null;
  train_status: string | null;
}

export interface ServiceAlert {
  alert_id: string;
  cause: string | null;
  effect: string | null;
  header_text: string;
  description_text: string | null;
  url: string | null;
  active_period_start: number | null;
  active_period_end: number | null;
  informed_entities: InformedEntity[];
}

export interface InformedEntity {
  agency_id: string | null;
  route_id: string | null;
  route_type: number | null;
  trip_id: string | null;
  stop_id: string | null;
}

// ============================================================================
// Zod Schemas for MCP Tool Input Validation
// ============================================================================

export const GetDeparturesSchema = z.object({
  station_name: z
    .string()
    .min(2)
    .describe('Station name (partial match supported, e.g., "Grand Central" or "Harlem")'),
  direction: z
    .enum(['inbound', 'outbound', 'all'])
    .default('all')
    .describe('Direction of travel: inbound (to GCT), outbound (from GCT), or all'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe('Maximum number of departures to return'),
  include_realtime: z
    .boolean()
    .default(true)
    .describe('Include real-time delay information if available'),
});

export const GetRouteScheduleSchema = z.object({
  route_name: z
    .string()
    .describe('Route/line name (e.g., "Hudson", "Harlem", "New Haven")'),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('Date in YYYY-MM-DD format (defaults to today)'),
  direction: z
    .enum(['inbound', 'outbound', 'all'])
    .default('all')
    .describe('Direction of travel'),
});

export const GetServiceAlertsSchema = z.object({
  route_name: z
    .string()
    .optional()
    .describe('Filter alerts by route/line name'),
  station_name: z
    .string()
    .optional()
    .describe('Filter alerts by station name'),
});

export const SearchStationsSchema = z.object({
  query: z.string().min(1).describe('Search query for station names'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(5)
    .describe('Maximum number of results'),
});

export const GetTripDetailsSchema = z.object({
  trip_id: z.string().describe('The GTFS trip ID'),
  include_realtime: z
    .boolean()
    .default(true)
    .describe('Include real-time delay information'),
});

export const GetStationInfoSchema = z.object({
  station_name: z.string().min(2).describe('Station name to look up'),
});

const DateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .describe('Date in YYYY-MM-DD format (defaults to the current Metro-North service date)');

const GtfsTimeSchema = z
  .string()
  .regex(/^([0-2]?\d|3[0-5]):[0-5]\d(:[0-5]\d)?$/)
  .optional()
  .describe('Departure time in HH:mm or HH:mm:ss format; GTFS after-midnight times like 25:10 are supported');

export const GetStationPairScheduleSchema = z.object({
  origin_station: z.string().min(2).describe('Origin station name'),
  destination_station: z.string().min(2).describe('Destination station name'),
  date: DateSchema,
  depart_after: GtfsTimeSchema,
  limit: z
    .number()
    .int()
    .min(1)
    .max(25)
    .default(5)
    .describe('Maximum number of direct trips to return'),
  include_realtime: z
    .boolean()
    .default(true)
    .describe('Include real-time delay information if available'),
});

export const GetFirstLastTrainsSchema = z.object({
  origin_station: z.string().min(2).describe('Origin station name'),
  destination_station: z.string().min(2).describe('Destination station name'),
  date: DateSchema,
  include_realtime: z
    .boolean()
    .default(true)
    .describe('Include real-time delay information if available'),
});

export const PlanMetroNorthTripSchema = z.object({
  origin_station: z.string().min(2).describe('Origin station name'),
  destination_station: z.string().min(2).describe('Destination station name'),
  date: DateSchema,
  depart_after: GtfsTimeSchema,
  limit: z
    .number()
    .int()
    .min(1)
    .max(10)
    .default(3)
    .describe('Maximum number of trip options to include'),
  include_realtime: z
    .boolean()
    .default(true)
    .describe('Include real-time delay information if available'),
  include_alerts: z
    .boolean()
    .default(true)
    .describe('Include current service alerts for matching routes and stations'),
});

type JsonSchemaProperty = {
  type: string;
  description?: string;
  enum?: string[];
  default?: string | number | boolean;
  minimum?: number;
  maximum?: number;
  pattern?: string;
};

type JsonObjectSchema = {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
};

const stringProperty = (
  description: string,
  options: Omit<JsonSchemaProperty, 'type' | 'description'> = {}
): JsonSchemaProperty => ({
  type: 'string',
  description,
  ...options,
});

const numberProperty = (
  description: string,
  options: Omit<JsonSchemaProperty, 'type' | 'description'> = {}
): JsonSchemaProperty => ({
  type: 'number',
  description,
  ...options,
});

const booleanProperty = (
  description: string,
  options: Omit<JsonSchemaProperty, 'type' | 'description'> = {}
): JsonSchemaProperty => ({
  type: 'boolean',
  description,
  ...options,
});

export const ToolInputSchemas = {
  get_departures: {
    type: 'object',
    properties: {
      station_name: stringProperty(
        'Station name (partial match supported, e.g., "Grand Central" or "Harlem")'
      ),
      direction: stringProperty('Direction of travel: inbound (to GCT), outbound (from GCT), or all', {
        enum: ['inbound', 'outbound', 'all'],
        default: 'all',
      }),
      limit: numberProperty('Maximum number of departures to return (1-50)', {
        default: 10,
        minimum: 1,
        maximum: 50,
      }),
      include_realtime: booleanProperty('Include real-time delay information if available', {
        default: true,
      }),
    },
    required: ['station_name'],
  },
  get_trip_details: {
    type: 'object',
    properties: {
      trip_id: stringProperty('The GTFS trip ID'),
      include_realtime: booleanProperty('Include real-time delay information', {
        default: true,
      }),
    },
    required: ['trip_id'],
  },
  get_route_schedule: {
    type: 'object',
    properties: {
      route_name: stringProperty('Route/line name (e.g., "Hudson", "Harlem", "New Haven")'),
      date: stringProperty('Date in YYYY-MM-DD format (defaults to today)', {
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      }),
      direction: stringProperty('Direction of travel', {
        enum: ['inbound', 'outbound', 'all'],
        default: 'all',
      }),
    },
    required: ['route_name'],
  },
  get_service_alerts: {
    type: 'object',
    properties: {
      route_name: stringProperty('Filter alerts by route/line name'),
      station_name: stringProperty('Filter alerts by station name'),
    },
  },
  search_stations: {
    type: 'object',
    properties: {
      query: stringProperty('Search query for station names'),
      limit: numberProperty('Maximum number of results (1-20)', {
        default: 5,
        minimum: 1,
        maximum: 20,
      }),
    },
    required: ['query'],
  },
  get_station_info: {
    type: 'object',
    properties: {
      station_name: stringProperty('Station name to look up'),
    },
    required: ['station_name'],
  },
  get_system_status: {
    type: 'object',
    properties: {},
  },
  get_station_pair_schedule: {
    type: 'object',
    properties: {
      origin_station: stringProperty('Origin station name'),
      destination_station: stringProperty('Destination station name'),
      date: stringProperty('Date in YYYY-MM-DD format', {
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      }),
      depart_after: stringProperty('Departure time in HH:mm or HH:mm:ss format', {
        pattern: '^([0-2]?\\d|3[0-5]):[0-5]\\d(:[0-5]\\d)?$',
      }),
      limit: numberProperty('Maximum number of direct trips to return (1-25)', {
        default: 5,
        minimum: 1,
        maximum: 25,
      }),
      include_realtime: booleanProperty('Include real-time delay information if available', {
        default: true,
      }),
    },
    required: ['origin_station', 'destination_station'],
  },
  get_first_last_trains: {
    type: 'object',
    properties: {
      origin_station: stringProperty('Origin station name'),
      destination_station: stringProperty('Destination station name'),
      date: stringProperty('Date in YYYY-MM-DD format', {
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      }),
      include_realtime: booleanProperty('Include real-time delay information if available', {
        default: true,
      }),
    },
    required: ['origin_station', 'destination_station'],
  },
  plan_metro_north_trip: {
    type: 'object',
    properties: {
      origin_station: stringProperty('Origin station name'),
      destination_station: stringProperty('Destination station name'),
      date: stringProperty('Date in YYYY-MM-DD format', {
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      }),
      depart_after: stringProperty('Departure time in HH:mm or HH:mm:ss format', {
        pattern: '^([0-2]?\\d|3[0-5]):[0-5]\\d(:[0-5]\\d)?$',
      }),
      limit: numberProperty('Maximum number of trip options to include (1-10)', {
        default: 3,
        minimum: 1,
        maximum: 10,
      }),
      include_realtime: booleanProperty('Include real-time delay information if available', {
        default: true,
      }),
      include_alerts: booleanProperty('Include current service alerts for matching routes and stations', {
        default: true,
      }),
    },
    required: ['origin_station', 'destination_station'],
  },
} satisfies Record<string, JsonObjectSchema>;

// ============================================================================
// Output Types
// ============================================================================

// Peak vs off-peak fare classification for a trip, derived from the GTFS
// `trips.peak_offpeak` flag (1 = peak, 0 = off-peak). `null` when the feed does
// not classify the trip (e.g. pre-migration rows where the column is NULL).
export type FareClass = 'peak' | 'off_peak' | null;

// A resolved GTFS note reference (from notes.txt, joined via stop_times.note_id).
// `mark` is the short code (e.g. "H", "B"); `description` is the human-readable
// text (note_desc, falling back to note_title). Notes with no text are omitted
// entirely rather than surfaced with an empty description.
export interface StopNote {
  mark: string | null;
  description: string;
}

export interface DepartureInfo {
  trip_id: string;
  route_name: string;
  destination: string;
  scheduled_departure: string;
  actual_departure: string | null;
  delay_minutes: number | null;
  // Resolved boarding track (realtime assignment when present, else scheduled).
  // `platform` mirrors `track` for backward compatibility with the field that
  // previously existed on this type.
  platform: string | null;
  track: string | null;
  scheduled_track: string | null;
  track_source: 'realtime' | 'scheduled' | null;
  train_status: string | null;
  // Peak/off-peak classification for the trip (null when unclassified).
  fare_class: FareClass;
  // Note attached to the origin stop for this departure (null when none).
  note: StopNote | null;
  status: 'on_time' | 'delayed' | 'cancelled' | 'unknown';
  stops: string[];
}

export interface StationInfo {
  stop_id: string;
  name: string;
  latitude: number;
  longitude: number;
  zone_id: string | null;
  routes: string[];
  wheelchair_accessible: boolean;
}

export interface TripDetails {
  trip_id: string;
  route_name: string;
  direction: string;
  service_days: string[];
  // Peak/off-peak classification for the trip (null when unclassified).
  fare_class: FareClass;
  stops: TripStop[];
  // Distinct notes referenced anywhere along the trip's stop times (empty when
  // none). Deduplicated across stops so a note that repeats appears once.
  notes: StopNote[];
  realtime_status: TripRealtimeStatus | null;
}

export interface TripStop {
  stop_name: string;
  stop_id: string;
  arrival_time: string;
  departure_time: string;
  stop_sequence: number;
  delay_minutes: number | null;
  track: string | null;
  scheduled_track: string | null;
  track_source: 'realtime' | 'scheduled' | null;
  train_status: string | null;
  // Note attached to this stop (null when none).
  note: StopNote | null;
}

export interface TripRealtimeStatus {
  delay_minutes: number;
  last_updated: string;
  current_stop: string | null;
  next_stop: string | null;
}

export interface StationPairTrip {
  trip_id: string;
  route_name: string;
  destination: string;
  direction: string;
  origin_station: string;
  destination_station: string;
  scheduled_origin_departure: string;
  actual_origin_departure: string | null;
  scheduled_destination_arrival: string;
  actual_destination_arrival: string | null;
  duration_minutes: number;
  origin_delay_minutes: number | null;
  destination_delay_minutes: number | null;
  // Boarding track at the origin station: realtime assignment when present,
  // otherwise the scheduled track from stop_times.
  track: string | null;
  scheduled_track: string | null;
  track_source: 'realtime' | 'scheduled' | null;
  train_status: string | null;
  // Peak/off-peak classification for the trip (null when unclassified).
  fare_class: FareClass;
  // Note attached to the origin stop for this leg (null when none).
  note: StopNote | null;
  status: 'on_time' | 'delayed' | 'cancelled' | 'unknown';
}

export interface FirstLastTrains {
  service_date: string;
  origin_station: string;
  destination_station: string;
  first_train: StationPairTrip | null;
  last_train: StationPairTrip | null;
  total_direct_trips: number;
}

// A same-station timed transfer between the two legs of a one-transfer
// itinerary. `arrive`/`depart` are the display-formatted platform times at the
// hub and `wait_minutes` is the scheduled gap between them. `guaranteed` is true
// for GTFS transfer_type = 1 (a timed connection the MTA holds), which is the
// only kind Metro-North publishes.
export interface TransferConnection {
  station: string;
  arrive: string;
  depart: string;
  wait_minutes: number;
  guaranteed: boolean;
}

// A one-transfer trip option: two direct legs joined at a hub station. Each leg
// reuses StationPairTrip so realtime delays, tracks, and notes surface per leg.
// `total_duration_minutes` spans leg-1 boarding to leg-2 arrival. `connection_at_risk`
// is set when leg-1's realtime delay is at least the scheduled transfer wait, i.e.
// the arriving train may miss the connection.
export interface TransferItinerary {
  itinerary_type: 'one_transfer';
  legs: [StationPairTrip, StationPairTrip];
  transfer: TransferConnection;
  total_duration_minutes: number;
  connection_at_risk: boolean;
}

// Type exports for schema inference
export type GetDeparturesInput = z.infer<typeof GetDeparturesSchema>;
export type GetRouteScheduleInput = z.infer<typeof GetRouteScheduleSchema>;
export type GetServiceAlertsInput = z.infer<typeof GetServiceAlertsSchema>;
export type SearchStationsInput = z.infer<typeof SearchStationsSchema>;
export type GetTripDetailsInput = z.infer<typeof GetTripDetailsSchema>;
export type GetStationInfoInput = z.infer<typeof GetStationInfoSchema>;
export type GetStationPairScheduleInput = z.infer<typeof GetStationPairScheduleSchema>;
export type GetFirstLastTrainsInput = z.infer<typeof GetFirstLastTrainsSchema>;
export type PlanMetroNorthTripInput = z.infer<typeof PlanMetroNorthTripSchema>;
