import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ToolInputSchemas } from '../domain/gtfs.js';

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
