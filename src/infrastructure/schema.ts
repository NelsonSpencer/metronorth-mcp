import { sqliteTable, text, integer, real, primaryKey } from 'drizzle-orm/sqlite-core';

// Agency table
export const agency = sqliteTable('agency', {
  agency_id: text('agency_id').primaryKey(),
  agency_name: text('agency_name').notNull(),
  agency_url: text('agency_url').notNull(),
  agency_timezone: text('agency_timezone').notNull(),
  agency_lang: text('agency_lang'),
  agency_phone: text('agency_phone'),
  agency_fare_url: text('agency_fare_url'),
});

// Stops table
export const stops = sqliteTable('stops', {
  stop_id: text('stop_id').primaryKey(),
  stop_code: text('stop_code'),
  stop_name: text('stop_name').notNull(),
  stop_desc: text('stop_desc'),
  stop_lat: real('stop_lat').notNull(),
  stop_lon: real('stop_lon').notNull(),
  zone_id: text('zone_id'),
  stop_url: text('stop_url'),
  location_type: integer('location_type').default(0),
  parent_station: text('parent_station'),
  stop_timezone: text('stop_timezone'),
  wheelchair_boarding: integer('wheelchair_boarding'),
});

// Routes table
export const routes = sqliteTable('routes', {
  route_id: text('route_id').primaryKey(),
  agency_id: text('agency_id'),
  route_short_name: text('route_short_name'),
  route_long_name: text('route_long_name').notNull(),
  route_desc: text('route_desc'),
  route_type: integer('route_type').notNull(),
  route_url: text('route_url'),
  route_color: text('route_color'),
  route_text_color: text('route_text_color'),
});

// Trips table
export const trips = sqliteTable('trips', {
  trip_id: text('trip_id').primaryKey(),
  route_id: text('route_id').notNull(),
  service_id: text('service_id').notNull(),
  trip_headsign: text('trip_headsign'),
  trip_short_name: text('trip_short_name'),
  direction_id: integer('direction_id'),
  block_id: text('block_id'),
  shape_id: text('shape_id'),
  wheelchair_accessible: integer('wheelchair_accessible'),
  bikes_allowed: integer('bikes_allowed'),
});

// Stop times table
export const stopTimes = sqliteTable(
  'stop_times',
  {
    trip_id: text('trip_id').notNull(),
    arrival_time: text('arrival_time').notNull(),
    departure_time: text('departure_time').notNull(),
    stop_id: text('stop_id').notNull(),
    stop_sequence: integer('stop_sequence').notNull(),
    stop_headsign: text('stop_headsign'),
    pickup_type: integer('pickup_type'),
    drop_off_type: integer('drop_off_type'),
    shape_dist_traveled: real('shape_dist_traveled'),
    timepoint: integer('timepoint'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.trip_id, table.stop_sequence] }),
  })
);

// Calendar table
export const calendar = sqliteTable('calendar', {
  service_id: text('service_id').primaryKey(),
  monday: integer('monday').notNull(),
  tuesday: integer('tuesday').notNull(),
  wednesday: integer('wednesday').notNull(),
  thursday: integer('thursday').notNull(),
  friday: integer('friday').notNull(),
  saturday: integer('saturday').notNull(),
  sunday: integer('sunday').notNull(),
  start_date: text('start_date').notNull(),
  end_date: text('end_date').notNull(),
});

// Calendar dates table
export const calendarDates = sqliteTable(
  'calendar_dates',
  {
    service_id: text('service_id').notNull(),
    date: text('date').notNull(),
    exception_type: integer('exception_type').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.service_id, table.date] }),
  })
);

// Realtime updates table
export const realtimeUpdates = sqliteTable(
  'realtime_updates',
  {
    trip_id: text('trip_id').notNull(),
    stop_id: text('stop_id').notNull(),
    arrival_delay: integer('arrival_delay'),
    departure_delay: integer('departure_delay'),
    schedule_relationship: text('schedule_relationship'),
    updated_at: text('updated_at'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.trip_id, table.stop_id] }),
  })
);

// Metadata table
export const metadata = sqliteTable('metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updated_at: text('updated_at'),
});
