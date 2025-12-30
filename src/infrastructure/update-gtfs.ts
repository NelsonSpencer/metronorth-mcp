#!/usr/bin/env node

/**
 * Script to manually update GTFS static data
 * Run with: npm run gtfs:update
 */

import { getGTFSLoader } from './gtfs-loader.js';
import { getDatabase, closeDatabase } from './database.js';
import { createModuleLogger } from '../logger.js';

const logger = createModuleLogger('update-gtfs');

async function main() {
  logger.info('Starting GTFS update');

  try {
    // Initialize database
    getDatabase();

    // Get loader and force update
    const loader = getGTFSLoader();
    await loader.updateStaticData(true);

    logger.info('GTFS update completed successfully');
  } catch (error) {
    logger.error({ error }, 'GTFS update failed');
    process.exit(1);
  } finally {
    closeDatabase();
  }
}

main();
