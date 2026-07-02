import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Holds the current in-memory database; the mocked getSqlite returns whatever is
// seeded in beforeEach so each test runs against a fresh schema.
const dbHolder = vi.hoisted(() => ({ db: null as unknown as import('better-sqlite3').Database }));

// Mutable realtime response so connection-at-risk tests can vary leg-1's delay.
const realtimeFixture = vi.hoisted(() => ({ delaySeconds: null as number | null }));

vi.mock('../src/infrastructure/database.js', () => ({
  getSqlite: vi.fn(() => dbHolder.db),
}));

vi.mock('../src/infrastructure/station-service.js', () => ({
  getStationService: vi.fn(() => ({
    findStationByName: vi.fn((name: string) => {
      const lower = name.toLowerCase();
      if (lower.includes('origin')) {
        return Promise.resolve({ stop_id: 'ORIG', stop_name: 'Origin Station' });
      }
      if (lower.includes('destination')) {
        return Promise.resolve({ stop_id: 'DEST', stop_name: 'Destination Station' });
      }
      return Promise.resolve(null);
    }),
  })),
}));

vi.mock('../src/infrastructure/realtime-client.js', () => ({
  getRealtimeClient: vi.fn(() => ({
    isAvailable: vi.fn(() => true),
    getTripUpdates: vi.fn(() => Promise.resolve([])),
    getRealtimeInfoForTripAtStopFromUpdates: vi.fn(() => ({
      delaySeconds: realtimeFixture.delaySeconds,
      status: realtimeFixture.delaySeconds ? 'delayed' : 'on_time',
      actualTime: null,
      track: null as string | null,
      trainStatus: null as string | null,
    })),
  })),
}));

function createSchema(db: import('better-sqlite3').Database): void {
  db.exec(`
    CREATE TABLE routes (route_id TEXT PRIMARY KEY, route_long_name TEXT NOT NULL);
    CREATE TABLE stops (stop_id TEXT PRIMARY KEY, stop_name TEXT NOT NULL);
    CREATE TABLE trips (
      trip_id TEXT PRIMARY KEY,
      route_id TEXT NOT NULL,
      service_id TEXT NOT NULL,
      trip_headsign TEXT,
      trip_short_name TEXT,
      direction_id INTEGER,
      peak_offpeak INTEGER
    );
    CREATE TABLE stop_times (
      trip_id TEXT NOT NULL,
      arrival_time TEXT NOT NULL,
      departure_time TEXT NOT NULL,
      stop_id TEXT NOT NULL,
      stop_sequence INTEGER NOT NULL,
      track TEXT,
      note_id TEXT,
      PRIMARY KEY (trip_id, stop_sequence)
    );
    CREATE TABLE calendar (
      service_id TEXT PRIMARY KEY,
      monday INTEGER, tuesday INTEGER, wednesday INTEGER, thursday INTEGER,
      friday INTEGER, saturday INTEGER, sunday INTEGER,
      start_date TEXT NOT NULL, end_date TEXT NOT NULL
    );
    CREATE TABLE calendar_dates (
      service_id TEXT NOT NULL, date TEXT NOT NULL, exception_type INTEGER NOT NULL,
      PRIMARY KEY (service_id, date)
    );
    CREATE TABLE transfers (
      from_stop_id TEXT NOT NULL, to_stop_id TEXT NOT NULL,
      from_route_id TEXT, to_route_id TEXT,
      from_trip_id TEXT NOT NULL, to_trip_id TEXT NOT NULL,
      transfer_type INTEGER NOT NULL DEFAULT 1, min_transfer_time INTEGER,
      PRIMARY KEY (from_trip_id, to_trip_id, from_stop_id)
    );
    CREATE TABLE notes (note_id TEXT PRIMARY KEY, note_mark TEXT, note_title TEXT, note_desc TEXT);
  `);
}

type StopTimeSeed = {
  stop_id: string;
  seq: number;
  arr: string;
  dep: string;
  track?: string | null;
};

