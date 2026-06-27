# Governance

`metronorth-mcp` uses maintainer-led governance.

## Maintainer Authority

Maintainers decide project scope, release timing, dependency policy, issue triage, and whether a contribution is merged. Community input is welcome, but merge and release decisions stay with maintainers.

## Project Scope

The default project is a local stdio MCP server for public Metro-North schedule, realtime, and alert data. The project does not operate a shared hosted endpoint or provide an SLA.

## Decision Principles

- Keep the default transport local and simple.
- Preserve read-only MCP behavior unless a write capability is explicitly designed and reviewed.
- Prefer public, keyless MTA data sources.
- Keep dependency risk small and explain accepted scanner findings in documentation.
- Support Node.js 22 or newer unless maintainers update the package engines and release notes.

## Releases

Releases are cut by maintainers. Versioned changes should be reflected in `CHANGELOG.md`, and release candidates should pass the documented local checks before publishing.
