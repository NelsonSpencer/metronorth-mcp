import { beforeEach, describe, expect, it, vi } from "vitest";
import protobuf from "protobufjs";
import { GTFS_REALTIME_PROTO } from "../src/infrastructure/gtfs-realtime-schema.js";

// This suite deliberately does NOT mock gtfs-realtime-decoder. It drives real
// protobuf-encoded feeds through the real decoder and the real realtime-client
// normalization, so it exercises protobufjs' `defaults: true` fabrication - the
// exact path a hand-built decoder mock would bypass. Only the network, cache,
// and database boundaries are stubbed.
const axiosGetMock = vi.hoisted(() => vi.fn());
const cacheGetMock = vi.hoisted(() => vi.fn());
const cacheSetMock = vi.hoisted(() => vi.fn());
const dbRunMock = vi.hoisted(() => vi.fn());

vi.mock("axios", () => ({
  default: {
    get: axiosGetMock,
    isAxiosError: vi.fn(() => false),
  },
}));

vi.mock("../src/infrastructure/cache.js", () => ({
  getCache: vi.fn(() => ({
    get: cacheGetMock,
    set: cacheSetMock,
  })),
  CACHE_KEYS: {
    tripUpdates: "realtime:trip_updates",
    serviceAlerts: "realtime:alerts",
  },
}));

vi.mock("../src/infrastructure/database.js", () => ({
  getSqlite: vi.fn(() => ({
    prepare: vi.fn(() => ({
      all: vi.fn(() => []),
      get: vi.fn(() => undefined),
      run: dbRunMock,
    })),
  })),
  transaction: vi.fn((fn: () => unknown) => fn()),
}));

const FeedMessageType = protobuf
  .parse(GTFS_REALTIME_PROTO)
  .root.lookupType("transit_realtime.FeedMessage");

// Epoch seconds for 12:00:00 on service date 2024-01-01 (America/New_York),
// matching the constant used in tests/realtime-client.test.ts.
const NOON_EPOCH = 1704128400;

function encodeFeed(payload: Record<string, unknown>): Uint8Array {
  return FeedMessageType.encode(FeedMessageType.create(payload)).finish();
}

// Build a single-stop feed, decode it through the REAL decoder inside the
// realtime client, and return both the normalized updates and the resolved
// realtime info for that stop.
async function driveFeed(
  stopTimeUpdate: Record<string, unknown>,
  scheduledTime: string,
) {
  const buffer = encodeFeed({
    header: { gtfsRealtimeVersion: "2.0" },
    entity: [
      {
        id: "8001",
        tripUpdate: {
          trip: { tripId: "trip-real", routeId: "2", startDate: "20240101" },
          stopTimeUpdate: [{ stopId: "GCT", ...stopTimeUpdate }],
        },
      },
    ],
  });

  axiosGetMock.mockResolvedValue({ data: buffer });

  const { MetroNorthRealtime } = await import(
    "../src/infrastructure/realtime-client.js"
  );
  const client = new MetroNorthRealtime();
  const updates = await client.getTripUpdates();
  const info = client.getRealtimeInfoForTripAtStopFromUpdates(
    updates,
    "trip-real",
    "GCT",
    scheduledTime,
    "8001",
  );

  return { updates, info };
}

describe("realtime delay derivation through the real GTFS-RT decoder", () => {
  beforeEach(() => {
    axiosGetMock.mockReset();
    cacheGetMock.mockReset();
    cacheGetMock.mockResolvedValue(null);
    cacheSetMock.mockReset();
    cacheSetMock.mockResolvedValue(undefined);
    dbRunMock.mockReset();
  });

  it("surfaces a wire-absent delay as null and derives it from the absolute time", async () => {
    // Absolute time is +5 min late, and the wire carries NO `delay` field. The
    // real decoder must surface delay as null (not a fabricated 0) so the
    // absolute-time fallback runs and reports the train as delayed.
    const { updates, info } = await driveFeed(
      {
        departure: { time: NOON_EPOCH + 300 },
        ".transit_realtime.mnrStopTimeUpdate": { track: "7", trainStatus: "Late" },
      },
      "12:00:00",
    );

    expect(updates[0].stop_time_updates[0].departure_delay).toBeNull();
    expect(updates[0].stop_time_updates[0].arrival_delay).toBeNull();
    expect(info.delaySeconds).toBe(300);
    expect(info.status).toBe("delayed");
    expect(info.track).toBe("7");
    expect(info.trainStatus).toBe("Late");
  });

  it("respects an explicit wire delay of 0 as on-time even when the absolute time is late", async () => {
    // Explicit delay = 0 is present on the wire alongside a +5 min absolute
    // time. The explicit 0 must win: no derivation, reported on-time.
    const { updates, info } = await driveFeed(
      { departure: { delay: 0, time: NOON_EPOCH + 300 } },
      "12:00:00",
    );

    expect(updates[0].stop_time_updates[0].departure_delay).toBe(0);
    expect(info.delaySeconds).toBe(0);
    expect(info.status).toBe("on_time");
  });

  it("respects an explicit non-zero wire delay of 420 over any derivation", async () => {
    const { updates, info } = await driveFeed(
      { departure: { delay: 420 } },
      "12:00:00",
    );

    expect(updates[0].stop_time_updates[0].departure_delay).toBe(420);
    expect(info.delaySeconds).toBe(420);
    expect(info.status).toBe("delayed");
  });
});
