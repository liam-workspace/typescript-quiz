// Deliberately the deprecated parser: web-push 3.x resolves the request host
// with it, so the stored string must read identically under both parsers.
/* oxlint-disable typescript/no-deprecated */
import { parse as legacyParse } from "node:url"
import { describe, expect, it } from "vitest"
import {
  canonicalPushEndpoint,
  isAllowedPushEndpoint,
  isValidHostSuffix,
} from "../src/reminders/push-endpoint.js"

describe("isAllowedPushEndpoint", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/abc",
    "https://api.push.apple.com/3/device/abc",
    "https://db5p.notify.windows.com/w/?token=abc",
    "https://fcm.googleapis.com:443/x",
    "HTTPS://FCM.GOOGLEAPIS.COM/x",
  ])("allows %s", (url) => {
    expect(isAllowedPushEndpoint(url)).toBe(true)
  })

  it.each([
    ["trailing-dot localhost", "https://localhost./x"],
    ["localhost", "https://localhost/x"],
    ["a .localhost host", "https://foo.localhost./x"],
    ["a single-label service", "https://postgres:5432/x"],
    ["a single-label service on 443", "https://api/x"],
    ["cloud metadata", "https://metadata.google.internal/x"],
    ["a .local host", "https://printer.local/x"],
    ["a vendor host on port 8443", "https://fcm.googleapis.com:8443/x"],
    ["userinfo", "https://user:pw@fcm.googleapis.com/x"],
    ["userinfo disguise", "https://fcm.googleapis.com@evil.test/x"],
    ["a prefix attack", "https://evilfcm.googleapis.com/x"],
    ["a suffix attack", "https://fcm.googleapis.com.evil.test/x"],
    ["an IPv4 literal", "https://127.0.0.1/x"],
    ["a decimal IPv4", "https://2130706433/x"],
    ["a hex IPv4", "https://0x7f.1/x"],
    ["an IPv6 literal", "https://[::1]/x"],
    ["a percent-encoded host", "https://%66cm.googleapis.com/x"],
    ["a percent-encoded loopback", "https://127%2E0%2E0%2E1/x"],
    ["an IDN lookalike", "https://fcm.googleаpis.com/x"],
    ["plain http", "http://fcm.googleapis.com/x"],
    ["no scheme", "fcm.googleapis.com/x"],
    ["garbage", "not a url"],
    ["a semicolon in a label", "https://evil.test;.push.apple.com/x"],
    ["a quote in a label", "https://evil.test'.push.apple.com/x"],
    ["a double quote in a label", 'https://evil.test".push.apple.com/x'],
    ["a brace in a label", "https://evil.test{.push.apple.com/x"],
    ["a closing brace in a label", "https://evil.test}.push.apple.com/x"],
    ["a backtick in a label", "https://evil.test`.push.apple.com/x"],
    ["an underscore in a label", "https://a_b.push.apple.com/x"],
    ["an asterisk in a label", "https://a*b.push.apple.com/x"],
    ["a tilde in a label", "https://a~b.push.apple.com/x"],
    ["a space in a label", "https://a b.push.apple.com/x"],
    ["a leading empty label", "https://.fcm.googleapis.com/x"],
    ["an inner empty label", "https://x..fcm.googleapis.com/x"],
    ["a label starting with a hyphen", "https://-a.fcm.googleapis.com/x"],
    ["a label ending with a hyphen", "https://a-.fcm.googleapis.com/x"],
    ["a 64-character label", `https://${"a".repeat(64)}.fcm.googleapis.com/x`],
    [
      "a host over 253 characters",
      `https://${"a.".repeat(130)}fcm.googleapis.com/x`,
    ],
    ["an oversized URL", `https://fcm.googleapis.com/${"a".repeat(2100)}`],
  ])("refuses %s", (_name, url) => {
    expect(isAllowedPushEndpoint(url)).toBe(false)
  })

  it("adds configured suffixes on a label boundary, in any case or form", () => {
    const extra = [" *.Push.Example.Test ", ""]

    expect(isAllowedPushEndpoint("https://a.push.example.test/x", extra)).toBe(
      true,
    )
    expect(isAllowedPushEndpoint("https://push.example.test/x", extra)).toBe(
      true,
    )
    expect(isAllowedPushEndpoint("https://xpush.example.test/x", extra)).toBe(
      false,
    )
    expect(isAllowedPushEndpoint("https://example.test/x", extra)).toBe(false)
  })

  it("canonicalises scheme, host, trailing dot and default port", () => {
    expect(
      canonicalPushEndpoint("HTTPS://FCM.googleapis.com.:443/Send/X"),
    ).toBe("https://fcm.googleapis.com/Send/X")
  })
})

describe("parser independence", () => {
  const accepted = [
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/abc",
    "https://db5p.notify.windows.com/w/?token=abc",
    "HTTPS://FCM.GOOGLEAPIS.COM./x",
    "https://xn--a-b.push.apple.com/x",
    "https://fcm.googleapis.com:443/x",
  ]

  it.each(accepted)(
    "%s is stored as a string every parser reads alike",
    (url) => {
      const stored = canonicalPushEndpoint(url)

      expect(stored).not.toBeNull()
      expect(legacyParse(stored ?? "").hostname).toBe(
        new URL(stored ?? "").hostname,
      )
    },
  )

  it.each([
    "https:%66cm.googleapis.com/x",
    "https:/%66cm.googleapis.com/x",
    "https:\\%66cm.googleapis.com/x",
  ])(
    "%s is stored as the canonical decoded vendor host or not at all",
    (url) => {
      const stored = canonicalPushEndpoint(url)

      expect([null, "https://fcm.googleapis.com/x"]).toContain(stored)

      if (stored) {
        expect(legacyParse(stored).hostname).toBe("fcm.googleapis.com")
      }
    },
  )
})

describe("isValidHostSuffix", () => {
  it.each(["push.example.test", "a.b.example.org", "xn--p1ai.example.com"])(
    "accepts %s",
    (suffix) => {
      expect(isValidHostSuffix(suffix)).toBe(true)
    },
  )

  it.each([
    "com",
    "localhost",
    "internal",
    "0.1",
    "a.1",
    "a;b.test",
    "a..test",
    "-a.test",
    "",
  ])("refuses %j", (suffix) => {
    expect(isValidHostSuffix(suffix)).toBe(false)
  })
})
