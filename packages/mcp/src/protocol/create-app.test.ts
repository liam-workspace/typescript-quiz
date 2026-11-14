import request from "supertest"
import { describe, expect, it } from "vitest"
import type { GatewayConfig } from "../config.js"
import { createGatewayApp } from "./create-app.js"

const config: GatewayConfig = {
  publicOrigin: "https://mcp.example.test",
  authorizationServer: "https://auth.example.test",
  apiBaseUrl: "https://api.example.test",
  port: 3100,
  apiTimeoutMs: 10_000,
  allowedOrigins: [],
}

describe("createGatewayApp", () => {
  it("serves protected-resource discovery and only accepts POST for MCP", async () => {
    const app = createGatewayApp(config)
    await request(app)
      .get("/.well-known/oauth-protected-resource")
      .expect(200)
      .expect("Content-Type", /json/)
      .expect(({ body }) =>
        expect(body.authorization_servers).toEqual([
          config.authorizationServer,
        ]),
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
})
