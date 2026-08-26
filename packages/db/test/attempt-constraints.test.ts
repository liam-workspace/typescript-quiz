import { describe, expect, it } from "vitest"
import { withDatabase } from "./helpers/database.js"
import { seedPublishedTest } from "./helpers/fixtures.js"

const newAttempt = (
  pool: import("pg").Pool,
  f: { studentId: string; versionId: string },
  id: string,
) =>
  pool.query(
    `INSERT INTO attempt (id, student_id, test_version_id) VALUES ($1,$2,$3)`,
    [id, f.studentId, f.versionId],
  )

describe("migration 1002 — attempts", () => {
  it("allows only one in-progress attempt per student per version", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      await newAttempt(pool, f, "f0000000-0000-0000-0000-000000000001")
      await expect(
        newAttempt(pool, f, "f0000000-0000-0000-0000-000000000002"),
      ).rejects.toThrow(/attempt_one_active/)
    })
  }, 120_000)

  it("refuses a half-started clock", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      await newAttempt(pool, f, "f0000000-0000-0000-0000-000000000001")
      await expect(
        pool.query(`UPDATE attempt SET started_at = now()
                     WHERE id='f0000000-0000-0000-0000-000000000001'`),
      ).rejects.toThrow(/attempt_clock_paired/)
    })
  }, 120_000)

  it("refuses an expired attempt not pinned to its deadline", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      await newAttempt(pool, f, "f0000000-0000-0000-0000-000000000001")
      await pool.query(`UPDATE attempt SET started_at=now(), expires_at=now()+interval '50 min'
                         WHERE id='f0000000-0000-0000-0000-000000000001'`)
      await expect(
        pool.query(
          `UPDATE attempt SET status='expired', submitted_at=now()+interval '99 min',
             points_earned=1, points_possible=2, percentage=50, answered_count=1,
             unanswered_count=1, correct_count=1, incorrect_count=0, question_count=2
           WHERE id='f0000000-0000-0000-0000-000000000001'`,
        ),
      ).rejects.toThrow(/attempt_expired_pins_deadline/)
    })
  }, 120_000)

  it("refuses a response to a question from another version", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      await newAttempt(pool, f, "f0000000-0000-0000-0000-000000000001")
      await expect(
        pool.query(
          `INSERT INTO response (attempt_id, question_id, test_version_id,
                                 client_instance_id, client_seq)
           VALUES ('f0000000-0000-0000-0000-000000000001',
                   'd000000f-0000-0000-0000-0000000000ff', $1, 'ci', 1)`,
          [f.versionId],
        ),
      ).rejects.toThrow(/response_question_fk/)
    })
  }, 120_000)

  it("refuses a choice belonging to a different question", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      await newAttempt(pool, f, "f0000000-0000-0000-0000-000000000001")
      await pool.query(
        `INSERT INTO response (attempt_id, question_id, test_version_id,
                               client_instance_id, client_seq)
         VALUES ('f0000000-0000-0000-0000-000000000001', $1, $2, 'ci', 1)`,
        [f.questionIds[0], f.versionId],
      )
      await expect(
        pool.query(
          `INSERT INTO response_choice (attempt_id, question_id, choice_id)
           VALUES ('f0000000-0000-0000-0000-000000000001', $1, $2)`,
          // Index 2 is a choice belonging to question 2, not question 1.
          [f.questionIds[0], f.choiceIds[2]],
        ),
      ).rejects.toThrow(/response_choice_choice_fk/)
    })
  }, 120_000)

  it("allows only one open section at a time", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      await newAttempt(pool, f, "f0000000-0000-0000-0000-000000000001")
      const enter = (sectionId: string) =>
        pool.query(
          `INSERT INTO attempt_section (attempt_id, test_section_id, test_version_id, expires_at)
           VALUES ('f0000000-0000-0000-0000-000000000001',$1,$2, now()+interval '25 min')`,
          [sectionId, f.versionId],
        )
      await enter(f.listeningSectionId)
      await expect(enter(f.readingSectionId)).rejects.toThrow(
        /attempt_section_one_open/,
      )
    })
  }, 120_000)
})
