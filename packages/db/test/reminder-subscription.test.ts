import { randomUUID } from "node:crypto"
import { runner } from "node-pg-migrate"
import { fileURLToPath } from "node:url"
import type pg from "pg"
import { describe, expect, it } from "vitest"
import { upsertStudentBySubject } from "../src/index.js"
import {
  deleteReminderSubscription,
  findReminderSubscription,
  upsertReminderSubscription,
  type ReminderSubscriptionInput,
} from "../src/repositories/reminder.repository.js"
import { migrateToLatest } from "../src/migrate.js"
import { withDatabase } from "./helpers/database.js"

async function newStudent(pool: pg.Pool): Promise<string> {
  const { student } = await upsertStudentBySubject(pool, {
    subjectClaim: `sub-${randomUUID()}`,
    email: `${randomUUID()}@example.test`,
    displayName: "Reminder",
  })

  return student.id
}

function input(
  studentId: string,
  overrides: Partial<ReminderSubscriptionInput> = {},
): ReminderSubscriptionInput {
  return {
    studentId,
    endpoint: `https://push.example.test/${randomUUID()}`,
    p256dh: "p256dh-key",
    auth: "auth-secret",
    timezone: "America/New_York",
    locale: "en",
    hour: 16,
    minute: 30,
    ...overrides,
  }
}

const RAW_INSERT = `INSERT INTO reminder_subscription
  (student_id, endpoint, p256dh, auth, timezone, hour, minute)
  VALUES ($1, $2, 'k', 'a', 'UTC', $3, $4)`

describe("migration 1017 — reminder_subscription constraints", () => {
  it("refuses an out-of-range hour or minute", async () => {
    await withDatabase(async (pool) => {
      const studentId = await newStudent(pool)

      await expect(
        pool.query(RAW_INSERT, [studentId, "https://p.example.test/a", 24, 0]),
      ).rejects.toMatchObject({ constraint: "reminder_hour_range" })
      await expect(
        pool.query(RAW_INSERT, [studentId, "https://p.example.test/b", 8, 60]),
      ).rejects.toMatchObject({ constraint: "reminder_minute_range" })
    })
  })

  it("refuses a non-https endpoint", async () => {
    await withDatabase(async (pool) => {
      const studentId = await newStudent(pool)

      await expect(
        pool.query(RAW_INSERT, [studentId, "http://p.example.test/a", 8, 0]),
      ).rejects.toMatchObject({ constraint: "reminder_endpoint_https" })
    })
  })

  it("holds one subscription per student and one student per endpoint", async () => {
    await withDatabase(async (pool) => {
      const first = await newStudent(pool)
      const second = await newStudent(pool)

      await pool.query(RAW_INSERT, [first, "https://p.example.test/x", 8, 0])
      await expect(
        pool.query(RAW_INSERT, [first, "https://p.example.test/y", 8, 0]),
      ).rejects.toMatchObject({ constraint: "reminder_subscription_pkey" })
      await expect(
        pool.query(RAW_INSERT, [second, "https://p.example.test/x", 8, 0]),
      ).rejects.toMatchObject({
        constraint: "reminder_subscription_endpoint_key",
      })
    })
  })

  it("is deleted with its student", async () => {
    await withDatabase(async (pool) => {
      const studentId = await newStudent(pool)
      await pool.query(RAW_INSERT, [
        studentId,
        "https://p.example.test/z",
        8,
        0,
      ])

      await pool.query(`DELETE FROM student WHERE id = $1`, [studentId])

      const { rows } = await pool.query(`SELECT 1 FROM reminder_subscription`)
      expect(rows).toHaveLength(0)
    })
  })
})

