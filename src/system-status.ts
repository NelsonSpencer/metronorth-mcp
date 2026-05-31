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

export interface SystemStatusDependencies {
  getMetadata: (key: string) => string | null;
  gtfsLoader: {
    needsUpdate: () => Promise<boolean>;
  };
  realtimeClient: {
    isAvailable: () => boolean;
  };
}

function getDefaultSystemStatusDependencies(): SystemStatusDependencies {
  return {
    getMetadata,
    gtfsLoader: getGTFSLoader(),
    realtimeClient: getRealtimeClient(),
  };
}

export async function getSystemStatus(
  dependencies: Partial<SystemStatusDependencies> = {}
): Promise<SystemStatus> {
  const defaults = getDefaultSystemStatusDependencies();
  const deps = {
    ...defaults,
    ...dependencies,
  };
  const gtfsLastUpdate = deps.getMetadata('gtfs_last_update');
  const stopsCount = deps.getMetadata('gtfs_stops_count');
  const tripsCount = deps.getMetadata('gtfs_trips_count');
  const serverInfo = getServerInfo();

  return {
    status: 'operational',
    gtfs_data: {
      last_update: gtfsLastUpdate || 'never',
      needs_update: await deps.gtfsLoader.needsUpdate(),
      stops: stopsCount ? parseInt(stopsCount) : 0,
      trips: tripsCount ? parseInt(tripsCount) : 0,
    },
    realtime: {
      available: deps.realtimeClient.isAvailable(),
      note: 'Real-time data enabled (public MTA API)',
    },
    server: {
      ...serverInfo,
      uptime: process.uptime(),
    },
  };
}
