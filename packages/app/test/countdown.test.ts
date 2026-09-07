import { describe, expect, it } from "vitest"
import { createServerCountdown, formatCountdown } from "../src/lib/countdown.js"

describe("createServerCountdown", () => {
  it("uses the server offset so device clock skew does not change the remaining time", () => {
    let accurateDeviceNow = Date.parse("2026-08-28T10:00:00.000Z")
    let skewedDeviceNow = Date.parse("2026-08-28T11:00:00.000Z")
    const expiresAt = "2026-08-28T10:25:00.000Z"
    const serverTime = "2026-08-28T10:00:00.000Z"
    const accurateCountdown = createServerCountdown(
      expiresAt,
      serverTime,
      () => accurateDeviceNow,
    )
    const skewedCountdown = createServerCountdown(
      expiresAt,
      serverTime,
      () => skewedDeviceNow,
    )

    expect(accurateCountdown()).toBe(25 * 60 * 1_000)
    expect(skewedCountdown()).toBe(25 * 60 * 1_000)

    accurateDeviceNow += 1_000
    skewedDeviceNow += 1_000

    expect(accurateCountdown()).toBe(24 * 60 * 1_000 + 59_000)
    expect(skewedCountdown()).toBe(24 * 60 * 1_000 + 59_000)
  })

  it("clamps the remaining time at zero after the deadline", () => {
    let deviceNow = Date.parse("2026-08-28T10:00:00.000Z")
    const countdown = createServerCountdown(
      "2026-08-28T10:00:01.000Z",
      "2026-08-28T10:00:00.000Z",
      () => deviceNow,
    )

    deviceNow += 2_000

    expect(countdown()).toBe(0)
  })

  it("never grants extra time when the device clock is moved backward after load", () => {
    let deviceNow = Date.parse("2026-08-28T10:00:00.000Z")
    const countdown = createServerCountdown(
      "2026-08-28T10:25:00.000Z",
      "2026-08-28T10:00:00.000Z",
      () => deviceNow,
    )

    expect(countdown()).toBe(25 * 60 * 1_000)

    deviceNow -= 60 * 60 * 1_000

    expect(countdown()).toBe(25 * 60 * 1_000)
  })
})

describe("formatCountdown", () => {
  it.each([
    [25 * 60 * 1_000, "25:00"],
    [4 * 60 * 1_000 + 7_000, "04:07"],
    [0, "00:00"],
  ])("formats %i milliseconds as %s", (remainingMs, expected) => {
    expect(formatCountdown(remainingMs)).toBe(expected)
  })
})
