import { randomUUID } from "node:crypto"
import type pg from "pg"
import { describe, expect, it } from "vitest"
import {
  listAdminLearners,
  listAdminQuestions,
  listAdminResults,
  listAdminTests,
  loadAdminAttemptDetail,
  loadAdminOverview,
  loadAdminTestDetail,
} from "../src/admin.js"
import { InvalidCursorError } from "../src/repositories/catalog.repository.js"
import { loadForRunner } from "../src/index.js"
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

async function addDraftQuestions(
  pool: pg.Pool,
  versionId: string,
  prompts: string[],
): Promise<string[]> {
  const sectionId = randomUUID()
  const groupId = randomUUID()
  await pool.query(
    `INSERT INTO test_section (id, test_version_id, ordinal, title, type,
       duration_seconds, navigation, allow_answer_change)
     VALUES ($1, $2, 1, 'Draft reading', 'reading', 600, 'free', true)`,
    [sectionId, versionId],
  )
  await pool.query(
    `INSERT INTO question_group (id, test_version_id, test_section_id, ordinal)
     VALUES ($1, $2, $3, 1)`,
    [groupId, versionId, sectionId],
  )

  return Promise.all(
    prompts.map(async (prompt, index) => {
      const id = `f0000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`
      await pool.query(
        `INSERT INTO question (id, test_version_id, question_group_id,
         question_key, ordinal, prompt, type, points)
       VALUES ($1, $2, $3, $4, $5, $6, 'single_choice', 1)`,
        [id, versionId, groupId, `draft-${index}`, index + 1, prompt],
      )
      // Insert in reverse order to exercise the projection's choice ordering.
      await pool.query(
        `INSERT INTO choice (id, question_id, ordinal, label, is_correct)
       VALUES ($2, $1, 2, 'Incorrect', false), ($3, $1, 1, 'Correct', true)`,
        [
          id,
          id.replace("f0000000", "f2000000"),
          id.replace("f0000000", "f1000000"),
        ],
      )

      return id
    }),
  )
}

