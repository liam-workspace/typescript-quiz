import { randomUUID } from "node:crypto"
import type pg from "pg"
import { finalizeAttempt } from "../src/repositories/attempt.repository.js"
import { loadReview } from "@pp/db/scoring"
import { describe, expect, it } from "vitest"
import { withDatabase } from "./helpers/database.js"
import { seedPublishedTest, type Fixture } from "./helpers/fixtures.js"

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

describe("loadReview", () => {
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
})
