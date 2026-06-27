# Socket Triage

This project is a local stdio MCP server. Triage Socket findings by whether the dependency path is installed only, exercised during install, exercised by local stdio runtime, or exposed by a deployment wrapper outside the default project.

## Expected Network Access

Default runtime access is outbound only:

- `https://rrgtfsfeeds.s3.amazonaws.com/gtfsmnr.zip`
- `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/mnr%2Fgtfs-mnr`
- `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fall-alerts`

The default server does not listen on an HTTP port. npm install may contact the npm registry and package artifact hosts. Redis network access occurs only when `REDIS_URL` is configured.

## Accepted Constraints

### `better-sqlite3`

`better-sqlite3` is an accepted direct dependency. It provides the local SQLite database used for imported GTFS data and cache tables.

Accepted native/install behavior:

- Native module install for supported Node platforms.
- `prebuild-install` fetching a prebuilt binary when available.
- Local compilation when a prebuilt binary is unavailable.
- Install-time `tar-stream` through `better-sqlite3 -> prebuild-install -> tar-fs -> tar-stream`.

The `tar-stream` path is install-time package handling, not runtime extraction of untrusted MTA feed data.

Accepted SQLite PRAGMAs:

- `journal_mode = WAL`
- `synchronous = NORMAL`
- `cache_size = 10000`
- `temp_store = MEMORY`

These PRAGMAs are local database performance settings. The project does not expose a raw SQL MCP tool.

### MCP SDK Transitive Packages

`@modelcontextprotocol/sdk` currently brings transitive packages including `@hono/node-server`, `express`, `range-parser`, `ajv`, and `cross-spawn`.

The default `metronorth-mcp` entrypoint uses stdio transport. The SDK HTTP server path is not exercised by normal local stdio usage. In that default path, `@hono/node-server`, `range-parser`, `ajv`, and `cross-spawn` are SDK transitive packages that are installed but not exercised by the server entrypoint.

### `pino` and `real-require`

`real-require` is present through `pino` and `thread-stream`. This is accepted as a logging transitive dependency for structured local logging.

### Remediated `glob` Through `gtfs-realtime-bindings`

`glob@8` was previously pulled by `gtfs-realtime-bindings -> protobufjs-cli -> glob`.

Remediation: `metronorth-mcp` now uses a local GTFS-Realtime decoder backed by direct `protobufjs` runtime decoding. `gtfs-realtime-bindings`, `protobufjs-cli`, and `glob` should not appear in the production dependency graph.

## Review Rules

- Do not waive new findings silently. Record why the package is installed and whether stdio runtime exercises it.
- Prefer upgrades or dependency removal when a finding affects runtime code.
- Re-check `npm ls` paths after dependency changes.
- Keep this document current when accepted constraints change.
