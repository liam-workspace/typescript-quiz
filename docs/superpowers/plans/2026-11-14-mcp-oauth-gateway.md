# OAuth MCP Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone Streamable HTTP MCP gateway that uses the current OIDC issuer and provides only safe, read-only student data tools.

**Architecture:** `@pp/mcp` owns the MCP protocol, RFC 9728 discovery, request validation, and an allowlisted REST adapter. It forwards client-issued OIDC bearer JWTs to `@pp/server`, which remains the authority for authentication and student ownership. A new process, rather than a Nest module, follows the reference architecture and isolates protocol concerns.

**Tech Stack:** Node 24, TypeScript, Express 5, `@modelcontextprotocol/sdk`, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-14-mcp-oauth-gateway-design.md`

## Global Constraints

- The gateway is a `packages/mcp` workspace package and must not import `@pp/db` or `@pp/server`.
- `MCP_PUBLIC_ORIGIN`, `MCP_AUTHORIZATION_SERVER`, and `API_BASE_URL` are required bare origins; HTTPS is required unless loopback.
- Only the five read-only tools named in the design may be listed.
- Never log, return, or put a bearer token in a URL.
- API `401` responses become an RFC 9728 reauthorization challenge.
- Requests are limited to `POST /mcp`, 256 KiB JSON bodies, and no JSON-RPC batches.

## Review Focus

- A valid-looking token rejected by the API must produce a challenge, not leak the API's body; covered by Task 3's gateway test.
- A DNS-rebinding `Host` or untrusted browser `Origin` must be refused before parsing/calling the API; covered by Task 2's edge tests.
- An unknown tool or unknown argument must not reach the API; covered by Task 4's MCP-server tests.
- Cursor values must be URL encoded and an API base URL path must not be bypassed; covered by Task 4's REST adapter test.
- A completed-attempt review larger than the output cap must be a safe tool error; covered by Task 4's result-cap test.

---

### Task 1: Workspace package and validated gateway configuration

**Files:**
- Create: `packages/mcp/package.json`
- Create: `packages/mcp/tsconfig.json`
- Create: `packages/mcp/src/config.ts`
- Test: `packages/mcp/src/config.test.ts`

**Interfaces:**
- Produces `GatewayConfig` and `loadGatewayConfig(env): GatewayConfig`.
- Consumes environment values `MCP_PUBLIC_ORIGIN`, `MCP_AUTHORIZATION_SERVER`, `API_BASE_URL`, optional `MCP_PORT`, `MCP_API_TIMEOUT_MS`, and `MCP_ALLOWED_ORIGINS`.

- [ ] **Step 1: Write configuration tests**

Assert required bare origins, HTTPS-or-loopback validation, numeric ranges, comma-separated allowed origins, and default `port: 3100` / `apiTimeoutMs: 10_000`.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pnpm --filter @pp/mcp test -- config.test.ts`
Expected: FAIL because `config.ts` does not exist.

- [ ] **Step 3: Add the package setup and implement `loadGatewayConfig`**

Use immutable validated values and exact environment-variable names from the design. Do not read `process.env` outside `loadGatewayConfigFromProcess()`.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `pnpm --filter @pp/mcp test -- config.test.ts`
Expected: PASS.

### Task 2: OAuth metadata and HTTP security edge

**Files:**
- Create: `packages/mcp/src/protocol/metadata.ts`
- Create: `packages/mcp/src/protocol/edge.ts`
- Test: `packages/mcp/src/protocol/edge.test.ts`

**Interfaces:**
- Consumes `GatewayConfig`.
- Produces `protectedResourceMetadata(config)`, `resourceMetadataUrl(config)`, `createOriginGuard(config)`, and `sendChallenge(res, config)`.

- [ ] **Step 1: Write edge tests**

