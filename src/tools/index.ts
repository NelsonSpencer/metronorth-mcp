import { fromError } from 'zod-validation-error';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';
import {
  GetDeparturesSchema,
  GetRouteScheduleSchema,
  GetServiceAlertsSchema,
  SearchStationsSchema,
  GetTripDetailsSchema,
  GetStationInfoSchema,
  GetStationPairScheduleSchema,
  GetFirstLastTrainsSchema,
  PlanMetroNorthTripSchema,
  ToolInputSchemas,
  type StationPairTrip,
} from '../domain/gtfs.js';
import { getScheduleService } from '../infrastructure/schedule-service.js';
import { getStationService } from '../infrastructure/station-service.js';
import { getRealtimeClient } from '../infrastructure/realtime-client.js';
import { getGTFSLoader } from '../infrastructure/gtfs-loader.js';
import { getMetadata } from '../infrastructure/database.js';
import { createModuleLogger, logRequest } from '../logger.js';
import { ROUTE_IDS_BY_NAME } from '../config.js';
import { getMetroNorthServiceContext } from '../domain/transit-time.js';

const logger = createModuleLogger('tools');

// Tool definitions for MCP
export const toolDefinitions = [
  {
    name: 'get_departures',
    title: 'Get Departures',
    description: 'Get upcoming departures from a station, including realtime delays when available.',
    inputSchema: ToolInputSchemas.get_departures,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'get_trip_details',
    title: 'Get Trip Details',
    description: 'Get stop-level details for a specific train trip.',
    inputSchema: ToolInputSchemas.get_trip_details,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'get_route_schedule',
    title: 'Get Route Schedule',
    description: 'Get a Metro-North route schedule by route, date, and direction.',
    inputSchema: ToolInputSchemas.get_route_schedule,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'get_service_alerts',
    title: 'Get Service Alerts',
    description: 'Get current Metro-North service alerts, optionally by route or station.',
    inputSchema: ToolInputSchemas.get_service_alerts,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'search_stations',
    title: 'Search Stations',
    description: 'Search stations by name. Use this first for partial or ambiguous station names.',
    inputSchema: ToolInputSchemas.search_stations,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'get_station_info',
    title: 'Get Station Info',
    description: 'Get station metadata and served routes for a Metro-North station.',
    inputSchema: ToolInputSchemas.get_station_info,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'get_system_status',
    title: 'Get System Status',
    description: 'Check GTFS freshness, cached data counts, and realtime feed availability.',
    inputSchema: ToolInputSchemas.get_system_status,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'get_station_pair_schedule',
    title: 'Get Station Pair Schedule',
    description: 'Find direct trains between two Metro-North stations.',
    inputSchema: ToolInputSchemas.get_station_pair_schedule,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'get_first_last_trains',
    title: 'Get First Last Trains',
    description: 'Get the first and last direct trains between two stations for a service date.',
    inputSchema: ToolInputSchemas.get_first_last_trains,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'plan_metro_north_trip',
    title: 'Plan Metro-North Trip',
    description: 'Plan a direct Metro-North trip with options, alerts, and data freshness.',
    inputSchema: ToolInputSchemas.plan_metro_north_trip,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
] satisfies Tool[];

class UnknownToolError extends Error {}

class ToolDomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
  }
}

function parseArgs<T>(schema: z.ZodType<T>, args: Record<string, unknown>): T {
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    throw new ToolDomainError('invalid_arguments', fromError(parsed.error).toString());
  }

  return parsed.data;
}

function asStructuredContent(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { value };
}

function toToolResult(result: unknown): CallToolResult {
  const structuredContent = asStructuredContent(result);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(structuredContent, null, 2),
      },
    ],
    structuredContent,
  };
}

