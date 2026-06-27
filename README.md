# Metro-North MCP Server

[![CI](https://github.com/NelsonSpencer/metronorth-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/NelsonSpencer/metronorth-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/metronorth-mcp)](https://www.npmjs.com/package/metronorth-mcp)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node.js 22+](https://img.shields.io/badge/node-%3E%3D22-339933.svg)

MCP server for Metro-North schedules, stations, service alerts, and real-time departures.

Uses public MTA GTFS and GTFS-Realtime feeds. No MTA API key required.

This package runs as a local stdio MCP server by default. The project does not operate or publish a shared hosted MCP endpoint.

## Project Model

- Local stdio MCP server; no maintainer-operated hosted endpoint, uptime commitment, or SLA.
- Unofficial project; not affiliated with or endorsed by the MTA.
- Best-effort public MTA schedule, realtime, and alert data.
- Node.js 22 or newer is required. Current development expects npm and the native `better-sqlite3` install path to work on the target machine.

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

## Agent Usage

This server exposes usage guidance through MCP:

- Read `metronorth://usage` for the recommended station, trip-planning, alert, and freshness workflow.
- Read `metronorth://examples` for common tool-call examples.
- Use the `use-metro-north-mcp` prompt when an agent needs a quick operating guide.

Recommended flow:

1. Search stations first when names may be partial or ambiguous.
2. Use `plan_metro_north_trip` for station-to-station questions.
3. Use `get_station_pair_schedule` for direct train options between two stations.
4. Use `get_first_last_trains` for first/last train questions.
5. Read `metronorth://system/status` when data freshness matters.
6. Treat realtime departures and alerts as best-effort public feed data.

## Tools

Tool results include readable text and MCP `structuredContent`. Invalid inputs and unknown stations return structured errors.

| Tool                        | Use                                                    |
| --------------------------- | ------------------------------------------------------ |
| `search_stations`           | Search stations by name                                |
| `get_departures`            | Get upcoming departures from a station                 |
| `get_trip_details`          | Get stop-level details for a trip                      |
| `get_route_schedule`        | Get a route schedule by date and direction             |
| `get_service_alerts`        | Get current service alerts                             |
| `get_station_info`          | Get station metadata and served routes                 |
| `get_system_status`         | Check feed availability and local data freshness       |
| `get_station_pair_schedule` | Find direct trains between two stations                |
| `get_first_last_trains`     | Get first and last direct trains for a service date    |
| `plan_metro_north_trip`     | Plan a direct trip with options, alerts, and freshness |

Example:

```json
{
  "origin_station": "Grand Central",
  "destination_station": "White Plains",
  "limit": 3,
  "include_alerts": true
}
```

## Resources and Prompts

Resources:

- `metronorth://usage`
- `metronorth://examples`
- `metronorth://system/status`
- `metronorth://routes`
- `metronorth://stations`
- `metronorth://station/{station_name}`

Prompts:

- `use-metro-north-mcp`
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

## Runtime Requirements

- Node.js `>=22.0.0`.
- `better-sqlite3` uses a native SQLite binding. npm usually installs a prebuilt binary; if one is unavailable for your platform, npm may compile it locally. If a local build fails (for example on a very new Node release or a platform without build tooling), install on Node.js 22 or 24 LTS, where prebuilt binaries are published.
- The local database defaults to `~/.cache/metronorth-mcp/metronorth.db` and uses SQLite PRAGMAs for WAL mode, normal sync, cache size, and in-memory temp storage.
- Redis is optional and only used when `REDIS_URL` is set.

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

## Network Access

Default runtime network access is outbound only:

- Static GTFS ZIP: `https://rrgtfsfeeds.s3.amazonaws.com/gtfsmnr.zip`
- Metro-North GTFS-Realtime trips: `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/mnr%2Fgtfs-mnr`
- MTA alerts: `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fall-alerts`

npm install may also contact the npm registry and package artifact hosts. The default stdio server does not listen on a network port.

## Transport and Hosting

The public install path is local stdio:

```bash
npx -y metronorth-mcp
```

Do not point strangers at a maintainer-owned hosted URL unless you intentionally want to operate a public service. If you wrap this server with HTTP for a personal tool, bind it to localhost by default, require bearer-token authentication before exposing it beyond localhost, and keep tunnel URLs private. The built-in `--http` transport described below follows exactly this posture.

## Remote / HTTP transport

`metronorth-mcp` speaks the local stdio transport by default. Passing `--http` instead exposes an opt-in Streamable HTTP endpoint, so any remote MCP host or assistant that speaks Streamable HTTP can reach the server. stdio stays the default; nothing about the existing `npx -y metronorth-mcp` install path or any stdio MCP client changes.

```bash
metronorth-mcp --http
# serves http://127.0.0.1:8000/mcp
```

The server speaks plain HTTP on loopback and does not terminate TLS. HTTPS and outside reachability come from whatever fronts it: a local tunnel, or a reverse proxy if you self-host. This stays a local, user-run capability, not a maintainer-operated endpoint.

### Flags and environment variables

CLI flags take precedence over the `MCP_HTTP*` environment variables.

| Flag                       | Environment variable       | Default          | Purpose                                                          |
| -------------------------- | -------------------------- | ---------------- | ---------------------------------------------------------------- |
| `--http`                   | `MCP_HTTP`                 | `false` (stdio)  | Enable the HTTP transport.                                       |
| `--host <host>`            | `MCP_HTTP_HOST`            | `127.0.0.1`      | Bind address. Keep it on loopback unless you front it.           |
| `--port <port>`            | `MCP_HTTP_PORT`            | `8000`           | Listen port.                                                     |
| `--token <token>`          | `MCP_HTTP_TOKEN`           | unset            | Require `Authorization: Bearer <token>` on `/mcp`.              |
| `--allowed-hosts <list>`   | `MCP_HTTP_ALLOWED_HOSTS`   | loopback names   | Comma-separated `Host` allow-list (DNS-rebind protection).       |
| `--allowed-origins <list>` | `MCP_HTTP_ALLOWED_ORIGINS` | loopback origins | Comma-separated `Origin` allow-list (DNS-rebind protection). Header-less clients still pass. |

`MCP_HTTP` accepts `1`, `true`, `yes`, or `on`. Run `metronorth-mcp --help` for the same summary.

### Endpoints

- `POST` / `GET` / `DELETE` `/mcp` — the Streamable HTTP MCP endpoint. A session is negotiated on the `initialize` request and carried in the `mcp-session-id` header.
- `GET /health` — unauthenticated liveness probe returning `{"status":"ok"}`, for tunnels and proxies.

### Connecting a remote MCP host

The endpoint is a generic Streamable HTTP MCP server with no host-specific code, so it works with any remote MCP host or assistant that speaks Streamable HTTP. [Poke](https://poke.com) is one such host; others exist now and more will emerge. The two connection shapes below use Poke only as a worked example.

1. **Local tunnel (no hosting).** Run the server locally, then point the host's tunnel at `http://localhost:8000/mcp`:

   ```bash
   metronorth-mcp --http
   # then, with your chosen host's tunnel command — for example:
   npx poke@latest tunnel http://localhost:8000/mcp -n "metronorth"
   ```

2. **Remote URL (self-host behind HTTPS).** If you run the server behind your own HTTPS proxy, give the host your `https://…/mcp` URL plus a bearer token / API key. With Poke, for example, add it at `poke.com/settings/connections/integrations/new`.

Other assistants and hosts connect the same way: a tunnel to the loopback URL, or a self-hosted HTTPS URL with a token.

### Security

The transport binds `127.0.0.1` by default and enables DNS-rebinding protection. It fails closed: binding a non-loopback address (for example `--host 0.0.0.0`) without a token is refused at startup. Set `--token` (or `MCP_HTTP_TOKEN`) for any exposure beyond loopback, and keep tunnel URLs and tokens private. See [SECURITY.md](SECURITY.md) and the full [HTTP transport reference](https://github.com/NelsonSpencer/metronorth-mcp/blob/main/docs/http-transport.md).

## Development Checks

```bash
npm run typecheck
npm test
npm run lint
npm run build
npm run smoke:mcp
npm audit --omit=dev --audit-level=high
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

## Community Documents

- [Support](SUPPORT.md)
- [Governance](GOVERNANCE.md)
- [Security](SECURITY.md)
- [HTTP transport reference](https://github.com/NelsonSpencer/metronorth-mcp/blob/main/docs/http-transport.md)
- [Dependency upgrades](https://github.com/NelsonSpencer/metronorth-mcp/blob/main/docs/dependency-upgrades.md)
- [Socket triage](https://github.com/NelsonSpencer/metronorth-mcp/blob/main/docs/socket-triage.md)
- [Changelog](CHANGELOG.md)

## License

MIT. See `LICENSE`.
