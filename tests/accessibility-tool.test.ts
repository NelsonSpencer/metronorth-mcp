import { describe, expect, it, vi } from 'vitest';
import { handleToolCall } from '../src/tools/index.js';
import type { ServiceAlert, StationInfo } from '../src/domain/gtfs.js';

// A mix of alerts: two accessibility alerts (one detected by keyword, one by the
// ACCESSIBILITY_ISSUE effect), plus an unrelated service alert that must be
// excluded from every accessibility result.
const alerts: ServiceAlert[] = [
  {
    alert_id: 'elevator-gct',
    cause: 'MAINTENANCE',
    // Detected by the keyword scan, NOT by the effect field.
    effect: 'REDUCED_SERVICE',
    header_text: 'Elevator out of service at Grand Central Terminal',
    description_text: 'The elevator to the Metro-North platforms is temporarily out of service.',
    url: null,
    active_period_start: null,
    active_period_end: null,
    informed_entities: [
      { agency_id: 'MNR', route_id: '2', route_type: null, trip_id: null, stop_id: 'GCT' },
    ],
  },
  {
    alert_id: 'accessibility-effect',
    cause: 'OTHER_CAUSE',
    // Detected by the effect field even though the text avoids the keywords.
    effect: 'ACCESSIBILITY_ISSUE',
    header_text: 'Reduced boarding assistance at Stamford',
    description_text: 'Boarding assistance may be delayed.',
    url: null,
    active_period_start: null,
    active_period_end: null,
    informed_entities: [
      { agency_id: 'MNR', route_id: '3', route_type: null, trip_id: null, stop_id: 'STM' },
    ],
  },
  {
    alert_id: 'harlem-delay',
    cause: 'MAINTENANCE',
    effect: 'MODIFIED_SERVICE',
    header_text: 'Harlem Line schedule change',
    description_text: 'Expect minor delays this evening.',
    url: null,
    active_period_start: null,
    active_period_end: null,
    informed_entities: [
      { agency_id: 'MNR', route_id: '2', route_type: null, trip_id: null, stop_id: null },
    ],
  },
];

const grandCentralInfo: StationInfo = {
  stop_id: 'GCT',
  name: 'Grand Central Terminal',
  latitude: 40.7527,
  longitude: -73.9772,
  zone_id: '1',
  routes: ['Hudson', 'Harlem', 'New Haven'],
  wheelchair_accessible: true,
};

function makeStationService() {
  return {
    findStationByName: vi.fn(),
    searchStations: vi.fn(),
    getStationInfo: vi.fn((stationName: string) =>
      Promise.resolve(stationName.toLowerCase().includes('grand') ? grandCentralInfo : null)
    ),
  };
}

function makeRealtimeClient(serviceAlerts: ServiceAlert[] = alerts) {
  return {
    isAvailable: vi.fn(() => true),
    getServiceAlerts: vi.fn(() => Promise.resolve(serviceAlerts)),
  };
}

describe('get_accessibility_status', () => {
  it('is registered in the tool definitions', async () => {
    const { toolDefinitions } = await import('../src/tools/index.js');
    expect(toolDefinitions.map((tool) => tool.name)).toContain('get_accessibility_status');
  });

  it('returns accessibility alerts (keyword + effect) and excludes unrelated alerts', async () => {
    const result = await handleToolCall(
      'get_accessibility_status',
      {},
      { realtimeClient: makeRealtimeClient(), stationService: makeStationService() }
    );

    expect(result.isError).toBeUndefined();
    const content = result.structuredContent as Record<string, unknown>;
    const returnedAlerts = content.accessibility_alerts as Array<Record<string, unknown>>;

    expect(content.station).toBeNull();
    expect(content.total).toBe(2);
    expect(returnedAlerts.map((a) => a.id)).toEqual(['elevator-gct', 'accessibility-effect']);
    expect(returnedAlerts.map((a) => a.id)).not.toContain('harlem-delay');
    expect(returnedAlerts[0].affected_routes).toEqual(['2']);
  });

  it('always includes the data caveat and MTA status page', async () => {
    const result = await handleToolCall(
      'get_accessibility_status',
      {},
      { realtimeClient: makeRealtimeClient(), stationService: makeStationService() }
    );

    const content = result.structuredContent as Record<string, unknown>;
    expect(content.status_page).toBe('https://new.mta.info/elevator-escalator-status');
    expect(String(content.data_caveat)).toContain('no machine-readable Metro-North');
  });

  it('narrows to the named station and includes its wheelchair-accessible info', async () => {
    const result = await handleToolCall(
      'get_accessibility_status',
      { station_name: 'Grand Central' },
      { realtimeClient: makeRealtimeClient(), stationService: makeStationService() }
    );

    expect(result.isError).toBeUndefined();
    const content = result.structuredContent as Record<string, unknown>;
    const returnedAlerts = content.accessibility_alerts as Array<Record<string, unknown>>;

    // Only the Grand Central elevator alert mentions the resolved station name.
    expect(content.total).toBe(1);
    expect(returnedAlerts.map((a) => a.id)).toEqual(['elevator-gct']);

    const station = content.station as Record<string, unknown>;
    expect(station.name).toBe('Grand Central Terminal');
    expect(station.wheelchair_accessible).toBe(true);
  });

  it('returns a structured not_found error for an unknown station', async () => {
    const result = await handleToolCall(
      'get_accessibility_status',
      { station_name: 'Nowhere Station' },
      { realtimeClient: makeRealtimeClient(), stationService: makeStationService() }
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent?.error).toMatchObject({
      code: 'not_found',
      tool: 'get_accessibility_status',
    });
  });

  it('handles the no-alerts path with an empty list and zero total', async () => {
    const result = await handleToolCall(
      'get_accessibility_status',
      {},
      { realtimeClient: makeRealtimeClient([]), stationService: makeStationService() }
    );

    expect(result.isError).toBeUndefined();
    const content = result.structuredContent as Record<string, unknown>;
    expect(content.accessibility_alerts).toEqual([]);
    expect(content.total).toBe(0);
    expect(content.station).toBeNull();
  });
});
