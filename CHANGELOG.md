# Changelog

All notable project changes are summarized here.

## 2.2.0 - 2026-07-02

- Surfaced real-time track assignments and human-readable train status by decoding the MTA Railroad GTFS-RT extension (`StopTimeUpdate` field 1005); a `cancelled` train status is treated as authoritative.
- Fixed delay derivation from absolute predicted times: the decoder no longer lets protobuf's `defaults: true` fabricate `StopTimeEvent.delay = 0` for stops where the wire omits `delay`, so trains that report only an absolute time are no longer silently shown as on-time. Explicit wire delays (including `0`) are still respected.
- Added peak / off-peak `fare_class` to fare results.
- Added per-train notes to schedule and trip results.
- Ingested transfers, notes, track, and peak data with a versioned schema migration and a one-time forced GTFS refresh so existing installs backfill the new columns.
- Made west-of-Hudson coverage honest: those lines are reported as `not_covered` and a routes resource documents what the server serves.

## 2.1.4 - 2026-06-27

- Added an opt-in, vendor-neutral Streamable HTTP transport (`--http`) so any remote MCP host or assistant that speaks Streamable HTTP (for example Poke) can connect via a local tunnel or a self-hosted HTTPS URL. stdio remains the default; existing stdio clients are unaffected.
- Kept the transport safe by default: loopback bind (`127.0.0.1`), DNS-rebinding protection with an explicit Host allow-list, optional bearer-token auth, a request-body cap, and request/headers timeouts. Errors return generic JSON without stack traces.
- Added CLI flags (`--http`, `--host`, `--port`, `--token`, `--allowed-hosts`, `--allowed-origins`, `--help`) and `MCP_HTTP*` environment fallbacks; CLI flags take precedence.
- Documented the transport in the README, `.env.example`, and a new `docs/http-transport.md` reference. The capability stays local and user-run; there is still no maintainer-operated hosted endpoint.

## 2.1.3 - 2026-06-27

- Documented deferred major dependency upgrades and added a Dependabot `ignore` rule so major npm bumps are held back deliberately rather than auto-proposed (`.github/dependabot.yml`, `docs/dependency-upgrades.md`).
- Removed an invalid Dependabot `registries` block. `npm-registry` entries require credentials, so the credential-less public-npm pin failed config validation; the public npm registry is already Dependabot's default.
- Added a native-install fallback note (use Node.js 22 or 24 LTS if a `better-sqlite3` build fails) to the README and SUPPORT docs.
- Removed maintainer-internal `docs/` from the published npm tarball; they remain in the repository.
- Added a private Code of Conduct reporting path.

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
