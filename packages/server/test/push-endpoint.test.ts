import { describe, expect, it } from "vitest"
import {
  canonicalPushEndpoint,
  isAllowedPushEndpoint,
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
