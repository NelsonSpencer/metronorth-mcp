import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ToolDomainError } from './errors.js';

function asStructuredContent(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { value };
}

export function toToolResult(result: unknown): CallToolResult {
  const structuredContent = asStructuredContent(result);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(structuredContent, null, 2),
      },
    ],
    structuredContent,
  };
}

export function getToolErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function toToolErrorResult(
  name: string,
  error: unknown,
  requestId?: string
): CallToolResult {
  const errorMessage = getToolErrorMessage(error);
  const errorCode = error instanceof ToolDomainError ? error.code : 'tool_error';

  return {
    content: [
      {
        type: 'text',
        text: `Error: ${errorMessage}`,
      },
    ],
    structuredContent: {
      error: {
        code: errorCode,
        message: errorMessage,
        tool: name,
        ...(requestId ? { request_id: requestId } : {}),
        ...(error instanceof ToolDomainError && error.details ? error.details : {}),
      },
    },
    isError: true,
  };
}
