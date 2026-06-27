#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { runStdio } from './server.js';
import { runHttp, isLoopbackHost } from './http-server.js';
import { config } from './config.js';
import { createModuleLogger } from './logger.js';

const logger = createModuleLogger('main');

const HELP = `metronorth-mcp — Metro-North MCP server

Usage:
  metronorth-mcp [options]

By default the server speaks the MCP stdio transport (for Cursor, Claude Code,
Codex and other MCP clients). Pass --http to expose an opt-in Streamable HTTP
endpoint on loopback instead.

Options:
  --http                    Enable the HTTP transport (default: stdio).
  --host <host>             HTTP bind address (default: 127.0.0.1).
  --port <port>             HTTP port (default: 8000).
  --token <token>           Require "Authorization: Bearer <token>" on /mcp.
  --allowed-hosts <list>    Comma-separated Host allow-list (DNS-rebind protection).
  --allowed-origins <list>  Comma-separated Origin allow-list (DNS-rebind protection).
  --help                    Show this help and exit.

Environment fallbacks (CLI flags take precedence):
  MCP_HTTP, MCP_HTTP_HOST, MCP_HTTP_PORT, MCP_HTTP_TOKEN,
  MCP_HTTP_ALLOWED_HOSTS, MCP_HTTP_ALLOWED_ORIGINS
`;

function parseList(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : undefined;
}

async function main() {
  try {
    const { values } = parseArgs({
      options: {
        http: { type: 'boolean' },
        host: { type: 'string' },
        port: { type: 'string' },
        token: { type: 'string' },
        'allowed-hosts': { type: 'string' },
        'allowed-origins': { type: 'string' },
        help: { type: 'boolean' },
      },
      allowPositionals: false,
    });

    if (values.help) {
      process.stdout.write(HELP);
      return;
    }

    // CLI flags override environment configuration.
    const httpEnabled = values.http ?? config.MCP_HTTP;

    if (!httpEnabled) {
      await runStdio();
      return;
    }

    const host = values.host ?? config.MCP_HTTP_HOST;

    // Reject an empty --port explicitly; Number('') === 0 would silently bind an
    // ephemeral port. An explicit `--port 0` (the string "0") stays valid.
    if (values.port !== undefined && values.port.trim() === '') {
      throw new Error('Invalid --port value: port must not be empty');
    }
    const port = values.port !== undefined ? Number(values.port) : config.MCP_HTTP_PORT;
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error(`Invalid --port value: ${values.port ?? String(config.MCP_HTTP_PORT)}`);
    }

    const token = values.token ?? config.MCP_HTTP_TOKEN;

    // Fail closed: a non-loopback bind without a token would be world-reachable
    // and unauthenticated. Refuse to start instead.
    if (!isLoopbackHost(host) && !token) {
      logger.fatal(
        { host },
        'Refusing to bind the HTTP transport to a non-loopback address without a token. ' +
          'Set --token (or MCP_HTTP_TOKEN) to require Bearer auth before exposing it.'
      );
      process.exit(1);
    }

    const allowedHosts = parseList(values['allowed-hosts']) ?? config.MCP_HTTP_ALLOWED_HOSTS;
    const allowedOrigins = parseList(values['allowed-origins']) ?? config.MCP_HTTP_ALLOWED_ORIGINS;

    // runHttp returns a handle; the long-running process ignores it (shutdown is
    // driven by the SIGINT/SIGTERM handlers registered inside runHttp).
    await runHttp({ host, port, token, allowedHosts, allowedOrigins });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
    logger.fatal(
      code !== undefined ? { error: message, code } : { error: message },
      'Failed to start server'
    );
    process.exit(1);
  }
}

void main();
