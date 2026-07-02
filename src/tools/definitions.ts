import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ToolInputSchemas } from '../domain/gtfs.js';

export const toolDefinitions = [
  {
    name: 'get_departures',
    title: 'Get Departures',
    description:
      'Get upcoming departures from a station, including realtime delays and track assignments when available. Track is the realtime assignment when present, otherwise the scheduled track; at Grand Central tracks typically post ~15-20 minutes before departure. Each departure also reports its fare_class (peak or off_peak) and any train note (e.g. "may depart early") when the schedule provides one.',
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
    description:
      'Find direct trains between two Metro-North stations. For itineraries that require a transfer, use plan_metro_north_trip.',
    inputSchema: ToolInputSchemas.get_station_pair_schedule,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'get_first_last_trains',
    title: 'Get First Last Trains',
    description:
      'Get the first and last direct trains between two stations for a service date. For transfer itineraries, use plan_metro_north_trip.',
    inputSchema: ToolInputSchemas.get_first_last_trains,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'plan_metro_north_trip',
    title: 'Plan Metro-North Trip',
    description:
      "Plan a Metro-North trip between two stations: returns direct trains plus one-transfer itineraries via the MTA's guaranteed timed connections at hub stations (e.g. Stamford, Croton-Harmon, South Norwalk), with options, alerts, and data freshness. Useful for branch stations (New Canaan, Danbury, Waterbury) that have no direct service to most of the system. Trips requiring two or more transfers are not supported.",
    inputSchema: ToolInputSchemas.plan_metro_north_trip,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'get_accessibility_status',
    title: 'Get Accessibility Status',
    description:
      "Report Metro-North elevator, escalator, and accessibility alerts, optionally for a single station (which also returns that station's static wheelchair-accessible flag). The MTA publishes no machine-readable Metro-North elevator/escalator feed, so results are derived from free-text service alerts and may be incomplete; see the MTA elevator & escalator status page.",
    inputSchema: ToolInputSchemas.get_accessibility_status,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
] satisfies Tool[];
