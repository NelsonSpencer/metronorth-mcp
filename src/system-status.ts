import { getMetadata } from './infrastructure/database.js';
import { getGTFSLoader } from './infrastructure/gtfs-loader.js';
import { getRealtimeClient } from './infrastructure/realtime-client.js';
import { getServerInfo } from './package-metadata.js';

export interface SystemStatus {
  status: 'operational';
  gtfs_data: {
    last_update: string;
    needs_update: boolean;
    stops: number;
    trips: number;
  };
  realtime: {
    available: boolean;
    note: string;
  };
  server: {
    name: string;
    version: string;
    uptime: number;
  };
}

export async function getSystemStatus(): Promise<SystemStatus> {
  const gtfsLastUpdate = getMetadata('gtfs_last_update');
  const stopsCount = getMetadata('gtfs_stops_count');
  const tripsCount = getMetadata('gtfs_trips_count');
  const realtimeClient = getRealtimeClient();
  const loader = getGTFSLoader();
  const serverInfo = getServerInfo();

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
    server: {
      ...serverInfo,
      uptime: process.uptime(),
    },
  };
}
