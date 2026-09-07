import { randomUUID } from "node:crypto"
import type pg from "pg"
import { finalizeAttempt } from "../src/repositories/attempt.repository.js"
import { loadReview } from "@pp/db/scoring"
import { describe, expect, it } from "vitest"
import { withDatabase } from "./helpers/database.js"
import {
  seedMixedStimulusTest,
  seedPublishedTest,
  type Fixture,
} from "./helpers/fixtures.js"

const NOW = new Date("2026-08-27T10:00:00.000Z")

async function insertAttempt(pool: pg.Pool, fixture: Fixture): Promise<string> {
  const attemptId = randomUUID()

  await pool.query(
    `INSERT INTO attempt
       (id, student_id, test_version_id, status, started_at, expires_at)
     VALUES ($1, $2, $3, 'in_progress', $4, $5)`,
    [
      attemptId,
      fixture.studentId,
      fixture.versionId,
      new Date("2026-08-27T09:30:00.000Z"),
      new Date("2026-08-27T10:30:00.000Z"),
    ],
  )

  return attemptId
}

async function recordAnswer(
  pool: pg.Pool,
  fixture: Fixture,
  input: { attemptId: string; questionIndex: number; choiceIndex: number },
): Promise<void> {
  await pool.query(
    `INSERT INTO response
       (attempt_id, question_id, test_version_id, client_instance_id, client_seq)
     VALUES ($1, $2, $3, 'review-test', 1)`,
    [
      input.attemptId,
      fixture.questionIds[input.questionIndex],
      fixture.versionId,
    ],
  )
  await pool.query(
    `INSERT INTO response_choice (attempt_id, question_id, choice_id)
     VALUES ($1, $2, $3)`,
    [
      input.attemptId,
      fixture.questionIds[input.questionIndex],
      fixture.choiceIds[input.choiceIndex],
    ],
  )
}

async function finishAttempt(
  pool: pg.Pool,
  fixture: Fixture,
  answer?: { questionIndex: number; choiceIndex: number },
): Promise<string> {
  const attemptId = await insertAttempt(pool, fixture)

  if (answer) {
    await recordAnswer(pool, fixture, { attemptId, ...answer })
  }

  await finalizeAttempt(pool, {
    attemptId,
    status: "submitted",
    submittedAt: NOW,
  })

  return attemptId
}

function readyReview(
  pool: pg.Pool,
  attemptId: string,
): ReturnType<typeof loadReview> {
  return loadReview(pool, {
    attemptId,
    now: NOW,
    mediaUrlFor: (filename: string) => `/media/${filename}?signed=stub`,
  })
}

/**
 * A minimal published test with one picture-choice question, built with raw
 * SQL rather than `seedPublishedTest` -- that fixture is shared by many
 * other tests and carries no imageSvg choice, and widening it would be a
 * shared-fixture change unrelated to what this test needs to prove.
 */
