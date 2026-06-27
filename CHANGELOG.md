# Changelog

All notable project changes are summarized here.

## 2.1.2 - 2026-06-27

- Added OSS support, governance, dependency, and Socket triage documentation.
- Documented that the default package is a local stdio MCP server with no maintainer-operated hosted endpoint or SLA.
- Documented Node.js 22 support, native SQLite expectations, and public MTA outbound URLs.
- Replaced `gtfs-realtime-bindings` with direct `protobufjs` GTFS-Realtime decoding to remove the production `protobufjs-cli -> glob@8` dependency path.

## 2.1.1 - 2026-06-27

- Hardened OSS security and release workflow documentation.
- Pinned Dependabot to the public npm registry.
- Kept the package version source of truth aligned across package metadata.

## 2.1.0 - 2026-05-31

- Added Metro-North trip planning tools and MCP agent usage guidance.
- Added system status, metadata, and freshness reporting.
- Hardened dependency tooling, smoke checks, and realtime runtime paths.
