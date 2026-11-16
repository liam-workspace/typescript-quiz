import { randomUUID } from "node:crypto"
import type pg from "pg"
import { describe, expect, it } from "vitest"
import {
  listAdminLearners,
  listAdminResults,
  listAdminTests,
  loadAdminAttemptDetail,
  loadAdminOverview,
  loadAdminTestDetail,
} from "../src/admin.js"
import { InvalidCursorError } from "../src/repositories/catalog.repository.js"
import { withDatabase } from "./helpers/database.js"
import { seedPublishedTest, type Fixture } from "./helpers/fixtures.js"

const page = { limit: 20, cursor: null }

async function addDraft(pool: pg.Pool, testId: string): Promise<string> {
  const id = randomUUID()
  await pool.query(
    `INSERT INTO test_version (id, test_id, version, title, duration_seconds)
     VALUES ($1, $2, 2, 'Updated draft', 600)`,
    [id, testId],
  )

  return id
}

async function finishAttempt(
  pool: pg.Pool,
  f: Fixture,
  submittedAt = "2026-11-16 10:00:00.123456+00",
): Promise<string> {
  const id = randomUUID()
  await pool.query(
    `INSERT INTO attempt (id, student_id, test_version_id, status, submitted_at,
       points_earned, points_possible, percentage, answered_count,
       unanswered_count, correct_count, incorrect_count, question_count)
     VALUES ($1, $2, $3, 'submitted', $4, 1, 2, 50, 1, 1, 1, 0, 2)`,
    [id, f.studentId, f.versionId, submittedAt],
  )
  await pool.query(
    `INSERT INTO response (attempt_id, question_id, test_version_id,
       client_instance_id, client_seq) VALUES ($1, $2, $3, 'admin-test', 1)`,
    [id, f.questionIds[0], f.versionId],
  )
  await pool.query(
    `INSERT INTO response_choice (attempt_id, question_id, choice_id)
     VALUES ($1, $2, $3)`,
    [id, f.questionIds[0], f.choiceIds[0]],
  )

  return id
}

