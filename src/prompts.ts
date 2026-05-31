import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { GetPromptResult, ListPromptsResult } from '@modelcontextprotocol/sdk/types.js';

export const promptDefinitions: ListPromptsResult['prompts'] = [
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
            'First search for the origin and destination stations if the names may be partial.',
            'Then check upcoming departures from the origin and current service alerts.',
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
            'Use system status to explain data freshness when relevant.',
            'If a station is provided, include station-specific context.',
            'Keep the answer practical for a commuter and call out realtime uncertainty.',
          ].join('\n'),
        },
      },
    ],
  };
}
