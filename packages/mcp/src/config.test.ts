import { describe, expect, it } from "vitest"
import { loadGatewayConfig } from "./config.js"

const required = {
  MCP_PUBLIC_ORIGIN: "https://mcp.example.test",
  MCP_AUTHORIZATION_SERVER: "https://auth.example.test",
  API_BASE_URL: "https://api.example.test",
}

describe("loadGatewayConfig", () => {
  it("loads required origins and safe defaults", () => {
    expect(loadGatewayConfig(required)).toEqual({
      publicOrigin: "https://mcp.example.test",
      authorizationServer: "https://auth.example.test",
      apiBaseUrl: "https://api.example.test",
      port: 3100,
      bindHost: "127.0.0.1",
      apiTimeoutMs: 10_000,
      allowedOrigins: [],
    })
  })

  it("allows HTTP only for loopback origins and parses optional settings", () => {
    expect(
      loadGatewayConfig({
        ...required,
        MCP_PUBLIC_ORIGIN: "http://localhost:3100",
        API_BASE_URL: "http://127.0.0.1:3000",
        MCP_PORT: "3101",
        MCP_BIND_HOST: "::1",
        MCP_API_TIMEOUT_MS: "1200",
        MCP_ALLOWED_ORIGINS: "https://claude.ai, http://localhost:3001",
      }),
    ).toEqual({
      publicOrigin: "http://localhost:3100",
      authorizationServer: "https://auth.example.test",
      apiBaseUrl: "http://127.0.0.1:3000",
      port: 3101,
      bindHost: "::1",
      apiTimeoutMs: 1200,
      allowedOrigins: ["https://claude.ai", "http://localhost:3001"],
    })
  })

  it.each([
    [{ ...required, MCP_PUBLIC_ORIGIN: "https://mcp.example.test/path" }],
    [{ ...required, MCP_AUTHORIZATION_SERVER: "http://auth.example.test" }],
    [{ ...required, API_BASE_URL: "https://api.example.test/" }],
    [{ ...required, MCP_PORT: "0" }],
    [{ ...required, MCP_API_TIMEOUT_MS: "999" }],
    [{ ...required, MCP_ALLOWED_ORIGINS: "https://allowed.example.test/path" }],
  ])("rejects invalid configuration %#", (env) => {
    expect(() => loadGatewayConfig(env)).toThrow()
  })
})
