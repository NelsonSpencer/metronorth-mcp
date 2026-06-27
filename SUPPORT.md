# Support

`metronorth-mcp` is an unpaid OSS project maintained on a best-effort basis.

## What Is Supported

- The latest published npm version.
- Local stdio MCP usage on Node.js 22 or newer.
- Public MTA GTFS, GTFS-Realtime, and alert feed integration.
- Native `better-sqlite3` installs on common supported Node platforms. If a local build fails, install on Node.js 22 or 24 LTS, where prebuilt binaries are published.

## What Is Not Supported

- A maintainer-operated hosted endpoint.
- Uptime, latency, incident response, or transit-data accuracy SLAs.
- Third-party HTTP wrappers, tunnels, or public deployments you operate.
- Private MTA data sources or non-public APIs.

## Getting Help

Open a GitHub issue with:

- Package version and Node.js version.
- MCP client and install command.
- Relevant logs with secrets removed.
- Whether the issue affects install, startup, a specific tool call, or feed freshness.

Security issues should follow [SECURITY.md](SECURITY.md), not public support issues.
