# Contributing

Thanks for helping improve `metronorth-mcp`.

## Development Setup

Requirements:

- Node.js 22 or newer
- npm

```bash
npm install
cp .env.example .env
npm run build
```

The first run downloads public Metro-North GTFS data and imports it into a local SQLite database.

## Checks

Run these before opening a pull request:

```bash
npm run typecheck
npm test
npm run lint
npm run build
npm run smoke:mcp
npm audit --omit=dev --audit-level=high
```

## Project Boundaries

- Keep the default server transport as local stdio.
- Do not add a shared public hosted MCP URL to documentation.
- Treat MTA GTFS and GTFS-Realtime data as best-effort public feed data.
- Keep tool results read-only unless a change explicitly introduces a reviewed write capability.
- Preserve structured MCP responses when changing tool behavior.

## Pull Requests

PRs should describe:

- User-facing behavior changes.
- Any MCP tool/resource/prompt contract changes.
- Test coverage added or updated.
- Data freshness, caching, or feed assumptions.

If a change affects package publishing, Docker, CI, or dependency security, call that out explicitly.
