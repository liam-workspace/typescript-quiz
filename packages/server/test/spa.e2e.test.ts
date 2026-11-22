import { existsSync } from "node:fs"
import { cp, mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import request from "supertest"
import type { App } from "supertest/types.js"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
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
  let hiddenSpaRoot = ""

  beforeAll(async () => {
    if (!spaRoot) {
      throw new Error("SPA_ROOT must point at a built SPA")
    }

    // Reproduce hidden ancestors such as .worktrees on every checkout.
    hiddenSpaRoot = await mkdtemp(join(tmpdir(), ".quiz-spa-"))
    await cp(spaRoot, hiddenSpaRoot, { recursive: true })
    vi.stubEnv("SPA_ROOT", hiddenSpaRoot)
    app = await createTestApp()
  })

  afterAll(async () => {
    await app?.close()
    vi.unstubAllEnvs()

    if (hiddenSpaRoot) {
      await rm(hiddenSpaRoot, { recursive: true, force: true })
    }
  })

  it("serves the SPA shell at / from a hidden root directory", async () => {
    if (!app) {
      throw new Error("Application failed to initialize")
    }

    const res = await request(app.http.getHttpServer() as App)
      .get("/")
      .expect(200)
    expect(res.text).toContain('<div id="root">')
  })

  it("serves built JavaScript assets from the same root", async () => {
    if (!app) {
      throw new Error("Application failed to initialize")
    }

    const assets = await readdir(join(hiddenSpaRoot, "assets"))
    const script = assets.find((asset) => asset.endsWith(".js"))
    expect(script).toBeDefined()

    await request(app.http.getHttpServer() as App)
      .get(`/assets/${script}`)
      .expect(200)
      .expect("Content-Type", /javascript/)
  })

  it.each(["/api/missing/path", "/media/missing/path"])(
    "keeps unmatched %s on the normal error response",
    async (path) => {
      if (!app) {
        throw new Error("Application failed to initialize")
      }

      const res = await request(app.http.getHttpServer() as App)
        .get(path)
        .expect(404)
        .expect("Content-Type", /application\/json/)
      expect(res.body).toMatchObject({ statusCode: 404 })
    },
  )

  it("does not serve the SPA shell for a non-GET request", async () => {
    if (!app) {
      throw new Error("Application failed to initialize")
    }

    const res = await request(app.http.getHttpServer() as App)
      .post("/library")
      .expect(404)
      .expect("Content-Type", /application\/json/)
    expect(res.body).toMatchObject({ statusCode: 404 })
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

  it("serves the worker and manifest as real files with revalidation headers", async () => {
    if (!app) {
      throw new Error("Application failed to initialize")
    }

    const sw = await request(app.http.getHttpServer() as App)
      .get("/sw.js")
      .expect(200)
      .expect("Content-Type", /javascript/)
      .expect("Cache-Control", "no-cache")
    expect(sw.text).not.toContain('<div id="root">')

    await request(app.http.getHttpServer() as App)
      .get("/manifest.webmanifest")
      .expect(200)
      .expect("Content-Type", /manifest\+json|application\/json/)
      .expect("Cache-Control", "no-cache")
  })

  it("serves push-sw.js (imported by the worker) as a real script with no-cache", async () => {
    if (!app) {
      throw new Error("Application failed to initialize")
    }

    const res = await request(app.http.getHttpServer() as App)
      .get("/push-sw.js")
      .expect(200)
      .expect("Content-Type", /javascript/)
      .expect("Cache-Control", "no-cache")

    expect(res.text).toContain("notificationclick")
  })

  it("marks the shell no-cache and hashed assets immutable", async () => {
    if (!app) {
      throw new Error("Application failed to initialize")
    }

    await request(app.http.getHttpServer() as App)
      .get("/history")
      .expect(200)
      .expect("Cache-Control", "no-cache")

    const assets = await readdir(join(hiddenSpaRoot, "assets"))
    const script = assets.find((asset) => asset.endsWith(".js"))

    await request(app.http.getHttpServer() as App)
      .get(`/assets/${script}`)
      .expect("Cache-Control", /immutable/)
  })

  it("answers a missing worker file with a JSON 404, never the shell", async () => {
    if (!app) {
      throw new Error("Application failed to initialize")
    }

    const res = await request(app.http.getHttpServer() as App)
      .get("/workbox-doesnotexist.js")
      .expect(404)
      .expect("Content-Type", /application\/json/)
    expect(res.body).toMatchObject({ statusCode: 404 })
  })
})
