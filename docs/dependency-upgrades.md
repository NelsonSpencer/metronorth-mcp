# Dependency Upgrades

Use this checklist when changing dependencies.

## Supported Runtime

- Node.js 22 or newer is the supported runtime.
- Keep `package.json` engines, README runtime notes, and release notes aligned when runtime support changes.
- Native dependency upgrades should be checked on at least one clean install path.

## Routine Checks

Run:

```bash
npm install
npm run typecheck
npm test
npm run lint
npm run build
npm run smoke:mcp
npm audit --omit=dev --audit-level=high
```

For scanner-driven changes, also run targeted `npm ls <package>` checks and update [socket-triage.md](socket-triage.md) when the dependency path changes.

## Native SQLite

`better-sqlite3` is expected and accepted. When upgrading it:

- Confirm the package supports Node.js 22 or newer.
- Confirm npm can install a prebuilt binary or compile locally.
- Re-test startup so the local database initializes and PRAGMAs apply.

## MCP SDK

`@modelcontextprotocol/sdk` may bring HTTP/server packages that are not exercised by the default stdio transport. After SDK upgrades, re-check whether transitive findings are still install-only, stdio-runtime, or HTTP-wrapper concerns.

## Remediated Cleanup

`gtfs-realtime-bindings` previously pulled `protobufjs-cli` and `glob@8` into the production dependency graph. This project now uses direct `protobufjs` runtime decoding with a committed GTFS-Realtime schema module.

After dependency changes, verify the old chain stays removed:

```bash
npm ls gtfs-realtime-bindings protobufjs-cli glob --omit=dev
```
