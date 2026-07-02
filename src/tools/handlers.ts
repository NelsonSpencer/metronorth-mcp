import {
  GetDeparturesSchema,
  GetRouteScheduleSchema,
  GetServiceAlertsSchema,
  GetTripDetailsSchema,
  GetStationInfoSchema,
  GetStationPairScheduleSchema,
  GetFirstLastTrainsSchema,
  PlanMetroNorthTripSchema,
  SearchStationsSchema,
  type StationPairTrip,
  type TransferItinerary,
} from '../domain/gtfs.js';
import { getMetroNorthServiceContext } from '../domain/transit-time.js';
import { ROUTE_IDS_BY_NAME, WEST_OF_HUDSON_LINES } from '../config.js';
import { getSystemStatus } from '../system-status.js';
import type { ToolContext } from './context.js';
import { ToolDomainError } from './errors.js';
import { parseArgs } from './validation.js';

export type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolContext
) => Promise<unknown>;

export const toolHandlers: Record<string, ToolHandler> = {
  get_departures: handleGetDepartures,
  get_trip_details: handleGetTripDetails,
  get_route_schedule: handleGetRouteSchedule,
  get_service_alerts: handleGetServiceAlerts,
  search_stations: handleSearchStations,
  get_station_info: handleGetStationInfo,
  get_system_status: handleGetSystemStatus,
  get_station_pair_schedule: handleGetStationPairSchedule,
  get_first_last_trains: handleGetFirstLastTrains,
  plan_metro_north_trip: handlePlanMetroNorthTrip,
} satisfies Record<string, ToolHandler>;

/**
 * Metro-North's west-of-Hudson lines (Pascack Valley, Port Jervis) are operated
 * by NJ Transit and are absent from the GTFS feed this server loads. Reject a
 * request for one with an honest, actionable error instead of the generic
 * "route not found" other unknown routes fall through to.
 */
function assertRouteIsCovered(routeName: string): void {
  const normalized = routeName.trim().toLowerCase();
  const line = WEST_OF_HUDSON_LINES.find((l) => l.name.toLowerCase() === normalized);
  if (!line) return;

  throw new ToolDomainError(
    'not_covered',
    `"${line.name}" is a west-of-Hudson Metro-North line operated by ${line.operated_by}, which is not included in this server's data. Check ${line.operated_by} for its schedules and alerts: ${line.reference_url}`,
    {
      line: line.name,
      operated_by: line.operated_by,
      reference_url: line.reference_url,
    }
  );
}

async function handleGetDepartures(args: Record<string, unknown>, context: ToolContext) {
  const parsed = parseArgs(GetDeparturesSchema, args);
  const { station_name, direction, limit, include_realtime } = parsed;
  const departures = await context.scheduleService.getDepartures(
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
      track: d.track,
      track_source: d.track_source,
      train_status: d.train_status,
      fare_class: d.fare_class,
      note: d.note,
      upcoming_stops: d.stops.slice(0, 5),
      trip_id: d.trip_id,
    })),
    realtime_available: departures.some((d) => d.delay_minutes !== null),
  };
}

async function handleGetTripDetails(args: Record<string, unknown>, context: ToolContext) {
  const { trip_id, include_realtime } = parseArgs(GetTripDetailsSchema, args);
  const details = await context.scheduleService.getTripDetails(trip_id, include_realtime);

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
    fare_class: details.fare_class,
    notes: details.notes,
    stops: details.stops.map((s) => ({
      station: s.stop_name,
      arrival: s.arrival_time,
      departure: s.departure_time,
      delay: s.delay_minutes ? `${s.delay_minutes} min` : null,
      track: s.track,
      track_source: s.track_source,
      train_status: s.train_status,
      note: s.note,
    })),
    realtime_status: details.realtime_status,
  };
}

async function handleGetRouteSchedule(args: Record<string, unknown>, context: ToolContext) {
  const { route_name, date, direction } = parseArgs(GetRouteScheduleSchema, args);
  assertRouteIsCovered(route_name);
  const schedule = await context.scheduleService.getRouteSchedule(route_name, date, direction);

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
      fare_class: t.fare_class,
    })),
    total_trips: schedule.length,
  };
}

