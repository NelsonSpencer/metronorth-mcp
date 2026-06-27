# HTTP Transport Reference

`metronorth-mcp` speaks the local stdio MCP transport by default. Passing `--http`
instead exposes an opt-in [Streamable HTTP](https://modelcontextprotocol.io/docs/concepts/transports)
endpoint so any remote MCP host or assistant that speaks Streamable HTTP can reach the
server. stdio remains the default; existing stdio MCP clients are unaffected.

The endpoint is a generic Streamable HTTP MCP server with no host-specific code. This
stays a local, user-run capability, not a maintainer-operated endpoint. See
[GOVERNANCE.md](https://github.com/NelsonSpencer/metronorth-mcp/blob/main/GOVERNANCE.md)
and [SECURITY.md](https://github.com/NelsonSpencer/metronorth-mcp/blob/main/SECURITY.md)
for the project model.

## Quick start

```bash
metronorth-mcp --http
# serves http://127.0.0.1:8000/mcp

metronorth-mcp --http --port 9000 --token SECRET
# env equivalents:
MCP_HTTP=1 MCP_HTTP_PORT=9000 MCP_HTTP_TOKEN=SECRET metronorth-mcp --http
```

The server speaks plain HTTP on loopback and does **not** terminate TLS. HTTPS and
outside reachability come from whatever fronts it: a local tunnel, or a reverse proxy if
you self-host.

## Flags and environment variables

CLI flags take precedence over the `MCP_HTTP*` environment variables.

| Flag                       | Environment variable       | Default          | Purpose                                                      |
| -------------------------- | -------------------------- | ---------------- | ------------------------------------------------------------ |
| `--http`                   | `MCP_HTTP`                 | `false` (stdio)  | Enable the HTTP transport.                                   |
| `--host <host>`            | `MCP_HTTP_HOST`            | `127.0.0.1`      | Bind address. Never defaults to `0.0.0.0`.                   |
| `--port <port>`            | `MCP_HTTP_PORT`            | `8000`           | Listen port (integer `0`–`65535`).                           |
| `--token <token>`          | `MCP_HTTP_TOKEN`           | unset            | Require `Authorization: Bearer <token>` on every `/mcp` call.|
| `--allowed-hosts <list>`   | `MCP_HTTP_ALLOWED_HOSTS`   | loopback names   | Comma-separated `Host` allow-list (DNS-rebind protection).   |
| `--allowed-origins <list>` | `MCP_HTTP_ALLOWED_ORIGINS` | unset            | Comma-separated `Origin` allow-list (DNS-rebind protection). |
| `--help`                   | —                          | —                | Print usage and exit.                                        |

Notes:

- `MCP_HTTP` is truthy for `1`, `true`, `yes`, or `on`.
- `--allowed-hosts` / `--allowed-origins` accept a comma-separated list; blank entries are
  ignored. When `--allowed-hosts` is unset, the default allow-list is `127.0.0.1`,
  `localhost`, `127.0.0.1:<port>`, and `localhost:<port>`.
- `--allowed-origins` defaults to unset, because non-browser MCP clients often send no
  `Origin` header.

## Endpoints

| Method           | Path      | Auth          | Behavior                                                                 |
| ---------------- | --------- | ------------- | ------------------------------------------------------------------------ |
| `POST`           | `/mcp`    | bearer if set | Send a JSON-RPC message. An `initialize` request opens a new session.    |
| `GET`            | `/mcp`    | bearer if set | Open the server-to-client SSE stream for an existing session.            |
| `DELETE`         | `/mcp`    | bearer if set | End an existing session.                                                  |
| `GET`            | `/health` | none          | Liveness probe. Returns `200 {"status":"ok"}`.                           |

Error responses use terse JSON bodies and never leak stack traces:

| Status | Body                              | When                                                            |
| ------ | --------------------------------- | --------------------------------------------------------------- |
| `401`  | `{"error":"unauthorized"}`        | A token is configured and the `Authorization` header is missing or wrong. |
| `404`  | `{"error":"not_found"}`           | Path is neither `/mcp` nor `/health`.                           |
| `404`  | `{"error":"session_not_found"}`   | `GET` / `DELETE /mcp` with an unknown `mcp-session-id`.         |
| `400`  | `{"error":"invalid_request"}`     | Request body is not valid JSON.                                 |
| `400`  | `{"error":"invalid_session"}`     | `POST /mcp` with no session that is not an `initialize` request.|
| `405`  | `{"error":"method_not_allowed"}`  | Unsupported HTTP method for the path.                           |
| `413`  | `{"error":"payload_too_large"}`   | Request body exceeds the 1 MiB cap.                             |
| `500`  | `{"error":"internal_server_error"}` | Unexpected server error (details are logged, not returned).   |

## Session model

- The transport generates a session id (`randomUUID`) when a client sends an `initialize`
  request. The id is returned in the `mcp-session-id` response header.
- Clients pass `mcp-session-id` on subsequent `POST`, `GET`, and `DELETE` requests; the
  server routes each request to the matching session transport.
- A fresh MCP server instance is created per session. The Metro-North data layer
  (SQLite + GTFS cache) is initialized once per process and shared across sessions.
- Closing a session (client `DELETE`, transport close, or process shutdown) removes it from
  the in-memory session map. `SIGINT` / `SIGTERM` close the HTTP server and all sessions,
  then run the standard cache/database cleanup.

## Security model

This transport follows the security guidance in the
[MCP Streamable HTTP transport specification](https://modelcontextprotocol.io/docs/concepts/transports):
bind to loopback, validate `Host` / `Origin` to defeat DNS rebinding, and authenticate even
on localhost.

- **Loopback bind.** The default bind address is `127.0.0.1`; the server never binds
  `0.0.0.0` by default. To expose it, front it with a tunnel or reverse proxy rather than
  widening the bind address.
- **No TLS.** Loopback traffic is plaintext. HTTPS is terminated by the tunnel or proxy in
  front of the server, never by `metronorth-mcp` itself.
- **DNS-rebinding protection.** The SDK's DNS-rebinding protection is enabled with an
  explicit `Host` allow-list (it is off in the SDK unless an allow-list is set). The default
  list covers loopback names. A tunnel that rewrites the `Host` header can widen it via
  `--allowed-hosts` / `MCP_HTTP_ALLOWED_HOSTS`; an `Origin` allow-list is configurable via
  `--allowed-origins` / `MCP_HTTP_ALLOWED_ORIGINS`.
- **Optional bearer token.** When `--token` (or `MCP_HTTP_TOKEN`) is set, every `/mcp`
  request must send `Authorization: Bearer <token>`; the comparison is constant-time. When
  no token is set, the server logs a prominent warning that the transport is unauthenticated.
  Set a token for any exposure beyond loopback. `/health` is intentionally unauthenticated so
  tunnels and proxies can probe liveness.
- **Body cap and timeouts.** Request bodies are capped at 1 MiB (`413` beyond that). The
  HTTP server sets a 30s request timeout and a 20s headers timeout as cheap abuse mitigation.
  Full rate limiting is out of scope for a single-user local bridge.
- **No detail leakage.** Errors are logged server-side and returned as generic JSON; stack
  traces and error messages are never sent to clients.

### Self-hosting caveat

Hosting this behind a public HTTPS URL is outside the default project model. If you run it
that way, you own the wrapper's security: terminate TLS, require a bearer token, restrict the
`Host` / `Origin` allow-lists to what your proxy actually sends, add rate limiting, and keep
the deployment private. See
[SECURITY.md](https://github.com/NelsonSpencer/metronorth-mcp/blob/main/SECURITY.md).

## Connecting remote MCP hosts

Because the endpoint is a generic Streamable HTTP MCP server, it works with any remote MCP
host or assistant that speaks Streamable HTTP. [Poke](https://poke.com) is one such host;
others exist now and more will emerge. The examples below use Poke only to make the two
connection shapes concrete.

### 1. Local tunnel (no hosting)

Run the server locally and let the host tunnel into the loopback URL:

```bash
metronorth-mcp --http
# then, with your chosen host's tunnel command — for example:
npx poke@latest tunnel http://localhost:8000/mcp -n "metronorth"
```

The tunnel provides the public HTTPS hop; the server stays bound to loopback. If the tunnel
presents a `Host` the default allow-list rejects (a `403`), widen it with `--allowed-hosts`.

### 2. Remote URL (self-host behind HTTPS)

If you run the server behind your own HTTPS proxy, give the host the public `https://…/mcp`
URL plus a bearer token / API key. With Poke, for example, add it at
`poke.com/settings/connections/integrations/new`. Always set `--token` for this shape.

Other assistants and hosts connect the same way: a tunnel to the loopback URL, or a
self-hosted HTTPS URL with a token.
