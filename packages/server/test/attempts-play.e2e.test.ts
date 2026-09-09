import type { PgPool } from "@liam-workspace/node-postgres"
import { testDocumentSchema, type TestDocument } from "@pp/common"
import { randomUUID } from "node:crypto"
import request from "supertest"
import type { App } from "supertest/types.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { REQUEST_POOL } from "../src/database/tokens.js"
import { createTestApp, type TestApp } from "./helpers/app.js"

const SUB = "google-oauth2|attempts-play-test"
const EMAIL = "tom@example.com"

/**
 * One listening section, one capped audio stimulus (`maxPlays: 1`), one
 * question -- just enough content to claim a play against.
 */
function playCappedDoc(slug: string, mediaFilename: string): TestDocument {
  return testDocumentSchema.parse({
    title: "Play E2E Test",
    slug,
    level: "primary-step-1",
    durationSeconds: 100,
    sections: [
      {
        title: "Listening — Part 1",
        type: "listening",
        durationSeconds: 100,
        navigation: "forward_only",
        allowAnswerChange: false,
        playback: { maxPlays: 1, allowPause: false, allowSeek: false },
        instructions: [],
        groups: [
          {
            stimulus: { type: "audio", mediaFilename, maxPlays: 1 },
            questions: [
              {
                questionKey: "q1",
                prompt: "What does the boy want to do?",
                type: "single_choice",
                points: 1,
                choices: [
                  { label: "Read a book", isCorrect: true },
                  { label: "Play football", isCorrect: false },
                ],
              },
            ],
          },
        ],
      },
    ],
  })
}

async function insertMediaAsset(pool: PgPool, filename: string): Promise<void> {
  await pool.query(
    `INSERT INTO media_asset (id, kind, filename, mime_type, byte_size, checksum)
     VALUES ($1, 'audio', $2, 'audio/mpeg', 1000, $3)`,
    [randomUUID(), filename, `checksum-${filename}`],
  )
}

async function insertStaleAttempt(
  pool: PgPool,
  input: {
    studentId: string
    versionId: string
    startedAt: Date
    expiresAt: Date
  },
): Promise<string> {
  const attemptId = randomUUID()

  await pool.query(
    `INSERT INTO attempt (id, student_id, test_version_id, status, started_at, expires_at)
     VALUES ($1, $2, $3, 'in_progress', $4, $5)`,
    [
      attemptId,
      input.studentId,
      input.versionId,
      input.startedAt,
      input.expiresAt,
    ],
  )

  return attemptId
}

interface PlayGrantBody {
  stimulusId: string
  playsUsed: number
  playsRemaining: number | null
  mediaUrl: string
  urlExpiresAt: string
}

