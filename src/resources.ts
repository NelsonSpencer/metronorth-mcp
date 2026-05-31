import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type {
  ListResourceTemplatesResult,
  ListResourcesResult,
  ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js';
import { ROUTE_NAMES } from './config.js';
import { getStationService } from './infrastructure/station-service.js';
import { getMetadata } from './infrastructure/database.js';
import { getGTFSLoader } from './infrastructure/gtfs-loader.js';
import { getRealtimeClient } from './infrastructure/realtime-client.js';

const JSON_MIME_TYPE = 'application/json';
const MARKDOWN_MIME_TYPE = 'text/markdown';
const STATION_URI_PREFIX = 'metronorth://station/';

export const resourceDefinitions: ListResourcesResult['resources'] = [
  {
    uri: 'metronorth://usage',
    name: 'usage',
    title: 'Metro-North MCP Usage Guide',
    description: 'Agent guide for using Metro-North tools, resources, and prompts.',
    mimeType: MARKDOWN_MIME_TYPE,
  },
  {
    uri: 'metronorth://examples',
    name: 'examples',
    title: 'Metro-North MCP Examples',
    description: 'Practical examples for common Metro-North MCP workflows.',
    mimeType: MARKDOWN_MIME_TYPE,
  },
  {
    uri: 'metronorth://system/status',
    name: 'system-status',
    title: 'Metro-North MCP System Status',
    description: 'GTFS data freshness, cached data counts, and realtime availability.',
    mimeType: JSON_MIME_TYPE,
  },
  {
    uri: 'metronorth://routes',
    name: 'routes',
    title: 'Metro-North Routes',
    description: 'Supported Metro-North route IDs and route names.',
    mimeType: JSON_MIME_TYPE,
  },
  {
    uri: 'metronorth://stations',
    name: 'stations',
    title: 'Metro-North Stations',
    description: 'Cached Metro-North station summaries.',
    mimeType: JSON_MIME_TYPE,
  },
];

export const resourceTemplateDefinitions: ListResourceTemplatesResult['resourceTemplates'] = [
  {
    uriTemplate: 'metronorth://station/{station_name}',
    name: 'station-detail',
    title: 'Metro-North Station Detail',
    description: 'Detailed station information for a Metro-North station name.',
    mimeType: JSON_MIME_TYPE,
  },
];

export async function handleReadResource(uri: string): Promise<ReadResourceResult> {
  if (uri === 'metronorth://usage') {
    return textResource(uri, getUsageResource());
  }

  if (uri === 'metronorth://examples') {
    return textResource(uri, getExamplesResource());
  }

  if (uri === 'metronorth://system/status') {
    return jsonResource(uri, await getSystemStatusResource());
  }

  if (uri === 'metronorth://routes') {
    return jsonResource(uri, getRoutesResource());
  }

  if (uri === 'metronorth://stations') {
    return jsonResource(uri, await getStationsResource());
  }

  if (uri.startsWith(STATION_URI_PREFIX)) {
    const stationName = decodeURIComponent(uri.slice(STATION_URI_PREFIX.length));
    return jsonResource(uri, await getStationResource(stationName));
  }

  throw new McpError(ErrorCode.InvalidRequest, `Unknown resource URI: ${uri}`);
}

function textResource(uri: string, text: string): ReadResourceResult {
  return {
    contents: [
      {
        uri,
        mimeType: MARKDOWN_MIME_TYPE,
        text,
      },
    ],
  };
}

function jsonResource(uri: string, value: unknown): ReadResourceResult {
  return {
    contents: [
      {
        uri,
        mimeType: JSON_MIME_TYPE,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function getUsageResource(): string {
  return [
    '# Metro-North MCP Usage',
    '',
    'Use this server for Metro-North station lookup, departures, route schedules, service alerts, and data freshness.',
    '',
    '## Station-to-station trips',
    '',
    '- Use `plan_metro_north_trip` first for station-to-station questions.',
    '- Use `get_station_pair_schedule` when the user asks for direct train options between two stations.',
    '- Use `get_first_last_trains` when the user asks for the first or last direct train of a service date.',
    '- Transfer planning is not included; direct trains only.',
    '',
    '## Station matching',
    '',
    '- Use `search_stations` first when a station name may be partial or ambiguous.',
    '- Use the returned station name with `get_departures`, `get_station_info`, or station-specific alerts.',
    '',
    '## Trip planning',
    '',
    '1. Search the origin and destination stations if names may be ambiguous.',
    '2. Call `plan_metro_north_trip` for recommended direct options.',
    '3. Call `get_trip_details` if the user wants the full stop list for a selected trip.',
    '4. Summarize the best option, any uncertainty, and whether realtime data was available.',
    '',
    '## Service status',
    '',
    '- Use `get_service_alerts` for current route or station alerts.',
    '- Read `metronorth://system/status` when data freshness matters.',
    '- Treat realtime departures and alerts as best-effort public feed data.',
  ].join('\n');
}

function getExamplesResource(): string {
  return [
    '# Metro-North MCP Examples',
    '',
    '## Find a station',
    '',
    'Call `search_stations` with `{ "query": "Grand Central", "limit": 5 }`.',
    '',
    '## Plan a direct trip',
    '',
    'Call `plan_metro_north_trip` with `{ "origin_station": "Grand Central", "destination_station": "White Plains", "limit": 3, "include_alerts": true }`.',
    '',
    '## Get station-to-station options',
    '',
    'Call `get_station_pair_schedule` with `{ "origin_station": "Grand Central", "destination_station": "White Plains", "depart_after": "17:00", "limit": 5 }`.',
    '',
    '## Find the first and last trains',
    '',
    'Call `get_first_last_trains` with `{ "origin_station": "Grand Central", "destination_station": "White Plains" }`.',
    '',
    '## Check outbound departures',
    '',
    'Call `get_departures` with `{ "station_name": "Grand Central", "direction": "outbound", "limit": 5, "include_realtime": true }`.',
    '',
    '## Summarize Harlem Line alerts',
    '',
    'Call `get_service_alerts` with `{ "route_name": "Harlem" }`.',
    '',
    '## Explain data freshness',
    '',
    'Read `metronorth://system/status` or call `get_system_status`.',
    '',
    '## Handle invalid station names',
    '',
    'If a station-specific tool returns a structured error, search stations and retry with the closest matching station name.',
  ].join('\n');
}

async function getSystemStatusResource() {
  const loader = getGTFSLoader();
  const realtimeClient = getRealtimeClient();
  const gtfsLastUpdate = getMetadata('gtfs_last_update');
  const stopsCount = getMetadata('gtfs_stops_count');
  const tripsCount = getMetadata('gtfs_trips_count');

  return {
    status: 'operational',
    gtfs_data: {
      last_update: gtfsLastUpdate || 'never',
      needs_update: await loader.needsUpdate(),
      stops: stopsCount ? parseInt(stopsCount) : 0,
      trips: tripsCount ? parseInt(tripsCount) : 0,
    },
    realtime: {
      available: realtimeClient.isAvailable(),
      note: 'Real-time data enabled (public MTA API)',
    },
  };
}

function getRoutesResource() {
  return {
    routes: Object.entries(ROUTE_NAMES).map(([route_id, route_name]) => ({
      route_id,
      route_name,
    })),
  };
}

async function getStationsResource() {
  const stationService = getStationService();
  const stations = await stationService.getAllStations();

  return {
    stations: stations.map((station) => ({
      stop_id: station.stop_id,
      name: station.stop_name,
      zone: station.zone_id,
    })),
    total: stations.length,
  };
}

async function getStationResource(stationName: string) {
  const stationService = getStationService();
  const station = await stationService.getStationInfo(stationName);

  if (!station) {
    throw new McpError(ErrorCode.InvalidRequest, `Station not found: ${stationName}`);
  }

  return { station };
}
