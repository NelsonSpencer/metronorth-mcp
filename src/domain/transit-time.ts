export const METRO_NORTH_TIME_ZONE = 'America/New_York';
const SERVICE_DAY_ROLLOVER_HOUR = 3;

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export type MetroNorthServiceContext = {
  serviceDate: string;
  serviceDateCompact: string;
  queryTime: string;
};

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: METRO_NORTH_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function getParts(date: Date): DateParts {
  const values = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function formatServiceDate(parts: Pick<DateParts, 'year' | 'month' | 'day'>): string {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function compactDate(date: string): string {
  return date.replace(/-/g, '');
}

function formatGtfsClock(totalSeconds: number, includeServiceDayHours: boolean): string {
  const secondsInDay = 24 * 60 * 60;
  const normalizedSeconds = includeServiceDayHours
    ? totalSeconds
    : ((totalSeconds % secondsInDay) + secondsInDay) % secondsInDay;
  const hours = Math.floor(normalizedSeconds / 3600);
  const minutes = Math.floor((normalizedSeconds % 3600) / 60);
  const seconds = normalizedSeconds % 60;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function parseGtfsTime(gtfsTime: string): number {
  const [hours, minutes, seconds] = gtfsTime.split(':').map(Number);
  return hours * 3600 + minutes * 60 + (seconds || 0);
}

// Convert an America/New_York wall-clock instant to epoch seconds using the
// same tz machinery (Intl formatter) the rest of this module relies on, rather
// than reinventing offset math. Correct across DST except inside the ~1h
// spring-forward gap / fall-back overlap, which does not affect MNR schedules.
function partsToEpochSeconds(parts: DateParts): number {
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const local = getParts(new Date(asUtc));
  const localAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  const offsetMs = localAsUtc - asUtc;
  return Math.round((asUtc - offsetMs) / 1000);
}

/**
 * Resolve a GTFS scheduled time on a given service date to absolute epoch
 * seconds in America/New_York. Handles GTFS after-midnight times (e.g. "25:10"
 * rolls into the next calendar day) and accepts service dates as either
 * `YYYY-MM-DD` or the compact `YYYYMMDD` form used by GTFS-RT `start_date`.
 * Returns NaN when the service date cannot be parsed.
 */
export function gtfsServiceTimeToEpochSeconds(serviceDate: string, gtfsTime: string): number {
  const compact = serviceDate.replace(/-/g, '');
  if (!/^\d{8}$/.test(compact)) {
    return NaN;
  }

  const year = Number(compact.slice(0, 4));
  const month = Number(compact.slice(4, 6));
  const day = Number(compact.slice(6, 8));

  const totalSeconds = parseGtfsTime(gtfsTime);
  const dayOffset = Math.floor(totalSeconds / 86400);
  const secondsIntoDay = totalSeconds - dayOffset * 86400;

  // Resolve the wall-clock calendar day (service date plus any 24h+ rollover)
  // in UTC space so month/year boundaries are handled correctly, then read that
  // day back at the New York wall clock.
  const rolledDay = new Date(Date.UTC(year, month - 1, day + dayOffset));

  return partsToEpochSeconds({
    year: rolledDay.getUTCFullYear(),
    month: rolledDay.getUTCMonth() + 1,
    day: rolledDay.getUTCDate(),
    hour: Math.floor(secondsIntoDay / 3600),
    minute: Math.floor((secondsIntoDay % 3600) / 60),
    second: secondsIntoDay % 60,
  });
}

export function formatGtfsTimeForDisplay(gtfsTime: string): string {
  return formatGtfsClock(parseGtfsTime(gtfsTime), false).slice(0, 5);
}

export function addMinutesToGtfsTime(gtfsTime: string, minutes: number): string {
  return formatGtfsClock(parseGtfsTime(gtfsTime) + minutes * 60, false).slice(0, 5);
}

export function getMetroNorthServiceContext(now: Date = new Date()): MetroNorthServiceContext {
  const localParts = getParts(now);
  const serviceDate =
    localParts.hour < SERVICE_DAY_ROLLOVER_HOUR
      ? formatServiceDate(getParts(new Date(now.getTime() - 24 * 60 * 60 * 1000)))
      : formatServiceDate(localParts);
  const queryHour =
    localParts.hour < SERVICE_DAY_ROLLOVER_HOUR ? localParts.hour + 24 : localParts.hour;
  const queryTime = formatGtfsClock(
    queryHour * 3600 + localParts.minute * 60 + localParts.second,
    true
  );

  return {
    serviceDate,
    serviceDateCompact: compactDate(serviceDate),
    queryTime,
  };
}

export function compactServiceDate(serviceDate: string): string {
  return compactDate(serviceDate);
}
