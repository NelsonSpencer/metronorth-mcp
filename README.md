# Metro-North MCP Server

[![CI](https://github.com/NelsonSpencer/metronorth-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/NelsonSpencer/metronorth-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/metronorth-mcp)](https://www.npmjs.com/package/metronorth-mcp)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node.js 20+](https://img.shields.io/badge/node-%3E%3D20-339933.svg)

MCP server for Metro-North schedules, stations, service alerts, and real-time departures.

Uses public MTA GTFS and GTFS-Realtime feeds. No MTA API key required.

## Install with an Agent

Paste this into your MCP-capable coding agent:

```text
Install the Metro-North MCP server in this client as "metronorth".
Use command "npx" with args ["-y", "metronorth-mcp"].
After installing, reload MCP servers and test it by calling search_stations with query "Grand Central".
```

## Install

```bash
npx -y metronorth-mcp
```

GitHub install:

```bash
npx -y --package github:NelsonSpencer/metronorth-mcp metronorth-mcp
```

Use `metronorth` as the MCP server name.

## MCP Client Setup

### Cursor

Copy and open this deeplink:

```text
cursor://anysphere.cursor-deeplink/mcp/install?name=metronorth&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIm1ldHJvbm9ydGgtbWNwIl19
```

Manual `.cursor/mcp.json` config:

```json
{
  "mcpServers": {
    "metronorth": {
      "command": "npx",
      "args": ["-y", "metronorth-mcp"]
    }
  }
}
```

### Codex

```bash
codex mcp add metronorth -- npx -y metronorth-mcp
codex mcp list
```

### Claude Code

```bash
claude mcp add metronorth -- npx -y metronorth-mcp
claude mcp list
```

Run `/mcp` in Claude Code to confirm the server is connected.

### VS Code

```bash
code --add-mcp '{"name":"metronorth","command":"npx","args":["-y","metronorth-mcp"]}'
```

Open Copilot Chat in Agent mode and enable the server from the tools picker.

### OpenClaw

```bash
openclaw mcp set metronorth '{"command":"npx","args":["-y","metronorth-mcp"]}'
openclaw mcp list
```

### Hermes

```bash
hermes mcp add metronorth --command npx --args -y metronorth-mcp
hermes mcp test metronorth
```

Restart or reload MCP servers after installing.

### Other MCP Clients

Use this server entry:

```json
{
  "command": "npx",
  "args": ["-y", "metronorth-mcp"]
}
```

Full MCP config:

```json
{
  "mcpServers": {
    "metronorth": {
      "command": "npx",
      "args": ["-y", "metronorth-mcp"]
    }
  }
}
```

## Tools

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

Example:

```json
{
  "station_name": "Grand Central",
  "direction": "outbound",
  "limit": 5,
  "include_realtime": true
}
```

## Resources and Prompts

Resources:

- `metronorth://system/status`
- `metronorth://routes`
- `metronorth://stations`
- `metronorth://station/{station_name}`

Prompts:

- `plan-metro-north-trip`
- `summarize-service-status`

## Local Development

```bash
git clone https://github.com/NelsonSpencer/metronorth-mcp.git
cd metronorth-mcp
npm install
cp .env.example .env
npm run build
npm start
```

First run downloads the public Metro-North GTFS ZIP and imports it into SQLite.

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

If `DB_PATH` is empty, schedule data is stored in `~/.cache/metronorth-mcp/metronorth.db`.

Redis is optional. If `REDIS_URL` is empty, the server uses in-memory caching.

## Development Checks

```bash
npm run typecheck
npm test
npm run lint
npm run build
npm run smoke:mcp
```

## Docker

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

Docker Compose starts the MCP server with Redis and persistent storage.

```bash
docker-compose up -d
docker-compose logs -f metronorth-mcp
```

## Additional Notes

- Static schedules are cached locally from public MTA GTFS feeds.
- Real-time departures and alerts use public GTFS-Realtime feeds and are best-effort.
- Tools handle dynamic lookups; resources expose reference data; prompts provide reusable workflows.
- Unofficial project. Not affiliated with or endorsed by the MTA.

## License

MIT. See `LICENSE`.
