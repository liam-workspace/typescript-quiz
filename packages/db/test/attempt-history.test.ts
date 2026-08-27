import { randomUUID } from "node:crypto"
import type pg from "pg"
import { describe, expect, it } from "vitest"
import { finalizeAttempt } from "../src/repositories/attempt.repository.js"
import {
  listAttemptHistory,
  type AttemptHistoryRow,
} from "../src/repositories/attempt-result.repository.js"
import { withDatabase } from "./helpers/database.js"
import { seedPublishedTest, type Fixture } from "./helpers/fixtures.js"

const NOW = new Date("2026-08-27T10:00:00.000Z")
const OLDER = new Date("2026-08-27T09:00:00.000Z")

async function insertAttempt(
  pool: pg.Pool,
  fixture: Fixture,
  input: {
    id?: string
    status?: "submitted" | "expired"
    submittedAt?: Date
    finished?: boolean
  } = {},
): Promise<string> {
  const id = input.id ?? randomUUID()
  const submittedAt = input.submittedAt ?? NOW
  const status = input.status ?? "submitted"

  await pool.query(
    `INSERT INTO attempt
       (id, student_id, test_version_id, status, started_at, expires_at)
     VALUES ($1, $2, $3, 'in_progress', $4::timestamptz - interval '30 minutes', $4)`,
    [id, fixture.studentId, fixture.versionId, submittedAt],
  )

  if (input.finished !== false) {
    await finalizeAttempt(pool, { attemptId: id, status, submittedAt })
  }

  return id
}

function historyInput(
  fixture: Fixture,
  input: Partial<{
    status: "finished" | "submitted" | "expired"
    limit: number
    cursor: string | null
  }> = {},
) {
  return {
    studentId: fixture.studentId,
    status: input.status ?? ("finished" as const),
    limit: input.limit ?? 20,
    cursor: input.cursor ?? null,
  }
}

function attemptIds(attempts: AttemptHistoryRow[]): string[] {
  return attempts.map((attempt) => attempt.id)
}

function overlappingIds(left: string[], right: string[]): string[] {
  const rightIds = new Set(right)

  return left.filter((id) => rightIds.has(id))
}