Assert both well-known metadata paths return the public `/mcp` resource and configured authorization server; mismatched hosts and origins get `403`; malformed/absent bearer gets the RFC 9728 `WWW-Authenticate` header.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pnpm --filter @pp/mcp test -- edge.test.ts`
Expected: FAIL because the protocol modules do not exist.

- [ ] **Step 3: Implement metadata and edge helpers**

Use case-insensitive host matching and never retain/log token contents. The authorization server is the configured bare issuer URL.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `pnpm --filter @pp/mcp test -- edge.test.ts`
Expected: PASS.

### Task 3: Stateless Streamable HTTP application

**Files:**
- Create: `packages/mcp/src/protocol/create-app.ts`
- Create: `packages/mcp/src/main.ts`
- Test: `packages/mcp/src/protocol/create-app.test.ts`

**Interfaces:**
- Consumes `GatewayConfig`, `createOriginGuard`, `sendChallenge`, and `buildMcpServer` from Task 4.
- Produces `createGatewayApp(config): Express` and a process entrypoint that listens on `config.port`.

- [ ] **Step 1: Write application tests**

Assert `GET`/`DELETE /mcp` return `405` with `Allow: POST`, batches return JSON-RPC invalid-request errors, oversized/invalid JSON errors are safe, and an API `401` during initialization returns the resource-metadata challenge.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pnpm --filter @pp/mcp test -- create-app.test.ts`
Expected: FAIL because `createGatewayApp` does not exist.

- [ ] **Step 3: Implement the request-scoped Streamable HTTP transport**

Create one SDK server/transport per request with JSON responses and remove `authorization` before passing headers to the SDK. Close both on response close.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `pnpm --filter @pp/mcp test -- create-app.test.ts`
Expected: PASS.

### Task 4: Read-only API adapter and MCP tools

**Files:**
- Create: `packages/mcp/src/api/client.ts`
- Create: `packages/mcp/src/protocol/mcp-server.ts`
- Test: `packages/mcp/src/protocol/mcp-server.test.ts`

**Interfaces:**
- Consumes a `GatewayConfig`, a bearer string, and the API paths in the design.
- Produces `createApiClient(config, bearer)`, `buildMcpServer(scope)`, and exactly five tools.

- [ ] **Step 1: Write tool tests**

Assert `tools/list` exposes precisely the five read-only tool names, each schema rejects unknown arguments, calls send the bearer upstream, a `401` marks reauthorization, and large API results return a bounded tool error.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pnpm --filter @pp/mcp test -- mcp-server.test.ts`
Expected: FAIL because the API adapter and MCP server do not exist.

- [ ] **Step 3: Implement allowlisted REST calls and request handlers**

Use `Server`, `ListToolsRequestSchema`, and `CallToolRequestSchema`; encode only declared path/query parameters and map expected API errors to non-sensitive tool text. Do not implement generic URL or HTTP-method arguments.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `pnpm --filter @pp/mcp test -- mcp-server.test.ts`
Expected: PASS.

### Task 5: Workspace commands and operator documentation

**Files:**
- Modify: `package.json:5-23`
- Modify: `README.md:39-102`
- Modify: `compose.yml:1-77`

**Interfaces:**
- Consumes the built `@pp/mcp` package and the deployment configuration from Tasks 1-4.
- Produces root `dev:mcp` / `start:mcp` commands and documented environment/compose service settings.

- [ ] **Step 1: Add command and deployment expectation tests where configuration is machine-readable**

Add assertions to the nearest gateway configuration/application test that `MCP_PUBLIC_ORIGIN` and `API_BASE_URL` remain required, so documentation does not become an insecure default.

- [ ] **Step 2: Implement scripts and docs**

Run the gateway separately from the API in development and compose; document that the configured issuer must accept the MCP client's OAuth registration/redirect flow.

- [ ] **Step 3: Verify production build and focused gateway tests**

Run: `pnpm --filter @pp/mcp build && pnpm --filter @pp/mcp test`
Expected: PASS.

- [ ] **Step 4: Verify the repository gates**

Run: `pnpm typecheck && pnpm test`
Expected: PASS, or report pre-existing failures by test name.
