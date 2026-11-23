# OAuth MCP Gateway Design

## Intent

Expose the student's completed TOEFL Primary test information to an MCP client
without giving that client a way to start, alter, submit, or inspect a live
attempt. Authentication must use the application's existing OpenID Connect
issuer so a client can discover and complete the standard OAuth authorization
flow rather than requiring a copied bearer token.

## Goals

- Run an independent HTTP MCP gateway at `POST /mcp`.
- Publish RFC 9728 protected-resource metadata and challenge unauthenticated
  calls with its `resource_metadata` URL.
- Point OAuth discovery to the configured OIDC issuer. The MCP client obtains
  its authorization-code/PKCE token directly from that issuer, then presents
  the JWT to the gateway.
- Forward that JWT only to this application's REST API, which remains the
  sole verifier and owner of student authorization.
- Provide a small, explicit, read-only tool set for published tests and
  completed-attempt history, results, and review.

## Non-goals

- No local OAuth account, token store, token signing key, refresh-token store,
  or database migration.
- No MCP tool for starting or running an attempt, saving answers, claiming
  media playback, submitting, or administering tests.
- No attempt to make a token issued by another issuer acceptable to the API.

## Architecture

`packages/mcp` is an Express process using the MCP SDK's stateless Streamable
HTTP server transport. It owns protocol parsing, DNS-rebinding/origin checks,
OAuth resource metadata, and conversion of API failures into MCP-safe errors.
It never imports `@pp/db` or server services.

The gateway needs `MCP_PUBLIC_ORIGIN`, `MCP_AUTHORIZATION_SERVER`, and
`API_BASE_URL`. `MCP_AUTHORIZATION_SERVER` is the bare OIDC issuer URL (for
example `https://auth-dev.icovn.me`); its discovery document supplies the
authorization and token endpoints. The client registration and redirect URI
are therefore managed by the selected MCP client and issuer, not by this
gateway. The deployment must ensure that this issuer accepts the MCP client's
registration method (dynamic registration or an administrator-registered
client).

For each MCP request, a fresh server and HTTP transport are created. The
gateway forwards `Authorization: Bearer <JWT>` to `/api/...`; a `401` becomes
an RFC 9728 challenge and no API response body, token, or upstream URL is
returned to the client.

## Tool surface

| MCP tool | API operation | Constraints |
| --- | --- | --- |
| `list_published_tests` | `GET /api/tests` | optional page cursor and limit |
| `get_test_details` | `GET /api/tests/{slug}` | no questions or choices |
| `list_finished_attempts` | `GET /api/attempts` | finished/submitted/expired only |
| `get_attempt_result` | `GET /api/attempts/{id}/result` | completed attempts only |
| `get_attempt_review` | `GET /api/attempts/{id}/review` | completed attempts only |

Tool argument schemas reject unknown properties. Tool results are JSON text
and are capped before sending so an unexpectedly large review cannot make a
protocol response unbounded.

## Security constraints

- Require HTTPS for non-loopback public/API/issuer origins.
- Reject a mismatched `Host`, and reject browser `Origin` values outside the
  public origin plus `MCP_ALLOWED_ORIGINS`.
- Accept bearer JWT syntax only; do not log token values.
- Allow only `POST /mcp`; `GET` and `DELETE` respond `405` with `Allow: POST`.
- Reject JSON-RPC batches and cap request bodies at 256 KiB.
- Keep the bearer out of the request passed to the SDK transport.

## Approaches considered

1. Embed MCP in the Nest application. Rejected: protocol transport and OAuth
   edge concerns would share the student API process and make its routes less
   auditable.
2. Separate stateless gateway using the existing OIDC issuer. Selected: it
   matches the reference repository while preserving the API as the authority
   for JWT verification and data access.
3. Gateway-issued opaque tokens backed by a new database table. Rejected: it
   duplicates the issuer's OAuth flow and adds token persistence and API trust
   changes without a requirement those systems cannot meet.