function questionIds(questions: Array<{ id: string }>): string[] {
  return questions.map((question) => question.id)
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
  it("lists only latest-version questions, including unpublished drafts", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const initial = await listAdminQuestions(pool, {
        ...page,
        testId: f.testId,
      })
      expect(questionIds(initial.items)).toEqual(f.questionIds)

      const versionId = await addDraft(pool, f.testId)
      const ids = await addDraftQuestions(pool, versionId, ["Draft question"])
      expect(
        await listAdminQuestions(pool, { ...page, testId: f.testId }),
      ).toMatchObject({
        items: [{ id: ids[0], prompt: "Draft question" }],
        nextCursor: null,
      })
    })
  }, 120_000)

  it("bounds question pages and continues through tied prompts without repeats", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const versionId = await addDraft(pool, f.testId)
      const ids = await addDraftQuestions(pool, versionId, [
        "Same",
        "Same",
        "Zebra",
      ])
      const first = await listAdminQuestions(pool, { limit: 1, cursor: null })
      expect(questionIds(first.items)).toEqual([ids[0]])
      expect(first.nextCursor).not.toBeNull()
      const second = await listAdminQuestions(pool, {
        limit: 1,
        cursor: first.nextCursor,
      })
      expect(questionIds(second.items)).toEqual([ids[1]])
      expect(second.nextCursor).not.toBeNull()
      const third = await listAdminQuestions(pool, {
        limit: 1,
        cursor: second.nextCursor,
      })
      expect(questionIds(third.items)).toEqual([ids[2]])
      expect(third.nextCursor).toBeNull()
    })
  }, 120_000)

  it("restricts question search to the requested test and matches prompts case-insensitively", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const otherTestId = randomUUID()
      const otherVersionId = randomUUID()
      await pool.query(`INSERT INTO test (id, slug) VALUES ($1, 'other')`, [
        otherTestId,
      ])
      await pool.query(
        `INSERT INTO test_version (id, test_id, version, title, duration_seconds)
         VALUES ($1, $2, 1, 'Other test', 600)`,
        [otherVersionId, otherTestId],
      )
      const ids = await addDraftQuestions(pool, otherVersionId, [
        "What is this draft?",
      ])
      expect(
        (await listAdminQuestions(pool, { ...page, search: "WHAT" })).items,
      ).toHaveLength(2)
      expect(
        (
          await listAdminQuestions(pool, {
            ...page,
            testId: otherTestId,
            search: "WHAT",
          })
        ).items,
      ).toMatchObject([{ id: ids[0] }])
      expect(
        (
          await listAdminQuestions(pool, {
            ...page,
            testId: f.testId,
            search: "WHAT",
          })
        ).items,
      ).toMatchObject([{ id: f.questionIds[0] }])
      expect(
        await listAdminQuestions(pool, { ...page, testId: randomUUID() }),
      ).toEqual({ items: [], nextCursor: null })
      expect(
        await listAdminQuestions(pool, { ...page, search: "absent" }),
      ).toEqual({ items: [], nextCursor: null })
    })
  }, 120_000)

  it("returns ordered correct-choice data only through the admin question surface", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const versionId = await addDraft(pool, f.testId)
      const ids = await addDraftQuestions(pool, versionId, ["Draft question"])
      const result = await listAdminQuestions(pool, page)
      expect(result).toEqual({
        items: [
          {
            id: ids[0],
            prompt: "Draft question",
            choices: [
              {
                id: "f1000000-0000-0000-0000-000000000001",
                label: "Correct",
                isCorrect: true,
              },
              {
                id: "f2000000-0000-0000-0000-000000000001",
                label: "Incorrect",
                isCorrect: false,
              },
            ],
          },
        ],
        nextCursor: null,
      })
      expect(
        JSON.stringify(await loadForRunner(pool, versionId, null)),
      ).not.toContain("isCorrect")
      expect(await import("../src/index.js")).not.toHaveProperty(
        "listAdminQuestions",
      )
    })
  }, 120_000)

  it("rejects cursors owned by other admin lists", async () => {
    await withDatabase(async (pool) => {
      const cursor = Buffer.from(
        JSON.stringify({
          kind: "tests",
          key: "Same",
          id: randomUUID(),
        }),
      ).toString("base64url")
      await expect(
        listAdminQuestions(pool, { limit: 1, cursor }),
      ).rejects.toBeInstanceOf(InvalidCursorError)
    })
  }, 120_000)

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

  it.each(["older published version", "null"])(
    "exposes the latest draft version ID when the publication pointer is %s",
    async (publicationPointer) => {
      await withDatabase(async (pool) => {
        const f = await seedPublishedTest(pool)
        const draftVersionId = await addDraft(pool, f.testId)

        if (publicationPointer === "null") {
          await pool.query(
            `UPDATE test SET current_version_id = NULL WHERE id = $1`,
            [f.testId],
          )
        }

        expect(await loadAdminTestDetail(pool, f.testId)).toMatchObject({
          id: f.testId,
          status: "draft",
          versionId: draftVersionId,
          currentVersionId: publicationPointer === "null" ? null : f.versionId,
        })
      })
    },
    120_000,
  )

  it("lists completed results by historical test version without learner names or emails", async () => {
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

  it("loads the learner name and answer data on the attempt detail projection", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const id = await finishAttempt(pool, f)
      expect(await loadAdminAttemptDetail(pool, id)).toMatchObject({
        attemptId: id,
        learnerName: "Tom",
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

  it.each([
    "2026-02-30",
    "2026-02-30 10:00:00.123456+00",
    "2025-02-29 10:00:00.123456+00",
    "2026-02-28",
  ])(
    "rejects malformed result cursor timestamp %s",
    async (key) => {
      await withDatabase(async (pool) => {
        const cursor = Buffer.from(
          JSON.stringify({ kind: "results", key, id: randomUUID() }),
        ).toString("base64url")
        await expect(
          listAdminResults(pool, { limit: 20, cursor }),
        ).rejects.toBeInstanceOf(InvalidCursorError)
      })
    },
    120_000,
  )

  it("rejects invalid cursor shapes and out-of-bounds page sizes", async () => {
    await withDatabase(async (pool) => {
      const lists = [
        listAdminTests,
        listAdminResults,
        listAdminLearners,
        listAdminQuestions,
      ]
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
