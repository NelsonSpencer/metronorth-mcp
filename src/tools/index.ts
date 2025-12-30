import { fromError } from 'zod-validation-error';
import {
  GetDeparturesSchema,
  GetRouteScheduleSchema,
  GetServiceAlertsSchema,
  SearchStationsSchema,
  GetTripDetailsSchema,
  GetStationInfoSchema,
} from '../domain/gtfs.js';
import { getScheduleService } from '../infrastructure/schedule-service.js';
import { getStationService } from '../infrastructure/station-service.js';
import { getRealtimeClient } from '../infrastructure/realtime-client.js';
import { getGTFSLoader } from '../infrastructure/gtfs-loader.js';
import { getMetadata } from '../infrastructure/database.js';
import { createModuleLogger, logRequest } from '../logger.js';
import { ROUTE_IDS_BY_NAME } from '../config.js';

const logger = createModuleLogger('tools');

// Tool definitions for MCP
export const toolDefinitions = [
  {
    name: 'get_departures',
    description:
      'Get upcoming Metro-North train departures from a station. Returns scheduled and real-time departure information including delays.',
    inputSchema: {
      type: 'object',
      properties: {
        station_name: {
          type: 'string',
          description: 'Station name (partial match supported, e.g., "Grand Central" or "Harlem")',
        },
        direction: {
          type: 'string',
          enum: ['inbound', 'outbound', 'all'],
          default: 'all',
          description: 'Direction of travel: inbound (to GCT), outbound (from GCT), or all',
        },
        limit: {
          type: 'number',
          default: 10,
          description: 'Maximum number of departures to return (1-50)',
        },
        include_realtime: {
          type: 'boolean',
          default: true,
          description: 'Include real-time delay information if available',
        },
      },
      required: ['station_name'],
    },
  },
  {
    name: 'get_trip_details',
    description:
      'Get detailed information about a specific train trip, including all stops and times.',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: {
          type: 'string',
          description: 'The GTFS trip ID',
        },
        include_realtime: {
          type: 'boolean',
          default: true,
          description: 'Include real-time delay information',
        },
      },
      required: ['trip_id'],
    },
  },
  {
    name: 'get_route_schedule',
    description: 'Get the full schedule for a Metro-North line/route for today.',
    inputSchema: {
      type: 'object',
      properties: {
        route_name: {
          type: 'string',
          description: 'Route/line name (e.g., "Hudson", "Harlem", "New Haven")',
        },
        date: {
          type: 'string',
          description: 'Date in YYYY-MM-DD format (defaults to today)',
        },
        direction: {
          type: 'string',
          enum: ['inbound', 'outbound', 'all'],
          default: 'all',
          description: 'Direction of travel',
        },
      },
      required: ['route_name'],
    },
  },
  {
    name: 'get_service_alerts',
    description: 'Get current service alerts and advisories for Metro-North.',
    inputSchema: {
      type: 'object',
      properties: {
        route_name: {
          type: 'string',
          description: 'Filter alerts by route/line name',
        },
        station_name: {
          type: 'string',
          description: 'Filter alerts by station name',
        },
      },
    },
  },
  {
    name: 'search_stations',
    description: 'Search for Metro-North stations by name.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query for station names',
        },
        limit: {
          type: 'number',
          default: 5,
          description: 'Maximum number of results (1-20)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_station_info',
    description: 'Get detailed information about a specific Metro-North station.',
    inputSchema: {
      type: 'object',
      properties: {
        station_name: {
          type: 'string',
          description: 'Station name to look up',
        },
      },
      required: ['station_name'],
    },
  },
  {
    name: 'get_system_status',
    description:
      'Get the current status of the Metro-North MCP server, including data freshness and connectivity.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// Tool handlers
export async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
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
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    success = false;
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ tool: name, error: errorMessage }, 'Tool execution failed');

    return {
      content: [
        {
          type: 'text',
          text: `Error: ${errorMessage}`,
        },
      ],
    };
  } finally {
    logRequest(name, args, Date.now() - start, success);
  }
}

async function handleGetDepartures(args: Record<string, unknown>) {
  const parsed = GetDeparturesSchema.safeParse(args);
  if (!parsed.success) {
    throw new Error(fromError(parsed.error).toString());
  }

  const { station_name, direction, limit, include_realtime } = parsed.data;
  const scheduleService = getScheduleService();

  const departures = await scheduleService.getDepartures(
    station_name,
    direction,
    limit,
    include_realtime
  );

  if (departures.length === 0) {
    return {
      message: `No upcoming departures found from "${station_name}"`,
      suggestions: [
        'Check the station name spelling',
        'Try a partial name like "Grand" for Grand Central',
        'Use search_stations to find the correct station name',
      ],
    };
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
  const parsed = GetTripDetailsSchema.safeParse(args);
  if (!parsed.success) {
    throw new Error(fromError(parsed.error).toString());
  }

  const { trip_id, include_realtime } = parsed.data;
  const scheduleService = getScheduleService();

  const details = await scheduleService.getTripDetails(trip_id, include_realtime);

  if (!details) {
    return {
      error: `Trip "${trip_id}" not found`,
      suggestion: 'Use get_departures first to find valid trip IDs',
    };
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
  const parsed = GetRouteScheduleSchema.safeParse(args);
  if (!parsed.success) {
    throw new Error(fromError(parsed.error).toString());
  }

  const { route_name, date, direction } = parsed.data;
  const scheduleService = getScheduleService();

  const scheduleDate = date ? new Date(date) : new Date();
  const schedule = await scheduleService.getRouteSchedule(route_name, scheduleDate, direction);

  if (schedule.length === 0) {
    return {
      error: `No schedule found for route "${route_name}"`,
      available_routes: ['Hudson', 'Harlem', 'New Haven', 'New Canaan', 'Danbury', 'Waterbury'],
    };
  }

  return {
    route: route_name,
    date: scheduleDate.toISOString().slice(0, 10),
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
  const parsed = GetServiceAlertsSchema.safeParse(args);
  if (!parsed.success) {
    throw new Error(fromError(parsed.error).toString());
  }

  const { route_name, station_name } = parsed.data;
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
    if (station) {
      filtered = filtered.filter((a) =>
        a.informed_entities.some((e) => e.stop_id === station.stop_id)
      );
    }
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
  const parsed = SearchStationsSchema.safeParse(args);
  if (!parsed.success) {
    throw new Error(fromError(parsed.error).toString());
  }

  const { query, limit } = parsed.data;
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
  const parsed = GetStationInfoSchema.safeParse(args);
  if (!parsed.success) {
    throw new Error(fromError(parsed.error).toString());
  }

  const { station_name } = parsed.data;
  const stationService = getStationService();

  const info = await stationService.getStationInfo(station_name);

  if (!info) {
    return {
      error: `Station "${station_name}" not found`,
      suggestion: 'Use search_stations to find the correct station name',
    };
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
