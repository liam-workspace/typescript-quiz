import { randomUUID } from "node:crypto"
import type pg from "pg"
import { describe, expect, it } from "vitest"
import { finalizeAttempt } from "../src/repositories/attempt.repository.js"
import {
  claimReminderSend,
  deleteReminderSubscriptionByEndpoint,
  findReminderSubscription,
  listReminderCandidates,
  releaseReminderClaim,
  upsertReminderSubscription,
  type ReminderClaim,
} from "../src/repositories/reminder.repository.js"
import { withDatabase } from "./helpers/database.js"
import { seedPublishedTest, type Fixture } from "./helpers/fixtures.js"

async function subscribe(pool: pg.Pool, studentId: string): Promise<string> {
  const endpoint = `https://push.example.test/${randomUUID()}`

  await upsertReminderSubscription(pool, {
    studentId,
    endpoint,
    p256dh: "k",
    auth: "a",
    timezone: "UTC",
    locale: "en",
    hour: 16,
    minute: 30,
  })

  return endpoint
}

async function finishAttempt(
  pool: pg.Pool,
  fixture: Fixture,
  finished: { at: Date; status?: "submitted" | "expired" },
): Promise<void> {
  const id = randomUUID()

  await pool.query(
    `INSERT INTO attempt (id, student_id, test_version_id, status, started_at, expires_at)
     VALUES ($1, $2, $3, 'in_progress', $4::timestamptz - interval '30 minutes', $4)`,
    [id, fixture.studentId, fixture.versionId, finished.at],
  )
  await finalizeAttempt(pool, {
    attemptId: id,
    status: finished.status ?? "submitted",
    submittedAt: finished.at,
  })
}

async function lastSentOn(
  pool: pg.Pool,
  studentId: string,
): Promise<string | null | undefined> {
  return (await findReminderSubscription(pool, studentId))?.lastSentOn
}

describe("listReminderCandidates", () => {
  it("returns every subscription with the student's latest finished attempt (submitted or expired)", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const endpoint = await subscribe(pool, fixture.studentId)
      await finishAttempt(pool, fixture, {
        at: new Date("2026-01-14T10:00:00Z"),
      })
      await finishAttempt(pool, fixture, {
        at: new Date("2026-01-15T10:00:00Z"),
        status: "expired",
      })

      const candidates = await listReminderCandidates(pool)

      expect(candidates).toHaveLength(1)
      expect(candidates[0]).toMatchObject({
        studentId: fixture.studentId,
        endpoint,
        timezone: "UTC",
        hour: 16,
        minute: 30,
        lastSentOn: null,
      })
      expect(candidates[0].lastFinishedAt).toEqual(
        new Date("2026-01-15T10:00:00Z"),
      )
    })
  })

  it("reports lastFinishedAt null for a student with no finished attempt (an in-progress one does not count)", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      await subscribe(pool, fixture.studentId)
      await pool.query(
        `INSERT INTO attempt (student_id, test_version_id, status) VALUES ($1, $2, 'in_progress')`,
        [fixture.studentId, fixture.versionId],
      )

      const [candidate] = await listReminderCandidates(pool)

      expect(candidate.lastFinishedAt).toBeNull()
    })
  })
})

describe("claimReminderSend / releaseReminderClaim", () => {
  async function subscribedClaim(
    pool: pg.Pool,
    localDate: string,
  ): Promise<ReminderClaim> {
    const fixture = await seedPublishedTest(pool)
    const endpoint = await subscribe(pool, fixture.studentId)

    return { studentId: fixture.studentId, endpoint, localDate }
  }

  it("claims a local date exactly once", async () => {
    await withDatabase(async (pool) => {
      const claim = await subscribedClaim(pool, "2026-01-15")

      expect(await claimReminderSend(pool, claim)).toBe(true)
      expect(await claimReminderSend(pool, claim)).toBe(false)
      expect(
        await claimReminderSend(pool, { ...claim, localDate: "2026-01-16" }),
      ).toBe(true)
    })
  })

  it("lets exactly one of two concurrent claimers win the same local date", async () => {
    await withDatabase(async (pool) => {
      const claim = await subscribedClaim(pool, "2026-01-15")
      const first = await pool.connect()
      const second = await pool.connect()

      try {
        await first.query("BEGIN")
        await second.query("BEGIN")

        const winner = await claimReminderSend(first, claim)
        // Blocks on the row lock until `first` commits, then re-checks the
        // WHERE clause against the committed row.
        const pending = claimReminderSend(second, claim)

        await first.query("COMMIT")

        const loser = await pending

        await second.query("COMMIT")

        expect([winner, loser]).toEqual([true, false])
      } finally {
        first.release()
        second.release()
      }
    })
  })

  it("does not claim when the row's endpoint changed since it was read", async () => {
    await withDatabase(async (pool) => {
      const claim = await subscribedClaim(pool, "2026-01-15")

      expect(
        await claimReminderSend(pool, {
          ...claim,
          endpoint: "https://push.example.test/stale",
        }),
      ).toBe(false)
      expect(await lastSentOn(pool, claim.studentId)).toBeNull()
    })
  })

  it("releases a claim back to the previous date so a failed send can retry", async () => {
    await withDatabase(async (pool) => {
      const claim = await subscribedClaim(pool, "2026-01-15")
      await claimReminderSend(pool, claim)

      await releaseReminderClaim(pool, claim, null)

      expect(await lastSentOn(pool, claim.studentId)).toBeNull()
      expect(await claimReminderSend(pool, claim)).toBe(true)
    })
  })

  it("restores a non-null previous date", async () => {
    await withDatabase(async (pool) => {
      const claim = await subscribedClaim(pool, "2026-01-15")
      await claimReminderSend(pool, { ...claim, localDate: "2026-01-14" })
      await claimReminderSend(pool, claim)

      await releaseReminderClaim(pool, claim, "2026-01-14")

      expect(await lastSentOn(pool, claim.studentId)).toBe("2026-01-14")
    })
  })

  it("leaves the row alone when its date is no longer the one claimed", async () => {
    await withDatabase(async (pool) => {
      const claim = await subscribedClaim(pool, "2026-01-15")
      await claimReminderSend(pool, { ...claim, localDate: "2026-01-16" })

      await releaseReminderClaim(pool, claim, null)

      expect(await lastSentOn(pool, claim.studentId)).toBe("2026-01-16")
    })
  })
})

describe("deleteReminderSubscriptionByEndpoint", () => {
  it("removes the row holding that endpoint and nothing else", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const endpoint = await subscribe(pool, fixture.studentId)

      await deleteReminderSubscriptionByEndpoint(
        pool,
        "https://push.example.test/other",
      )
      expect(
        await findReminderSubscription(pool, fixture.studentId),
      ).not.toBeNull()

      await deleteReminderSubscriptionByEndpoint(pool, endpoint)
      expect(await findReminderSubscription(pool, fixture.studentId)).toBeNull()
    })
  })
})
