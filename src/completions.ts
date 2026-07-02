import type { CompleteRequestParams, CompleteResult } from '@modelcontextprotocol/sdk/types.js';
import { MAJOR_STATIONS, ROUTE_NAMES } from './config.js';
import { getStationService } from './infrastructure/station-service.js';

// The resource template whose {station_name} variable we complete.
const STATION_TEMPLATE_URI = 'metronorth://station/{station_name}';

// MCP caps completion values at 100; we return at most this many suggestions.
const MAX_COMPLETIONS = 10;

// Minimal view of the station service so the completion logic can be unit-tested
// with a lightweight fake. The real StationService satisfies this structurally.
export interface StationNameSource {
  searchStations(query: string, limit: number): Promise<Array<{ stop_name: string }>>;
}

function toCompletion(values: string[]): CompleteResult {
  return {
    completion: {
      values: values.slice(0, MAX_COMPLETIONS),
      hasMore: false,
    },
  };
}

const EMPTY_COMPLETION: CompleteResult = toCompletion([]);

async function completeStationName(
  value: string,
  stationService: StationNameSource
): Promise<CompleteResult> {
  const trimmed = value.trim();

  // With nothing typed yet, offer popular hub stations as a starting point.
  if (!trimmed) {
    return toCompletion([...MAJOR_STATIONS]);
  }

  const stations = await stationService.searchStations(trimmed, MAX_COMPLETIONS);
  return toCompletion(stations.map((station) => station.stop_name));
}

function completeRouteName(value: string): CompleteResult {
  const routeNames = Object.values(ROUTE_NAMES);
  const trimmed = value.trim().toLowerCase();

  if (!trimmed) {
    return toCompletion(routeNames);
  }

  return toCompletion(routeNames.filter((name) => name.toLowerCase().includes(trimmed)));
}

/**
 * Provide argument completions for the station resource template and the
 * station/route prompt arguments. Unknown refs or arguments return an empty
 * value list (never throw) so clients degrade gracefully.
 *
 * The station service is injected so this can be exercised without a live
 * database; it defaults to the shared singleton in production.
 */
export async function handleCompletion(
  params: CompleteRequestParams,
  stationService: StationNameSource = getStationService()
): Promise<CompleteResult> {
  const { ref, argument } = params;
  const value = argument.value ?? '';

  if (ref.type === 'ref/resource') {
    if (ref.uri === STATION_TEMPLATE_URI && argument.name === 'station_name') {
      return completeStationName(value, stationService);
    }
    return EMPTY_COMPLETION;
  }

  if (ref.type === 'ref/prompt') {
    if (
      ref.name === 'plan-metro-north-trip' &&
      (argument.name === 'origin' || argument.name === 'destination')
    ) {
      return completeStationName(value, stationService);
    }

    if (ref.name === 'summarize-service-status') {
      if (argument.name === 'station_name') {
        return completeStationName(value, stationService);
      }
      if (argument.name === 'route_name') {
        return completeRouteName(value);
      }
    }

    return EMPTY_COMPLETION;
  }

  return EMPTY_COMPLETION;
}
