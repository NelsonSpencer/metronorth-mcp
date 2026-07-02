import { describe, expect, it } from 'vitest';
import protobuf from 'protobufjs';
import { GTFS_REALTIME_PROTO } from '../src/infrastructure/gtfs-realtime-schema.js';
import { decodeGtfsRealtimeFeed } from '../src/infrastructure/gtfs-realtime-decoder.js';

// Build fixtures from the exact same inline schema the decoder uses, so the
// wire format (including the MTA Railroad field-1005 extension) round-trips.
const root = protobuf.parse(GTFS_REALTIME_PROTO).root;
const FeedMessageType = root.lookupType('transit_realtime.FeedMessage');

function encodeFeed(payload: Record<string, unknown>): Uint8Array {
  const message = FeedMessageType.create(payload);
  return FeedMessageType.encode(message).finish();
}

describe('decodeGtfsRealtimeFeed MNR stop-time extension', () => {
  it('extracts track and trainStatus from the field-1005 extension', () => {
    const buffer = encodeFeed({
      header: { gtfsRealtimeVersion: '2.0' },
      entity: [
        {
          id: '1234',
          tripUpdate: {
            trip: { tripId: 'trip-a', startDate: '20240101' },
            stopTimeUpdate: [
              {
                stopId: 'GCT',
                departure: { time: 1704135000 },
                '.transit_realtime.mnrStopTimeUpdate': {
                  track: '5',
                  trainStatus: 'On-Time',
                },
              },
            ],
          },
        },
      ],
    });

    const feed = decodeGtfsRealtimeFeed(buffer);
    const stopTimeUpdate = feed.entity[0].tripUpdate?.stopTimeUpdate?.[0];

    expect(stopTimeUpdate?.track).toBe('5');
    expect(stopTimeUpdate?.trainStatus).toBe('On-Time');
    // Absolute predicted time survives decoding for the delay fallback.
    expect(stopTimeUpdate?.departure?.time).toBe('1704135000');
  });

  it('decodes alert enums to their string names (effect/cause), not numeric codes', () => {
    // The wire carries enums as numeric codes (Effect.ACCESSIBILITY_ISSUE = 11,
    // Cause.MAINTENANCE = 9), which is how the live MTA feed encodes them.
    const buffer = encodeFeed({
      header: { gtfsRealtimeVersion: '2.0' },
      entity: [
        {
          id: 'alert-1',
          alert: {
            effect: 11,
            cause: 9,
            informedEntity: [{ agencyId: 'MNR', routeId: '3' }],
            headerText: { translation: [{ text: 'Elevator out of service', language: 'en' }] },
          },
        },
      ],
    });

    const feed = decodeGtfsRealtimeFeed(buffer);
    const alert = feed.entity[0].alert;

    // The handler compares `effect === 'ACCESSIBILITY_ISSUE'`; the decoder must
    // surface the enum name, not the numeric string "11".
    expect(alert?.effect).toBe('ACCESSIBILITY_ISSUE');
    expect(alert?.cause).toBe('MAINTENANCE');
  });

  it('decodes cleanly with track/trainStatus undefined when the extension is absent', () => {
    const buffer = encodeFeed({
      header: { gtfsRealtimeVersion: '2.0' },
      entity: [
        {
          id: '5678',
          tripUpdate: {
            trip: { tripId: 'trip-b', startDate: '20240101' },
            stopTimeUpdate: [{ stopId: 'WP', departure: { delay: 120 } }],
          },
        },
      ],
    });

    const feed = decodeGtfsRealtimeFeed(buffer);
    const stopTimeUpdate = feed.entity[0].tripUpdate?.stopTimeUpdate?.[0];

    expect(stopTimeUpdate?.track).toBeUndefined();
    expect(stopTimeUpdate?.trainStatus).toBeUndefined();
    expect(stopTimeUpdate?.departure?.delay).toBe(120);
  });
});
