import { randomUUID } from "node:crypto"
import type pg from "pg"
import { describe, expect, it } from "vitest"
import {
  listPublishedTests,
  type TestCardRow,
} from "../src/repositories/catalog.repository.js"
import { withDatabase } from "./helpers/database.js"
import { seedPublishedTest } from "./helpers/fixtures.js"

// Named top-level predicates rather than inline arrows: every test body
// below already nests describe > it > withDatabase, so an inline arrow
// passed to .find/.some/.map would be a 4th level of nested callback and
// trip max-nested-callbacks. A function declared here is nested one level
// (inside itself), not four.
function byId(id: string) {
  return (card: TestCardRow): boolean => card.id === id
}

function bySlug(slug: string) {
  return (card: TestCardRow): boolean => card.slug === slug
}

function cardId(card: TestCardRow): string {
  return card.id
}

function createdTestId(created: { testId: string }): string {
  return created.testId
}

function includedIn(ids: string[]) {
  return (id: string): boolean => ids.includes(id)
}

/**
 * Minimal published test: no sections. Good enough for cases that only
 * exercise the catalog listing/pagination shape rather than section
 * content, and cheap to insert many of for the keyset pagination case.
 */
async function insertPublishedTest(
  pool: pg.Pool,
  input: { slug: string; title: string },
): Promise<{ testId: string; versionId: string }> {
  const testId = randomUUID()
  const versionId = randomUUID()

  await pool.query(`INSERT INTO test (id, slug) VALUES ($1, $2)`, [
    testId,
    input.slug,
  ])
  await pool.query(
    `INSERT INTO test_version (id, test_id, version, title, duration_seconds)
     VALUES ($1, $2, 1, $3, 1000)`,
    [versionId, testId, input.title],
  )
  await pool.query(
    `UPDATE test_version SET published_at = now() WHERE id = $1`,
    [versionId],
  )
  await pool.query(`UPDATE test SET current_version_id = $1 WHERE id = $2`, [
    versionId,
    testId,
  ])

  return { testId, versionId }
}

/** A draft-only test: never published, so current_version_id stays null. */
async function insertDraftTest(
  pool: pg.Pool,
  input: { slug: string; title: string },
): Promise<{ testId: string; versionId: string }> {
  const testId = randomUUID()
  const versionId = randomUUID()

  await pool.query(`INSERT INTO test (id, slug) VALUES ($1, $2)`, [
    testId,
    input.slug,
  ])
  await pool.query(
    `INSERT INTO test_version (id, test_id, version, title, duration_seconds)
     VALUES ($1, $2, 1, $3, 1000)`,
    [versionId, testId, input.title],
  )

  return { testId, versionId }
}

async function insertInProgressAttempt(
  pool: pg.Pool,
  input: { studentId: string; versionId: string },
): Promise<string> {
  const attemptId = randomUUID()

  await pool.query(
    `INSERT INTO attempt (id, student_id, test_version_id, status)
     VALUES ($1, $2, $3, 'in_progress')`,
    [attemptId, input.studentId, input.versionId],
  )

  return attemptId
}

async function insertFinishedAttempt(
  pool: pg.Pool,
  input: {
    studentId: string
    versionId: string
    submittedAt: Date
    pointsEarned: number
    pointsPossible: number
    percentage: number
  },
): Promise<string> {
  const attemptId = randomUUID()
  const correct = input.pointsEarned > 0 ? 1 : 0

  await pool.query(
    `INSERT INTO attempt (
       id, student_id, test_version_id, status,
       started_at, expires_at, submitted_at,
       points_earned, points_possible, percentage,
       answered_count, unanswered_count, correct_count, incorrect_count, question_count
     ) VALUES (
       $1, $2, $3, 'submitted',
       $4::timestamptz - interval '10 minutes', $4, $4,
       $5, $6, $7,
       1, 0, $8, $9, 1
     )`,
    [
      attemptId,
      input.studentId,
      input.versionId,
      input.submittedAt,
      input.pointsEarned,
      input.pointsPossible,
      input.percentage,
      correct,
      1 - correct,
    ],
  )

  return attemptId
}