describe("POST /attempts/:id/stimuli/:stimulusId/play", () => {
  let app: TestApp | undefined = undefined

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app?.close()
  })

  function ready(): TestApp {
    if (!app) {
      throw new Error("Application failed to initialize")
    }

    return app
  }

  async function provision(
    a: TestApp,
    sub: string,
  ): Promise<{ token: string; studentId: string }> {
    const token = await a.mint({ sub, email: EMAIL })

    await request(a.http.getHttpServer() as App)
      .post("/api/session")
      .set("Authorization", `Bearer ${token}`)
      .expect(201)
    const me = await request(a.http.getHttpServer() as App)
      .get("/api/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)

    return { token, studentId: (me.body as { id: string }).id }
  }

  async function importAndPublish(
    a: TestApp,
    slug: string,
    mediaFilename: string,
  ): Promise<{ versionId: string; sectionId: string; stimulusId: string }> {
    const pool = a.get<PgPool>(REQUEST_POOL)

    await insertMediaAsset(pool, mediaFilename)

    const adminToken = await a.mint({
      sub: `${SUB}-admin-${slug}`,
      email: EMAIL,
      isAdmin: true,
    })
    const imported = await request(a.http.getHttpServer() as App)
      .post("/api/admin/tests/import")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(playCappedDoc(slug, mediaFilename))
      .expect(201)
    const { testId } = imported.body as { testId: string }
    await request(a.http.getHttpServer() as App)
      .post(`/api/admin/tests/${testId}/publish`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200)

    const { rows } = await pool.query<{
      version_id: string
      section_id: string
      stimulus_id: string
    }>(
      `SELECT tv.id AS version_id, ts.id AS section_id, st.id AS stimulus_id
         FROM test_version tv
         JOIN test t ON t.id = tv.test_id
         JOIN test_section ts ON ts.test_version_id = tv.id
         JOIN question_group qg ON qg.test_section_id = ts.id
         JOIN stimulus st ON st.id = qg.stimulus_id
        WHERE t.slug = $1`,
      [slug],
    )
    const [row] = rows

    return {
      versionId: row.version_id,
      sectionId: row.section_id,
      stimulusId: row.stimulus_id,
    }
  }

  async function startAndEnter(
    a: TestApp,
    token: string,
    slug: string,
    sectionId: string,
  ): Promise<string> {
    const started = await request(a.http.getHttpServer() as App)
      .post("/api/attempts")
      .set("Authorization", `Bearer ${token}`)
      .send({ slug })
    const { id: attemptId } = started.body as { id: string }

    await request(a.http.getHttpServer() as App)
      .post(`/api/attempts/${attemptId}/sections/${sectionId}/enter`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200)

    return attemptId
  }

  it("200s and returns a mediaUrl that the media controller then accepts", async () => {
    const a = ready()
    const slug = `play-claim-${randomUUID()}`
    const { sectionId, stimulusId } = await importAndPublish(
      a,
      slug,
      "claim.mp3",
    )
    const { token } = await provision(a, `${SUB}-claim`)
    const attemptId = await startAndEnter(a, token, slug, sectionId)

    const res = await request(a.http.getHttpServer() as App)
      .post(`/api/attempts/${attemptId}/stimuli/${stimulusId}/play`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200)

    const body = res.body as PlayGrantBody

    expect(body.stimulusId).toBe(stimulusId)
    expect(body.playsUsed).toBe(1)
    expect(body.playsRemaining).toBe(0)
    expect(Number.isNaN(Date.parse(body.urlExpiresAt))).toBe(false)
    expect(body.mediaUrl).toContain("/api/media/claim.mp3")
    expect(body.mediaUrl).toContain("sig=")

    await request(a.http.getHttpServer() as App)
      .get(body.mediaUrl)
      .buffer(true)
      .expect((mediaRes) => {
        // No file was ever written to mediaRoot for this filename -- the
        // point of this assertion is that the SIGNATURE was accepted (a
        // rejected signature would be 403; a missing file, once accepted,
        // is a distinct 404), not that bytes came back.
        if (mediaRes.status !== 404) {
          throw new Error(`expected 404 (missing file), got ${mediaRes.status}`)
        }
      })
  })

  // The ownership guard was tested in NEITHER direction: every other test
  // here claims a play on the claimant's own attempt, so
  // loadRunningOwnedAttempt's student check could have been deleted and all
  // of them would still pass. A play claim spends a capped, irreplaceable
  // resource against a specific child's attempt -- another child must not
  // be able to spend it, and a signed media URL must not be issued to them.
  it("403s a play claim on another student's attempt, and spends no play", async () => {
    const a = ready()
    const slug = `play-foreign-${randomUUID()}`
    const { sectionId, stimulusId } = await importAndPublish(
      a,
      slug,
      "foreign.mp3",
    )

    const { token: ownerToken } = await provision(a, `${SUB}-owner`)
    const attemptId = await startAndEnter(a, ownerToken, slug, sectionId)

    const { token: intruderToken } = await provision(a, `${SUB}-intruder`)

    await request(a.http.getHttpServer() as App)
      .post(`/api/attempts/${attemptId}/stimuli/${stimulusId}/play`)
      .set("Authorization", `Bearer ${intruderToken}`)
      .expect(403)

    // ...and the cap is untouched, so the owner still has their one play.
    const owner = await request(a.http.getHttpServer() as App)
      .post(`/api/attempts/${attemptId}/stimuli/${stimulusId}/play`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200)

    const body = owner.body as PlayGrantBody

    expect(body.playsUsed).toBe(1)
    expect(body.playsRemaining).toBe(0)
  })

  it("409s the second claim on a capped stimulus", async () => {
    const a = ready()
    const slug = `play-second-${randomUUID()}`
    const { sectionId, stimulusId } = await importAndPublish(
      a,
      slug,
      "second.mp3",
    )
    const { token } = await provision(a, `${SUB}-second`)
    const attemptId = await startAndEnter(a, token, slug, sectionId)

    await request(a.http.getHttpServer() as App)
      .post(`/api/attempts/${attemptId}/stimuli/${stimulusId}/play`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200)

    await request(a.http.getHttpServer() as App)
      .post(`/api/attempts/${attemptId}/stimuli/${stimulusId}/play`)
      .set("Authorization", `Bearer ${token}`)
      .expect(409)
  })

  it("410s a past-deadline attempt without claiming a play", async () => {
    const a = ready()
    const slug = `play-expired-${randomUUID()}`
    const { versionId, stimulusId } = await importAndPublish(
      a,
      slug,
      "expired.mp3",
    )
    const { token, studentId } = await provision(a, `${SUB}-expired`)
    const pool = a.get<PgPool>(REQUEST_POOL)
    const attemptId = await insertStaleAttempt(pool, {
      studentId,
      versionId,
      startedAt: new Date(Date.now() - 60 * 60 * 1000),
      expiresAt: new Date(Date.now() - 10 * 60 * 1000),
    })

    await request(a.http.getHttpServer() as App)
      .post(`/api/attempts/${attemptId}/stimuli/${stimulusId}/play`)
      .set("Authorization", `Bearer ${token}`)
      .expect(410)

    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM stimulus_play WHERE attempt_id = $1`,
      [attemptId],
    )

    expect(rows[0].count).toBe("0")
  })
})
