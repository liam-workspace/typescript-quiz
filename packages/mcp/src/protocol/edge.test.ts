import { describe, expect, it, vi } from "vitest"
import { type GatewayConfig } from "../config.js"
import { createOriginGuard, extractBearer, sendChallenge } from "./edge.js"
import { protectedResourceMetadata, resourceMetadataUrl } from "./metadata.js"

const config: GatewayConfig = {
  publicOrigin: "https://mcp.example.test",
  authorizationServer: "https://auth.example.test",
  apiBaseUrl: "https://api.example.test",
  port: 3100,
  apiTimeoutMs: 10_000,
  allowedOrigins: ["https://claude.ai"],
}

function response() {
  const result = {
    status: vi.fn(),
    setHeader: vi.fn(),
    json: vi.fn(),
    end: vi.fn(),
  }
  result.status.mockReturnValue(result)
  result.setHeader.mockReturnValue(result)
  result.json.mockReturnValue(result)
  return result
}

describe("MCP protocol edge", () => {
  it("publishes the existing issuer as its authorization server", () => {
    expect(protectedResourceMetadata(config)).toEqual({
      resource: "https://mcp.example.test/mcp",
      authorization_servers: ["https://auth.example.test"],
      bearer_methods_supported: ["header"],
    })
    expect(resourceMetadataUrl(config)).toBe(
      "https://mcp.example.test/.well-known/oauth-protected-resource",
    )
  })

  it("refuses mismatched hosts and browser origins", () => {
    const guard = createOriginGuard(config)
    const denied = response()
    const next = vi.fn()
    guard(
      { headers: { host: "evil.example.test" } } as never,
      denied as never,
      next,
    )
    expect(denied.status).toHaveBeenCalledWith(403)
    expect(next).not.toHaveBeenCalled()

    const allowed = response()
    guard(
      {
        headers: { host: "MCP.EXAMPLE.TEST", origin: "https://claude.ai" },
      } as never,
      allowed as never,
      next,
    )
    expect(next).toHaveBeenCalledOnce()
  })

  it("rejects malformed bearers with an RFC 9728 challenge", () => {
    const result = response()
    sendChallenge(result as never, config)
    expect(result.status).toHaveBeenCalledWith(401)
    expect(result.setHeader).toHaveBeenCalledWith(
      "WWW-Authenticate",
      'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource"',
    )
    expect(extractBearer("Bearer not-a-jwt")).toBeUndefined()
    expect(extractBearer("Bearer aaa.bbb.ccc")).toBe("aaa.bbb.ccc")
  })
})