// Tool handlers
export async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  const start = Date.now();
  let success = true;

  try {
    let result: unknown;

    switch (name) {
      case 'get_departures':
        result = await handleGetDepartures(args);
        break;
      case 'get_trip_details':
        result = await handleGetTripDetails(args);
        break;
      case 'get_route_schedule':
        result = await handleGetRouteSchedule(args);
        break;
      case 'get_service_alerts':
        result = await handleGetServiceAlerts(args);
        break;
      case 'search_stations':
        result = await handleSearchStations(args);
        break;
      case 'get_station_info':
        result = await handleGetStationInfo(args);
        break;
      case 'get_system_status':
        result = await handleGetSystemStatus();
        break;
      case 'get_station_pair_schedule':
        result = await handleGetStationPairSchedule(args);
        break;
      case 'get_first_last_trains':
        result = await handleGetFirstLastTrains(args);
        break;
      case 'plan_metro_north_trip':
        result = await handlePlanMetroNorthTrip(args);
        break;
      default:
        throw new UnknownToolError(`Unknown tool: ${name}`);
    }

    return toToolResult(result);
  } catch (error) {
    if (error instanceof UnknownToolError) {
      success = false;
      throw error;
    }

    success = false;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode = error instanceof ToolDomainError ? error.code : 'tool_error';
    logger.error({ tool: name, error: errorMessage }, 'Tool execution failed');

    return {
      content: [
        {
          type: 'text',
          text: `Error: ${errorMessage}`,
        },
      ],
      structuredContent: {
        error: {
          code: errorCode,
          message: errorMessage,
          tool: name,
          ...(error instanceof ToolDomainError && error.details ? error.details : {}),
        },
      },
      isError: true,
    };
  } finally {
    logRequest(name, args, Date.now() - start, success);
  }
}

async function handleGetDepartures(args: Record<string, unknown>) {
  const parsed = parseArgs(GetDeparturesSchema, args);
  const { station_name, direction, limit, include_realtime } = parsed;
  const scheduleService = getScheduleService();

  const departures = await scheduleService.getDepartures(
    station_name,
    direction,
    limit,
    include_realtime
  );

  if (departures.length === 0) {
    throw new ToolDomainError('not_found', `No upcoming departures found from "${station_name}"`, {
      suggestions: [
        'Check the station name spelling',
        'Try a partial name like "Grand" for Grand Central',
        'Use search_stations to find the correct station name',
      ],
    });
  }

  return {
    station: station_name,
    departures: departures.map((d) => ({
      route: d.route_name,
      destination: d.destination,
      scheduled: d.scheduled_departure,
      actual: d.actual_departure || d.scheduled_departure,
      delay: d.delay_minutes ? `${d.delay_minutes} min late` : null,
      status: d.status,
      upcoming_stops: d.stops.slice(0, 5),
      trip_id: d.trip_id,
    })),
    realtime_available: departures.some((d) => d.delay_minutes !== null),
  };
}

async function handleGetTripDetails(args: Record<string, unknown>) {
  const { trip_id, include_realtime } = parseArgs(GetTripDetailsSchema, args);
  const scheduleService = getScheduleService();

  const details = await scheduleService.getTripDetails(trip_id, include_realtime);

  if (!details) {
    throw new ToolDomainError('not_found', `Trip "${trip_id}" not found`, {
      suggestion: 'Use get_departures first to find valid trip IDs',
    });
  }

  return {
    trip_id: details.trip_id,
    route: details.route_name,
    direction: details.direction,
    service_days: details.service_days,
    stops: details.stops.map((s) => ({
      station: s.stop_name,
      arrival: s.arrival_time,
      departure: s.departure_time,
      delay: s.delay_minutes ? `${s.delay_minutes} min` : null,
    })),
    realtime_status: details.realtime_status,
  };
}

async function handleGetRouteSchedule(args: Record<string, unknown>) {
  const { route_name, date, direction } = parseArgs(GetRouteScheduleSchema, args);
  const scheduleService = getScheduleService();

  const schedule = await scheduleService.getRouteSchedule(route_name, date, direction);

  if (schedule.length === 0) {
    throw new ToolDomainError('not_found', `No schedule found for route "${route_name}"`, {
      available_routes: ['Hudson', 'Harlem', 'New Haven', 'New Canaan', 'Danbury', 'Waterbury'],
    });
  }

  return {
    route: route_name,
    date: date || getMetroNorthServiceContext().serviceDate,
    direction,
    trips: schedule.map((t) => ({
      trip_id: t.trip_id,
      destination: t.destination,
      departure: t.scheduled_departure,
    })),
    total_trips: schedule.length,
  };
}