describe("admin read projections", () => {
  it("shows the latest draft while retaining the current published pointer", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      await addDraft(pool, f.testId)
      const result = await listAdminTests(pool, { ...page, status: "draft" })
      expect(result.items).toHaveLength(1)
      expect(typeof result.items[0].updatedAt).toBe("string")
      expect(result.items).toMatchObject([
        {
          id: f.testId,
          title: "Updated draft",
          status: "draft",
          currentVersionId: f.versionId,
        },
      ])
      expect(
        await listAdminTests(pool, { ...page, status: "published" }),
      ).toEqual({ items: [], nextCursor: null })
      expect(
        await listAdminTests(pool, { ...page, status: "archived" }),
      ).toEqual({ items: [], nextCursor: null })
      expect(
        (await listAdminTests(pool, { ...page, search: "UPDATED" })).items,
      ).toHaveLength(1)
      expect(
        (await listAdminTests(pool, { ...page, search: "absent" })).items,
      ).toEqual([])
    })
  }, 120_000)

  it("pages tests with duplicate titles without repeating the last row", async () => {
    await withDatabase(async (pool) => {
      await pool.query(`INSERT INTO test (id, slug) VALUES
        ('22222222-2222-2222-2222-222222222221', 'one'),
        ('22222222-2222-2222-2222-222222222222', 'two')`)
      await pool.query(`INSERT INTO test_version (test_id, version, title, duration_seconds)
        SELECT id, 1, 'Same title', 600 FROM test`)
      const first = await listAdminTests(pool, { limit: 1, cursor: null })
      const second = await listAdminTests(pool, {
        limit: 1,
        cursor: first.nextCursor,
      })
      expect(first.items[0]?.id).toBe("22222222-2222-2222-2222-222222222221")
      expect(second.items[0]?.id).toBe("22222222-2222-2222-2222-222222222222")
      expect(second.nextCursor).toBeNull()
    })
  }, 120_000)

  it("loads ordered section summaries from the latest test version", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      expect(await loadAdminTestDetail(pool, f.testId)).toMatchObject({
        id: f.testId,
        status: "published",
        durationSeconds: 3000,
        description: null,
        sections: [
          {
            id: f.listeningSectionId,
            title: "Listening — Part 1",
            questionCount: 1,
          },
          { id: f.readingSectionId, title: "Reading", questionCount: 1 },
        ],
      })
      await addDraft(pool, f.testId)
      expect(await loadAdminTestDetail(pool, f.testId)).toMatchObject({
        title: "Updated draft",
        durationSeconds: 600,
        sections: [],
      })
    })
  }, 120_000)

  it("returns only aggregate completed results pinned to their historical version", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const attemptId = await finishAttempt(pool, f)
      await addDraft(pool, f.testId)
      await pool.query(
        `INSERT INTO attempt (student_id, test_version_id) VALUES ($1, $2)`,
        [f.studentId, f.versionId],
      )
      expect(
        await listAdminResults(pool, {
          ...page,
          testId: f.testId,
          learnerId: f.studentId,
        }),
      ).toEqual({
        items: [
          {
            attemptId,
            testId: f.testId,
            testTitle: "TOEFL Primary — Practice Test 04",
            learnerId: f.studentId,
            learnerName: "Tom",
            score: 1,
            maxScore: 2,
            completedAt: "2026-11-16T10:00:00.123Z",
          },
        ],
        nextCursor: null,
      })
      expect(
        (await listAdminResults(pool, { ...page, learnerId: randomUUID() }))
          .items,
      ).toEqual([])
      expect(
        (await listAdminResults(pool, { ...page, testId: randomUUID() })).items,
      ).toEqual([])
    })
  }, 120_000)

  it("preserves sub-millisecond result cursor precision", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const newer = await finishAttempt(
        pool,
        f,
        "2026-11-16 10:00:00.123456+00",
      )
      const older = await finishAttempt(
        pool,
        f,
        "2026-11-16 10:00:00.123455+00",
      )
      const first = await listAdminResults(pool, { limit: 1, cursor: null })
      const second = await listAdminResults(pool, {
        limit: 1,
        cursor: first.nextCursor,
      })
      expect(first.items[0]?.attemptId).toBe(newer)
      expect(second.items[0]?.attemptId).toBe(older)
      expect(second.nextCursor).toBeNull()
    })
  }, 120_000)

  it("loads selected and unanswered answer details only on the attempt detail projection", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const id = await finishAttempt(pool, f)
      expect(await loadAdminAttemptDetail(pool, id)).toMatchObject({
        attemptId: id,
        answers: [
          {
            questionId: f.questionIds[0],
            response: { selectedChoiceIds: [f.choiceIds[0]] },
            score: 1,
            maxScore: 1,
          },
          {
            questionId: f.questionIds[1],
            response: { selectedChoiceIds: [] },
            score: 0,
            maxScore: 1,
          },
        ],
      })
    })
  }, 120_000)

  it("pages learners with tied names and includes activity for learners without attempts", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      await finishAttempt(pool, f)
      const otherId = "11111111-1111-1111-1111-111111111112"
      await pool.query(
        `INSERT INTO student (id, subject_claim, email, display_name)
        VALUES ($1, 'another', 'other@example.test', 'Tom')`,
        [otherId],
      )
      const first = await listAdminLearners(pool, {
        limit: 1,
        cursor: null,
        search: "tom",
      })
      expect(first.items).toHaveLength(1)
      expect(typeof first.items[0].lastAttemptAt).toBe("string")
      expect(first.items).toMatchObject([
        {
          id: f.studentId,
          displayName: "Tom",
          email: "tom@example.test",
          attemptCount: 1,
        },
      ])
      const second = await listAdminLearners(pool, {
        limit: 1,
        cursor: first.nextCursor,
        search: "tom",
      })
      expect(second.items).toEqual([
        {
          id: otherId,
          displayName: "Tom",
          email: "other@example.test",
          attemptCount: 0,
          lastAttemptAt: null,
        },
      ])
      expect(second.nextCursor).toBeNull()
      expect(
        (await listAdminLearners(pool, { ...page, search: "other@example" }))
          .items,
      ).toHaveLength(1)
    })
  }, 120_000)

  it("counts version-aware test status and running/completed attempts globally", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      await finishAttempt(pool, f)
      await pool.query(
        `INSERT INTO attempt (student_id, test_version_id) VALUES ($1, $2)`,
        [f.studentId, f.versionId],
      )
      await addDraft(pool, f.testId)
      expect(await loadAdminOverview(pool, {})).toEqual({
        tests: { total: 1, drafts: 1, published: 0 },
        attempts: { total: 2, inProgress: 1, completed: 1 },
        learners: { total: 1 },
      })
    })
  }, 120_000)

  it("returns null for missing resources and running attempts without finalizing them", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO attempt (student_id, test_version_id,
        started_at, expires_at) VALUES ($1, $2, now() - interval '2 hours', now() - interval '1 hour') RETURNING id`,
        [f.studentId, f.versionId],
      )
      expect(await loadAdminTestDetail(pool, randomUUID())).toBeNull()
      expect(await loadAdminAttemptDetail(pool, randomUUID())).toBeNull()
      expect(await loadAdminAttemptDetail(pool, rows[0].id)).toBeNull()
      const state = await pool.query<{ status: string }>(
        `SELECT status FROM attempt WHERE id = $1`,
        [rows[0].id],
      )
      expect(state.rows[0].status).toBe("in_progress")
    })
  }, 120_000)

  it("rejects invalid cursor shapes and out-of-bounds page sizes", async () => {
    await withDatabase(async (pool) => {
      const lists = [listAdminTests, listAdminResults, listAdminLearners]
      const checks: Array<Promise<unknown>> = []

      for (const list of lists) {
        checks.push(
          expect(
            list(pool, { limit: 20, cursor: "bad" }),
          ).rejects.toBeInstanceOf(InvalidCursorError),
        )
        checks.push(
          expect(
            list(pool, {
              limit: 20,
              cursor: Buffer.from(
                JSON.stringify({ key: "x", id: "not-a-uuid" }),
              ).toString("base64url"),
            }),
          ).rejects.toBeInstanceOf(InvalidCursorError),
        )
        checks.push(
          expect(list(pool, { limit: 101, cursor: null })).rejects.toThrow(),
        )
      }
      await Promise.all(checks)
    })
  }, 120_000)
})