describe("reminder repository — upsert / find / delete", () => {
  it("stores and reads back a subscription", async () => {
    await withDatabase(async (pool) => {
      const studentId = await newStudent(pool)
      const saved = await upsertReminderSubscription(
        pool,
        input(studentId, { locale: "ja", timezone: "Asia/Tokyo" }),
      )

      expect(saved).toMatchObject({
        studentId,
        locale: "ja",
        timezone: "Asia/Tokyo",
        hour: 16,
        minute: 30,
        lastSentOn: null,
      })
      expect(await findReminderSubscription(pool, studentId)).toEqual(saved)
    })
  })

  it("replaces the student's previous subscription instead of adding a second row", async () => {
    await withDatabase(async (pool) => {
      const studentId = await newStudent(pool)
      await upsertReminderSubscription(pool, input(studentId))
      const replacement = input(studentId, { locale: "fr" })

      await upsertReminderSubscription(pool, replacement)

      const { rows } = await pool.query<{ endpoint: string }>(
        `SELECT endpoint FROM reminder_subscription`,
      )
      expect(rows).toEqual([{ endpoint: replacement.endpoint }])
    })
  })

  it("keeps last_sent_on when the same endpoint re-subscribes, clears it for a new endpoint", async () => {
    await withDatabase(async (pool) => {
      const studentId = await newStudent(pool)
      const original = input(studentId)
      await upsertReminderSubscription(pool, original)
      await pool.query(
        `UPDATE reminder_subscription SET last_sent_on = '2026-01-15' WHERE student_id = $1`,
        [studentId],
      )

      const same = await upsertReminderSubscription(pool, original)
      expect(same.lastSentOn).toBe("2026-01-15")

      const moved = await upsertReminderSubscription(pool, input(studentId))
      expect(moved.lastSentOn).toBeNull()
    })
  })

  it("moves an endpoint to the student who subscribes with it (shared phone)", async () => {
    await withDatabase(async (pool) => {
      const first = await newStudent(pool)
      const second = await newStudent(pool)
      const shared = input(first)
      await upsertReminderSubscription(pool, shared)

      await upsertReminderSubscription(pool, { ...shared, studentId: second })

      expect(await findReminderSubscription(pool, first)).toBeNull()
      expect(await findReminderSubscription(pool, second)).toMatchObject({
        endpoint: shared.endpoint,
      })
    })
  })

  it("deletes only the named student's row and reports whether one existed", async () => {
    await withDatabase(async (pool) => {
      const first = await newStudent(pool)
      const second = await newStudent(pool)
      await upsertReminderSubscription(pool, input(first))
      await upsertReminderSubscription(pool, input(second))

      expect(await deleteReminderSubscription(pool, first)).toBe(true)
      expect(await deleteReminderSubscription(pool, first)).toBe(false)
      expect(await findReminderSubscription(pool, second)).not.toBeNull()
    })
  })
})

describe("migration 1017 — down and up again", () => {
  it("drops the table cleanly and re-applies", async () => {
    await withDatabase(async (pool, { databaseUrl }) => {
      const regclass = () =>
        pool.query<{ t: string | null }>(
          `SELECT to_regclass('reminder_subscription') AS t`,
        )
      expect((await regclass()).rows[0].t).not.toBeNull()

      // Roll back 1017 and anything applied after it, whatever is newest.
      const { rows: applied } = await pool.query<{ name: string }>(
        `SELECT name FROM pp_migrations WHERE name >= $1 ORDER BY name`,
        ["1017_reminder_subscription"],
      )
      expect(applied[0].name).toBe("1017_reminder_subscription")

      await runner({
        databaseUrl,
        dir: fileURLToPath(new URL("../migrations", import.meta.url)),
        direction: "down",
        count: applied.length,
        migrationsTable: "pp_migrations",
      })
      expect((await regclass()).rows[0].t).toBeNull()

      await migrateToLatest(databaseUrl)
      expect((await regclass()).rows[0].t).not.toBeNull()
    })
  }, 120_000)
})

describe("reminder repository — endpoint race", () => {
  it("retries once when another student claims the endpoint mid-upsert", async () => {
    const calls: string[] = []
    let inserts = 0
    const db = {
      query: (sql: string) => {
        calls.push(sql.trimStart().split(/\s/)[0])

        if (sql.includes("INSERT")) {
          inserts += 1

          if (inserts === 1) {
            return Promise.reject(
              Object.assign(new Error("duplicate"), {
                code: "23505",
                constraint: "reminder_subscription_endpoint_key",
              }),
            )
          }

          return Promise.resolve({
            rows: [
              {
                student_id: "s",
                endpoint: "https://p.example.test/e",
                p256dh: "k",
                auth: "a",
                timezone: "UTC",
                locale: "en",
                hour: 8,
                minute: 0,
                last_sent_on: null,
              },
            ],
          })
        }

        return Promise.resolve({ rows: [], rowCount: 0 })
      },
    }

    const saved = await upsertReminderSubscription(
      db as never,
      input("s", { endpoint: "https://p.example.test/e" }),
    )

    expect(saved.studentId).toBe("s")
    expect(calls).toEqual(["DELETE", "INSERT", "DELETE", "INSERT"])
  })

  it("does not swallow other database errors", async () => {
    const db = {
      query: () =>
        Promise.reject(Object.assign(new Error("boom"), { code: "XX000" })),
    }

    await expect(
      upsertReminderSubscription(db as never, input("s")),
    ).rejects.toThrow("boom")
  })
})