async function handleGetServiceAlerts(args: Record<string, unknown>) {
  const { route_name, station_name } = parseArgs(GetServiceAlertsSchema, args);
  const realtimeClient = getRealtimeClient();

  const alerts = await realtimeClient.getServiceAlerts();

  // Filter alerts if needed
  let filtered = alerts;
  if (route_name) {
    const routeIds = ROUTE_IDS_BY_NAME[route_name.toLowerCase()] || [];
    filtered = filtered.filter((a) =>
      a.informed_entities.some((e) => routeIds.includes(e.route_id || ''))
    );
  }

  if (station_name) {
    const stationService = getStationService();
    const station = await stationService.findStationByName(station_name);
    if (!station) {
      throw new ToolDomainError('not_found', `Station "${station_name}" not found`, {
        suggestion: 'Use search_stations to find the correct station name',
      });
    }

    filtered = filtered.filter((a) =>
      a.informed_entities.some((e) => e.stop_id === station.stop_id)
    );
  }

  return {
    alerts: filtered.map((a) => ({
      id: a.alert_id,
      header: a.header_text,
      description: a.description_text,
      cause: a.cause,
      effect: a.effect,
      affected_routes: a.informed_entities
        .filter((e) => e.route_id)
        .map((e) => e.route_id),
    })),
    total: filtered.length,
    last_updated: new Date().toISOString(),
  };
}

async function handleSearchStations(args: Record<string, unknown>) {
  const { query, limit } = parseArgs(SearchStationsSchema, args);
  const stationService = getStationService();

  const stations = await stationService.searchStations(query, limit);

  return {
    query,
    results: stations.map((s) => ({
      stop_id: s.stop_id,
      name: s.stop_name,
      zone: s.zone_id,
    })),
    total: stations.length,
  };
}

async function handleGetStationInfo(args: Record<string, unknown>) {
  const { station_name } = parseArgs(GetStationInfoSchema, args);
  const stationService = getStationService();

  const info = await stationService.getStationInfo(station_name);

  if (!info) {
    throw new ToolDomainError('not_found', `Station "${station_name}" not found`, {
      suggestion: 'Use search_stations to find the correct station name',
    });
  }

  return {
    station: {
      id: info.stop_id,
      name: info.name,
      location: {
        latitude: info.latitude,
        longitude: info.longitude,
      },
      zone: info.zone_id,
      routes: info.routes,
      wheelchair_accessible: info.wheelchair_accessible,
    },
  };
}

async function handleGetSystemStatus() {
  const gtfsLastUpdate = getMetadata('gtfs_last_update');
  const stopsCount = getMetadata('gtfs_stops_count');
  const tripsCount = getMetadata('gtfs_trips_count');
  const realtimeClient = getRealtimeClient();

  const loader = getGTFSLoader();
  const needsUpdate = await loader.needsUpdate();

  return {
    status: 'operational',
    gtfs_data: {
      last_update: gtfsLastUpdate || 'never',
      needs_update: needsUpdate,
      stops: stopsCount ? parseInt(stopsCount) : 0,
      trips: tripsCount ? parseInt(tripsCount) : 0,
    },
    realtime: {
      available: realtimeClient.isAvailable(),
      note: 'Real-time data enabled (public MTA API)',
    },
    server: {
      version: '2.0.0',
      uptime: process.uptime(),
    },
  };
}

function formatStationPairTrip(trip: StationPairTrip) {
  return {
    trip_id: trip.trip_id,
    route: trip.route_name,
    destination: trip.destination,
    direction: trip.direction,
    origin: trip.origin_station,
    destination_station: trip.destination_station,
    origin_departure: {
      scheduled: trip.scheduled_origin_departure,
      actual: trip.actual_origin_departure || trip.scheduled_origin_departure,
      delay_minutes: trip.origin_delay_minutes,
    },
    destination_arrival: {
      scheduled: trip.scheduled_destination_arrival,
      actual: trip.actual_destination_arrival || trip.scheduled_destination_arrival,
      delay_minutes: trip.destination_delay_minutes,
    },
    duration_minutes: trip.duration_minutes,
    status: trip.status,
  };
}

