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
import { toolDefinitions, handleToolCall } from './tools/index.js';
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

const logger = createModuleLogger('server');

export class MetroNorthMCPServer {
  private server: Server;
  private isShuttingDown: boolean = false;

  constructor() {
    this.server = new Server(
      {
        name: 'metronorth-mcp',
        version: '2.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
      }
    );

    this.setupHandlers();
    this.setupShutdownHandlers();
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: toolDefinitions,
      };
    });

    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return {
        resources: resourceDefinitions,
      };
    });

    this.server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
      return {
        resourceTemplates: resourceTemplateDefinitions,
      };
    });

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      return handleReadResource(request.params.uri);
    });

    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      return {
        prompts: promptDefinitions,
      };
    });

    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      return handleGetPrompt(request.params.name, request.params.arguments || {});
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (!toolDefinitions.some((t) => t.name === name)) {
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }

      try {
        const result = await handleToolCall(name, args || {});
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ tool: name, error: message }, 'Tool execution error');

        throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${message}`);
      }
    });
  }

  private setupShutdownHandlers(): void {
    const shutdown = async (signal: string) => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;

      logger.info({ signal }, 'Shutting down server');

      try {
        await shutdownCache();
        closeDatabase();
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

  async initialize(): Promise<void> {
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

  async run(): Promise<void> {
    await this.initialize();

    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    logger.info('Metro-North MCP Server running on stdio');
  }
}

// Main entry point
export async function startServer(): Promise<void> {
  const server = new MetroNorthMCPServer();
  await server.run();
}
