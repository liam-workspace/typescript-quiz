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

  // `correct_count + incorrect_count = answered_count` evaluates to NULL when
  // the counts are NULL, and a CHECK that evaluates to NULL passes — so the
  // constraint used to accept a completed section with no counts at all.
  // These three pin completion => the counts exist AND reconcile.
  it("refuses a completed section with NULL counts", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      await newAttempt(pool, f, "f0000000-0000-0000-0000-000000000001")
      await expect(
        pool.query(
          `INSERT INTO attempt_section (attempt_id, test_section_id, test_version_id,
                                        expires_at, completed_at)
           VALUES ('f0000000-0000-0000-0000-000000000001',$1,$2,
                   now()+interval '25 min', now())`,
          [f.listeningSectionId, f.versionId],
        ),
      ).rejects.toThrow(/attempt_section_counts_reconcile/)
    })
  }, 120_000)

  // Every column present, so the only thing left to fail is the arithmetic:
  // 1 + 0 is not 5.
  it("refuses a completed section whose counts do not reconcile", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      await newAttempt(pool, f, "f0000000-0000-0000-0000-000000000001")
      await expect(
        pool.query(
          `INSERT INTO attempt_section (attempt_id, test_section_id, test_version_id,
                                        expires_at, completed_at,
                                        points_earned, points_possible, answered_count,
                                        unanswered_count, correct_count, incorrect_count)
           VALUES ('f0000000-0000-0000-0000-000000000001',$1,$2,
                   now()+interval '25 min', now(), 1, 2, 5, 0, 1, 0)`,
          [f.listeningSectionId, f.versionId],
        ),
      ).rejects.toThrow(/attempt_section_counts_reconcile/)
    })
  }, 120_000)

  it("accepts a completed section whose counts reconcile", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      await newAttempt(pool, f, "f0000000-0000-0000-0000-000000000001")
      await pool.query(
        `INSERT INTO attempt_section (attempt_id, test_section_id, test_version_id,
                                      expires_at, completed_at,
                                      points_earned, points_possible, answered_count,
                                      unanswered_count, correct_count, incorrect_count)
         VALUES ('f0000000-0000-0000-0000-000000000001',$1,$2,
                 now()+interval '25 min', now(), 1, 2, 1, 0, 1, 0)`,
        [f.listeningSectionId, f.versionId],
      )

      const { rows } = await pool.query<{ answered_count: number }>(
        `SELECT answered_count FROM attempt_section
          WHERE attempt_id='f0000000-0000-0000-0000-000000000001'`,
      )
      expect(rows[0].answered_count).toBe(1)
    })
  }, 120_000)

  // Widening the same guard to the other three columns: the arithmetic only
  // mentions answered/correct/incorrect, so a constraint that stopped there
  // would still let a completed section carry a NULL points_earned -- which
  // is precisely what the per-section breakdown reads.
  it("refuses a completed section missing points_earned", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      await newAttempt(pool, f, "f0000000-0000-0000-0000-000000000001")
      await expect(
        pool.query(
          `INSERT INTO attempt_section (attempt_id, test_section_id, test_version_id,
                                        expires_at, completed_at,
                                        points_possible, answered_count,
                                        unanswered_count, correct_count, incorrect_count)
           VALUES ('f0000000-0000-0000-0000-000000000001',$1,$2,
                   now()+interval '25 min', now(), 2, 1, 0, 1, 0)`,
          [f.listeningSectionId, f.versionId],
        ),
      ).rejects.toThrow(/attempt_section_counts_reconcile/)
    })
  }, 120_000)

  // Same widening, second of the three columns the arithmetic never
  // mentions: all five OTHER columns present and valid, points_possible
  // alone omitted.
  it("refuses a completed section missing points_possible", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      await newAttempt(pool, f, "f0000000-0000-0000-0000-000000000001")
      await expect(
        pool.query(
          `INSERT INTO attempt_section (attempt_id, test_section_id, test_version_id,
                                        expires_at, completed_at,
                                        points_earned, answered_count,
                                        unanswered_count, correct_count, incorrect_count)
           VALUES ('f0000000-0000-0000-0000-000000000001',$1,$2,
                   now()+interval '25 min', now(), 1, 1, 0, 1, 0)`,
          [f.listeningSectionId, f.versionId],
        ),
      ).rejects.toThrow(/attempt_section_counts_reconcile/)
    })
  }, 120_000)

  // Third of the three: all five OTHER columns present and valid,
  // unanswered_count alone omitted.
  it("refuses a completed section missing unanswered_count", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      await newAttempt(pool, f, "f0000000-0000-0000-0000-000000000001")
      await expect(
        pool.query(
          `INSERT INTO attempt_section (attempt_id, test_section_id, test_version_id,
                                        expires_at, completed_at,
                                        points_earned, points_possible, answered_count,
                                        correct_count, incorrect_count)
           VALUES ('f0000000-0000-0000-0000-000000000001',$1,$2,
                   now()+interval '25 min', now(), 1, 2, 1, 1, 0)`,
          [f.listeningSectionId, f.versionId],
        ),
      ).rejects.toThrow(/attempt_section_counts_reconcile/)
    })
  }, 120_000)

  // Guard attempt_section_running_is_ungraded: the fail-open shape F12/F13
  // already cost this branch two findings, one table over. An OPEN section
  // (completed_at IS NULL) must carry no numbers at all -- before this
  // constraint existed, correct_count=9/incorrect_count=9/answered_count=1
  // on a section nobody had finished was accepted (verified).
  it("refuses an open section carrying counts", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      await newAttempt(pool, f, "f0000000-0000-0000-0000-000000000001")
      await expect(
        pool.query(
          `INSERT INTO attempt_section (attempt_id, test_section_id, test_version_id,
                                        expires_at, correct_count, incorrect_count, answered_count)
           VALUES ('f0000000-0000-0000-0000-000000000001',$1,$2,
                   now()+interval '25 min', 9, 9, 1)`,
          [f.listeningSectionId, f.versionId],
        ),
      ).rejects.toThrow(/attempt_section_running_is_ungraded/)
    })
  }, 120_000)

  it("accepts an open section carrying no counts", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      await newAttempt(pool, f, "f0000000-0000-0000-0000-000000000001")
      await pool.query(
        `INSERT INTO attempt_section (attempt_id, test_section_id, test_version_id, expires_at)
         VALUES ('f0000000-0000-0000-0000-000000000001',$1,$2, now()+interval '25 min')`,
        [f.listeningSectionId, f.versionId],
      )

      const { rows } = await pool.query<{ correct_count: number | null }>(
        `SELECT correct_count FROM attempt_section
          WHERE attempt_id='f0000000-0000-0000-0000-000000000001'`,
      )
      expect(rows[0].correct_count).toBeNull()
    })
  }, 120_000)

  // Guard attempt_section_points_sane: a completed section's points_earned
  // must fall within [0, points_possible] -- mirrors attempt_points_sane on
  // the attempt table, one table over.
  it("refuses a completed section with points_earned over points_possible", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      await newAttempt(pool, f, "f0000000-0000-0000-0000-000000000001")
      await expect(
        pool.query(
          `INSERT INTO attempt_section (attempt_id, test_section_id, test_version_id,
                                        expires_at, completed_at,
                                        points_earned, points_possible, answered_count,
                                        unanswered_count, correct_count, incorrect_count)
           VALUES ('f0000000-0000-0000-0000-000000000001',$1,$2,
                   now()+interval '25 min', now(), 5, 2, 1, 0, 1, 0)`,
          [f.listeningSectionId, f.versionId],
        ),
      ).rejects.toThrow(/attempt_section_points_sane/)
    })
  }, 120_000)

  it("accepts a completed section with points_earned within range", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      await newAttempt(pool, f, "f0000000-0000-0000-0000-000000000001")
      await pool.query(
        `INSERT INTO attempt_section (attempt_id, test_section_id, test_version_id,
                                      expires_at, completed_at,
                                      points_earned, points_possible, answered_count,
                                      unanswered_count, correct_count, incorrect_count)
         VALUES ('f0000000-0000-0000-0000-000000000001',$1,$2,
                 now()+interval '25 min', now(), 2, 2, 1, 0, 1, 0)`,
        [f.listeningSectionId, f.versionId],
      )

      const { rows } = await pool.query<{ points_earned: number }>(
        `SELECT points_earned FROM attempt_section
          WHERE attempt_id='f0000000-0000-0000-0000-000000000001'`,
      )
      expect(rows[0].points_earned).toBe(2)
    })
  }, 120_000)
})
