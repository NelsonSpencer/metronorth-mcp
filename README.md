# Metro-North MCP Server

A production-grade Model Context Protocol (MCP) server for Metro-North Railroad schedules and real-time data.

## Features

- **Real-time departures**: Get upcoming train departures from any Metro-North station
- **Live status updates**: Track delays and service disruptions
- **Station search**: Fuzzy search for station names
- **Route schedules**: View full schedules for any Metro-North line
- **Service alerts**: Get current service advisories and alerts

> **Note**: This server uses the public MTA API - no API key required!

## Quick Start

### Prerequisites

- Node.js 20+
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/metronorth-mcp.git
cd metronorth-mcp

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Build the project
npm run build

# Start the server
npm start
```

### Configuration

Create a `.env` file with the following options:

```env
# Optional: Redis for distributed caching
REDIS_URL=redis://localhost:6379

# Optional: Custom database path
DB_PATH=./db/metronorth.db
```

No API key is required - the MTA now provides public access to all GTFS feeds.

## MCP Integration

### Claude Desktop

Add to your Claude Desktop configuration (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "metronorth": {
      "command": "node",
      "args": ["/path/to/metronorth-mcp/build/index.js"]
    }
  }
}
```

### Docker

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

## Available Tools

### get_departures

Get upcoming train departures from a station.

```json
{
  "station_name": "Grand Central",
  "direction": "outbound",
  "limit": 5,
  "include_realtime": true
}
```

### get_trip_details

Get detailed information about a specific trip.

```json
{
  "trip_id": "TRAIN_123",
  "include_realtime": true
}
```

### get_route_schedule

Get the full schedule for a Metro-North line.

```json
{
  "route_name": "Hudson",
  "date": "2024-12-25",
  "direction": "inbound"
}
```

### get_service_alerts

Get current service alerts and advisories.

```json
{
  "route_name": "Harlem"
}
```

### search_stations

Search for Metro-North stations by name.

```json
{
  "query": "White Plains",
  "limit": 5
}
```

### get_station_info

Get detailed information about a specific station.

```json
{
  "station_name": "Croton-Harmon"
}
```

### get_system_status

Get the current status of the MCP server.

```json
{}
```

## Development

```bash
# Run in development mode with hot reload
npm run dev

# Run tests
npm test

# Run tests with coverage
npm run test -- --coverage

# Lint code
npm run lint

# Format code
npm run format

# Type check
npm run typecheck
```

## Docker Deployment

```bash
# Build the image
docker build -t metronorth-mcp .

# Run with Docker Compose
docker-compose up -d

# View logs
docker-compose logs -f metronorth-mcp
```

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   MCP Client    │◄──►│  STDIO Transport │◄──►│   TypeScript    │
│ (Claude/Cursor) │    │                  │    │   MCP Server    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                                  │
                                                  ▼
┌─────────────────┐                       ┌─────────────────────────┐
│  GTFS Static    │◄──────┐               │     SQLite Database     │
│  (web.mta.info) │       │               │   (Cached GTFS + RT)    │
└─────────────────┘       │               └─────────────────────────┘
                           │                         │
                           ▼                         ▼
                    ┌─────────────────┐       ┌──────────────────┐
                    │  GTFS Realtime  │       │   Redis Cache    │
                    │  (MTA API Key)  │       │   (Optional)     │
                    └─────────────────┘       └──────────────────┘
```

## Data Sources

| Type | Source | Update Frequency |
|------|--------|------------------|
| Static Schedules | MTA GTFS Feed | Daily |
| Real-time Updates | MTA GTFS-RT API | Every 30s |
| Service Alerts | MTA Alerts Feed | Real-time |

## License

MIT
