# Metro-North MCP Server

Metro-North MCP is a Model Context Protocol server that lets AI assistants answer practical Metro-North questions using public MTA schedule and real-time feeds.

It exposes tools for station search, upcoming departures, trip details, route schedules, service alerts, and local data freshness. The server runs over MCP stdio, caches schedule data in SQLite, and can optionally use Redis for shared caching.

## Why I Built This

I built this as a focused integration project: take a real public data source, turn it into a reliable local service, and expose it through an AI-native interface. It demonstrates the kind of work I enjoy most: connecting messy real-world data, workflow context, and practical automation into something useful.

## What This Demonstrates

- MCP server design with TypeScript and stdio transport
- Public GTFS and GTFS-Realtime feed integration
- Local schedule caching with SQLite
- Optional Redis-backed caching
- Input validation for AI-callable tools
- Tests, typechecking, linting, Docker support, and CI

## Data Sources

This project uses public MTA feeds and does not require an MTA API key.

| Data | Source | Local handling |
| --- | --- | --- |
| Static schedules | MTA Metro-North GTFS ZIP | Downloaded and cached in SQLite |
| Real-time trip updates | MTA GTFS-Realtime feed | Fetched on demand and cacheable |
| Service alerts | MTA alerts feed | Fetched on demand and cacheable |

## Available Tools

### `search_stations`

Search for Metro-North stations by name.

```json
{
  "query": "White Plains",
  "limit": 5
}
```

Example result shape:

```json
{
  "query": "White Plains",
  "results": [
    {
      "stop_id": "place_WP",
      "name": "White Plains",
      "zone": "4"
    }
  ],
  "total": 1
}
```

### `get_departures`

Get upcoming departures from a station.

```json
{
  "station_name": "Grand Central",
  "direction": "outbound",
  "limit": 5,
  "include_realtime": true
}
```

Example result shape:

```json
{
  "station": "Grand Central",
  "departures": [
    {
      "route": "Hudson",
      "destination": "Poughkeepsie",
      "scheduled": "17:42",
      "actual": "17:47",
      "delay": "5 min late",
      "status": "delayed",
      "upcoming_stops": ["Harlem-125th Street", "Yankees-E 153rd Street"],
      "trip_id": "example-trip-id"
    }
  ],
  "realtime_available": true
}
```

### `get_trip_details`

Get detailed stop information for a specific trip.

```json
{
  "trip_id": "example-trip-id",
  "include_realtime": true
}
```

### `get_route_schedule`

Get a route schedule for a date and direction.

```json
{
  "route_name": "Hudson",
  "date": "2026-06-01",
  "direction": "inbound"
}
```

### `get_service_alerts`

Get current service alerts, optionally filtered by route or station.

```json
{
  "route_name": "Harlem"
}
```

### `get_station_info`

Get station metadata and served routes.

```json
{
  "station_name": "Croton-Harmon"
}
```

### `get_system_status`

Check server status, local GTFS freshness, cached stop/trip counts, and real-time availability.

```json
{}
```

## Quick Start

### Prerequisites

- Node.js 20+
- npm

### Install And Build

```bash
git clone https://github.com/NelsonSpencer/metronorth-mcp.git
cd metronorth-mcp
npm install
cp .env.example .env
npm run build
```

### Run Locally

```bash
npm start
```

On first startup, the server checks whether local GTFS schedule data is available. If not, it downloads the public Metro-North GTFS ZIP and imports it into SQLite.

## MCP Client Setup

### Claude Desktop

After building the project, add this to your Claude Desktop configuration:

```json
{
  "mcpServers": {
    "metronorth": {
      "command": "node",
      "args": ["/absolute/path/to/metronorth-mcp/build/index.js"]
    }
  }
}
```

### Docker

```bash
docker build -t metronorth-mcp .
```

Then configure an MCP client to run:

```json
{
  "mcpServers": {
    "metronorth": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "metronorth-mcp"]
    }
  }
}
```

## Configuration

Create a `.env` file from `.env.example`.

```env
NODE_ENV=development
LOG_LEVEL=info
REDIS_URL=
DB_PATH=./db/metronorth.db
GTFS_UPDATE_INTERVAL_HOURS=24
CACHE_TTL_SECONDS=300
```

Redis is optional. If `REDIS_URL` is empty, the server falls back to local in-memory caching.

## Development

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

After loading GTFS data with `npm run gtfs:update`, run a real-data smoke check:

```bash
npm run smoke
```

Useful scripts:

```bash
npm run dev
npm run gtfs:update
npm run db:migrate
```

## Docker Compose

Docker Compose starts the MCP server with Redis and persistent volumes for local GTFS data and SQLite.

```bash
docker-compose up -d
docker-compose logs -f metronorth-mcp
```

## Architecture

```text
MCP client
  -> stdio transport
  -> TypeScript MCP server
  -> validated tool handlers
  -> schedule, station, and realtime services
  -> public MTA GTFS / GTFS-Realtime feeds
  -> local SQLite cache
  -> optional Redis cache
```

## Project Status

This is a proof-of-work project, not an official MTA product. It is intended to show a practical AI-native integration pattern using public transit data and MCP.

## License

MIT. See `LICENSE`.
