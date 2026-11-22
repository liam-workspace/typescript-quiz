import { randomUUID } from "node:crypto"
import type { PgPool } from "@liam-workspace/node-postgres"
import { Logger } from "@nestjs/common"
import type { Clock } from "@pp/common"
import {
  createJobPool,
  findReminderSubscription,
  loadDbConfig,
  migrateToLatest,
  upsertReminderSubscription,
  upsertStudentBySubject,
  type ReminderLocale,
} from "@pp/db"
import type pg from "pg"
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
  vi,
} from "vitest"
import type {
  PushMessage,
  PushOutcome,
  PushSender,
  PushTarget,
} from "../src/reminders/push-sender.js"
import { reminderMessage } from "../src/reminders/reminder-messages.js"
import {
  REMINDER_LOCK_KEY,
  REMINDER_RETRY_MINUTES,
  REMINDER_TICK_MS,
  ReminderScheduler,
  type ReminderSchedulerConfig,
} from "../src/reminders/reminder.scheduler.js"
import { seedWriteFixture } from "./helpers/write-fixture.js"

class FakeSender implements PushSender {
  readonly calls: Array<{ target: PushTarget; message: PushMessage }> = []
  outcome: (target: PushTarget) => PushOutcome | Promise<PushOutcome> = () => ({
    kind: "sent",
  })

  send(target: PushTarget, message: PushMessage): Promise<PushOutcome> {
    this.calls.push({ target, message })

    return Promise.resolve(this.outcome(target))
  }
}

const CONFIG: ReminderSchedulerConfig = {
  enabled: true,
  pushEndpointHosts: [],
}
const MINUTE = 60_000
// 21:30Z is 16:30 EST in January: exactly the reminder time below.
const DUE = new Date("2026-01-15T21:30:00.000Z")
const BODIES: Record<ReminderLocale, string> = {
  de: "Zeit für ein bisschen Übung 🎧",
  en: "Time for a little practice 🎧",
  es: "Hora de practicar un poquito 🎧",
  fr: "C'est l'heure de s'entraîner un peu 🎧",
  it: "È ora di fare un po' di pratica 🎧",
  ja: "ちょっと練習する時間だよ 🎧",
}

describe("reminderMessage", () => {
  it.each(Object.entries(BODIES))(
    "localises the body for %s and carries only fixed text",
    (locale, body) => {
      expect(reminderMessage(locale as ReminderLocale)).toEqual({
        title: "Primary Practice",
        body,
        url: "/",
      })
    },
  )
})