describe("listAttemptHistory", () => {
  // A privacy boundary with no negative case is a half-blind guard: every
  // other test here seeds one student, so `WHERE a.student_id = $1` could be
  // deleted entirely and all of them would still pass. This is the test that
  // fails if it ever is -- one child must never see another child's results.
  it("returns nothing belonging to another student", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const mine = await insertAttempt(pool, fixture)

      const otherStudentId = randomUUID()
      await pool.query(
        `INSERT INTO student (id, subject_claim, email, display_name)
         VALUES ($1, 'sub-someone-else', 'else@example.test', 'Someone Else')`,
        [otherStudentId],
      )
      const theirs = randomUUID()
      await pool.query(
        `INSERT INTO attempt
           (id, student_id, test_version_id, status, started_at, expires_at)
         VALUES ($1, $2, $3, 'in_progress',
                 $4::timestamptz - interval '30 minutes', $4)`,
        [theirs, otherStudentId, fixture.versionId, NOW],
      )
      await finalizeAttempt(pool, {
        attemptId: theirs,
        status: "submitted",
        submittedAt: NOW,
      })

      const result = await listAttemptHistory(pool, historyInput(fixture))

      expect(attemptIds(result.attempts)).toEqual([mine])
      expect(attemptIds(result.attempts)).not.toContain(theirs)
    })
  }, 120_000)

  it("lists finished attempts newest-submitted-first", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const olderId = await insertAttempt(pool, fixture, {
        submittedAt: OLDER,
      })
      const newestId = await insertAttempt(pool, fixture)

      const result = await listAttemptHistory(pool, historyInput(fixture))

      expect(attemptIds(result.attempts)).toEqual([newestId, olderId])
      expect(result.attempts[0]).toMatchObject({
        testTitle: "TOEFL Primary — Practice Test 04",
        submittedAt: NOW,
        status: "submitted",
        pointsEarned: 0,
        pointsPossible: 2,
        percentage: 0,
        sections: [
          {
            title: "Listening — Part 1",
            type: "listening",
            pointsEarned: 0,
            pointsPossible: 1,
          },
          {
            title: "Reading",
            type: "reading",
            pointsEarned: 0,
            pointsPossible: 1,
          },
        ],
      })
      expect(typeof result.attempts[0]?.percentage).toBe("number")
    })
  }, 120_000)

  it("includes an expired attempt under the default finished filter", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const expiredId = await insertAttempt(pool, fixture, {
        status: "expired",
      })

      const result = await listAttemptHistory(pool, historyInput(fixture))

      expect(result.attempts).toMatchObject([
        { id: expiredId, status: "expired", submittedAt: NOW },
      ])
    })
  }, 120_000)

  it("excludes an in_progress attempt entirely", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      await insertAttempt(pool, fixture, { finished: false })

      const result = await listAttemptHistory(pool, historyInput(fixture))

      expect(result).toEqual({ attempts: [], nextCursor: null })
    })
  }, 120_000)

  it("filters to only expired when status=expired is given", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const submittedId = await insertAttempt(pool, fixture)
      const expiredId = await insertAttempt(pool, fixture, {
        status: "expired",
        submittedAt: OLDER,
      })

      const result = await listAttemptHistory(
        pool,
        historyInput(fixture, { status: "expired" }),
      )

      expect(attemptIds(result.attempts)).toEqual([expiredId])
      expect(attemptIds(result.attempts)).not.toContain(submittedId)
    })
  }, 120_000)

  it("paginates a submitted_at tie with no overlap or gap", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const newestId = "10000000-0000-0000-0000-000000000001"
      const tiedLowerId = "20000000-0000-0000-0000-000000000001"
      const tiedHigherId = "30000000-0000-0000-0000-000000000001"
      const oldestId = "40000000-0000-0000-0000-000000000001"
      const tiedAt = new Date("2026-08-27T09:30:00.000Z")
      const preciseTiedAt = "2026-08-27T09:30:00.123456Z"

      await insertAttempt(pool, fixture, { id: newestId, submittedAt: NOW })
      await insertAttempt(pool, fixture, {
        id: tiedLowerId,
        submittedAt: tiedAt,
      })
      await insertAttempt(pool, fixture, {
        id: tiedHigherId,
        submittedAt: tiedAt,
      })
      // PostgreSQL retains microseconds while JavaScript Date does not. The
      // cursor must preserve this exact database key or the second tied row
      // disappears when the tie straddles the page boundary.
      await pool.query(
        `UPDATE attempt SET submitted_at = $3::timestamptz
          WHERE id IN ($1, $2)`,
        [tiedLowerId, tiedHigherId, preciseTiedAt],
      )
      await insertAttempt(pool, fixture, {
        id: oldestId,
        submittedAt: OLDER,
      })

      const page1 = await listAttemptHistory(
        pool,
        historyInput(fixture, { limit: 2 }),
      )
      const page2 = await listAttemptHistory(
        pool,
        historyInput(fixture, { limit: 2, cursor: page1.nextCursor }),
      )

      const page1Ids = attemptIds(page1.attempts)
      const page2Ids = attemptIds(page2.attempts)

      expect(page1Ids).toEqual([newestId, tiedLowerId])
      expect(page2Ids).toEqual([tiedHigherId, oldestId])
      expect(overlappingIds(page1Ids, page2Ids)).toEqual([])
      expect([...page1Ids, ...page2Ids]).toEqual([
        newestId,
        tiedLowerId,
        tiedHigherId,
        oldestId,
      ])
      expect(page1.nextCursor).not.toBeNull()
      expect(page2.nextCursor).toBeNull()
    })
  }, 120_000)
})
