import protobuf from "protobufjs";
import { GTFS_REALTIME_PROTO } from "./gtfs-realtime-schema.js";

export interface FeedMessage {
  header: {
    gtfsRealtimeVersion: string;
    incrementality: number;
    timestamp: string;
  };
  entity: FeedEntity[];
}

export interface FeedEntity {
  id: string;
  isDeleted?: boolean;
  tripUpdate?: GTFSRTTripUpdate;
  alert?: GTFSRTAlert;
}

export interface GTFSRTTripUpdate {
  trip: {
    tripId: string;
    routeId?: string;
    startTime?: string;
    startDate?: string;
    scheduleRelationship?: string;
  };
  vehicle?: {
    id?: string;
    label?: string;
  };
  stopTimeUpdate?: GTFSRTStopTimeUpdate[];
  timestamp?: string;
}

export interface GTFSRTStopTimeUpdate {
  stopSequence?: number;
  stopId?: string;
  arrival?: {
    delay?: number;
    time?: string;
  };
  departure?: {
    delay?: number;
    time?: string;
  };
  scheduleRelationship?: string;
}

export interface GTFSRTAlert {
  activePeriod?: { start?: string; end?: string }[];
  informedEntity?: {
    agencyId?: string;
    routeId?: string;
    routeType?: number;
    trip?: { tripId?: string };
    stopId?: string;
  }[];
  cause?: string;
  effect?: string;
  url?: { translation?: { text: string; language?: string }[] };
  headerText?: { translation?: { text: string; language?: string }[] };
  descriptionText?: { translation?: { text: string; language?: string }[] };
}

interface DecodedFeedMessage {
  header?: {
    gtfsRealtimeVersion?: string;
    incrementality?: number;
    timestamp?: string | number;
  };
  entity?: DecodedFeedEntity[];
}

interface DecodedFeedEntity {
  id?: string;
  isDeleted?: boolean;
  tripUpdate?: DecodedTripUpdate;
  alert?: DecodedAlert;
}

interface DecodedTripUpdate {
  trip?: {
    tripId?: string;
    routeId?: string;
    startTime?: string;
    startDate?: string;
    scheduleRelationship?: number | string;
  };
  vehicle?: {
    id?: string;
    label?: string;
  };
  stopTimeUpdate?: DecodedStopTimeUpdate[];
  timestamp?: string | number;
}

interface DecodedStopTimeUpdate {
  stopSequence?: number;
  stopId?: string;
  arrival?: {
    delay?: number;
    time?: string | number;
  };
  departure?: {
    delay?: number;
    time?: string | number;
  };
  scheduleRelationship?: number | string;
}

interface DecodedAlert {
  activePeriod?: { start?: string | number; end?: string | number }[];
  informedEntity?: {
    agencyId?: string;
    routeId?: string;
    routeType?: number;
    trip?: { tripId?: string };
    stopId?: string;
  }[];
  cause?: number | string;
  effect?: number | string;
  url?: DecodedTranslatedString;
  headerText?: DecodedTranslatedString;
  descriptionText?: DecodedTranslatedString;
}

interface DecodedTranslatedString {
  translation?: { text?: string; language?: string }[];
}

const feedMessageType = protobuf
  .parse(GTFS_REALTIME_PROTO)
  .root.lookupType("transit_realtime.FeedMessage");

export function decodeGtfsRealtimeFeed(data: Uint8Array): FeedMessage {
  const decoded = feedMessageType.decode(data);
  const feed = feedMessageType.toObject(decoded, {
    arrays: true,
    defaults: true,
    longs: String,
  }) as DecodedFeedMessage;

  return normalizeFeedMessage(feed);
}

function normalizeFeedMessage(feed: DecodedFeedMessage): FeedMessage {
  return {
    header: {
      gtfsRealtimeVersion: feed.header?.gtfsRealtimeVersion || "2.0",
      incrementality: feed.header?.incrementality || 0,
      timestamp: String(feed.header?.timestamp || ""),
    },
    entity: (feed.entity || []).map((entity) => ({
      id: entity.id || "",
      isDeleted: entity.isDeleted || false,
      tripUpdate: entity.tripUpdate
        ? normalizeTripUpdate(entity.tripUpdate)
        : undefined,
      alert: entity.alert ? normalizeAlert(entity.alert) : undefined,
    })),
  };
}

function normalizeTripUpdate(tripUpdate: DecodedTripUpdate): GTFSRTTripUpdate {
  return {
    trip: {
      tripId: tripUpdate.trip?.tripId || "",
      routeId: tripUpdate.trip?.routeId || undefined,
      startTime: tripUpdate.trip?.startTime || undefined,
      startDate: tripUpdate.trip?.startDate || undefined,
      scheduleRelationship: String(tripUpdate.trip?.scheduleRelationship || ""),
    },
    vehicle: tripUpdate.vehicle
      ? {
          id: tripUpdate.vehicle.id || undefined,
          label: tripUpdate.vehicle.label || undefined,
        }
      : undefined,
    stopTimeUpdate: (tripUpdate.stopTimeUpdate || []).map((stopTimeUpdate) => ({
      stopSequence: stopTimeUpdate.stopSequence || undefined,
      stopId: stopTimeUpdate.stopId || undefined,
      arrival: stopTimeUpdate.arrival
        ? {
            delay: stopTimeUpdate.arrival.delay ?? undefined,
            time: stopTimeUpdate.arrival.time
              ? String(stopTimeUpdate.arrival.time)
              : undefined,
          }
        : undefined,
      departure: stopTimeUpdate.departure
        ? {
            delay: stopTimeUpdate.departure.delay ?? undefined,
            time: stopTimeUpdate.departure.time
              ? String(stopTimeUpdate.departure.time)
              : undefined,
          }
        : undefined,
      scheduleRelationship: String(stopTimeUpdate.scheduleRelationship || ""),
    })),
    timestamp: tripUpdate.timestamp ? String(tripUpdate.timestamp) : undefined,
  };
}

function normalizeAlert(alert: DecodedAlert): GTFSRTAlert {
  return {
    activePeriod: (alert.activePeriod || []).map((activePeriod) => ({
      start: activePeriod.start ? String(activePeriod.start) : undefined,
      end: activePeriod.end ? String(activePeriod.end) : undefined,
    })),
    informedEntity: (alert.informedEntity || []).map((informedEntity) => ({
      agencyId: informedEntity.agencyId || undefined,
      routeId: informedEntity.routeId || undefined,
      routeType: informedEntity.routeType || undefined,
      trip: informedEntity.trip
        ? { tripId: informedEntity.trip.tripId || undefined }
        : undefined,
      stopId: informedEntity.stopId || undefined,
    })),
    cause: String(alert.cause || ""),
    effect: String(alert.effect || ""),
    url: normalizeTranslatedString(alert.url),
    headerText: normalizeTranslatedString(alert.headerText),
    descriptionText: normalizeTranslatedString(alert.descriptionText),
  };
}

function normalizeTranslatedString(
  translatedString?: DecodedTranslatedString,
): GTFSRTAlert["headerText"] {
  if (!translatedString) {
    return undefined;
  }

  return {
    translation: (translatedString.translation || []).map((translation) => ({
      text: translation.text || "",
      language: translation.language || undefined,
    })),
  };
}
