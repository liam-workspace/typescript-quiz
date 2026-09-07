import { existsSync } from "node:fs"
import request from "supertest"
import type { App } from "supertest/types.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createTestApp, type TestApp } from "./helpers/app.js"

// This test only makes sense against the real HTTP server with the SPA files
// present alongside it -- something only `SPA_ROOT` (set by the Docker image,
// see main.ts) provides. The unit-test harness never builds packages/app, so
// outside Docker this suite is genuinely un-runnable and MUST skip rather
// than report a false pass or a false failure.
const spaRoot = process.env.SPA_ROOT
const describeIfSpaBuilt =
  spaRoot && existsSync(spaRoot) ? describe : describe.skip

describeIfSpaBuilt("SPA serving", () => {
  let app: TestApp | undefined = undefined

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app?.close()
  })

  it("serves the SPA shell at /", async () => {
    if (!app) {
      throw new Error("Application failed to initialize")
    }

    const res = await request(app.http.getHttpServer() as App)
      .get("/")
      .expect(200)
    expect(res.text).toContain('<div id="root">')
  })

  it("serves the SAME SPA shell for a client-side route, not a 404", async () => {
    if (!app) {
      throw new Error("Application failed to initialize")
    }

    const res = await request(app.http.getHttpServer() as App)
      .get("/library")
      .expect(200)
    expect(res.text).toContain('<div id="root">')
  })

  it("keeps the API reachable under /api, not shadowed by the SPA fallback", async () => {
    if (!app) {
      throw new Error("Application failed to initialize")
    }

    await request(app.http.getHttpServer() as App)
      .get("/api/tests")
      .expect(401)
  })

  it("still answers /health outside the /api prefix", async () => {
    if (!app) {
      throw new Error("Application failed to initialize")
    }

    await request(app.http.getHttpServer() as App)
      .get("/health")
      .expect(200)
  })
})
