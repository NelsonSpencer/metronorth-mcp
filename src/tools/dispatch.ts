import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'node:crypto';
import { createModuleLogger, logRequest } from '../logger.js';
import { createToolContext, type ToolContextOverrides } from './context.js';
import { UnknownToolError } from './errors.js';
import { toolHandlers } from './handlers.js';
import { getToolErrorMessage, toToolErrorResult, toToolResult } from './results.js';

const logger = createModuleLogger('tools');

export interface ToolRequestContext {
  requestId: string;
}

export type ToolCallOptions = ToolContextOverrides & Partial<ToolRequestContext>;

export function createRequestContext(): ToolRequestContext {
  return {
    requestId: randomUUID(),
  };
}

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  options: ToolCallOptions = {}
): Promise<CallToolResult> {
  const start = Date.now();
  let success = true;
  const requestId = options.requestId ?? createRequestContext().requestId;
  const contextOverrides: ToolContextOverrides = {
    scheduleService: options.scheduleService,
    stationService: options.stationService,
    realtimeClient: options.realtimeClient,
    gtfsLoader: options.gtfsLoader,
    getMetadata: options.getMetadata,
  };

  try {
    const handler = toolHandlers[name];
    if (!handler) {
      throw new UnknownToolError(`Unknown tool: ${name}`);
    }

    const result = await handler(args, createToolContext(contextOverrides));
    return toToolResult(result);
  } catch (error) {
    if (error instanceof UnknownToolError) {
      success = false;
      throw error;
    }

    success = false;
    const errorMessage = getToolErrorMessage(error);
    logger.error(
      { tool: name, request_id: requestId, error: errorMessage },
      'Tool execution failed'
    );

    return toToolErrorResult(name, error, requestId);
  } finally {
    logRequest(name, args, Date.now() - start, success, requestId);
  }
}
