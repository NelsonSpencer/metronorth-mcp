# AGENTS.md

Guidance for AI agents working in this repository.

## Project overview

**Metro-North MCP Server** — a Node.js/TypeScript MCP (Model Context Protocol) server that exposes Metro-North Railroad transit data (stations, schedules, trip planning, alerts) to AI coding agents. It communicates over **stdio only** (no HTTP port). Data comes from public MTA GTFS static feeds (SQLite cache) and GTFS-Realtime feeds.

## Cursor Cloud specific instructions

### Services

| Service | Required | Notes |
| --- | --- | --- |
| Metro-North MCP Server | Yes | Stdio MCP process — spawned by an MCP client or smoke scripts, not a long-running daemon with a port |
| SQLite (embedded) | Yes | File at `~/.cache/metronorth-mcp/metronorth.db` by default; auto-created on first run |
| Redis | No | Optional caching via `REDIS_URL`; defaults to in-memory cache |
| MTA GTFS feeds | Yes (network) | Auto-downloaded on first start if stale; manual refresh: `npm run gtfs:update` |

### One-time setup (not in update script)

On a fresh clone, copy the example env file if `.env` does not exist:

```bash
cp .env.example .env
```

No API keys are required. MTA feeds are public.

### Standard commands

See `package.json` scripts and `README.md` § Development Checks. Quick reference:

| Task | Command |
| --- | --- |
| Install deps | `npm ci` |
| Dev (watch) | `npm run dev` |
| Build | `npm run build` |
| Start (built) | `npm start` |
| Typecheck | `npm run typecheck` |
| Test | `npm test` |
| Lint | `npm run lint` |
| Tool smoke (needs GTFS data) | `npm run smoke` |
| MCP protocol smoke (self-contained) | `npm run smoke:mcp` |
| Force GTFS refresh | `npm run gtfs:update` |

### Gotchas

- **`npm ci` runs `prepare`**, which builds the project automatically. You do not need a separate build after install unless you change source files.
- **First run with real data** downloads ~4 MB GTFS ZIP from MTA and imports into SQLite (~5–10 s). `npm run smoke` requires this data; `npm run smoke:mcp` seeds its own temp DB and does not need network.
- **No listening port** — the server is not a web app. Use `npm run smoke:mcp` or `npm run smoke` to verify end-to-end behavior without an MCP client.
- **Node.js ≥ 20** is required (`engines` in `package.json`).
- **Redis via Docker Compose** (`docker-compose up -d`) is optional and mainly for production-style caching; local dev works fine without it.
