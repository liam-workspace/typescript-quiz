import type pg from "pg"
import { describe, expect, it } from "vitest"
import { setPosition } from "../src/repositories/attempt.repository.js"
import { withDatabase } from "./helpers/database.js"

const STUDENT_ID = "11111111-1111-1111-1111-111111111111"
const TEST_ID = "22222222-2222-2222-2222-222222222222"
const VERSION_ID = "a0000000-0000-0000-0000-000000000001"
const ATTEMPT_ID = "f0000000-0000-0000-0000-000000000001"

const FORWARD_SECTION_ID = "b0000000-0000-0000-0000-000000000001"
const FREE_SECTION_ID = "b0000000-0000-0000-0000-000000000002"
const FORWARD_GROUP_ID = "c0000000-0000-0000-0000-000000000001"
const FREE_GROUP_ID = "c0000000-0000-0000-0000-000000000002"

const FORWARD_QUESTION_IDS = [
  "d0000000-0000-0000-0000-000000000001",
  "d0000000-0000-0000-0000-000000000002",
  "d0000000-0000-0000-0000-000000000003",
]
const FREE_QUESTION_IDS = [
  "d0000000-0000-0000-0000-000000000004",
  "d0000000-0000-0000-0000-000000000005",
  "d0000000-0000-0000-0000-000000000006",
]
const NOW = new Date("2026-08-27T10:00:00.000Z")

