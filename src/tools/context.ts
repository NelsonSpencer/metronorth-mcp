import type { GTFSLoader } from '../infrastructure/gtfs-loader.js';
import { getGTFSLoader } from '../infrastructure/gtfs-loader.js';
import type { MetroNorthRealtime } from '../infrastructure/realtime-client.js';
import { getRealtimeClient } from '../infrastructure/realtime-client.js';
import type { ScheduleService } from '../infrastructure/schedule-service.js';
import { getScheduleService } from '../infrastructure/schedule-service.js';
import type { StationService } from '../infrastructure/station-service.js';
import { getStationService } from '../infrastructure/station-service.js';
import { getMetadata } from '../infrastructure/database.js';

export type ScheduleServiceLike = Pick<
  ScheduleService,
  | 'getDepartures'
  | 'getTripDetails'
  | 'getRouteSchedule'
  | 'getStationPairSchedule'
  | 'getFirstLastTrains'
  | 'getTransferItineraries'
>;

export type StationServiceLike = Pick<
  StationService,
  'findStationByName' | 'getStationInfo' | 'searchStations'
>;

export type RealtimeClientLike = Pick<MetroNorthRealtime, 'getServiceAlerts' | 'isAvailable'>;
export type GTFSLoaderLike = Pick<GTFSLoader, 'needsUpdate'>;

export interface ToolContext {
  readonly scheduleService: ScheduleServiceLike;
  readonly stationService: StationServiceLike;
  readonly realtimeClient: RealtimeClientLike;
  readonly gtfsLoader: GTFSLoaderLike;
  readonly getMetadata: (key: string) => string | null;
}

export type ToolContextOverrides = Partial<ToolContext>;

export function createDefaultToolContext(): ToolContext {
  return {
    get scheduleService() {
      return getScheduleService();
    },
    get stationService() {
      return getStationService();
    },
    get realtimeClient() {
      return getRealtimeClient();
    },
    get gtfsLoader() {
      return getGTFSLoader();
    },
    getMetadata,
  };
}

export function createToolContext(overrides: ToolContextOverrides = {}): ToolContext {
  const defaults = createDefaultToolContext();

  return {
    get scheduleService() {
      return overrides.scheduleService ?? defaults.scheduleService;
    },
    get stationService() {
      return overrides.stationService ?? defaults.stationService;
    },
    get realtimeClient() {
      return overrides.realtimeClient ?? defaults.realtimeClient;
    },
    get gtfsLoader() {
      return overrides.gtfsLoader ?? defaults.gtfsLoader;
    },
    getMetadata: overrides.getMetadata ?? defaults.getMetadata,
  };
}
