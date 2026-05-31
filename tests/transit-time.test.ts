import { describe, expect, it } from 'vitest';
import {
  addMinutesToGtfsTime,
  formatGtfsTimeForDisplay,
  getMetroNorthServiceContext,
  parseGtfsTime,
} from '../src/domain/transit-time.js';

describe('Metro-North transit time helpers', () => {
  it('uses the previous service date for early-morning New York trips', () => {
    const context = getMetroNorthServiceContext(new Date('2024-01-02T06:10:00Z'));

    expect(context.serviceDate).toBe('2024-01-01');
    expect(context.serviceDateCompact).toBe('20240101');
    expect(context.queryTime).toBe('25:10:00');
  });

  it('keeps the current service date after the rollover hour', () => {
    const context = getMetroNorthServiceContext(new Date('2024-01-02T14:30:00Z'));

    expect(context.serviceDate).toBe('2024-01-02');
    expect(context.queryTime).toBe('09:30:00');
  });

  it('parses and formats GTFS times after midnight', () => {
    expect(parseGtfsTime('25:10:00')).toBe(90600);
    expect(formatGtfsTimeForDisplay('25:10:00')).toBe('01:10');
    expect(addMinutesToGtfsTime('25:10:00', 20)).toBe('01:30');
  });
});
