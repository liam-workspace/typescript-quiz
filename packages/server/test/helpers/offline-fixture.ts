import type { PgPool } from "@liam-workspace/node-postgres"
import { testDocumentSchema } from "@pp/common"
import { randomUUID } from "node:crypto"
import request from "supertest"
import type { App } from "supertest/types.js"
import { REQUEST_POOL } from "../../src/database/tokens.js"
import type { TestApp } from "./app.js"

export interface FixtureQuestion {
  id: string
  /** Ordered by choice ordinal; index 0 is the correct one. */
  choiceIds: string[]
}

export interface OfflineFixture {
  slug: string
  versionId: string
  mediaFilename: string
  listening: {
    sectionId: string
    stimulusId: string
    questions: FixtureQuestion[]
  }
  reading: { sectionId: string; questions: FixtureQuestion[] }
}

function question(key: string, prompt: string, labels: [string, string]) {
  return {
    questionKey: key,
    prompt,
    type: "single_choice" as const,
    points: 1,
    choices: [
      { label: labels[0], isCorrect: true },
      { label: labels[1], isCorrect: false },
    ],
  }
}

/**
 * Imports and publishes a two-section test: a forward-only listening section
 * (one capped audio stimulus, maxPlays 1, two questions, 600 s) and a free
 * reading section (one passage, one question, 600 s). Total 1200 s.
 */
export async function seedOfflineFixture(
  app: TestApp,
  slug: string,
): Promise<OfflineFixture> {
  const pool = app.get<PgPool>(REQUEST_POOL)
  const mediaFilename = `${slug}.mp3`

  await pool.query(
    `INSERT INTO media_asset (id, kind, filename, mime_type, byte_size, checksum)
     VALUES ($1, 'audio', $2, 'audio/mpeg', 2048, $3)`,
    [randomUUID(), mediaFilename, `checksum-${slug}`],
  )

  const doc = testDocumentSchema.parse({
    title: `Offline ${slug}`,
    slug,
    level: "primary-step-1",
    durationSeconds: 1200,
    sections: [
      {
        title: "Listening",
        type: "listening",
        durationSeconds: 600,
        navigation: "forward_only",
        allowAnswerChange: false,
        playback: { maxPlays: 1, allowPause: false, allowSeek: false },
        instructions: ["Put your headphones on now."],
        groups: [
          {
            stimulus: { type: "audio", mediaFilename, maxPlays: 1 },
            questions: [
              question("l1", "Where is the bag?", ["Bench", "Desk"]),
              question("l2", "What time is it?", ["8:30", "9:00"]),
            ],
          },
        ],
      },
      {
        title: "Reading",
        type: "reading",
        durationSeconds: 600,
        navigation: "free",
        allowAnswerChange: true,
        playback: null,
        instructions: [],
        groups: [
          {
            stimulus: {
              type: "passage",
              title: "Tom's garden",
              bodyText: "Tom has a small garden.",
            },
            questions: [
              question("r1", "What does Tom have?", ["A garden", "A boat"]),
            ],
          },
        ],
      },
    ],
  })

  const adminToken = await app.mint({
    sub: `offline-fixture-admin-${slug}`,
    email: "admin@example.com",
    isAdmin: true,
  })
  const imported = await request(app.http.getHttpServer() as App)
    .post("/api/admin/tests/import")
    .set("Authorization", `Bearer ${adminToken}`)
    .send(doc)
    .expect(201)
  const { testId } = imported.body as { testId: string }

  await request(app.http.getHttpServer() as App)
    .post(`/api/admin/tests/${testId}/publish`)
    .set("Authorization", `Bearer ${adminToken}`)
    .expect(200)

  const { rows: sections } = await pool.query<{
    id: string
    type: string
    version_id: string
  }>(
    `SELECT ts.id, ts.type::text AS type, tv.id AS version_id
       FROM test_section ts
       JOIN test_version tv ON tv.id = ts.test_version_id
       JOIN test t ON t.id = tv.test_id
      WHERE t.slug = $1
      ORDER BY ts.ordinal`,
    [slug],
  )
  const { rows: stimuli } = await pool.query<{ id: string }>(
    `SELECT st.id FROM stimulus st
       JOIN test_version tv ON tv.id = st.test_version_id
       JOIN test t ON t.id = tv.test_id
      WHERE t.slug = $1 AND st.media_asset_id IS NOT NULL`,
    [slug],
  )

  async function questionsOf(sectionId: string): Promise<FixtureQuestion[]> {
    const { rows } = await pool.query<{ id: string; choice_ids: string[] }>(
      `SELECT q.id,
              array_agg(c.id ORDER BY c.ordinal) AS choice_ids
         FROM question q
         JOIN question_group qg ON qg.id = q.question_group_id
         JOIN choice c ON c.question_id = q.id
        WHERE qg.test_section_id = $1
        GROUP BY q.id, q.ordinal
        ORDER BY q.ordinal`,
      [sectionId],
    )

    return rows.map((row) => ({ id: row.id, choiceIds: row.choice_ids }))
  }

  const listeningRow = sections.find((s) => s.type === "listening")
  const readingRow = sections.find((s) => s.type === "reading")
  const stimulusRow = stimuli.at(0)

  if (!listeningRow || !readingRow || !stimulusRow) {
    throw new Error("offline fixture import did not produce the expected rows")
  }

  return {
    slug,
    versionId: listeningRow.version_id,
    mediaFilename,
    listening: {
      sectionId: listeningRow.id,
      stimulusId: stimulusRow.id,
      questions: await questionsOf(listeningRow.id),
    },
    reading: {
      sectionId: readingRow.id,
      questions: await questionsOf(readingRow.id),
    },
  }
}
