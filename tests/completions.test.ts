import { describe, expect, it, vi } from 'vitest';
import type { CompleteRequestParams } from '@modelcontextprotocol/sdk/types.js';
import { handleCompletion } from '../src/completions.js';
import { MAJOR_STATIONS, ROUTE_NAMES } from '../src/config.js';

const STATIONS = [
  'Grand Central Terminal',
  'Greenwich',
  'Harlem-125th Street',
  'White Plains',
  'Stamford',
];

function makeStationService() {
  return {
    searchStations: vi.fn((query: string, limit: number) =>
      Promise.resolve(
        STATIONS.filter((name) => name.toLowerCase().includes(query.toLowerCase()))
          .slice(0, limit)
          .map((stop_name) => ({ stop_name }))
      )
    ),
  };
}

function resourceRef(uri: string, argName: string, value: string): CompleteRequestParams {
  return { ref: { type: 'ref/resource', uri }, argument: { name: argName, value } };
}

function promptRef(name: string, argName: string, value: string): CompleteRequestParams {
  return { ref: { type: 'ref/prompt', name }, argument: { name: argName, value } };
}

const STATION_TEMPLATE_URI = 'metronorth://station/{station_name}';

describe('handleCompletion', () => {
  it('completes the station resource template variable via the station service', async () => {
    const stationService = makeStationService();
    const result = await handleCompletion(
      resourceRef(STATION_TEMPLATE_URI, 'station_name', 'gre'),
      stationService
    );

    expect(stationService.searchStations).toHaveBeenCalledWith('gre', 10);
    expect(result.completion.values).toEqual(['Greenwich']);
    expect(result.completion.hasMore).toBe(false);
  });

  it('offers popular stations for an empty resource-template value', async () => {
    const stationService = makeStationService();
    const result = await handleCompletion(
      resourceRef(STATION_TEMPLATE_URI, 'station_name', ''),
      stationService
    );

    expect(stationService.searchStations).not.toHaveBeenCalled();
    expect(result.completion.values).toEqual(MAJOR_STATIONS);
  });

  it('completes plan-metro-north-trip origin and destination with station names', async () => {
    const stationService = makeStationService();

    const origin = await handleCompletion(
      promptRef('plan-metro-north-trip', 'origin', 'grand'),
      stationService
    );
    const destination = await handleCompletion(
      promptRef('plan-metro-north-trip', 'destination', 'white'),
      stationService
    );

    expect(origin.completion.values).toEqual(['Grand Central Terminal']);
    expect(destination.completion.values).toEqual(['White Plains']);
  });

  it('completes summarize-service-status station_name with station names', async () => {
    const result = await handleCompletion(
      promptRef('summarize-service-status', 'station_name', 'stam'),
      makeStationService()
    );

    expect(result.completion.values).toEqual(['Stamford']);
  });

  it('completes summarize-service-status route_name by case-insensitive substring', async () => {
    const result = await handleCompletion(
      promptRef('summarize-service-status', 'route_name', 'new'),
      makeStationService()
    );

    expect(result.completion.values).toEqual(['New Haven', 'New Canaan']);
    expect(result.completion.hasMore).toBe(false);
  });

  it('returns all route names for an empty route_name value', async () => {
    const result = await handleCompletion(
      promptRef('summarize-service-status', 'route_name', ''),
      makeStationService()
    );

    expect(result.completion.values).toEqual(Object.values(ROUTE_NAMES));
  });

  it('returns an empty list for an unknown prompt argument', async () => {
    const result = await handleCompletion(
      promptRef('plan-metro-north-trip', 'direction', 'in'),
      makeStationService()
    );

    expect(result.completion.values).toEqual([]);
    expect(result.completion.hasMore).toBe(false);
  });

  it('returns an empty list for an unknown prompt ref', async () => {
    const result = await handleCompletion(
      promptRef('does-not-exist', 'origin', 'grand'),
      makeStationService()
    );

    expect(result.completion.values).toEqual([]);
  });

  it('returns an empty list for an unknown resource template', async () => {
    const result = await handleCompletion(
      resourceRef('metronorth://unknown/{thing}', 'thing', 'x'),
      makeStationService()
    );

    expect(result.completion.values).toEqual([]);
  });
});
