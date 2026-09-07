import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import request from "supertest"
import type { App } from "supertest/types.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createTestApp, type TestApp } from "./helpers/app.js"

/**
 * The half neither side's own tests could see. `POST /admin/media` writes a
 * file and a row; `GET /media/:filename` serves a file. Each was tested
 * against its own fixture, so both passed while they disagreed about what a
 * file is called -- uploads landed at `<id>.<placeholder>` while the runner
 * emitted `/media/<the client's name>`. Every signed URL pointed at a file
 * that had never been written.
 *
 * This drives the two halves against EACH OTHER, which is the only way that
 * disagreement is observable.
 */
describe("upload and serve agree on the filename", () => {
  let app: TestApp | undefined = undefined
  let mediaRoot = ""

  beforeAll(async () => {
    mediaRoot = await mkdtemp(join(tmpdir(), "pp-media-rt-"))
    process.env.MEDIA_ROOT = mediaRoot
    app = await createTestApp()
  })
  afterAll(async () => {
    await app?.close()
    await rm(mediaRoot, { recursive: true, force: true })
    delete process.env.MEDIA_ROOT
  })

  it("serves back exactly what an upload stored", async () => {
    if (!app) {
      throw new Error("Application failed to initialize")
    }

    const token = await app.mint({
      sub: "media-roundtrip",
      email: "admin@example.com",
      isAdmin: true,
    })
    const bytes = Buffer.from("round-trip-audio-bytes")

    const uploaded = await request(app.http.getHttpServer() as App)
      .post("/api/admin/media")
      .set("Authorization", `Bearer ${token}`)
      .field("kind", "audio")
      .attach("file", bytes, { filename: "teacher-named-it-this.mp3" })
      .expect(201)

    const { filename } = uploaded.body as { filename: string }

    // Uncapped by any stimulus, so no signature is required -- the point here
    // is reachability, not the cap.
    const served = await request(app.http.getHttpServer() as App)
      .get(`/api/media/${filename}`)
      .expect(200)

    expect(Buffer.from(served.body as Buffer).equals(bytes)).toBe(true)
    // A real extension, so the serving route can pick a Content-Type an
    // <audio> element will actually play.
    expect(served.headers["content-type"]).toContain("audio/mpeg")
  })
})
