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
