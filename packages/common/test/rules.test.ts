import { describe, expect, it } from "vitest"
import {
  canAcceptAnswerChange,
  canClaimPlay,
  canSetPosition,
  isPastDeadline,
  remainingPlays,
} from "../src/rules.js"

describe("canSetPosition", () => {
  it("allows any move when navigation is free, even backward", () => {
    expect(canSetPosition("free", 5, 1)).toBe(true)
  })

  it("allows a forward move when navigation is forward_only", () => {
    expect(canSetPosition("forward_only", 2, 3)).toBe(true)
  })

  it("allows a move to the current question when navigation is forward_only", () => {
    expect(canSetPosition("forward_only", 2, 2)).toBe(true)
  })

  it("refuses a backward move when navigation is forward_only", () => {
    expect(canSetPosition("forward_only", 3, 1)).toBe(false)
  })

  it("allows any move when there is no current position yet", () => {
    expect(canSetPosition("forward_only", null, 1)).toBe(true)
  })
})

describe("canClaimPlay", () => {
  it("allows an unlimited stimulus regardless of plays used", () => {
    expect(canClaimPlay(null, 999)).toBe(true)
  })

  it("allows a claim while plays used is below the cap", () => {
    expect(canClaimPlay(3, 2)).toBe(true)
  })

  it("refuses a claim once plays used reaches the cap", () => {
    expect(canClaimPlay(3, 3)).toBe(false)
  })
})

describe("remainingPlays", () => {
  it("returns null for an unlimited stimulus", () => {
    expect(remainingPlays(null, 5)).toBeNull()
  })

  it("returns the cap minus plays used", () => {
    expect(remainingPlays(3, 1)).toBe(2)
  })

  it("floors at zero rather than going negative", () => {
    expect(remainingPlays(3, 5)).toBe(0)
  })
})

describe("canAcceptAnswerChange", () => {
  it("allows any change when allowAnswerChange is true", () => {
    expect(canAcceptAnswerChange(true, ["a"], ["b"])).toBe(true)
  })

  it("allows a first answer (existingSelection null) even when allowAnswerChange is false", () => {
    expect(canAcceptAnswerChange(false, null, ["a"])).toBe(true)
  })

  it("allows an idempotent re-send of the identical selection, order-independent, when false", () => {
    expect(canAcceptAnswerChange(false, ["a", "b"], ["b", "a"])).toBe(true)
  })

  it("allows a re-send that differs only in UUID case, when false", () => {
    expect(
      canAcceptAnswerChange(
        false,
        ["ABCDEF12-3456-7890-ABCD-EF1234567890"],
        ["abcdef12-3456-7890-abcd-ef1234567890"],
      ),
    ).toBe(true)
  })

  it("refuses a genuinely different selection when allowAnswerChange is false", () => {
    // The case that must actually reject -- without it the suite could pass
    // against a predicate that always returns true
    expect(canAcceptAnswerChange(false, ["a"], ["b"])).toBe(false)
  })
})

describe("isPastDeadline", () => {
  const deadline = new Date("2026-08-27T12:00:00Z")

  it("is false when the deadline is null (untimed)", () => {
    expect(isPastDeadline(null, new Date("2099-01-01T00:00:00Z"))).toBe(false)
  })

  it("is false when now is before the deadline", () => {
    expect(isPastDeadline(deadline, new Date("2026-08-27T11:59:59Z"))).toBe(
      false,
    )
  })

  it("is true when now exactly equals the deadline", () => {
    // Submitted_at pins TO the deadline (attempt_expired_pins_deadline), so
    // the boundary itself must count as past, not still-running.
    expect(isPastDeadline(deadline, new Date("2026-08-27T12:00:00Z"))).toBe(
      true,
    )
  })

  it("is true when now is after the deadline", () => {
    expect(isPastDeadline(deadline, new Date("2026-08-27T12:00:01Z"))).toBe(
      true,
    )
  })
})
