import pino from 'pino';
import { config } from './config.js';

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
          },
        }
      : undefined,
  base: {
    service: 'metronorth-mcp',
    version: '2.0.0',
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
  success: boolean
) => {
  logger.info({
    type: 'tool_request',
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