describe("ReminderScheduler.tick (real Postgres)", () => {
  const handle: { pool?: pg.Pool; scheduler?: ReminderScheduler } = {}
  let now = DUE
  const clock: Clock = { now: () => now }
  let sender = new FakeSender()
  const logged: string[] = []

  function pool(): pg.Pool {
    if (!handle.pool) {
      throw new Error("pool not created")
    }

    return handle.pool
  }

  function scheduler(): ReminderScheduler {
    if (!handle.scheduler) {
      throw new Error("scheduler not created")
    }

    return handle.scheduler
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = inject("postgresConnectionUri")
    await migrateToLatest(process.env.DATABASE_URL)
    handle.pool = createJobPool(loadDbConfig())
  })

  afterAll(async () => {
    await pool().end()
  })

  beforeEach(async () => {
    await pool().query(`DELETE FROM reminder_subscription`)
    now = DUE
    sender = new FakeSender()
    handle.scheduler = new ReminderScheduler(pool(), sender, clock, CONFIG)
    logged.length = 0

    for (const level of ["log", "warn", "error"] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation(
        (message: unknown) => {
          logged.push(String(message))
        },
      )
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  interface Subscribed {
    readonly studentId: string
    readonly endpoint: string
    readonly email: string
    readonly displayName: string
  }

  async function subscribed(
    overrides: {
      locale?: ReminderLocale
      timezone?: string
      endpoint?: string
    } = {},
  ): Promise<Subscribed> {
    const email = `${randomUUID()}@example.test`
    const displayName = `Student ${randomUUID()}`
    const { student } = await upsertStudentBySubject(pool(), {
      subjectClaim: `sched-${randomUUID()}`,
      email,
      displayName,
    })
    const endpoint =
      overrides.endpoint ??
      `https://fcm.googleapis.com/fcm/send/${randomUUID()}`

    await upsertReminderSubscription(pool(), {
      studentId: student.id,
      endpoint,
      p256dh: `p256dh-${randomUUID()}`,
      auth: `auth-${randomUUID()}`,
      timezone: overrides.timezone ?? "America/New_York",
      locale: overrides.locale ?? "en",
      hour: 16,
      minute: 30,
    })

    return { studentId: student.id, endpoint, email, displayName }
  }

  async function lastSentOn(studentId: string): Promise<string | null> {
    return (
      (await findReminderSubscription(pool(), studentId))?.lastSentOn ?? null
    )
  }

  it("sends one notification at the local time, with a payload that names nobody", async () => {
    const student = await subscribed()

    const summary = await scheduler().tick()

    expect(summary).toEqual({
      status: "ran",
      sent: 1,
      failed: 0,
      rejected: 0,
      removed: 0,
      skipped: 0,
      invalid: 0,
    })
    expect(sender.calls).toHaveLength(1)
    expect(sender.calls[0].target.endpoint).toBe(student.endpoint)
    expect(sender.calls[0].message).toEqual({
      title: "Primary Practice",
      body: "Time for a little practice 🎧",
      url: "/",
    })

    const payload = JSON.stringify(sender.calls[0].message)

    for (const personal of [
      student.studentId,
      student.endpoint,
      student.email,
      student.displayName,
    ]) {
      expect(payload).not.toContain(personal)
    }

    expect(await lastSentOn(student.studentId)).toBe("2026-01-15")
  })

  it.each(Object.entries(BODIES))(
    "localises the pushed body to the subscription's locale (%s)",
    async (locale, body) => {
      await subscribed({ locale: locale as ReminderLocale })

      await scheduler().tick()

      expect(sender.calls[0].message.body).toBe(body)
    },
  )

  it("does not send a second time for the same local day, even from a fresh process", async () => {
    await subscribed()

    await scheduler().tick()
    now = new Date(DUE.getTime() + MINUTE)
    const second = await scheduler().tick()
    const restarted = new ReminderScheduler(pool(), sender, clock, CONFIG)
    now = new Date(DUE.getTime() + 2 * MINUTE)
    const third = await restarted.tick()

    expect(second.sent).toBe(0)
    expect(third.sent).toBe(0)
    expect(sender.calls).toHaveLength(1)
  })

  it("sends again on the next local day", async () => {
    await subscribed()

    await scheduler().tick()
    now = new Date(DUE.getTime() + 24 * 60 * MINUTE)
    const next = await scheduler().tick()

    expect(next.sent).toBe(1)
    expect(sender.calls).toHaveLength(2)
  })

  it("sends nothing before the local time", async () => {
    await subscribed()
    now = new Date(DUE.getTime() - MINUTE)

    expect(await scheduler().tick()).toMatchObject({ status: "ran", sent: 0 })
    expect(sender.calls).toHaveLength(0)
  })

  it("claims the local date BEFORE the request leaves", async () => {
    const student = await subscribed()
    let claimedDuringSend: string | null = "not called"
    sender.outcome = async () => {
      claimedDuringSend = await lastSentOn(student.studentId)

      return { kind: "sent" }
    }

    await scheduler().tick()

    expect(claimedDuringSend).toBe("2026-01-15")
  })

  it("deletes the subscription when the push service says it is gone (404/410)", async () => {
    const { studentId } = await subscribed()
    sender.outcome = () => ({ kind: "gone" })

    const summary = await scheduler().tick()

    expect(summary).toMatchObject({ sent: 0, removed: 1, failed: 0 })
    expect(await findReminderSubscription(pool(), studentId)).toBeNull()
  })

  it("deletes, and never requests, a stored endpoint that fails the send-time allow-list", async () => {
    // Admitted earlier (say under a PUSH_ENDPOINT_HOSTS entry since removed),
    // not allowed by the config the scheduler runs with now.
    const stale = await subscribed({
      endpoint: "https://push.example.test/legacy",
    })
    const allowed = await subscribed()

    const summary = await scheduler().tick()

    expect(summary).toMatchObject({ sent: 1, removed: 1 })
    expect(sender.calls.map((call) => call.target.endpoint)).toEqual([
      allowed.endpoint,
    ])
    expect(await findReminderSubscription(pool(), stale.studentId)).toBeNull()
    expect(logged.join("\n")).toContain(stale.studentId)
    expect(logged.join("\n")).not.toContain("push.example.test")
  })

  it("requests an endpoint admitted by the configured extra host suffixes", async () => {
    const extra = await subscribed({
      endpoint: "https://push.example.test/current",
    })
    const configured = new ReminderScheduler(pool(), sender, clock, {
      ...CONFIG,
      pushEndpointHosts: ["push.example.test"],
    })

    expect(await configured.tick()).toMatchObject({ sent: 1, removed: 0 })
    expect(sender.calls[0].target.endpoint).toBe(extra.endpoint)
  })

  it.each([
    { label: "503", outcome: { kind: "failed", statusCode: 503 } },
    { label: "429", outcome: { kind: "failed", statusCode: 429 } },
    { label: "a timeout", outcome: { kind: "failed", statusCode: null } },
  ] as const)(
    "hands the claim back on $label and retries only after the back-off, never twice a day",
    async ({ outcome }) => {
      const { studentId } = await subscribed()
      sender.outcome = () => outcome

      expect(await scheduler().tick()).toMatchObject({ sent: 0, failed: 1 })
      expect(await lastSentOn(studentId)).toBeNull()

      // Every minute of the back-off: no request at all.
      for (let minute = 1; minute < REMINDER_RETRY_MINUTES; minute += 1) {
        now = new Date(DUE.getTime() + minute * MINUTE)
        // oxlint-disable-next-line no-await-in-loop -- ticks are sequential by design
        expect(await scheduler().tick()).toMatchObject({ sent: 0, skipped: 1 })
      }

      expect(sender.calls).toHaveLength(1)

      sender.outcome = () => ({ kind: "sent" })
      now = new Date(DUE.getTime() + REMINDER_RETRY_MINUTES * MINUTE)
      const retry = await scheduler().tick()

      expect(retry.sent).toBe(1)
      expect(sender.calls).toHaveLength(2)
      expect(await lastSentOn(studentId)).toBe("2026-01-15")

      now = new Date(DUE.getTime() + 2 * REMINDER_RETRY_MINUTES * MINUTE)
      expect((await scheduler().tick()).sent).toBe(0)
      expect(sender.calls).toHaveLength(2)
    },
  )

  it("treats a sender that throws as a transient failure and keeps going with the others", async () => {
    const broken = await subscribed()
    const healthy = await subscribed()
    sender.outcome = (target) => {
      if (target.endpoint === broken.endpoint) {
        throw new Error(`boom ${target.endpoint}`)
      }

      return { kind: "sent" }
    }

    const summary = await scheduler().tick()

    expect(summary).toMatchObject({ sent: 1, failed: 1 })
    expect(await lastSentOn(broken.studentId)).toBeNull()
    expect(await lastSentOn(healthy.studentId)).toBe("2026-01-15")
  })

  it("never logs the endpoint or the subscription keys", async () => {
    const student = await subscribed()
    const row = await findReminderSubscription(pool(), student.studentId)
    sender.outcome = () => ({ kind: "failed", statusCode: 500 })

    await scheduler().tick()

    const output = logged.join("\n")

    expect(logged.length).toBeGreaterThan(0)
    expect(output).not.toContain(student.endpoint)
    expect(output).not.toContain(row?.p256dh)
    expect(output).not.toContain(row?.auth)
  })

  it("skips a student whose attempt finished earlier the same local day", async () => {
    const student = await subscribed()
    const fixture = await seedWriteFixture(pool(), student.studentId)
    // 10:00 EST on the reminder's local day.
    await pool().query(
      `UPDATE attempt
          SET status = 'submitted',
              started_at = '2026-01-15T14:30:00Z',
              expires_at = '2026-01-15T16:00:00Z',
              submitted_at = '2026-01-15T15:00:00Z',
              points_earned = 0, points_possible = 2, percentage = 0,
              answered_count = 0, unanswered_count = 2, correct_count = 0,
              incorrect_count = 0, question_count = 2
        WHERE id = $1`,
      [fixture.attemptId],
    )

    const summary = await scheduler().tick()

    expect(summary).toMatchObject({ sent: 0, skipped: 1 })
    expect(sender.calls).toHaveLength(0)
    expect(await lastSentOn(student.studentId)).toBeNull()
  })

  it.each([400, 401, 403, 413])(
    "keeps the claim and the row on a %i rejection: no retry today, a fresh try tomorrow",
    async (statusCode) => {
      const { studentId } = await subscribed()
      sender.outcome = () => ({ kind: "rejected", statusCode })

      expect(await scheduler().tick()).toMatchObject({
        sent: 0,
        rejected: 1,
        failed: 0,
        removed: 0,
      })
      expect(await lastSentOn(studentId)).toBe("2026-01-15")
      expect(await findReminderSubscription(pool(), studentId)).not.toBeNull()
      expect(logged.filter((line) => line.includes(studentId))).toHaveLength(1)
      expect(logged.join("\n")).toContain(String(statusCode))

      // The rest of today's grace window, every 15 minutes (past any
      // back-off): never a second request.
      for (
        let minute = REMINDER_RETRY_MINUTES;
        minute < 360;
        minute += REMINDER_RETRY_MINUTES
      ) {
        now = new Date(DUE.getTime() + minute * MINUTE)
        // oxlint-disable-next-line no-await-in-loop -- ticks are sequential by design
        expect((await scheduler().tick()).sent).toBe(0)
      }

      expect(sender.calls).toHaveLength(1)

      sender.outcome = () => ({ kind: "sent" })
      now = new Date(DUE.getTime() + 24 * 60 * MINUTE)

      expect((await scheduler().tick()).sent).toBe(1)
      expect(sender.calls).toHaveLength(2)
      expect(await lastSentOn(studentId)).toBe("2026-01-16")
    },
  )

  it("counts a row with an unknown timezone and logs its student once per process", async () => {
    const { studentId } = await subscribed({ timezone: "Mars/Phobos" })

    expect(await scheduler().tick()).toMatchObject({ sent: 0, invalid: 1 })
    now = new Date(DUE.getTime() + MINUTE)
    expect(await scheduler().tick()).toMatchObject({ sent: 0, invalid: 1 })

    expect(logged.filter((line) => line.includes(studentId))).toHaveLength(1)
    expect(sender.calls).toHaveLength(0)
  })

  it("the advisory lock keeps a second instance out of a tick while one is running it", async () => {
    await subscribed()
    const holder = await pool().connect()

    try {
      await holder.query("BEGIN")
      await holder.query("SELECT pg_advisory_xact_lock($1)", [
        REMINDER_LOCK_KEY,
      ])

      const summary = await scheduler().tick()

      expect(summary).toMatchObject({ status: "locked", sent: 0 })
      expect(sender.calls).toHaveLength(0)
    } finally {
      await holder.query("ROLLBACK")
      holder.release()
    }

    expect((await scheduler().tick()).sent).toBe(1)
  })

  it("at-most-once delivery via the atomic claim: two replicas ticking concurrently send each reminder exactly once", async () => {
    const students = await Promise.all(
      Array.from({ length: 5 }, () => subscribed()),
    )
    const otherPool = createJobPool(loadDbConfig())
    const otherSender = new FakeSender()
    const other = new ReminderScheduler(otherPool, otherSender, clock, CONFIG)

    try {
      const summaries = []

      for (let minute = 0; minute < 3; minute += 1) {
        now = new Date(DUE.getTime() + minute * MINUTE)
        // oxlint-disable-next-line no-await-in-loop -- each minute's pair runs concurrently
        const pair = await Promise.all([scheduler().tick(), other.tick()])

        summaries.push(...pair)
      }

      const endpoints = [...sender.calls, ...otherSender.calls].map(
        (call) => call.target.endpoint,
      )

      expect(endpoints).toHaveLength(students.length)
      expect(new Set(endpoints)).toEqual(
        new Set(students.map((student) => student.endpoint)),
      )
      expect(summaries.reduce((total, run) => total + run.sent, 0)).toBe(5)
    } finally {
      await otherPool.end()
    }
  })

  it("is inert when push is not configured (no sender)", async () => {
    const { studentId } = await subscribed()
    const inert = new ReminderScheduler(pool(), null, clock, CONFIG)

    expect(await inert.tick()).toMatchObject({ status: "disabled", sent: 0 })
    expect(await lastSentOn(studentId)).toBeNull()
  })
})

describe("ReminderScheduler lifecycle (fake timers, no database)", () => {
  const clock: Clock = { now: () => DUE }

  function failingPool(): { pool: PgPool; attempts: () => number } {
    let attempts = 0
    const pool = {
      connect: () => {
        attempts += 1

        return Promise.reject(new Error("database unavailable"))
      },
    } as unknown as PgPool

    return { pool, attempts: () => attempts }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("ticks every 60 s, survives a tick that throws, and stops cleanly on destroy", async () => {
    const logError = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined)
    const { pool, attempts } = failingPool()
    const scheduler = new ReminderScheduler(
      pool,
      new FakeSender(),
      clock,
      CONFIG,
    )

    scheduler.onModuleInit()
    expect(vi.getTimerCount()).toBe(1)

    await vi.advanceTimersByTimeAsync(REMINDER_TICK_MS - 1)
    expect(attempts()).toBe(0)

    await vi.advanceTimersByTimeAsync(1)
    expect(attempts()).toBe(1)

    await vi.advanceTimersByTimeAsync(REMINDER_TICK_MS)
    expect(attempts()).toBe(2)
    expect(logError).toHaveBeenCalledTimes(2)

    await scheduler.onModuleDestroy()
    expect(vi.getTimerCount()).toBe(0)

    await vi.advanceTimersByTimeAsync(5 * REMINDER_TICK_MS)
    expect(attempts()).toBe(2)
  })

  it("reports a failed tick as an error, not as a run", async () => {
    const { pool } = failingPool()
    const scheduler = new ReminderScheduler(
      pool,
      new FakeSender(),
      clock,
      CONFIG,
    )

    expect(await scheduler.tick()).toMatchObject({ status: "error", sent: 0 })
  })

  it("waits for an in-flight tick on destroy", async () => {
    let release: () => void = () => undefined
    const pool = {
      connect: () =>
        new Promise((_resolve, reject) => {
          release = () => {
            reject(new Error("late"))
          }
        }),
    } as unknown as PgPool
    const scheduler = new ReminderScheduler(
      pool,
      new FakeSender(),
      clock,
      CONFIG,
    )
    let destroyed = false

    scheduler.onModuleInit()
    await vi.advanceTimersByTimeAsync(REMINDER_TICK_MS)

    const destroying = scheduler.onModuleDestroy().then(() => {
      destroyed = true
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(destroyed).toBe(false)

    release()
    await destroying
    expect(destroyed).toBe(true)
  })

  it("never overlaps ticks: a tick still running makes the next one a no-op", async () => {
    let connects = 0
    let unblock: () => void = () => undefined
    const blocked = new Promise<void>((resolve) => {
      unblock = resolve
    })
    const pool = {
      connect: () => {
        connects += 1

        return blocked.then(() => {
          throw new Error("released")
        })
      },
    } as unknown as PgPool
    const scheduler = new ReminderScheduler(
      pool,
      new FakeSender(),
      clock,
      CONFIG,
    )

    const first = scheduler.tick()

    expect(await scheduler.tick()).toMatchObject({ status: "locked" })
    expect(connects).toBe(1)

    unblock()
    expect(await first).toMatchObject({ status: "error" })
  })

  it.each([
    { label: "VAPID is unconfigured (no sender)", sender: null, enabled: true },
    {
      label:
        "the scheduler is disabled (tests, REMINDER_SCHEDULER_ENABLED=false)",
      sender: new FakeSender(),
      enabled: false,
    },
  ])("starts no timer when $label", async ({ sender, enabled }) => {
    const { pool, attempts } = failingPool()
    const scheduler = new ReminderScheduler(pool, sender, clock, {
      ...CONFIG,
      enabled,
    })

    scheduler.onModuleInit()
    expect(vi.getTimerCount()).toBe(0)

    await vi.advanceTimersByTimeAsync(5 * REMINDER_TICK_MS)
    expect(attempts()).toBe(0)

    await scheduler.onModuleDestroy()
  })
})
