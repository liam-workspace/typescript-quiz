import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PgPool } from "@liam-public/node-postgres"
import { randomUUID } from "node:crypto"
import request from "supertest"
import type { App } from "supertest/types.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { REQUEST_POOL } from "../src/database/tokens.js"
import { signMediaUrl } from "../src/media/media-signing.js"
import { createTestApp, type TestApp } from "./helpers/app.js"

// Must match the secret `test/helpers/app.ts` sets on `process.env` before
// `createTestApp()` compiles `AppModule` -- there is no other way for a
// test to sign a URL the running app will accept.
const MEDIA_SIGNING_SECRET = "test-media-signing-secret"
const NOW = new Date("2026-08-27T10:00:00.000Z")

/**
 * A minimal, UNPUBLISHED content tree -- `isFilenameCapped` reads
 * `stimulus`/`test_section`/`media_asset` directly and never consults
 * `published_at`. `maxPlays: null` on both the section default and the
 * stimulus override produces an UNCAPPED filename; any non-null value on
 * either produces a capped one.
 */
async function insertStimulusMedia(
  pool: PgPool,
  input: { filename: string; sectionMaxPlays: number | null },
): Promise<void> {
  const testId = randomUUID()
  const versionId = randomUUID()
  const sectionId = randomUUID()
  const groupId = randomUUID()
  const mediaId = randomUUID()
  const stimulusId = randomUUID()

  await pool.query(`INSERT INTO test (id, slug) VALUES ($1, $2)`, [
    testId,
    `media-e2e-${testId}`,
  ])
  await pool.query(
    `INSERT INTO test_version (id, test_id, version, title, duration_seconds)
     VALUES ($1, $2, 1, 'Media E2E Test', 100)`,
    [versionId, testId],
  )
  await pool.query(
    `INSERT INTO test_section
       (id, test_version_id, ordinal, title, type, duration_seconds,
        navigation, allow_answer_change,
        default_max_plays, default_allow_pause, default_allow_seek)
     VALUES ($1, $2, 1, 'Listening', 'listening', 100, 'forward_only', false, $3, false, false)`,
    [sectionId, versionId, input.sectionMaxPlays],
  )
  await pool.query(
    `INSERT INTO media_asset (id, kind, filename, mime_type, byte_size, checksum)
     VALUES ($1, 'audio', $2, 'audio/mpeg', 1000, $3)`,
    [mediaId, input.filename, `checksum-${input.filename}`],
  )
  await pool.query(
    `INSERT INTO stimulus (id, test_version_id, type, media_asset_id)
     VALUES ($1, $2, 'audio', $3)`,
    [stimulusId, versionId, mediaId],
  )
  await pool.query(
    `INSERT INTO question_group (id, test_version_id, test_section_id, stimulus_id, ordinal)
     VALUES ($1, $2, $3, $4, 1)`,
    [groupId, versionId, sectionId, stimulusId],
  )
}

describe("GET /media/:filename", () => {
  let app: TestApp | undefined = undefined
  let mediaRoot = ""

  beforeAll(async () => {
    mediaRoot = await mkdtemp(join(tmpdir(), "pp-media-serve-"))
    process.env.MEDIA_ROOT = mediaRoot

    app = await createTestApp({ now: NOW })
  })

  afterAll(async () => {
    await app?.close()
    await rm(mediaRoot, { recursive: true, force: true })
    delete process.env.MEDIA_ROOT
  })

  function ready(): TestApp {
    if (!app) {
      throw new Error("Application failed to initialize")
    }

    return app
  }

  it("serves an uncapped file with no query params at all", async () => {
    const a = ready()
    const pool = a.get<PgPool>(REQUEST_POOL)

    await insertStimulusMedia(pool, {
      filename: "open.mp3",
      sectionMaxPlays: null,
    })
    await writeFile(join(mediaRoot, "open.mp3"), "uncapped-bytes")

    const res = await request(a.http.getHttpServer() as App)
      .get("/api/media/open.mp3")
      .buffer(true)
      .expect(200)

    expect((res.body as Buffer).toString()).toBe("uncapped-bytes")
  })

  it("403s a capped file's request with no sig", async () => {
    const a = ready()
    const pool = a.get<PgPool>(REQUEST_POOL)

    await insertStimulusMedia(pool, {
      filename: "capped-no-sig.mp3",
      sectionMaxPlays: 1,
    })
    await writeFile(join(mediaRoot, "capped-no-sig.mp3"), "capped-bytes")

    await request(a.http.getHttpServer() as App)
      .get("/api/media/capped-no-sig.mp3")
      .expect(403)
  })

  it("403s a capped file's request with an expired sig", async () => {
    const a = ready()
    const pool = a.get<PgPool>(REQUEST_POOL)

    await insertStimulusMedia(pool, {
      filename: "capped-expired.mp3",
      sectionMaxPlays: 1,
    })
    await writeFile(join(mediaRoot, "capped-expired.mp3"), "capped-bytes")

    const expiredUrl = signMediaUrl(
      "capped-expired.mp3",
      new Date(NOW.getTime() - 1000),
      MEDIA_SIGNING_SECRET,
    )

    await request(a.http.getHttpServer() as App)
      .get(`/api${expiredUrl}`)
      .expect(403)
  })

  it("200s a capped file's request with a valid, unexpired sig", async () => {
    const a = ready()
    const pool = a.get<PgPool>(REQUEST_POOL)

    await insertStimulusMedia(pool, {
      filename: "capped-valid.mp3",
      sectionMaxPlays: 1,
    })
    await writeFile(join(mediaRoot, "capped-valid.mp3"), "capped-bytes")

    const validUrl = signMediaUrl(
      "capped-valid.mp3",
      new Date(NOW.getTime() + 5 * 60 * 1000),
      MEDIA_SIGNING_SECRET,
    )

    const res = await request(a.http.getHttpServer() as App)
      .get(`/api${validUrl}`)
      .buffer(true)
      .expect(200)

    expect((res.body as Buffer).toString()).toBe("capped-bytes")
  })

  it("404s a traversal attempt (../../etc/passwd)", async () => {
    const a = ready()

    // The raw path param must contain a literal `/` to escape `mediaRoot`
    // via `path.resolve` -- `%2F` survives Express's route-splitting (which
    // happens before decoding) and is decoded back to `/` only once inside
    // the single `:filename` segment.
    await request(a.http.getHttpServer() as App)
      .get("/api/media/..%2F..%2Fetc%2Fpasswd")
      .expect(404)
  })
})
