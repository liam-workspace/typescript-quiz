import { describe, expect, it } from "vitest"
import { loadServerConfig } from "../src/config.js"

const BASE = {
  DATABASE_URL: "postgresql://pp:pw@localhost:5432/pp",
  JWKS_URL: "https://auth.test/jwks",
  MEDIA_SIGNING_SECRET: "secret",
}

describe("loadServerConfig — Web Push", () => {
  it("leaves push null when no VAPID variable is set, so the server still boots", () => {
    expect(loadServerConfig(BASE).push).toBeNull()
  })

  it("treats empty strings (compose's VAR:- defaults) as unset", () => {
    expect(
      loadServerConfig({
        ...BASE,
        VAPID_PUBLIC_KEY: "",
        VAPID_PRIVATE_KEY: "  ",
        VAPID_SUBJECT: "",
      }).push,
    ).toBeNull()
  })

  it("reads all three when all three are set", () => {
    expect(
      loadServerConfig({
        ...BASE,
        VAPID_PUBLIC_KEY: "pub",
        VAPID_PRIVATE_KEY: "priv",
        VAPID_SUBJECT: "mailto:ops@example.test",
      }).push,
    ).toEqual({
      publicKey: "pub",
      privateKey: "priv",
      subject: "mailto:ops@example.test",
    })
  })

  it("fails the boot when only some are set — a half-configured key pair is a typo, not a mode", () => {
    expect(() =>
      loadServerConfig({ ...BASE, VAPID_PUBLIC_KEY: "pub" }),
    ).toThrow(
      "VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT must be set together",
    )
  })

  it("reads and normalises PUSH_ENDPOINT_HOSTS, default empty", () => {
    expect(loadServerConfig(BASE).pushEndpointHosts).toEqual([])
    expect(
      loadServerConfig({
        ...BASE,
        PUSH_ENDPOINT_HOSTS: " *.Push.Example.Test, ,.other.example.org ",
      }).pushEndpointHosts,
    ).toEqual(["push.example.test", "other.example.org"])
  })

  it.each(["com", "localhost", "internal", "0.1", "ok.example.test,com"])(
    "refuses to boot on PUSH_ENDPOINT_HOSTS=%s",
    (value) => {
      expect(() =>
        loadServerConfig({ ...BASE, PUSH_ENDPOINT_HOSTS: value }),
      ).toThrow(/PUSH_ENDPOINT_HOSTS entry "(com|localhost|internal|0\.1)"/)
    },
  )
})

describe("loadServerConfig — reminder scheduler", () => {
  it("runs by default outside tests", () => {
    expect(
      loadServerConfig({ ...BASE, NODE_ENV: "production" })
        .reminderSchedulerEnabled,
    ).toBe(true)
    expect(loadServerConfig(BASE).reminderSchedulerEnabled).toBe(true)
  })

  it("is off under NODE_ENV=test unless explicitly enabled", () => {
    expect(process.env.NODE_ENV).toBe("test")
    expect(
      loadServerConfig({ ...BASE, NODE_ENV: "test" }).reminderSchedulerEnabled,
    ).toBe(false)
    expect(
      loadServerConfig({
        ...BASE,
        NODE_ENV: "test",
        REMINDER_SCHEDULER_ENABLED: "true",
      }).reminderSchedulerEnabled,
    ).toBe(true)
  })

  it("can be switched off in production", () => {
    expect(
      loadServerConfig({
        ...BASE,
        NODE_ENV: "production",
        REMINDER_SCHEDULER_ENABLED: "false",
      }).reminderSchedulerEnabled,
    ).toBe(false)
  })
})
