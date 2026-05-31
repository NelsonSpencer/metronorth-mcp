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
const STATION_URI_PREFIX = 'metronorth://station/';

export const resourceDefinitions: ListResourcesResult['resources'] = [
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
