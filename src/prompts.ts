import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { GetPromptResult, ListPromptsResult } from '@modelcontextprotocol/sdk/types.js';

export const promptDefinitions: ListPromptsResult['prompts'] = [
  {
    name: 'use-metro-north-mcp',
    title: 'Use Metro-North MCP',
    description: 'Guide an agent through the main Metro-North MCP tool workflows.',
    arguments: [],
  },
  {
    name: 'plan-metro-north-trip',
    title: 'Plan Metro-North Trip',
    description:
      'Guide an assistant through station search, departures, and alerts for a Metro-North trip.',
    arguments: [
      {
        name: 'origin',
        description: 'Origin station or partial station name.',
        required: true,
      },
      {
        name: 'destination',
        description: 'Destination station or partial station name.',
        required: true,
      },
      {
        name: 'direction',
        description: 'Optional direction: inbound, outbound, or all.',
        required: false,
      },
    ],
  },
  {
    name: 'summarize-service-status',
    title: 'Summarize Service Status',
    description:
      'Guide an assistant through route alerts, station-specific context, and system status.',
    arguments: [
      {
        name: 'route_name',
        description: 'Optional route name, such as Hudson, Harlem, or New Haven.',
        required: false,
      },
      {
        name: 'station_name',
        description: 'Optional station name for station-specific alert context.',
        required: false,
      },
    ],
  },
];

export function handleGetPrompt(
  name: string,
  args: Record<string, string> = {}
): GetPromptResult {
  switch (name) {
    case 'use-metro-north-mcp':
      return useMetroNorthMcpPrompt();
    case 'plan-metro-north-trip':
      return planMetroNorthTripPrompt(args);
    case 'summarize-service-status':
      return summarizeServiceStatusPrompt(args);
    default:
      throw new McpError(ErrorCode.InvalidRequest, `Unknown prompt: ${name}`);
  }
}

function requireString(args: Record<string, string>, key: string): string {
  const value = args[key]?.trim();
  if (!value) {
    throw new McpError(ErrorCode.InvalidParams, `Missing required prompt argument: ${key}`);
  }

  return value;
}

function useMetroNorthMcpPrompt(): GetPromptResult {
  return {
    description: 'Use Metro-North MCP tools, resources, and prompts effectively.',
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: [
            'Use the Metro-North MCP server for station lookup, departures, route schedules, alerts, and data freshness.',
            'Use plan_metro_north_trip first for station-to-station trip questions.',
            'Use get_station_pair_schedule for direct train options between two stations.',
            'Use get_first_last_trains when the user asks for the first or last train.',
            'Search stations first when a station name may be partial or ambiguous.',
            'Use get_departures for near-term station departure options.',
            'Use get_route_schedule for route/date schedule views.',
            'Use get_service_alerts for route or station disruptions.',
            'Read metronorth://system/status when data freshness matters.',
            'Mention that realtime departures and alerts are best-effort public feed data.',
            'Mention that transfer planning is not included when no direct trip is found.',
          ].join('\n'),
        },
      },
    ],
  };
}

function planMetroNorthTripPrompt(args: Record<string, string>): GetPromptResult {
  const origin = requireString(args, 'origin');
  const destination = requireString(args, 'destination');
  const direction = args.direction?.trim() || 'all';

  return {
    description: `Plan a Metro-North trip from ${origin} to ${destination}.`,
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: [
            `Plan a Metro-North trip from "${origin}" to "${destination}".`,
            `Use direction "${direction}" unless station context suggests otherwise.`,
            'Search the origin and destination stations if either name may be partial or ambiguous.',
            'Use plan_metro_north_trip for direct station-to-station options.',
            'Check current service alerts for relevant routes or stations.',
            'Summarize the best option, any uncertainty, and the realtime data caveat.',
          ].join('\n'),
        },
      },
    ],
  };
}

function summarizeServiceStatusPrompt(args: Record<string, string>): GetPromptResult {
  const routeName = args.route_name?.trim();
  const stationName = args.station_name?.trim();
  const scope = [routeName && `route "${routeName}"`, stationName && `station "${stationName}"`]
    .filter(Boolean)
    .join(' and ');

  return {
    description: `Summarize Metro-North service status${scope ? ` for ${scope}` : ''}.`,
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: [
            `Summarize Metro-North service status${scope ? ` for ${scope}` : ''}.`,
            'Check current service alerts first.',
            'If a station is provided, include station-specific context.',
            'Read system status if data freshness matters.',
            'Keep the answer practical for a commuter and call out realtime uncertainty.',
          ].join('\n'),
        },
      },
    ],
  };
}
