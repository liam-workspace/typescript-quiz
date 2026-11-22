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
})
