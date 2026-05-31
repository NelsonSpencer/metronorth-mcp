# Metro-North MCP Server

MCP server for Metro-North schedules, stations, service alerts, and real-time departures.

Uses public MTA GTFS and GTFS-Realtime feeds. Runs locally over MCP stdio.

## Features

- Search Metro-North stations by name
- Get upcoming departures for a station
- View trip details and route schedules
- Check current service alerts
- Read station metadata and served routes
- Check local data freshness and feed availability
- Expose MCP tools, resources, and prompts

## Data Sources

Uses public MTA feeds. No MTA API key required.

| Data | Source | Local handling |
| --- | --- | --- |
| Static schedules | MTA Metro-North GTFS ZIP | Downloaded and cached in SQLite |
| Real-time trip updates | MTA GTFS-Realtime feed | Fetched on demand and cacheable |
| Service alerts | MTA alerts feed | Fetched on demand and cacheable |

## Available Tools

Tool results include readable text and MCP `structuredContent`. Invalid inputs and unknown stations return structured errors.

| Tool | Use |
| --- | --- |
| `search_stations` | Search stations by name |
| `get_departures` | Get upcoming departures from a station |
| `get_trip_details` | Get stop-level details for a trip |
| `get_route_schedule` | Get a route schedule by date and direction |
| `get_service_alerts` | Get current service alerts |
| `get_station_info` | Get station metadata and served routes |
| `get_system_status` | Check feed availability and local data freshness |

### Examples

Search stations:

```json
{
  "query": "White Plains",
  "limit": 5
}
```

Get departures:

```json
{
  "station_name": "Grand Central",
  "direction": "outbound",
  "limit": 5,
  "include_realtime": true
}
```

Get trip details:

```json
{
  "trip_id": "example-trip-id",
  "include_realtime": true
}
```

Get a route schedule:

```json
{
  "route_name": "Hudson",
  "date": "2026-06-01",
  "direction": "inbound"
}
```

Get service alerts:

```json
{
  "route_name": "Harlem"
}
```

Get station info:

```json
{
  "station_name": "Croton-Harmon"
}
```

Check system status:

```json
{}
```

## MCP Resources and Prompts

Read-only resources:

- `metronorth://system/status`
- `metronorth://routes`
- `metronorth://stations`
- `metronorth://station/{station_name}`

Prompt templates:

- `plan-metro-north-trip`
- `summarize-service-status`

Tools handle dynamic lookups. Resources expose reference data. Prompts provide reusable workflows.

## Quick Start

### Prerequisites

- Node.js 20+
- npm

### Install and Build

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

First run downloads the public Metro-North GTFS ZIP and imports it into SQLite.

## MCP Client Setup

Run from GitHub:

```bash
npx -y --package github:NelsonSpencer/metronorth-mcp metronorth-mcp
```

Use `metronorth` as the server name.

### Cursor

[Install in Cursor](cursor://anysphere.cursor-deeplink/mcp/install?name=metronorth&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIi0tcGFja2FnZSIsImdpdGh1YjpOZWxzb25TcGVuY2VyL21ldHJvbm9ydGgtbWNwIiwibWV0cm9ub3J0aC1tY3AiXSwiZW52Ijp7Ik5PREVfRU5WIjoicHJvZHVjdGlvbiIsIkxPR19MRVZFTCI6Indhcm4ifX0%3D)

Restart Cursor after installing.

### Codex

```bash
codex mcp add metronorth -- npx -y --package github:NelsonSpencer/metronorth-mcp metronorth-mcp
codex mcp list
```

Restart Codex after installing.

### Claude Code

```bash
claude mcp add metronorth -- npx -y --package github:NelsonSpencer/metronorth-mcp metronorth-mcp
claude mcp list
```

Run `/mcp` in Claude Code to confirm the server is connected.

### VS Code

```bash
code --add-mcp '{"name":"metronorth","command":"npx","args":["-y","--package","github:NelsonSpencer/metronorth-mcp","metronorth-mcp"]}'
```

Open Copilot Chat in Agent mode and enable the server from the tools picker.

### OpenClaw

```bash
openclaw mcp set metronorth '{"command":"npx","args":["-y","--package","github:NelsonSpencer/metronorth-mcp","metronorth-mcp"]}'
openclaw mcp list
```

Restart OpenClaw after installing.

### Hermes

```bash
hermes mcp add metronorth --command npx --args -y --package github:NelsonSpencer/metronorth-mcp metronorth-mcp
hermes mcp test metronorth
```

Restart Hermes, or reload MCP servers with `/reload-mcp`.

### Claude Desktop, Cline, Roo Code, Windsurf, And Other MCP Clients

Use this server entry:

```json
{
  "command": "npx",
  "args": ["-y", "--package", "github:NelsonSpencer/metronorth-mcp", "metronorth-mcp"]
}
```

If the client expects a full MCP config file:

```json
{
  "mcpServers": {
    "metronorth": {
      "command": "npx",
      "args": ["-y", "--package", "github:NelsonSpencer/metronorth-mcp", "metronorth-mcp"]
    }
  }
}
```

Restart or reload MCP servers after editing config.

### Agent Install Prompt

For agent-assisted setup:

```text
Install the Metro-North MCP server in this client as "metronorth".
Use command "npx" with args ["-y", "--package", "github:NelsonSpencer/metronorth-mcp", "metronorth-mcp"].
After installing, reload MCP servers and test it by calling search_stations with query "Grand Central".
```

### Docker

```bash
docker build -t metronorth-mcp .
```

MCP client config:

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

Create `.env` from `.env.example`.

```env
NODE_ENV=development
LOG_LEVEL=info
REDIS_URL=
DB_PATH=
GTFS_UPDATE_INTERVAL_HOURS=24
CACHE_TTL_SECONDS=300
```

Redis is optional. If `REDIS_URL` is empty, the server falls back to local in-memory caching.

If `DB_PATH` is empty, schedule data is stored in `~/.cache/metronorth-mcp/metronorth.db`.

## Development

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

Run smoke checks:

```bash
npm run smoke
npm run smoke:mcp
```

Other scripts:

```bash
npm run dev
npm run gtfs:update
npm run db:migrate
```

## Docker Compose

Docker Compose starts the MCP server with Redis and persistent storage.

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

## Design Notes

MCP surface:

- Tools handle dynamic questions like departures, alerts, route schedules, and station matching.
- Resources expose read-only reference data like routes, stations, and system status.
- Prompts provide repeatable workflows for trip planning and service-status summaries.

Static schedules are downloaded from public MTA GTFS feeds and stored locally in SQLite. Real-time data is fetched from public GTFS-Realtime feeds and should be treated as best-effort context rather than a guarantee.

## Project Status

Unofficial project using public MTA feeds. Not affiliated with or endorsed by the MTA.

## License

MIT. See `LICENSE`.
