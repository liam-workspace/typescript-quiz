import type { PgPool } from "@liam-workspace/node-postgres"
import request from "supertest"
import type { App } from "supertest/types.js"
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { REQUEST_POOL } from "../src/database/tokens.js"
import { RemindersService } from "../src/reminders/reminders.service.js"
import { createFaultInjectingPool } from "./helpers/fault-injecting-pool.js"
import { createTestApp, type TestApp } from "./helpers/app.js"

const SUBSCRIPTION = {
  endpoint: "https://fcm.googleapis.com/send/abc123",
  expirationTime: null,
  keys: {
    p256dh:
      "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
    auth: "tBHItJI5svbpez7KI4CCXg",
  },
}
const BODY = {
  subscription: SUBSCRIPTION,
  timezone: "America/New_York",
  locale: "en",
  hour: 16,
  minute: 30,
}

interface Row {
  student_id: string
  endpoint: string
  locale: string
}

function isReminderInsert(sql: string): boolean {
  return sql.includes("INSERT INTO reminder_subscription")
}

describe("PUT/DELETE /api/me/reminders", () => {
  let app: TestApp | undefined = undefined

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app?.close()
  })

  beforeEach(async () => {
    await pool().query(`DELETE FROM reminder_subscription`)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  function ready(): TestApp {
    if (!app) {
      throw new Error("Application failed to initialize")
    }

    return app
  }

  function pool(): PgPool {
    return ready().get<PgPool>(REQUEST_POOL)
  }

  function configurePush(): void {
    vi.stubEnv("VAPID_PUBLIC_KEY", "test-public")
    vi.stubEnv("VAPID_PRIVATE_KEY", "test-private")
    vi.stubEnv("VAPID_SUBJECT", "mailto:test@example.test")
  }

  function server(): App {
    return ready().http.getHttpServer() as App
  }

  async function provisioned(sub: string): Promise<string> {
    const token = await ready().mint({ sub, email: `${sub}@example.test` })

    await request(server())
      .post("/api/session")
      .set("Authorization", `Bearer ${token}`)

    return token
  }

  async function rows(): Promise<Row[]> {
    const { rows: found } = await pool().query<Row>(
      `SELECT student_id, endpoint, locale FROM reminder_subscription`,
    )

    return found
  }

  describe("when Web Push is configured", () => {
    beforeEach(configurePush)

    it("stores the subscription and answers 204", async () => {
      const token = await provisioned("rem-a")

      await request(server())
        .put("/api/me/reminders")
        .set("Authorization", `Bearer ${token}`)
        .send(BODY)
        .expect(204)

      expect(await rows()).toMatchObject([
        { endpoint: SUBSCRIPTION.endpoint, locale: "en" },
      ])
    })

    it("defaults the locale to en and accepts the other five", async () => {
      const token = await provisioned("rem-locale")
      const { locale: _omitted, ...withoutLocale } = BODY

      await request(server())
        .put("/api/me/reminders")
        .set("Authorization", `Bearer ${token}`)
        .send(withoutLocale)
        .expect(204)
      expect((await rows())[0].locale).toBe("en")

      await request(server())
        .put("/api/me/reminders")
        .set("Authorization", `Bearer ${token}`)
        .send({ ...BODY, locale: "ja" })
        .expect(204)
      expect((await rows())[0].locale).toBe("ja")
    })

    it("a second PUT replaces the first: still one row for the student", async () => {
      const token = await provisioned("rem-replace")
      const put = (endpoint: string) =>
        request(server())
          .put("/api/me/reminders")
          .set("Authorization", `Bearer ${token}`)
          .send({ ...BODY, subscription: { ...SUBSCRIPTION, endpoint } })
          .expect(204)

      await put("https://fcm.googleapis.com/send/one")
      await put("https://fcm.googleapis.com/send/two")

      expect(await rows()).toMatchObject([
        { endpoint: "https://fcm.googleapis.com/send/two" },
      ])
    })

    it("moves an endpoint to the student who subscribes with it", async () => {
      const first = await provisioned("rem-shared-1")
      const second = await provisioned("rem-shared-2")
      const put = (token: string) =>
        request(server())
          .put("/api/me/reminders")
          .set("Authorization", `Bearer ${token}`)
          .send(BODY)
          .expect(204)

      await put(first)
      await put(second)

      const held = await rows()
      expect(held).toHaveLength(1)
      const { rows: owner } = await pool().query<{ subject_claim: string }>(
        `SELECT s.subject_claim FROM student s WHERE s.id = $1`,
        [held[0].student_id],
      )
      expect(owner[0].subject_claim).toBe("rem-shared-2")
    })

    it.each([
      [
        "a non-https endpoint",
        {
          subscription: {
            ...SUBSCRIPTION,
            endpoint: "http://fcm.googleapis.com/x",
          },
        },
      ],
      ["an unknown timezone", { timezone: "Mars/Phobos" }],
      ["an out-of-range hour", { hour: 24 }],
      ["an unknown locale", { locale: "xx" }],
      [
        "a missing key",
        {
          subscription: {
            endpoint: SUBSCRIPTION.endpoint,
            keys: { p256dh: "x" },
          },
        },
      ],
      ["an unexpected field", { admin: true }],
      [
        "an IP-literal endpoint",
        {
          subscription: {
            ...SUBSCRIPTION,
            endpoint: "https://10.0.0.5/send/x",
          },
        },
      ],
      [
        "a localhost endpoint",
        {
          subscription: {
            ...SUBSCRIPTION,
            endpoint: "https://localhost/send/x",
          },
        },
      ],
      [
        "credentials in the endpoint",
        {
          subscription: {
            ...SUBSCRIPTION,
            endpoint: "https://u:p@fcm.googleapis.com/x",
          },
        },
      ],
      [
        "a key that is not base64url",
        {
          subscription: {
            ...SUBSCRIPTION,
            keys: { p256dh: "not base64!", auth: "abc" },
          },
        },
      ],
      [
        "an oversized key",
        {
          subscription: {
            ...SUBSCRIPTION,
            keys: { p256dh: "a".repeat(257), auth: "abc" },
          },
        },
      ],
      ["a fractional minute", { minute: 1.5 }],
      [
        "an unknown push vendor",
        {
          subscription: {
            ...SUBSCRIPTION,
            endpoint: "https://push.example.test/send/x",
          },
        },
      ],
      [
        "a single-label service name",
        {
          subscription: {
            ...SUBSCRIPTION,
            endpoint: "https://api:3000/api/admin",
          },
        },
      ],
      [
        "a non-443 port",
        {
          subscription: {
            ...SUBSCRIPTION,
            endpoint: "https://fcm.googleapis.com:8443/send/x",
          },
        },
      ],
      [
        "an upper-case non-https scheme",
        {
          subscription: {
            ...SUBSCRIPTION,
            endpoint: "HTTP://fcm.googleapis.com/send/x",
          },
        },
      ],
      [
        "a suffix-attack host",
        {
          subscription: {
            ...SUBSCRIPTION,
            endpoint: "https://fcm.googleapis.com.evil.test/x",
          },
        },
      ],
    ])("refuses %s with 400 invalid_body", async (_name, patch) => {
      const token = await provisioned("rem-invalid")

      const res = await request(server())
        .put("/api/me/reminders")
        .set("Authorization", `Bearer ${token}`)
        .send({ ...BODY, ...patch })
        .expect(400)

      expect((res.body as { type: string }).type).toBe("invalid_body")
      expect(await rows()).toHaveLength(0)
    })

    it("accepts an upper-case scheme and host, stores it canonical, and collapses case variants to one row", async () => {
      const first = await provisioned("rem-case-1")
      const second = await provisioned("rem-case-2")
      const put = (token: string, endpoint: string) =>
        request(server())
          .put("/api/me/reminders")
          .set("Authorization", `Bearer ${token}`)
          .send({ ...BODY, subscription: { ...SUBSCRIPTION, endpoint } })
          .expect(204)

      await put(first, "HTTPS://FCM.googleapis.com./send/Abc")
      expect(await rows()).toMatchObject([
        { endpoint: "https://fcm.googleapis.com/send/Abc" },
      ])

      await put(second, "https://fcm.googleapis.com/send/Abc")
      await put(first, "HTTPS://fcm.GOOGLEAPIS.com/send/Abc")

      const held = await rows()
      expect(held).toHaveLength(1)
      expect(held[0].endpoint).toBe("https://fcm.googleapis.com/send/Abc")
    })

    it.each([
      "https://fcm.googleapis.com/fcm/send/x",
      "https://updates.push.services.mozilla.com/wpush/v2/x",
      "https://web.push.apple.com/x",
      "https://bn3p.notify.windows.com/w/?token=x",
    ])("accepts the built-in push vendor %s", async (endpoint) => {
      const token = await provisioned(`rem-vendor-${endpoint.length}`)

      await request(server())
        .put("/api/me/reminders")
        .set("Authorization", `Bearer ${token}`)
        .send({ ...BODY, subscription: { ...SUBSCRIPTION, endpoint } })
        .expect(204)
    })

    it("accepts an extra vendor host from PUSH_ENDPOINT_HOSTS only when configured", async () => {
      const token = await provisioned("rem-extra-host")
      const endpoint = "https://push.example.test/send/x"
      const put = () =>
        request(server())
          .put("/api/me/reminders")
          .set("Authorization", `Bearer ${token}`)
          .send({ ...BODY, subscription: { ...SUBSCRIPTION, endpoint } })

      await put().expect(400)
      vi.stubEnv("PUSH_ENDPOINT_HOSTS", "example.test, other.test")
      await put().expect(204)
    })

    it("redacts the rejected body of a differently-cased route too", async () => {
      const token = await provisioned("rem-case-route")
      await pool().query(`DELETE FROM failed_write`)

      await request(server())
        .put("/api/ME/Reminders")
        .set("Authorization", `Bearer ${token}`)
        .send({ ...BODY, hour: 99 })
        .expect(400)

      const { rows: captured } = await pool().query<{ raw_body: string }>(
        `SELECT raw_body FROM failed_write`,
      )
      expect(captured).toHaveLength(1)
      expect(JSON.stringify(captured)).not.toContain(SUBSCRIPTION.keys.auth)
    })

    it("answers 409 reminder_endpoint_conflict when the endpoint race is lost twice", async () => {
      await provisioned("rem-conflict")
      const failing = createFaultInjectingPool(
        pool(),
        isReminderInsert,
        Object.assign(new Error("duplicate"), {
          code: "23505",
          constraint: "reminder_subscription_endpoint_key",
        }),
      )
      const service = new RemindersService(failing)

      const outcome = service.save("rem-conflict", BODY as never)

      await expect(outcome).rejects.toMatchObject({
        status: 409,
        response: { type: "reminder_endpoint_conflict" },
      })
    })

    it("never keeps a rejected subscription's secrets in failed_write", async () => {
      const token = await provisioned("rem-redact")
      await pool().query(`DELETE FROM failed_write`)

      const res = await request(server())
        .put("/api/me/reminders")
        .set("Authorization", `Bearer ${token}`)
        .send({ ...BODY, hour: 99 })
        .expect(400)

      const { rows: captured } = await pool().query<{ raw_body: string }>(
        `SELECT raw_body FROM failed_write`,
      )
      expect((res.body as { capturedAs?: string }).capturedAs).toBeDefined()
      expect(JSON.stringify(captured)).not.toContain(SUBSCRIPTION.keys.auth)
      expect(JSON.stringify(captured)).not.toContain("fcm.googleapis.com")
    })

    it("refuses an unparseable or oversized body with a problem, never a 500, and keeps no secrets", async () => {
      const token = await provisioned("rem-garbage")
      await pool().query(`DELETE FROM failed_write`)

      const garbage = await request(server())
        .put("/api/me/reminders")
        .set("Authorization", `Bearer ${token}`)
        .set("Content-Type", "application/json")
        .send(`{"subscription":{"keys":{"auth":"${SUBSCRIPTION.keys.auth}"`)
        .expect(400)
      expect((garbage.body as { type: string }).type).toBe("unparseable_body")

      const huge = await request(server())
        .put("/api/me/reminders")
        .set("Authorization", `Bearer ${token}`)
        .set("Content-Type", "application/json")
        .send(JSON.stringify({ ...BODY, pad: "x".repeat(300_000) }))
        .expect(413)
      expect((huge.body as { type: string }).type).toBe("payload_too_large")

      const { rows: captured } = await pool().query<{ raw_body: string }>(
        `SELECT raw_body FROM failed_write`,
      )
      expect(captured.length).toBeGreaterThan(0)
      expect(JSON.stringify(captured)).not.toContain(SUBSCRIPTION.keys.auth)
      expect(await rows()).toHaveLength(0)
    })

    it("answers 401 without a token", async () => {
      await request(server()).put("/api/me/reminders").send(BODY).expect(401)
      await request(server()).delete("/api/me/reminders").expect(401)
    })

    it("answers 404 student_not_provisioned for a token whose student was never created", async () => {
      const token = await ready().mint({
        sub: "rem-ghost",
        email: "ghost@example.test",
      })

      const res = await request(server())
        .put("/api/me/reminders")
        .set("Authorization", `Bearer ${token}`)
        .send(BODY)
        .expect(404)

      expect((res.body as { type: string }).type).toBe(
        "student_not_provisioned",
      )
    })

    it("DELETE removes only the caller's row and is idempotent", async () => {
      const mine = await provisioned("rem-del-1")
      const theirs = await provisioned("rem-del-2")
      await request(server())
        .put("/api/me/reminders")
        .set("Authorization", `Bearer ${mine}`)
        .send(BODY)
        .expect(204)
      await request(server())
        .put("/api/me/reminders")
        .set("Authorization", `Bearer ${theirs}`)
        .send({
          ...BODY,
          subscription: {
            ...SUBSCRIPTION,
            endpoint: "https://fcm.googleapis.com/send/other",
          },
        })
        .expect(204)

      await request(server())
        .delete("/api/me/reminders")
        .set("Authorization", `Bearer ${mine}`)
        .expect(204)
      await request(server())
        .delete("/api/me/reminders")
        .set("Authorization", `Bearer ${mine}`)
        .expect(204)

      expect(await rows()).toMatchObject([
        { endpoint: "https://fcm.googleapis.com/send/other" },
      ])
    })
  })

  describe("when Web Push is not configured", () => {
    beforeEach(() => {
      vi.stubEnv("VAPID_PUBLIC_KEY", "")
      vi.stubEnv("VAPID_PRIVATE_KEY", "")
      vi.stubEnv("VAPID_SUBJECT", "")
    })

    it("PUT answers 503 reminders_not_configured and stores nothing", async () => {
      const token = await provisioned("rem-off")

      const res = await request(server())
        .put("/api/me/reminders")
        .set("Authorization", `Bearer ${token}`)
        .send(BODY)
        .expect(503)

      expect((res.body as { type: string }).type).toBe(
        "reminders_not_configured",
      )
      expect(await rows()).toHaveLength(0)
    })

    it("DELETE still answers 204 so sign-out cleanup never breaks", async () => {
      const token = await provisioned("rem-off-del")

      await request(server())
        .delete("/api/me/reminders")
        .set("Authorization", `Bearer ${token}`)
        .expect(204)
    })
  })
})
