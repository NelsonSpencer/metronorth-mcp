import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createModuleLogger, logRequest } from '../logger.js';
import { createToolContext, type ToolContextOverrides } from './context.js';
import { UnknownToolError } from './errors.js';
import { toolHandlers } from './handlers.js';
import { getToolErrorMessage, toToolErrorResult, toToolResult } from './results.js';

const logger = createModuleLogger('tools');

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  contextOverrides: ToolContextOverrides = {}
): Promise<CallToolResult> {
  const start = Date.now();
  let success = true;

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
    logger.error({ tool: name, error: errorMessage }, 'Tool execution failed');

    return toToolErrorResult(name, error);
  } finally {
    logRequest(name, args, Date.now() - start, success);
  }
}
