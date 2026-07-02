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
  // MTA Railroad extension (field 1005): assigned track and human-readable
  // train status. Undefined when the feed omits the extension.
  track?: string;
  trainStatus?: string;
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

interface DecodedMnrStopTimeUpdate {
  track?: string;
  trainStatus?: string;
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
  // protobufjs surfaces the field-1005 extension under its fully-qualified key;
  // some tooling paths expose the camelCased name, so both are read defensively.
  '.transit_realtime.mnrStopTimeUpdate'?: DecodedMnrStopTimeUpdate;
  mnrStopTimeUpdate?: DecodedMnrStopTimeUpdate;
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

// A raw protobufjs Message instance, read structurally for proto2 field
// presence. Present-on-the-wire scalar fields are set as own properties;
// wire-absent fields fall through to the prototype default, so
// `hasOwnProperty` is the reliable presence signal.
type RawProtoMessage = Record<string, unknown>;

// StopTimeEvent scalars whose fabricated proto2 defaults would otherwise be
// indistinguishable from real values. `delay` is the critical one: MTA omits it
// for most Metro-North stops (sending only an absolute `time`), and a fabricated
// `delay = 0` masks genuinely late trains. `time` is cleared alongside it so the
// absolute-time delay derivation never keys off a fabricated `time = 0`.
const PRESENCE_TRACKED_EVENT_FIELDS = ["delay", "time"] as const;
const STOP_TIME_EVENT_KEYS = ["arrival", "departure"] as const;

function hasWireField(message: RawProtoMessage, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(message, field);
}

export function decodeGtfsRealtimeFeed(data: Uint8Array): FeedMessage {
  const decoded = feedMessageType.decode(data);
  const feed = feedMessageType.toObject(decoded, {
    arrays: true,
    defaults: true,
    longs: String,
  }) as DecodedFeedMessage;

  // `defaults: true` fabricates proto2 scalar defaults for fields absent on the
  // wire. That is desirable for most fields (existing consumers rely on it), but
  // it silently invents `StopTimeEvent.delay = 0`, defeating the absolute-time
  // delay fallback. Restore true wire presence for the StopTimeEvent scalars we
  // consume by consulting the decoded protobuf Message, leaving every other
  // field's fabricated default untouched.
  restoreStopTimeEventPresence(decoded, feed);

  return normalizeFeedMessage(feed);
}

// Undefine fabricated StopTimeEvent scalars that were not present on the wire.
// The decoded protobuf Message (`raw`) preserves proto2 presence, while `feed`
// is the fabricated plain object. Both are produced from the same message, so
// the repeated `entity`/`stopTimeUpdate` arrays line up by index.
function restoreStopTimeEventPresence(
  raw: RawProtoMessage,
  feed: DecodedFeedMessage,
): void {
  const rawEntities = (raw.entity as RawProtoMessage[] | undefined) ?? [];
  const plainEntities = feed.entity ?? [];

  for (let i = 0; i < plainEntities.length; i++) {
    const rawTripUpdate = rawEntities[i]?.tripUpdate as
      | RawProtoMessage
      | undefined;
    const plainTripUpdate = plainEntities[i]?.tripUpdate;
    if (!rawTripUpdate || !plainTripUpdate) continue;

    const rawStopTimeUpdates =
      (rawTripUpdate.stopTimeUpdate as RawProtoMessage[] | undefined) ?? [];
    const plainStopTimeUpdates = plainTripUpdate.stopTimeUpdate ?? [];

    for (let j = 0; j < plainStopTimeUpdates.length; j++) {
      const rawStopTimeUpdate = rawStopTimeUpdates[j];
      const plainStopTimeUpdate = plainStopTimeUpdates[j];
      if (!rawStopTimeUpdate || !plainStopTimeUpdate) continue;

      for (const eventKey of STOP_TIME_EVENT_KEYS) {
        const rawEvent = rawStopTimeUpdate[eventKey] as
          | RawProtoMessage
          | null
          | undefined;
        const plainEvent = plainStopTimeUpdate[eventKey];
        if (!plainEvent) continue;

        for (const field of PRESENCE_TRACKED_EVENT_FIELDS) {
          if (!rawEvent || !hasWireField(rawEvent, field)) {
            plainEvent[field] = undefined;
          }
        }
      }
    }
  }
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
    stopTimeUpdate: (tripUpdate.stopTimeUpdate || []).map((stopTimeUpdate) => {
      const mnr =
        stopTimeUpdate[".transit_realtime.mnrStopTimeUpdate"] ??
        stopTimeUpdate.mnrStopTimeUpdate;

      return {
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
        track: mnr?.track || undefined,
        trainStatus: mnr?.trainStatus || undefined,
      };
    }),
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