async function handleGetStationPairSchedule(args: Record<string, unknown>) {
  const {
    origin_station,
    destination_station,
    date,
    depart_after,
    limit,
    include_realtime,
  } = parseArgs(GetStationPairScheduleSchema, args);
  const scheduleService = getScheduleService();
  const serviceDate = date || getMetroNorthServiceContext().serviceDate;
  const trips = await scheduleService.getStationPairSchedule(origin_station, destination_station, {
    date: serviceDate,
    departAfter: depart_after,
    limit,
    includeRealtime: include_realtime,
  });

  if (trips.length === 0) {
    throw new ToolDomainError(
      'not_found',
      `No direct trains found from "${origin_station}" to "${destination_station}"`,
      {
        suggestion:
          'Use search_stations to verify station names. Transfer planning is not included in this tool.',
      }
    );
  }

  return {
    origin: origin_station,
    destination: destination_station,
    service_date: serviceDate,
    depart_after: depart_after || null,
    trips: trips.map(formatStationPairTrip),
    total_direct_trips: trips.length,
    realtime_available: trips.some(
      (trip) => trip.origin_delay_minutes !== null || trip.destination_delay_minutes !== null
    ),
  };
}

async function handleGetFirstLastTrains(args: Record<string, unknown>) {
  const { origin_station, destination_station, date, include_realtime } = parseArgs(
    GetFirstLastTrainsSchema,
    args
  );
  const scheduleService = getScheduleService();
  const serviceDate = date || getMetroNorthServiceContext().serviceDate;
  const result = await scheduleService.getFirstLastTrains(
    origin_station,
    destination_station,
    serviceDate,
    include_realtime
  );

  return {
    ...result,
    first_train: result.first_train ? formatStationPairTrip(result.first_train) : null,
    last_train: result.last_train ? formatStationPairTrip(result.last_train) : null,
    no_service:
      result.total_direct_trips === 0
        ? `No direct trains found from "${origin_station}" to "${destination_station}" on ${serviceDate}`
        : null,
  };
}

async function handlePlanMetroNorthTrip(args: Record<string, unknown>) {
  const {
    origin_station,
    destination_station,
    date,
    depart_after,
    limit,
    include_realtime,
    include_alerts,
  } = parseArgs(PlanMetroNorthTripSchema, args);
  const scheduleService = getScheduleService();
  const serviceDate = date || getMetroNorthServiceContext().serviceDate;
  const options = await scheduleService.getStationPairSchedule(origin_station, destination_station, {
    date: serviceDate,
    departAfter: depart_after,
    limit,
    includeRealtime: include_realtime,
  });

  if (options.length === 0) {
    throw new ToolDomainError(
      'not_found',
      `No direct trip options found from "${origin_station}" to "${destination_station}"`,
      {
        suggestion:
          'Use search_stations to verify station names. Transfer planning is not included in this tool.',
      }
    );
  }

  const status = await handleGetSystemStatus();
  const alerts = include_alerts ? await getRelevantTripAlerts(options, origin_station, destination_station) : [];

  return {
    origin: origin_station,
    destination: destination_station,
    service_date: serviceDate,
    depart_after: depart_after || null,
    recommended_option: formatStationPairTrip(options[0]),
    alternate_options: options.slice(1).map(formatStationPairTrip),
    alerts,
    data_freshness: status.gtfs_data,
    realtime: {
      requested: include_realtime,
      available: status.realtime.available,
      caveat: 'Realtime departures and alerts use public MTA feeds and are best-effort.',
    },
    next_step:
      'Use get_trip_details with the selected trip_id for the full stop list, or get_service_alerts for broader service context.',
  };
}

async function getRelevantTripAlerts(
  options: StationPairTrip[],
  originStationName: string,
  destinationStationName: string
) {
  const realtimeClient = getRealtimeClient();
  const stationService = getStationService();
  const [originStation, destinationStation, alerts] = await Promise.all([
    stationService.findStationByName(originStationName),
    stationService.findStationByName(destinationStationName),
    realtimeClient.getServiceAlerts(),
  ]);
  const stationIds = new Set(
    [originStation?.stop_id, destinationStation?.stop_id].filter((id): id is string => Boolean(id))
  );
  const routeIds = new Set(
    options.flatMap((option) => ROUTE_IDS_BY_NAME[option.route_name.toLowerCase()] || [])
  );

  return alerts
    .filter((alert) =>
      alert.informed_entities.some(
        (entity) =>
          (entity.route_id && routeIds.has(entity.route_id)) ||
          (entity.stop_id && stationIds.has(entity.stop_id))
      )
    )
    .map((alert) => ({
      id: alert.alert_id,
      header: alert.header_text,
      description: alert.description_text,
      cause: alert.cause,
      effect: alert.effect,
    }));
}