async function seedPictureChoiceTest(pool: pg.Pool): Promise<{
  studentId: string
  versionId: string
  questionId: string
  choiceIds: string[]
}> {
  const studentId = "31111111-1111-1111-1111-111111111111"
  const testId = "32222222-2222-2222-2222-222222222222"
  const versionId = "33333333-3333-3333-3333-333333333333"
  const sectionId = "34444444-4444-4444-4444-444444444444"
  const groupId = "35555555-5555-5555-5555-555555555555"
  const questionId = "36666666-6666-6666-6666-666666666666"
  const c1 = "37777777-7777-7777-7777-777777777777"
  const c2 = "38888888-8888-8888-8888-888888888888"
  const svg = '<svg viewBox="0 0 10 10"><circle r="4"/></svg>'

  await pool.query(
    `INSERT INTO student (id, subject_claim, email, display_name)
     VALUES ($1,'sub-picture','picture@example.test','Picture')`,
    [studentId],
  )
  await pool.query(
    `INSERT INTO test (id, slug) VALUES ($1,'picture-review-01')`,
    [testId],
  )
  await pool.query(
    `INSERT INTO test_version (id, test_id, version, title, duration_seconds)
     VALUES ($1,$2,1,'Picture review',600)`,
    [versionId, testId],
  )
  await pool.query(
    `INSERT INTO test_section (id, test_version_id, ordinal, title, type, duration_seconds,
                               navigation, allow_answer_change,
                               default_max_plays, default_allow_pause, default_allow_seek)
     VALUES ($1,$2,1,'Listening','listening',600,'free',true,NULL,NULL,NULL)`,
    [sectionId, versionId],
  )
  await pool.query(
    `INSERT INTO question_group (id, test_version_id, test_section_id, ordinal)
     VALUES ($1,$2,$3,1)`,
    [groupId, versionId, sectionId],
  )
  await pool.query(
    `INSERT INTO question (id, test_version_id, question_group_id, question_key,
                           ordinal, prompt, type, points)
     VALUES ($1,$2,$3,'pq1',1,'Which picture?','single_choice',1)`,
    [questionId, versionId, groupId],
  )
  await pool.query(
    `INSERT INTO choice (id, question_id, ordinal, label, is_correct, image_svg)
     VALUES ($1,$3,1,'A',true,$4), ($2,$3,2,'B',false,NULL)`,
    [c1, c2, questionId, svg],
  )
  await pool.query(
    `UPDATE test_version SET published_at = now() WHERE id = $1`,
    [versionId],
  )
  await pool.query(`UPDATE test SET current_version_id = $1 WHERE id = $2`, [
    versionId,
    testId,
  ])

  return { studentId, versionId, questionId, choiceIds: [c1, c2] }
}

