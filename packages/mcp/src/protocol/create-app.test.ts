import request from "supertest"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { GatewayConfig } from "../config.js"
import { createGatewayApp } from "./create-app.js"

const config: GatewayConfig = {
  publicOrigin: "https://mcp.example.test",
  authorizationServer: "https://auth.example.test",
  apiBaseUrl: "https://api.example.test",
  port: 3100,
  bindHost: "127.0.0.1",
  apiTimeoutMs: 10_000,
  allowedOrigins: [],
}

describe("createGatewayApp", () => {
  afterEach(() => vi.unstubAllGlobals())
  it("serves protected-resource discovery and only accepts POST for MCP", async () => {
    const app = createGatewayApp(config)
    await request(app)
      .get("/.well-known/oauth-protected-resource")
      .expect(200)
      .expect("Content-Type", /json/)
      .expect(({ body }) =>
        expect(
          (body as { authorization_servers: unknown }).authorization_servers,
        ).toEqual([config.authorizationServer]),
      )
    await request(app).get("/mcp").expect("Allow", "POST").expect(405)
    await request(app).delete("/mcp").expect("Allow", "POST").expect(405)
  })

  it("refuses a request before protocol handling when its host is not public", async () => {
    await request(createGatewayApp(config))
      .post("/mcp")
      .set("Host", "evil.example.test")
      .send({ jsonrpc: "2.0", id: 1, method: "initialize" })
      .expect(403)
  })

  it("challenges an initialize request when the API rejects its bearer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    )
    await request(createGatewayApp(config))
      .post("/mcp")
      .set("Host", "mcp.example.test")
      .set("Authorization", "Bearer aaa.bbb.ccc")
      .send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
      .expect("WWW-Authenticate", /resource_metadata/)
      .expect(401)
  })
})
