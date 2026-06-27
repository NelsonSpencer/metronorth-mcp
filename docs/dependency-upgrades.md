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

## Deferred Major Upgrades

Dependabot batches `minor` and `patch` updates into grouped PRs and holds `major` version
bumps back via an explicit `ignore` rule (see
[`.github/dependabot.yml`](../.github/dependabot.yml)). Note that `update-types` inside a
`groups` block only controls *batching* — on its own it does not stop Dependabot from
opening individual PRs — so the top-level `ignore` rule is what actually defers majors.
Majors are handled deliberately, on their own branch, because they can carry breaking
changes into a published package. This is a stability posture, not an oversight.

The majors currently held back, with the reason each is deferred:

| Package | Held at | Latest major | Why deferred |
| --- | --- | --- | --- |
| `zod` | 3.x | 4.x | Breaking parse/error API; used across tool input schemas. Highest-effort; warrants its own deliberate migration. |
| `zod-validation-error` | 3.x | 5.x | Couples to `zod`; upgrade together with the `zod` 4 migration. |
| `eslint` | 9.x | 10.x | Flat config already in place, so mostly mechanical; low risk when scheduled. |
| `typescript` | 5.x | 6.x | Compiler major; re-run typecheck/build and review new diagnostics. |
| `pino` | 9.x | 10.x | Logging major; re-check structured logging and transport behavior. |
| `@types/node` | 22.x | 26.x | Kept aligned with the supported `engines` Node line (22+). Bump alongside any runtime-floor change. |

When taking on a deferred major, do it on its own branch, run the routine checks above, and
update this table and `CHANGELOG.md`.
