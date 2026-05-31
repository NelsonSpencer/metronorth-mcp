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
  schedule_relationship: string | null;
}

export interface VehiclePosition {
  trip_id: string | null;
  route_id: string | null;
  vehicle_id: string;
  latitude: number;
  longitude: number;
  bearing: number | null;
  speed: number | null;
  current_stop_sequence: number | null;
  current_status: string | null;
  timestamp: number | null;
  congestion_level: string | null;
  occupancy_status: string | null;
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
} satisfies Record<string, JsonObjectSchema>;

// ============================================================================
// Output Types
// ============================================================================

export interface DepartureInfo {
  trip_id: string;
  route_name: string;
  destination: string;
  scheduled_departure: string;
  actual_departure: string | null;
  delay_minutes: number | null;
  platform: string | null;
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
  stops: TripStop[];
  realtime_status: TripRealtimeStatus | null;
}

export interface TripStop {
  stop_name: string;
  stop_id: string;
  arrival_time: string;
  departure_time: string;
  stop_sequence: number;
  delay_minutes: number | null;
}

export interface TripRealtimeStatus {
  delay_minutes: number;
  last_updated: string;
  current_stop: string | null;
  next_stop: string | null;
}

// Type exports for schema inference
export type GetDeparturesInput = z.infer<typeof GetDeparturesSchema>;
export type GetRouteScheduleInput = z.infer<typeof GetRouteScheduleSchema>;
export type GetServiceAlertsInput = z.infer<typeof GetServiceAlertsSchema>;
export type SearchStationsInput = z.infer<typeof SearchStationsSchema>;
export type GetTripDetailsInput = z.infer<typeof GetTripDetailsSchema>;
export type GetStationInfoInput = z.infer<typeof GetStationInfoSchema>;
