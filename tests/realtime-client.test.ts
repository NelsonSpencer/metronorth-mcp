import { beforeEach, describe, expect, it, vi } from "vitest";

const axiosGetMock = vi.hoisted(() => vi.fn());
const decodeMock = vi.hoisted(() => vi.fn());
const cacheGetMock = vi.hoisted(() => vi.fn());
const cacheSetMock = vi.hoisted(() => vi.fn());
const dbRunMock = vi.hoisted(() => vi.fn());
const preparedQueries = vi.hoisted(() => [] as string[]);

vi.mock("axios", () => ({
  default: {
    get: axiosGetMock,
    isAxiosError: vi.fn(() => false),
  },
}));

vi.mock("../src/infrastructure/gtfs-realtime-decoder.js", () => ({
  decodeGtfsRealtimeFeed: decodeMock,
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
    prepare: vi.fn((query: string) => {
      preparedQueries.push(query);
      return {
        all: vi.fn(() => []),
        get: vi.fn(() => undefined),
        run: dbRunMock,
      };
    }),
  })),
  transaction: vi.fn((fn: () => unknown) => fn()),
}));

function alertEntity(
  id: string,
  informedEntity?: Array<{
    agencyId?: string;
    routeId?: string;
    routeType?: number;
    stopId?: string;
  }>,
) {
  return {
    id,
    alert: {
      informedEntity,
      headerText: {
        translation: [{ text: id, language: "en" }],
      },
    },
  };
}

describe("MetroNorthRealtime", () => {
  beforeEach(() => {
    axiosGetMock.mockReset();
    axiosGetMock.mockResolvedValue({ data: new ArrayBuffer(0) });
    decodeMock.mockReset();
    cacheGetMock.mockReset();
    cacheGetMock.mockResolvedValue(null);
    cacheSetMock.mockReset();
    cacheSetMock.mockResolvedValue(undefined);
    dbRunMock.mockReset();
    preparedQueries.length = 0;
  });

  it("scopes service alerts to Metro-North by agency/route_type, not a bare route id", async () => {
    decodeMock.mockReturnValue({
      entity: [
        // Agency 'MNR' is authoritative and passes outright.
        alertEntity("agency-mnr", [{ agencyId: "MNR" }]),
        // Agency 'MNR' plus a genuine MNR stop entity (the New Rochelle
        // elevator alert shape observed live).
        alertEntity("mnr-elevator", [
          { agencyId: "MNR", routeId: "3", stopId: "108" },
        ]),
        // No agency tagged: fall back to the route id (legacy feeds).
        alertEntity("route-4-no-agency", [{ routeId: "4" }]),
        // No agency but route_type says rail (GTFS route_type 2) -> MNR.
        alertEntity("route-1-rail", [{ routeId: "1", routeType: 2 }]),
        // Alerts with no informed entity are system-wide and pass through.
        alertEntity("system-wide", []),

        // --- Regression: NYC subway lines 1-6 collide with MNR route ids ---
        // Subway entity tagged with the subway agency must be REJECTED even
        // though routeId '2' looks like the Harlem Line ("[2][3] skips Clark St").
        alertEntity("subway-2-mtasbwy", [
          { routeId: "2", agencyId: "MTASBWY", stopId: "231" },
        ]),
        // Subway identified by route_type 1 (subway) with no agency -> REJECTED.
        alertEntity("subway-3-routetype", [{ routeId: "3", routeType: 1 }]),
        // Other operators sharing an MNR-looking route id are rejected too.
        alertEntity("lirr-6", [{ routeId: "6", agencyId: "LI" }]),
        // Route 8 is Port Jervis (west-of-Hudson, absent from this feed).
        alertEntity("west-of-hudson-8", [{ routeId: "8" }]),
        alertEntity("other-route-9", [{ routeId: "9" }]),
      ],
    });

    const { MetroNorthRealtime } =
      await import("../src/infrastructure/realtime-client.js");
    const client = new MetroNorthRealtime();

    const alerts = await client.getServiceAlerts();

    expect(alerts.map((alert) => alert.alert_id)).toEqual([
      "agency-mnr",
      "mnr-elevator",
      "route-4-no-agency",
      "route-1-rail",
      "system-wide",
    ]);
    // Subway/other-operator collisions are excluded.
    const ids = alerts.map((alert) => alert.alert_id);
    expect(ids).not.toContain("subway-2-mtasbwy");
    expect(ids).not.toContain("subway-3-routetype");
    expect(ids).not.toContain("lirr-6");
  });

  it("deletes stale realtime fallback rows before persisting fresh trip updates", async () => {
    decodeMock.mockReturnValue({
      entity: [
        {
          id: "456",
          tripUpdate: {
            trip: {
              tripId: "trip-1",
              routeId: "2",
            },
            stopTimeUpdate: [
              {
                stopId: "GCT",
                departure: { delay: 120 },
              },
            ],
            timestamp: "1717000000",
          },
        },
      ],
    });

    const { MetroNorthRealtime } =
      await import("../src/infrastructure/realtime-client.js");
    const client = new MetroNorthRealtime();

    const updates = await client.getTripUpdates();

    expect(updates).toHaveLength(1);
    expect(
      preparedQueries.some(
        (query) =>
          query.includes("DELETE FROM realtime_updates") &&
          query.includes("'-5 minutes'"),
      ),
    ).toBe(true);
    expect(dbRunMock).toHaveBeenCalledWith();
    expect(dbRunMock).toHaveBeenCalledWith(
      "trip-1",
      "GCT",
      null,
      120,
      null,
      null,
      null,
    );
  });

  it("preserves explicit zero delays from realtime trip updates", async () => {
    decodeMock.mockReturnValue({
      entity: [
        {
          id: "456",
          tripUpdate: {
            trip: {
              tripId: "trip-1",
              routeId: "2",
            },
            stopTimeUpdate: [
              {
                stopId: "GCT",
                arrival: { delay: 0 },
              },
              {
                stopId: "WP",
                departure: { delay: 0 },
              },
            ],
            timestamp: "1717000000",
          },
        },
      ],
    });

    const { MetroNorthRealtime } =
      await import("../src/infrastructure/realtime-client.js");
    const client = new MetroNorthRealtime();

    const updates = await client.getTripUpdates();
    const arrivalInfo = client.getRealtimeInfoForTripAtStopFromUpdates(
      updates,
      "trip-1",
      "GCT",
      "12:00:00",
      "456",
    );
    const departureInfo = client.getRealtimeInfoForTripAtStopFromUpdates(
      updates,
      "trip-1",
      "WP",
      "12:30:00",
      "456",
    );

    expect(updates[0].stop_time_updates).toEqual([
      expect.objectContaining({
        stop_id: "GCT",
        arrival_delay: 0,
        departure_delay: null,
      }),
      expect.objectContaining({
        stop_id: "WP",
        arrival_delay: null,
        departure_delay: 0,
      }),
    ]);
    expect(arrivalInfo).toMatchObject({ delaySeconds: 0, status: "on_time" });
    expect(departureInfo).toMatchObject({ delaySeconds: 0, status: "on_time" });
    expect(dbRunMock).toHaveBeenCalledWith(
      "trip-1",
      "GCT",
      0,
      null,
      null,
      null,
      null,
    );
    expect(dbRunMock).toHaveBeenCalledWith(
      "trip-1",
      "WP",
      null,
      0,
      null,
      null,
      null,
    );
  });
});