function addTrip(
  db: import('better-sqlite3').Database,
  tripId: string,
  routeId: string,
  serviceId: string,
  stopTimes: StopTimeSeed[]
): void {
  db.prepare(
    `INSERT INTO trips (trip_id, route_id, service_id, trip_headsign, trip_short_name, direction_id, peak_offpeak)
     VALUES (?, ?, ?, ?, ?, 0, 0)`
  ).run(tripId, routeId, serviceId, `${tripId} headsign`, tripId);

  const insert = db.prepare(
    `INSERT INTO stop_times (trip_id, arrival_time, departure_time, stop_id, stop_sequence, track)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const st of stopTimes) {
    insert.run(tripId, st.arr, st.dep, st.stop_id, st.seq, st.track ?? null);
  }
}

function addTransfer(
  db: import('better-sqlite3').Database,
  hub: string,
  fromTrip: string,
  toTrip: string,
  transferType = 1
): void {
  db.prepare(
    `INSERT INTO transfers (from_stop_id, to_stop_id, from_route_id, to_route_id, from_trip_id, to_trip_id, transfer_type, min_transfer_time)
     VALUES (?, ?, '1', '2', ?, ?, ?, NULL)`
  ).run(hub, hub, fromTrip, toTrip, transferType);
}

function seed(db: import('better-sqlite3').Database): void {
  createSchema(db);

  db.prepare(`INSERT INTO routes VALUES ('1', 'Hudson'), ('2', 'Harlem')`).run();
  db.prepare(
    `INSERT INTO stops VALUES ('ORIG', 'Origin Station'), ('HUB', 'Transfer Hub'), ('DEST', 'Destination Station')`
  ).run();

  // 2024-01-01 is a Monday; weekday service is active, weekend service is not.
  db.prepare(
    `INSERT INTO calendar VALUES
      ('weekday', 1, 1, 1, 1, 1, 0, 0, '20231201', '20241231'),
      ('weekend', 0, 0, 0, 0, 0, 1, 1, '20231201', '20241231')`
  ).run();

  // Itinerary A: ORIG 10:00 -> HUB arr 10:30 / dep 10:45 -> DEST 11:10 (wait 15, total 70).
  addTrip(db, 'T1', '1', 'weekday', [
    { stop_id: 'ORIG', seq: 1, arr: '10:00:00', dep: '10:00:00', track: '1' },
    { stop_id: 'HUB', seq: 2, arr: '10:30:00', dep: '10:31:00' },
  ]);
  addTrip(db, 'T2', '2', 'weekday', [
    { stop_id: 'HUB', seq: 1, arr: '10:40:00', dep: '10:45:00', track: 'A' },
    { stop_id: 'DEST', seq: 2, arr: '11:10:00', dep: '11:10:00' },
  ]);
  addTransfer(db, 'HUB', 'T1', 'T2');

  // Itinerary B: arrives DEST 12:10, i.e. after A — used to assert arrival ordering.
  addTrip(db, 'T3', '1', 'weekday', [
    { stop_id: 'ORIG', seq: 1, arr: '11:00:00', dep: '11:00:00' },
    { stop_id: 'HUB', seq: 2, arr: '11:30:00', dep: '11:31:00' },
  ]);
  addTrip(db, 'T4', '2', 'weekday', [
    { stop_id: 'HUB', seq: 1, arr: '11:40:00', dep: '11:45:00' },
    { stop_id: 'DEST', seq: 2, arr: '12:10:00', dep: '12:10:00' },
  ]);
  addTransfer(db, 'HUB', 'T3', 'T4');

  // Same-trip case: T5 itself continues ORIG -> HUB -> DEST, so its transfer to
  // T6 must be excluded (staying on T5 already reaches the destination).
  addTrip(db, 'T5', '1', 'weekday', [
    { stop_id: 'ORIG', seq: 1, arr: '10:05:00', dep: '10:05:00' },
    { stop_id: 'HUB', seq: 2, arr: '10:35:00', dep: '10:36:00' },
    { stop_id: 'DEST', seq: 3, arr: '11:05:00', dep: '11:05:00' },
  ]);
  addTrip(db, 'T6', '2', 'weekday', [
    { stop_id: 'HUB', seq: 1, arr: '10:40:00', dep: '10:50:00' },
    { stop_id: 'DEST', seq: 2, arr: '11:20:00', dep: '11:20:00' },
  ]);
  addTransfer(db, 'HUB', 'T5', 'T6');

  // Sanity-guard case: T8 departs the hub (09:05) before T7 arrives (09:50).
  addTrip(db, 'T7', '1', 'weekday', [
    { stop_id: 'ORIG', seq: 1, arr: '09:00:00', dep: '09:00:00' },
    { stop_id: 'HUB', seq: 2, arr: '09:50:00', dep: '09:51:00' },
  ]);
  addTrip(db, 'T8', '2', 'weekday', [
    { stop_id: 'HUB', seq: 1, arr: '09:00:00', dep: '09:05:00' },
    { stop_id: 'DEST', seq: 2, arr: '09:40:00', dep: '09:40:00' },
  ]);
  addTransfer(db, 'HUB', 'T7', 'T8');

  // Service-filter case: leg 1 (T9) runs weekend-only, so the itinerary is inactive.
  addTrip(db, 'T9', '1', 'weekend', [
    { stop_id: 'ORIG', seq: 1, arr: '10:10:00', dep: '10:10:00' },
    { stop_id: 'HUB', seq: 2, arr: '10:32:00', dep: '10:33:00' },
  ]);
  addTrip(db, 'T10', '2', 'weekday', [
    { stop_id: 'HUB', seq: 1, arr: '10:40:00', dep: '10:46:00' },
    { stop_id: 'DEST', seq: 2, arr: '11:12:00', dep: '11:12:00' },
  ]);
  addTransfer(db, 'HUB', 'T9', 'T10');

  // Service-filter case: leg 2 (T12) runs weekend-only.
  addTrip(db, 'T11', '1', 'weekday', [
    { stop_id: 'ORIG', seq: 1, arr: '10:15:00', dep: '10:15:00' },
    { stop_id: 'HUB', seq: 2, arr: '10:34:00', dep: '10:35:00' },
  ]);
  addTrip(db, 'T12', '2', 'weekend', [
    { stop_id: 'HUB', seq: 1, arr: '10:40:00', dep: '10:47:00' },
    { stop_id: 'DEST', seq: 2, arr: '11:13:00', dep: '11:13:00' },
  ]);
  addTransfer(db, 'HUB', 'T11', 'T12');
}

describe('ScheduleService.getTransferItineraries', () => {
  beforeEach(() => {
    dbHolder.db = new Database(':memory:');
    seed(dbHolder.db);
    realtimeFixture.delaySeconds = null;
  });

  it('assembles a one-transfer itinerary with both legs and the transfer window', async () => {
    const { ScheduleService } = await import('../src/infrastructure/schedule-service.js');
    const service = new ScheduleService();

    const itineraries = await service.getTransferItineraries('Origin Station', 'Destination Station', {
      date: '2024-01-01',
      limit: 1,
      includeRealtime: false,
    });

    expect(itineraries).toHaveLength(1);
    const [itinerary] = itineraries;

    expect(itinerary.itinerary_type).toBe('one_transfer');
    expect(itinerary.legs[0].trip_id).toBe('T1');
    expect(itinerary.legs[0].origin_station).toBe('Origin Station');
    expect(itinerary.legs[0].destination_station).toBe('Transfer Hub');
    expect(itinerary.legs[0].scheduled_origin_departure).toBe('10:00');
    expect(itinerary.legs[0].track).toBe('1');
    expect(itinerary.legs[1].trip_id).toBe('T2');
    expect(itinerary.legs[1].origin_station).toBe('Transfer Hub');
    expect(itinerary.legs[1].destination_station).toBe('Destination Station');
    expect(itinerary.legs[1].scheduled_destination_arrival).toBe('11:10');
    expect(itinerary.legs[1].track).toBe('A');

    expect(itinerary.transfer).toEqual({
      station: 'Transfer Hub',
      arrive: '10:30',
      depart: '10:45',
      wait_minutes: 15,
      guaranteed: true,
    });
    expect(itinerary.total_duration_minutes).toBe(70);
    expect(itinerary.connection_at_risk).toBe(false);
  });

  it('orders itineraries by final destination arrival', async () => {
    const { ScheduleService } = await import('../src/infrastructure/schedule-service.js');
    const service = new ScheduleService();

    const itineraries = await service.getTransferItineraries('Origin Station', 'Destination Station', {
      date: '2024-01-01',
      limit: 10,
      includeRealtime: false,
    });

    expect(itineraries.map((i) => i.legs[0].trip_id)).toEqual(['T1', 'T3']);
  });

  it('excludes a transfer when the arriving train itself continues to the destination', async () => {
    const { ScheduleService } = await import('../src/infrastructure/schedule-service.js');
    const service = new ScheduleService();

    const itineraries = await service.getTransferItineraries('Origin Station', 'Destination Station', {
      date: '2024-01-01',
      limit: 10,
      includeRealtime: false,
    });

    expect(itineraries.every((i) => i.legs[0].trip_id !== 'T5')).toBe(true);
  });

  it('filters out itineraries where the connection departs before the arriving leg lands', async () => {
    const { ScheduleService } = await import('../src/infrastructure/schedule-service.js');
    const service = new ScheduleService();

    const itineraries = await service.getTransferItineraries('Origin Station', 'Destination Station', {
      date: '2024-01-01',
      limit: 10,
      includeRealtime: false,
    });

    expect(itineraries.every((i) => i.legs[0].trip_id !== 'T7')).toBe(true);
  });

  it('only includes legs whose service runs on the requested date', async () => {
    const { ScheduleService } = await import('../src/infrastructure/schedule-service.js');
    const service = new ScheduleService();

    const itineraries = await service.getTransferItineraries('Origin Station', 'Destination Station', {
      date: '2024-01-01',
      limit: 10,
      includeRealtime: false,
    });

    // T9 (weekend leg 1) and T12 (weekend leg 2) must not appear on a weekday.
    expect(itineraries.every((i) => i.legs[0].trip_id !== 'T9')).toBe(true);
    expect(itineraries.every((i) => i.legs[1].trip_id !== 'T12')).toBe(true);
  });

  it('honors depart_after against the leg-1 origin departure', async () => {
    const { ScheduleService } = await import('../src/infrastructure/schedule-service.js');
    const service = new ScheduleService();

    const itineraries = await service.getTransferItineraries('Origin Station', 'Destination Station', {
      date: '2024-01-01',
      departAfter: '10:30',
      limit: 10,
      includeRealtime: false,
    });

    // Only itinerary B (leg 1 departs 11:00) survives; A departs 10:00.
    expect(itineraries.map((i) => i.legs[0].trip_id)).toEqual(['T3']);
  });

  it('respects the limit', async () => {
    const { ScheduleService } = await import('../src/infrastructure/schedule-service.js');
    const service = new ScheduleService();

    const itineraries = await service.getTransferItineraries('Origin Station', 'Destination Station', {
      date: '2024-01-01',
      limit: 1,
      includeRealtime: false,
    });

    expect(itineraries).toHaveLength(1);
  });

  it('flags connection_at_risk when leg-1 realtime delay meets or exceeds the wait', async () => {
    realtimeFixture.delaySeconds = 20 * 60; // 20 min >= 15 min wait
    const { ScheduleService } = await import('../src/infrastructure/schedule-service.js');
    const service = new ScheduleService();

    const itineraries = await service.getTransferItineraries('Origin Station', 'Destination Station', {
      date: '2024-01-01',
      limit: 1,
      includeRealtime: true,
    });

    expect(itineraries[0].legs[0].destination_delay_minutes).toBe(20);
    expect(itineraries[0].connection_at_risk).toBe(true);
  });

  it('does not flag connection_at_risk when leg-1 delay is under the wait', async () => {
    realtimeFixture.delaySeconds = 5 * 60; // 5 min < 15 min wait
    const { ScheduleService } = await import('../src/infrastructure/schedule-service.js');
    const service = new ScheduleService();

    const itineraries = await service.getTransferItineraries('Origin Station', 'Destination Station', {
      date: '2024-01-01',
      limit: 1,
      includeRealtime: true,
    });

    expect(itineraries[0].connection_at_risk).toBe(false);
  });
});
