# Contributing

Thanks for helping improve `metronorth-mcp`.

## Development Setup

Requirements:

- Node.js 22 or newer
- npm
- A local environment that can install the native `better-sqlite3` package. If a prebuilt binary is unavailable, npm may need compiler tooling for your platform.

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

## Release Process

Releases are maintainer-led.

1. Confirm the intended version and changelog entry.
2. Run the local checks listed above on Node.js 22 or newer.
3. Update package metadata only as part of the release change.
4. Tag releases as `vX.Y.Z`.
5. Publish through the repository's release/publish path.

Do not document a public hosted MCP endpoint as part of a release unless a maintainer explicitly decides to operate one and defines its support model.

## Dependency and Socket Reviews

- Use [docs/socket-triage.md](https://github.com/NelsonSpencer/metronorth-mcp/blob/main/docs/socket-triage.md) for recurring Socket findings and accepted constraints.
- Use [docs/dependency-upgrades.md](https://github.com/NelsonSpencer/metronorth-mcp/blob/main/docs/dependency-upgrades.md) when planning dependency updates.
- Prefer removing unused transitive dependency paths over adding long-lived allow-list comments.