describe("loadReview", () => {
  it("carries a picture choice's imageSvg, and omits it for a text-only choice", async () => {
    await withDatabase(async (pool) => {
      const picture = await seedPictureChoiceTest(pool)
      const attemptId = randomUUID()

      await pool.query(
        `INSERT INTO attempt (id, student_id, test_version_id, status, started_at, expires_at)
         VALUES ($1,$2,$3,'in_progress',$4,$5)`,
        [
          attemptId,
          picture.studentId,
          picture.versionId,
          new Date("2026-08-27T09:30:00.000Z"),
          new Date("2026-08-27T10:30:00.000Z"),
        ],
      )
      await finalizeAttempt(pool, {
        attemptId,
        status: "submitted",
        submittedAt: NOW,
      })

      const result = await readyReview(pool, attemptId)

      if (result.kind !== "ready") {
        throw new Error(`expected ready, received ${result.kind}`)
      }

      const [choiceA, choiceB] = result.items[0].choices

      expect(choiceA.imageSvg).toBe(
        '<svg viewBox="0 0 10 10"><circle r="4"/></svg>',
      )
      expect("imageSvg" in choiceB).toBe(false)
    })
  }, 120_000)

  it("returns EVERY question, including one never answered", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const attemptId = await finishAttempt(pool, fixture, {
        questionIndex: 0,
        choiceIndex: 0,
      })

      const result = await readyReview(pool, attemptId)

      expect(result).toMatchObject({
        kind: "ready",
        items: [
          { questionId: fixture.questionIds[0], outcome: "correct" },
          { questionId: fixture.questionIds[1], outcome: "unanswered" },
        ],
      })

      if (result.kind !== "ready") {
        throw new Error(`expected ready, received ${result.kind}`)
      }

      expect(result.items).toHaveLength(2)
      expect(typeof result.items[0]?.ordinal).toBe("number")
      expect(result.items[1]?.choices).toEqual([
        {
          id: fixture.choiceIds[2],
          label: "It began to rain",
          isCorrect: true,
          selected: false,
        },
        {
          id: fixture.choiceIds[3],
          label: "The bus was late",
          isCorrect: false,
          selected: false,
        },
      ])
    })
  }, 120_000)

  it("marks a correct answer's outcome correct and its choice selected: true", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const attemptId = await finishAttempt(pool, fixture, {
        questionIndex: 0,
        choiceIndex: 0,
      })

      const result = await readyReview(pool, attemptId)

      if (result.kind !== "ready") {
        throw new Error(`expected ready, received ${result.kind}`)
      }

      expect(result.items[0]).toMatchObject({
        outcome: "correct",
        choices: [
          { id: fixture.choiceIds[0], isCorrect: true, selected: true },
          { id: fixture.choiceIds[1], isCorrect: false, selected: false },
        ],
      })
    })
  }, 120_000)

  it("marks a wrong answer's outcome incorrect and shows the choice actually selected", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const attemptId = await finishAttempt(pool, fixture, {
        questionIndex: 0,
        choiceIndex: 1,
      })

      const result = await readyReview(pool, attemptId)

      if (result.kind !== "ready") {
        throw new Error(`expected ready, received ${result.kind}`)
      }

      expect(result.items[0]).toMatchObject({
        outcome: "incorrect",
        choices: [
          { id: fixture.choiceIds[0], isCorrect: true, selected: false },
          { id: fixture.choiceIds[1], isCorrect: false, selected: true },
        ],
      })
    })
  }, 120_000)

  it("carries a passage stimulus's title and bodyText for the reading question", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const attemptId = await finishAttempt(pool, fixture)

      const result = await readyReview(pool, attemptId)

      if (result.kind !== "ready") {
        throw new Error(`expected ready, received ${result.kind}`)
      }

      expect(result.items[1]?.stimulus).toEqual({
        id: fixture.uncappedStimulusId,
        type: "passage",
        title: "Rainy Day",
        bodyText: "A short reading passage about a rainy day.",
        replayable: true,
      })
    })
  }, 120_000)

  it("carries a replayable mediaUrl with no play-count field anywhere", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const attemptId = await finishAttempt(pool, fixture)

      const result = await readyReview(pool, attemptId)

      if (result.kind !== "ready") {
        throw new Error(`expected ready, received ${result.kind}`)
      }

      expect(result.items[0]?.stimulus).toEqual({
        id: fixture.cappedStimulusId,
        type: "audio",
        // Built by the caller's mediaUrlFor, which the service uses to SIGN.
        // "The cap no longer applies" cannot mean "send a bare URL":
        // /media refuses a capped filename without a valid signature and
        // cannot tell review from mid-test, because an <audio src> sends no
        // bearer. A bare URL here is one the client can never fetch.
        mediaUrl: "/media/l07.mp3?signed=stub",
        replayable: true,
      })
      // The play CAP is gone from the payload -- no counts, no pause/seek
      // rules. That is what "replayable" means on this route; it is a
      // different claim from whether the URL carries authority.
      expect(JSON.stringify(result)).not.toMatch(
        /playsUsed|playsRemaining|maxPlays|allowPause|allowSeek/,
      )
    })
  }, 120_000)

  // `mixed` is text AND media, and its own `type` never says WHICH media --
  // only media_asset.kind does, and until now that column was joined but
  // never projected. A client cannot guess, so it rendered every mixed
  // stimulus as an audio player: a picture question showed a child a dead
  // audio control and no image. No fixture had a mixed stimulus, so nothing
  // failed. This is the case that keeps `ma.kind` in the SELECT list.
  it("carries mediaKind on a mixed stimulus, so the client need not guess", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedMixedStimulusTest(pool)
      const attemptId = randomUUID()

      await pool.query(
        `INSERT INTO attempt
           (id, student_id, test_version_id, status, started_at, expires_at)
         VALUES ($1, $2, $3, 'in_progress', $4, $5)`,
        [
          attemptId,
          fixture.studentId,
          fixture.versionId,
          new Date("2026-08-27T09:30:00.000Z"),
          new Date("2026-08-27T10:30:00.000Z"),
        ],
      )
      await finalizeAttempt(pool, {
        attemptId,
        status: "submitted",
        submittedAt: NOW,
      })

      const result = await readyReview(pool, attemptId)

      if (result.kind !== "ready") {
        throw new Error(`expected ready, received ${result.kind}`)
      }

      expect(result.items[0]?.stimulus).toEqual({
        id: "70000000-0000-0000-0000-000000000003",
        type: "mixed",
        title: "At the park",
        bodyText: "Look and listen.",
        mediaUrl: "/media/m01.png?signed=stub",
        mediaKind: "image",
        replayable: true,
      })
    })
  }, 120_000)
})
