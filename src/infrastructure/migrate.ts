#!/usr/bin/env node

/**
 * Database migration script
 * Run with: npm run db:migrate
 */

import { getDatabase, closeDatabase } from './database.js';
import { createModuleLogger } from '../logger.js';

const logger = createModuleLogger('migrate');

async function main() {
  logger.info('Running database migrations');

  try {
    // Initialize database (creates schema if needed)
    getDatabase();
    logger.info('Database migrations completed successfully');
  } catch (error) {
    logger.error({ error }, 'Migration failed');
    process.exit(1);
  } finally {
    closeDatabase();
  }
}

main();
