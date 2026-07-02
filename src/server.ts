import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { toolDefinitions, handleToolCall, createRequestContext } from './tools/index.js';
import { promptDefinitions, handleGetPrompt } from './prompts.js';
import {
  handleReadResource,
  resourceDefinitions,
  resourceTemplateDefinitions,
} from './resources.js';
import { getDatabase, closeDatabase } from './infrastructure/database.js';
import { getGTFSLoader } from './infrastructure/gtfs-loader.js';
import { shutdownCache } from './infrastructure/cache.js';
import { createModuleLogger } from './logger.js';
import { getServerInfo } from './package-metadata.js';

const logger = createModuleLogger('server');

/**
 * Build a fully-wired, transport-agnostic MCP {@link Server}.
 *
 * Request handlers are stateless — all process state lives in the database and
 * cache singletons — so a fresh server can be created cheaply per transport or
 * per HTTP session. No process-level shutdown hooks are registered here.
 */
export function createMcpServer(): Server {
  const server = new Server(getServerInfo(), {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
    },
  });

  setupHandlers(server);

  return server;
}

function setupHandlers(server: Server): void {
  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: toolDefinitions,
    };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: resourceDefinitions,
    };
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    return {
      resourceTemplates: resourceTemplateDefinitions,
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    return handleReadResource(request.params.uri);
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
      prompts: promptDefinitions,
    };
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    return handleGetPrompt(request.params.name, request.params.arguments || {});
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const context = createRequestContext();

    if (!toolDefinitions.some((t) => t.name === name)) {
      logger.warn({ tool: name, request_id: context.requestId }, 'Unknown tool requested');
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }

    try {
      const result = await handleToolCall(name, args || {}, context);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        { tool: name, request_id: context.requestId, error: message },
        'Tool execution error'
      );

      throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${message}`);
    }
  });
}

/**
 * Initialize process-wide data: open the database and refresh GTFS static data
 * if it is stale. Idempotent — run once per process before serving traffic on
 * any transport.
 */
export async function initializeData(): Promise<void> {
  logger.info('Initializing Metro-North MCP Server');

  // Initialize database
  getDatabase();

  // Check if GTFS data needs updating
  const loader = getGTFSLoader();
  try {
    if (await loader.needsUpdate()) {
      logger.info('GTFS data is stale, updating...');
      await loader.updateStaticData();
    }
  } catch (error) {
    logger.warn({ error }, 'Failed to update GTFS data, using existing data');
  }

  logger.info('Server initialized');
}

/**
 * Release shared process resources (cache + database). Safe to call once during
 * shutdown.
 */
export async function cleanup(): Promise<void> {
  await shutdownCache();
  closeDatabase();
}

let isShuttingDown = false;
let shutdownHandlersRegistered = false;
let registeredBeforeCleanup: (() => Promise<void>) | undefined;

/**
 * Register SIGINT/SIGTERM handlers that release shared resources and exit.
 *
 * Idempotent: the process-level signal listeners are registered only once, so
 * calling this more than once does not stack duplicate handlers. The most
 * recent `beforeCleanup` hook is the one that runs on shutdown.
 *
 * @param beforeCleanup optional hook (e.g. close an HTTP listener) run before
 *   the shared cache/database cleanup.
 */
export function setupShutdownHandlers(beforeCleanup?: () => Promise<void>): void {
  registeredBeforeCleanup = beforeCleanup;

  if (shutdownHandlersRegistered) {
    return;
  }
  shutdownHandlersRegistered = true;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info({ signal }, 'Shutting down server');

    try {
      if (registeredBeforeCleanup) {
        await registeredBeforeCleanup();
      }
      await cleanup();
      logger.info('Cleanup complete');
    } catch (error) {
      logger.error({ error }, 'Error during shutdown');
    }

    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

/**
 * Run the server over the stdio transport (the default for MCP clients such as
 * Cursor, Claude Code and Codex).
 */
export async function runStdio(): Promise<void> {
  setupShutdownHandlers();

  await initializeData();

  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('Metro-North MCP Server running on stdio');
}

/**
 * Back-compat alias retained for existing imports/tests.
 * @deprecated use {@link runStdio} instead.
 */
export async function startServer(): Promise<void> {
  await runStdio();
}