async function seedPositionFixture(
  pool: pg.Pool,
  input: { sectionId: string; questionId: string },
): Promise<void> {
  await pool.query(
    `INSERT INTO student (id, subject_claim, email, display_name)
     VALUES ($1, 'sub-position', 'position@example.test', 'Position Student')`,
    [STUDENT_ID],
  )
  await pool.query(
    `INSERT INTO test (id, slug) VALUES ($1, 'position-repository-test')`,
    [TEST_ID],
  )
  await pool.query(
    `INSERT INTO test_version (id, test_id, version, title, duration_seconds)
     VALUES ($1, $2, 1, 'Position Repository Test', 600)`,
    [VERSION_ID, TEST_ID],
  )
  await pool.query(
    `INSERT INTO test_section
       (id, test_version_id, ordinal, title, type, duration_seconds,
        navigation, allow_answer_change)
     VALUES ($1, $3, 1, 'Forward only', 'listening', 300, 'forward_only', false),
            ($2, $3, 2, 'Free', 'reading', 300, 'free', true)`,
    [FORWARD_SECTION_ID, FREE_SECTION_ID, VERSION_ID],
  )
  await pool.query(
    `INSERT INTO question_group
       (id, test_version_id, test_section_id, ordinal)
     VALUES ($1, $3, $4, 1), ($2, $3, $5, 1)`,
    [
      FORWARD_GROUP_ID,
      FREE_GROUP_ID,
      VERSION_ID,
      FORWARD_SECTION_ID,
      FREE_SECTION_ID,
    ],
  )

  await Promise.all(
    [...FORWARD_QUESTION_IDS, ...FREE_QUESTION_IDS].map(
      async (questionId, index) => {
        const ordinal = index + 1
        const groupId =
          ordinal <= FORWARD_QUESTION_IDS.length
            ? FORWARD_GROUP_ID
            : FREE_GROUP_ID

        await pool.query(
          `INSERT INTO question
             (id, test_version_id, question_group_id, question_key, ordinal, prompt, type, points)
           VALUES ($1, $2, $3, $4, $5, $6, 'single_choice', 1)`,
          [
            questionId,
            VERSION_ID,
            groupId,
            `position-q-${ordinal}`,
            ordinal,
            `Question ${ordinal}`,
          ],
        )
      },
    ),
  )

  await pool.query(
    `INSERT INTO attempt
       (id, student_id, test_version_id, status, started_at, expires_at,
        current_section_id, current_question_id)
     VALUES ($1, $2, $3, 'in_progress', $4, $5, $6, $7)`,
    [
      ATTEMPT_ID,
      STUDENT_ID,
      VERSION_ID,
      NOW,
      new Date(NOW.getTime() + 600_000),
      input.sectionId,
      input.questionId,
    ],
  )
  await pool.query(
    `INSERT INTO attempt_section
       (attempt_id, test_section_id, test_version_id, entered_at, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      ATTEMPT_ID,
      input.sectionId,
      VERSION_ID,
      NOW,
      new Date(NOW.getTime() + 300_000),
    ],
  )
}

async function readPosition(
  pool: pg.Pool,
): Promise<{ sectionId: string; questionId: string }> {
  const { rows } = await pool.query<{
    current_section_id: string
    current_question_id: string
  }>(
    `SELECT current_section_id, current_question_id
       FROM attempt
      WHERE id = $1`,
    [ATTEMPT_ID],
  )
  const [row] = rows

  return {
    sectionId: row.current_section_id,
    questionId: row.current_question_id,
  }
}

describe("setPosition", () => {
  it("accepts any position in a free-navigation section, forward or backward", () =>
    withDatabase(async (pool) => {
      await seedPositionFixture(pool, {
        sectionId: FREE_SECTION_ID,
        questionId: FREE_QUESTION_IDS[1],
      })

      const forward = await setPosition(pool, {
        attemptId: ATTEMPT_ID,
        sectionId: FREE_SECTION_ID,
        questionId: FREE_QUESTION_IDS[2],
        now: NOW,
      })
      const backward = await setPosition(pool, {
        attemptId: ATTEMPT_ID,
        sectionId: FREE_SECTION_ID,
        questionId: FREE_QUESTION_IDS[0],
        now: NOW,
      })

      expect(forward).toEqual({ ok: true })
      expect(backward).toEqual({ ok: true })
      expect(await readPosition(pool)).toEqual({
        sectionId: FREE_SECTION_ID,
        questionId: FREE_QUESTION_IDS[0],
      })
    }))

  it("accepts a forward move in a forward_only section", () =>
    withDatabase(async (pool) => {
      await seedPositionFixture(pool, {
        sectionId: FORWARD_SECTION_ID,
        questionId: FORWARD_QUESTION_IDS[0],
      })

      const result = await setPosition(pool, {
        attemptId: ATTEMPT_ID,
        sectionId: FORWARD_SECTION_ID,
        questionId: FORWARD_QUESTION_IDS[2],
        now: NOW,
      })

      expect(result).toEqual({ ok: true })
      expect(await readPosition(pool)).toEqual({
        sectionId: FORWARD_SECTION_ID,
        questionId: FORWARD_QUESTION_IDS[2],
      })
    }))

  it("accepts re-confirming the SAME question in a forward_only section", () =>
    withDatabase(async (pool) => {
      await seedPositionFixture(pool, {
        sectionId: FORWARD_SECTION_ID,
        questionId: FORWARD_QUESTION_IDS[1],
      })

      const result = await setPosition(pool, {
        attemptId: ATTEMPT_ID,
        sectionId: FORWARD_SECTION_ID,
        questionId: FORWARD_QUESTION_IDS[1],
        now: NOW,
      })

      expect(result).toEqual({ ok: true })
      expect(await readPosition(pool)).toEqual({
        sectionId: FORWARD_SECTION_ID,
        questionId: FORWARD_QUESTION_IDS[1],
      })
    }))

  it("refuses a backward move in a forward_only section with navigation_locked", () =>
    withDatabase(async (pool) => {
      await seedPositionFixture(pool, {
        sectionId: FORWARD_SECTION_ID,
        questionId: FORWARD_QUESTION_IDS[2],
      })

      const result = await setPosition(pool, {
        attemptId: ATTEMPT_ID,
        sectionId: FORWARD_SECTION_ID,
        questionId: FORWARD_QUESTION_IDS[0],
        now: NOW,
      })

      expect(result).toEqual({ ok: false, reason: "navigation_locked" })
      expect(await readPosition(pool)).toEqual({
        sectionId: FORWARD_SECTION_ID,
        questionId: FORWARD_QUESTION_IDS[2],
      })
    }))

  it("persists currentSectionId and currentQuestionId on success", () =>
    withDatabase(async (pool) => {
      await seedPositionFixture(pool, {
        sectionId: FREE_SECTION_ID,
        questionId: FREE_QUESTION_IDS[0],
      })

      const result = await setPosition(pool, {
        attemptId: ATTEMPT_ID,
        sectionId: FREE_SECTION_ID,
        questionId: FREE_QUESTION_IDS[1],
        now: NOW,
      })

      expect(result).toEqual({ ok: true })
      expect(await readPosition(pool)).toEqual({
        sectionId: FREE_SECTION_ID,
        questionId: FREE_QUESTION_IDS[1],
      })
    }))
})
