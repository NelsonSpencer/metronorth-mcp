# Security Policy

## Supported Versions

Security fixes are handled for the latest published npm version of `metronorth-mcp`.

The supported runtime model is local stdio on Node.js 22 or newer. Maintainers do not operate a shared hosted endpoint for this package.

## Reporting a Vulnerability

Please do not include exploit details, sensitive logs, or private environment values in a public issue.

Preferred reporting path:

1. Use GitHub's private vulnerability reporting or security advisory flow for this repository.
2. If private reporting is unavailable, open a minimal public issue saying that you have a security report to share, without technical details.

Include:

- A short description of the issue and affected version.
- Reproduction steps or a proof of concept, if safe to share privately.
- Whether the issue affects local stdio use, Docker use, or any HTTP wrapper you run separately.

## Scope

This project is an unofficial Metro-North MCP server. Normal use does not require API keys or secrets. It downloads public MTA GTFS and GTFS-Realtime data, stores local SQLite/cache data, and exposes read-only MCP tools.

Hosted HTTP deployments are outside the default project model. If you expose this server through an HTTP wrapper, secure that wrapper with authentication, rate limiting, and private deployment controls.

Expected runtime outbound URLs are documented in [README.md](README.md#network-access). Dependency scanner notes are documented in [docs/socket-triage.md](docs/socket-triage.md).