async function handleGetServiceAlerts(args: Record<string, unknown>, context: ToolContext) {
  const { route_name, station_name } = parseArgs(GetServiceAlertsSchema, args);
  if (route_name) {
    assertRouteIsCovered(route_name);
  }
  const alerts = await context.realtimeClient.getServiceAlerts();

  let filtered = alerts;
  if (route_name) {
    const routeIds = ROUTE_IDS_BY_NAME[route_name.toLowerCase()] || [];
    filtered = filtered.filter((a) =>
      a.informed_entities.some((e) => routeIds.includes(e.route_id || ''))
    );
  }

  if (station_name) {
    const station = await context.stationService.findStationByName(station_name);
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

async function handleSearchStations(args: Record<string, unknown>, context: ToolContext) {
  const { query, limit } = parseArgs(SearchStationsSchema, args);
  const stations = await context.stationService.searchStations(query, limit);

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

async function handleGetStationInfo(args: Record<string, unknown>, context: ToolContext) {
  const { station_name } = parseArgs(GetStationInfoSchema, args);
  const info = await context.stationService.getStationInfo(station_name);

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

async function handleGetSystemStatus(_args: Record<string, unknown>, context: ToolContext) {
  return getSystemStatus({
    getMetadata: context.getMetadata,
    gtfsLoader: context.gtfsLoader,
    realtimeClient: context.realtimeClient,
  });
}

// A direct trip option inside a trip plan, tagged so consumers can tell it apart
// from a one-transfer itinerary (which carries itinerary_type: 'one_transfer').
function formatDirectOption(trip: StationPairTrip) {
  return { itinerary_type: 'direct' as const, ...formatStationPairTrip(trip) };
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
    track: trip.track,
    track_source: trip.track_source,
    train_status: trip.train_status,
    fare_class: trip.fare_class,
    note: trip.note,
    status: trip.status,
  };
}

async function handleGetStationPairSchedule(args: Record<string, unknown>, context: ToolContext) {
  const {
    origin_station,
    destination_station,
    date,
    depart_after,
    limit,
    include_realtime,
  } = parseArgs(GetStationPairScheduleSchema, args);
  const serviceDate = date || getMetroNorthServiceContext().serviceDate;
  const trips = await context.scheduleService.getStationPairSchedule(
    origin_station,
    destination_station,
    {
      date: serviceDate,
      departAfter: depart_after,
      limit,
      includeRealtime: include_realtime,
    }
  );

  if (trips.length === 0) {
    throw new ToolDomainError(
      'not_found',
      `No direct trains found from "${origin_station}" to "${destination_station}"`,
      {
        suggestion:
          'Use search_stations to verify station names, or plan_metro_north_trip for itineraries that include a transfer.',
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

async function handleGetFirstLastTrains(args: Record<string, unknown>, context: ToolContext) {
  const { origin_station, destination_station, date, include_realtime } = parseArgs(
    GetFirstLastTrainsSchema,
    args
  );
  const serviceDate = date || getMetroNorthServiceContext().serviceDate;
  const result = await context.scheduleService.getFirstLastTrains(
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

async function handlePlanMetroNorthTrip(args: Record<string, unknown>, context: ToolContext) {
  const {
    origin_station,
    destination_station,
    date,
    depart_after,
    limit,
    include_realtime,
    include_alerts,
  } = parseArgs(PlanMetroNorthTripSchema, args);
  const serviceDate = date || getMetroNorthServiceContext().serviceDate;
  const directOptions = await context.scheduleService.getStationPairSchedule(
    origin_station,
    destination_station,
    {
      date: serviceDate,
      departAfter: depart_after,
      limit,
      includeRealtime: include_realtime,
    }
  );

  // Only reach for transfers when direct trains don't already fill the request.
  // Grand Central <-> mainline pairs fill instantly, so this short-circuits the
  // heavier transfers query for the common case.
  let transferOptions: TransferItinerary[] = [];
  if (limit === undefined || directOptions.length < limit) {
    transferOptions = await context.scheduleService.getTransferItineraries(
      origin_station,
      destination_station,
      {
        date: serviceDate,
        departAfter: depart_after,
        limit,
        includeRealtime: include_realtime,
      }
    );
  }

  if (directOptions.length === 0 && transferOptions.length === 0) {
    throw new ToolDomainError(
      'not_found',
      `No direct or one-transfer trip options found from "${origin_station}" to "${destination_station}"`,
      {
        suggestion:
          'Use search_stations to verify station names. This planner covers direct trains and one-transfer itineraries via the MTA\'s guaranteed connections at hub stations; trips needing two or more transfers are not supported.',
      }
    );
  }

  const status = await handleGetSystemStatus({}, context);
  // Alerts consider every leg's route (direct trips and both legs of each transfer).
  const alertTrips = [...directOptions, ...transferOptions.flatMap((itinerary) => itinerary.legs)];
  const alerts = include_alerts
    ? await getRelevantTripAlerts(alertTrips, origin_station, destination_station, context)
    : [];

  // When at least one direct train exists it stays the recommendation and its
  // peers are the alternates; transfers are surfaced separately. When no direct
  // train exists, the best transfer itinerary becomes the recommendation.
  const directPlanOptions = directOptions.map(formatDirectOption);
  const hasDirect = directPlanOptions.length > 0;
  const recommendedOption = hasDirect ? directPlanOptions[0] : (transferOptions[0] ?? null);
  const alternateOptions = hasDirect ? directPlanOptions.slice(1) : transferOptions.slice(1);

  return {
    origin: origin_station,
    destination: destination_station,
    service_date: serviceDate,
    depart_after: depart_after || null,
    recommended_option: recommendedOption,
    alternate_options: alternateOptions,
    transfer_options: transferOptions,
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
  destinationStationName: string,
  context: ToolContext
) {
  const [originStation, destinationStation, alerts] = await Promise.all([
    context.stationService.findStationByName(originStationName),
    context.stationService.findStationByName(destinationStationName),
    context.realtimeClient.getServiceAlerts(),
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
