import { beforeEach, describe, expect, it, vi } from 'vitest';

const axiosGetMock = vi.hoisted(() => vi.fn());
const decodeMock = vi.hoisted(() => vi.fn());
const cacheGetMock = vi.hoisted(() => vi.fn());
const cacheSetMock = vi.hoisted(() => vi.fn());
const dbRunMock = vi.hoisted(() => vi.fn());
const preparedQueries = vi.hoisted(() => [] as string[]);

vi.mock('axios', () => ({
  default: {
    get: axiosGetMock,
    isAxiosError: vi.fn(() => false),
  },
}));

vi.mock('gtfs-realtime-bindings', () => ({
  default: {
    transit_realtime: {
      FeedMessage: {
        decode: decodeMock,
      },
    },
  },
}));

vi.mock('../src/infrastructure/cache.js', () => ({
  getCache: vi.fn(() => ({
    get: cacheGetMock,
    set: cacheSetMock,
  })),
  CACHE_KEYS: {
    tripUpdates: 'realtime:trip_updates',
    serviceAlerts: 'realtime:alerts',
  },
}));

vi.mock('../src/infrastructure/database.js', () => ({
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
  informedEntity?: Array<{ agencyId?: string; routeId?: string; stopId?: string }>
) {
  return {
    id,
    alert: {
      informedEntity,
      headerText: {
        translation: [{ text: id, language: 'en' }],
      },
    },
  };
}

describe('MetroNorthRealtime', () => {
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

  it('keeps service alerts for Metro-North routes 1 through 8, agency MNR, and system alerts', async () => {
    decodeMock.mockReturnValue({
      entity: [
        alertEntity('route-4', [{ routeId: '4' }]),
        alertEntity('route-8', [{ routeId: '8' }]),
        alertEntity('agency-mnr', [{ agencyId: 'MNR' }]),
        alertEntity('system-wide', []),
        alertEntity('other-route', [{ routeId: '9' }]),
      ],
    });

    const { MetroNorthRealtime } = await import('../src/infrastructure/realtime-client.js');
    const client = new MetroNorthRealtime();

    const alerts = await client.getServiceAlerts();

    expect(alerts.map((alert) => alert.alert_id)).toEqual([
      'route-4',
      'route-8',
      'agency-mnr',
      'system-wide',
    ]);
  });

  it('deletes stale realtime fallback rows before persisting fresh trip updates', async () => {
    decodeMock.mockReturnValue({
      entity: [
        {
          id: '456',
          tripUpdate: {
            trip: {
              tripId: 'trip-1',
              routeId: '2',
            },
            stopTimeUpdate: [
              {
                stopId: 'GCT',
                departure: { delay: 120 },
              },
            ],
            timestamp: '1717000000',
          },
        },
      ],
    });

    const { MetroNorthRealtime } = await import('../src/infrastructure/realtime-client.js');
    const client = new MetroNorthRealtime();

    const updates = await client.getTripUpdates();

    expect(updates).toHaveLength(1);
    expect(
      preparedQueries.some(
        (query) => query.includes('DELETE FROM realtime_updates') && query.includes("'-5 minutes'")
      )
    ).toBe(true);
    expect(dbRunMock).toHaveBeenCalledWith();
    expect(dbRunMock).toHaveBeenCalledWith('trip-1', 'GCT', null, 120, null);
  });
});
