import pino from 'pino';
import { config } from './config.js';
import { packageMetadata } from './package-metadata.js';

// MCP uses stdout for JSON-RPC, so logs must go to stderr
export const logger = pino({
  level: config.LOG_LEVEL,
  transport:
    config.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
            destination: 2, // stderr
          },
        }
      : {
          target: 'pino/file',
          options: { destination: 2 }, // stderr
        },
  base: {
    service: packageMetadata.name,
    version: packageMetadata.version,
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
});

// Child loggers for different modules
export const createModuleLogger = (module: string) =>
  logger.child({ module });

// Request logging helper
export const logRequest = (
  tool: string,
  params: Record<string, unknown>,
  duration: number,
  success: boolean,
  requestId?: string
) => {
  logger.info({
    type: 'tool_request',
    request_id: requestId,
    tool,
    params,
    duration_ms: duration,
    success,
  });
};

// Error logging helper
export const logError = (
  context: string,
  error: unknown,
  extra?: Record<string, unknown>
) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  logger.error({
    type: 'error',
    context,
    error: errorMessage,
    stack,
    ...extra,
  });
};

export default logger;