describe("MetroNorthRealtime absolute-time delay handling", () => {
  // Epoch seconds for these scheduled times on service date 2024-01-01 (EST):
  //   12:00:00 -> 1704128400 ; 25:10:00 (next-day 01:10) -> 1704175800
  const NOON_EPOCH = 1704128400;
  const AFTER_MIDNIGHT_EPOCH = 1704175800;

  beforeEach(() => {
    axiosGetMock.mockReset();
    axiosGetMock.mockResolvedValue({ data: new ArrayBuffer(0) });
    decodeMock.mockReset();
    cacheGetMock.mockReset();
    cacheGetMock.mockResolvedValue(null);
    cacheSetMock.mockReset();
    cacheSetMock.mockResolvedValue(undefined);
    dbRunMock.mockReset();
    preparedQueries.length = 0;
  });

  async function infoForStopTimeUpdate(
    stopTimeUpdate: Record<string, unknown>,
    scheduledTime: string,
  ) {
    decodeMock.mockReturnValue({
      entity: [
        {
          id: "100",
          tripUpdate: {
            trip: { tripId: "trip-x", routeId: "2", startDate: "20240101" },
            stopTimeUpdate: [{ stopId: "GCT", ...stopTimeUpdate }],
          },
        },
      ],
    });

    const { MetroNorthRealtime } =
      await import("../src/infrastructure/realtime-client.js");
    const client = new MetroNorthRealtime();
    const updates = await client.getTripUpdates();

    return client.getRealtimeInfoForTripAtStopFromUpdates(
      updates,
      "trip-x",
      "GCT",
      scheduledTime,
      "100",
    );
  }

  it("derives delay from absolute departure time for normal same-day trips", async () => {
    const info = await infoForStopTimeUpdate(
      {
        departure: { time: String(NOON_EPOCH + 300) },
        track: "7",
        trainStatus: "Delayed",
      },
      "12:00:00",
    );

    expect(info.delaySeconds).toBe(300);
    expect(info.status).toBe("delayed");
    expect(info.track).toBe("7");
    expect(info.trainStatus).toBe("Delayed");
  });

  it("derives absolute-time delay for after-midnight 25:xx schedules near the rollover", async () => {
    const info = await infoForStopTimeUpdate(
      { departure: { time: String(AFTER_MIDNIGHT_EPOCH + 180) } },
      "25:10:00",
    );

    expect(info.delaySeconds).toBe(180);
    expect(info.status).toBe("delayed");
  });

  it("prefers an explicit delay over the absolute-time derivation", async () => {
    // Absolute time implies +300s, but the explicit delay of 500s must win.
    const info = await infoForStopTimeUpdate(
      { departure: { delay: 500, time: String(NOON_EPOCH + 300) } },
      "12:00:00",
    );

    expect(info.delaySeconds).toBe(500);
    expect(info.status).toBe("delayed");
  });

  it("treats an absolute-time delay of 60s or less as on time", async () => {
    const info = await infoForStopTimeUpdate(
      { departure: { time: String(NOON_EPOCH + 30) } },
      "12:00:00",
    );

    expect(info.delaySeconds).toBe(30);
    expect(info.status).toBe("on_time");
  });
});
