#!/usr/bin/env node

import { startServer } from './server.js';
import { createModuleLogger } from './logger.js';

const logger = createModuleLogger('main');

async function main() {
  try {
    await startServer();
  } catch (error) {
    logger.fatal({ error }, 'Failed to start server');
    process.exit(1);
  }
}

main();
