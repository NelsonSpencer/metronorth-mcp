#!/usr/bin/env node

import { handleToolCall } from '../build/tools/index.js';
import { closeDatabase } from '../build/infrastructure/database.js';

async function callTool(name, args) {
  const result = await handleToolCall(name, args);
  const text = result.content[0]?.text ?? '';

  if (text.startsWith('Error:')) {
    throw new Error(`${name} failed: ${text}`);
  }

  return JSON.parse(text);
}

async function main() {
  try {
    const stationSearch = await callTool('search_stations', {
      query: 'Grand Central',
      limit: 3,
    });

    const stationInfo = await callTool('get_station_info', {
      station_name: 'Grand Central',
    });

    const departures = await callTool('get_departures', {
      station_name: 'Grand Central',
      direction: 'outbound',
      limit: 3,
      include_realtime: false,
    });

    const status = await callTool('get_system_status', {});

    const hasGrandCentral = stationSearch.results?.some((station) =>
      station.name.toLowerCase().includes('grand central')
    );
    if (!hasGrandCentral) {
      throw new Error('Grand Central was not found in station search results.');
    }

    if (!stationInfo.station?.routes?.length) {
      throw new Error('Grand Central station info did not include served routes.');
    }

    if (!departures.departures?.length) {
      throw new Error(
        'No outbound departures found from Grand Central. Run npm run gtfs:update and try again.'
      );
    }

    const allDeparturesPointToGrandCentral = departures.departures.every(
      (departure) => departure.destination === 'Grand Central'
    );
    if (allDeparturesPointToGrandCentral) {
      throw new Error('Outbound departures from Grand Central all point back to Grand Central.');
    }

    if (!status.gtfs_data || Number(status.gtfs_data.stops) === 0) {
      throw new Error('GTFS status reports no cached station data.');
    }

    console.log('Metro-North MCP smoke check passed.');
    console.log(`Stations cached: ${status.gtfs_data.stops}`);
    console.log(`Trips cached: ${status.gtfs_data.trips}`);
    console.log(
      `Sample outbound destinations: ${departures.departures
        .map((departure) => departure.destination)
        .join(', ')}`
    );

  } finally {
    closeDatabase();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