describe("catalog repository", () => {
  it("lists only published tests", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      await insertDraftTest(pool, {
        slug: "still-drafting",
        title: "Not Ready Yet",
      })

      const { tests } = await listPublishedTests(pool, {
        studentId: fixture.studentId,
        limit: 20,
        cursor: null,
      })

      expect(tests).toHaveLength(1)
      expect(tests[0]?.id).toBe(fixture.testId)
      expect(tests.some(bySlug("still-drafting"))).toBe(false)
      // The fixture's listening (1 question) and reading (1 question)
      // sections, in ordinal order -- proves the sections LATERAL join
      // and its questionCount aggregate, not just that the row exists.
      expect(tests[0]?.sections).toEqual([
        { type: "listening", questionCount: 1 },
        { type: "reading", questionCount: 1 },
      ])
    })
  }, 120_000)

  it("reports inProgressAttemptId when one is running", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const attemptId = await insertInProgressAttempt(pool, {
        studentId: fixture.studentId,
        versionId: fixture.versionId,
      })

      const { tests } = await listPublishedTests(pool, {
        studentId: fixture.studentId,
        limit: 20,
        cursor: null,
      })

      const card = tests.find(byId(fixture.testId))

      expect(card?.inProgressAttemptId).toBe(attemptId)
      expect(card?.attemptCount).toBe(0)
      expect(card?.bestAttempt).toBeNull()
    })
  }, 120_000)

  it("reports attemptCount and bestAttempt for finished attempts", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      await insertFinishedAttempt(pool, {
        studentId: fixture.studentId,
        versionId: fixture.versionId,
        submittedAt: new Date("2026-01-01T00:00:00.000Z"),
        pointsEarned: 1,
        pointsPossible: 2,
        percentage: 60,
      })
      const bestId = await insertFinishedAttempt(pool, {
        studentId: fixture.studentId,
        versionId: fixture.versionId,
        submittedAt: new Date("2026-01-02T00:00:00.000Z"),
        pointsEarned: 2,
        pointsPossible: 2,
        percentage: 85.25,
      })

      const { tests, summary } = await listPublishedTests(pool, {
        studentId: fixture.studentId,
        limit: 20,
        cursor: null,
      })

      const card = tests.find(byId(fixture.testId))

      expect(card?.attemptCount).toBe(2)
      expect(typeof card?.attemptCount).toBe("number")
      expect(card?.bestAttempt?.attemptId).toBe(bestId)
      expect(card?.bestAttempt?.percentage).toBe(85.25)
      expect(typeof card?.bestAttempt?.percentage).toBe("number")
      expect(card?.bestAttempt?.pointsEarned).toBe(2)
      expect(typeof card?.bestAttempt?.pointsEarned).toBe("number")
      expect(card?.bestAttempt?.pointsPossible).toBe(2)
      expect(card?.bestAttempt?.submittedAt).toBe("2026-01-02T00:00:00.000Z")
      expect(typeof card?.bestAttempt?.submittedAt).toBe("string")
      expect(typeof summary.attemptCount).toBe("number")
      expect(typeof summary.averagePct).toBe("number")
      expect(typeof summary.bestPct).toBe("number")
    })
  }, 120_000)

  it("does not let a finished attempt set inProgressAttemptId", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      await insertFinishedAttempt(pool, {
        studentId: fixture.studentId,
        versionId: fixture.versionId,
        submittedAt: new Date("2026-01-01T00:00:00.000Z"),
        pointsEarned: 1,
        pointsPossible: 2,
        percentage: 50,
      })

      const { tests } = await listPublishedTests(pool, {
        studentId: fixture.studentId,
        limit: 20,
        cursor: null,
      })

      const card = tests.find(byId(fixture.testId))

      expect(card?.inProgressAttemptId).toBeNull()
      expect(card?.attemptCount).toBe(1)
    })
  }, 120_000)

  it("paginates by keyset and the cursor round-trips", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const others = await Promise.all([
        insertPublishedTest(pool, { slug: "alpha", title: "Alpha Test" }),
        insertPublishedTest(pool, { slug: "beta", title: "Beta Test" }),
        insertPublishedTest(pool, { slug: "gamma", title: "Gamma Test" }),
      ])
      const allIds = [fixture.testId, ...others.map(createdTestId)].sort()

      const page1 = await listPublishedTests(pool, {
        studentId: fixture.studentId,
        limit: 2,
        cursor: null,
      })

      expect(page1.tests).toHaveLength(2)
      expect(page1.nextCursor).not.toBeNull()

      const page2 = await listPublishedTests(pool, {
        studentId: fixture.studentId,
        limit: 2,
        cursor: page1.nextCursor,
      })

      expect(page2.tests).toHaveLength(2)
      expect(page2.nextCursor).toBeNull()

      const page1Ids = page1.tests.map(cardId)
      const page2Ids = page2.tests.map(cardId)
      const overlap = page1Ids.filter(includedIn(page2Ids))

      expect(overlap).toHaveLength(0)
      expect([...page1Ids, ...page2Ids].sort()).toEqual(allIds)
    })
  }, 120_000)
})
