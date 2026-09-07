import { describe, expect, it } from "vitest"
import type { TestCard } from "../src/lib/api-types.js"
import { testCardActions } from "../src/lib/testCardState.js"

const freshCard: TestCard = {
  id: "test-04",
  slug: "primary-practice-04",
  title: "TOEFL Primary — Practice Test 04",
  level: "primary-step-1",
  durationSeconds: 3000,
  sections: [
    { type: "listening", questionCount: 20 },
    { type: "reading", questionCount: 20 },
  ],
  inProgressAttemptId: null,
  attemptCount: 0,
  bestAttempt: null,
}

describe("testCardActions", () => {
  it("returns Continue alone when an attempt is in progress, even after earlier finishes", () => {
    const actions = testCardActions({
      ...freshCard,
      inProgressAttemptId: "attempt-active",
      attemptCount: 2,
      bestAttempt: {
        attemptId: "attempt-best",
        submittedAt: "2026-08-21T10:15:00.000Z",
        pointsEarned: 36,
        pointsPossible: 40,
        percentage: 90,
      },
    })

    expect(actions).toEqual([{ kind: "continue", attemptId: "attempt-active" }])
    expect(actions).not.toContainEqual({ kind: "start" })
    expect(actions).not.toContainEqual({ kind: "tryAgain" })
  })

  it("returns Start alone for a test with no attempts", () => {
    const actions = testCardActions(freshCard)

    expect(actions).toEqual([{ kind: "start" }])
    expect(actions.some((action) => action.kind === "seeResult")).toBe(false)
  })

  it("returns Try again and See result together for a finished attempt", () => {
    const actions = testCardActions({
      ...freshCard,
      attemptCount: 1,
      bestAttempt: {
        attemptId: "attempt-best",
        submittedAt: "2026-08-21T10:15:00.000Z",
        pointsEarned: 36,
        pointsPossible: 40,
        percentage: 90,
      },
    })

    expect(actions).toEqual([
      { kind: "seeResult", attemptId: "attempt-best" },
      { kind: "tryAgain" },
    ])
  })

  it("keeps Try again available whenever only finished attempts exist", () => {
    const actions = testCardActions({
      ...freshCard,
      inProgressAttemptId: null,
      attemptCount: 3,
      bestAttempt: {
        attemptId: "attempt-best",
        submittedAt: "2026-08-14T09:00:00.000Z",
        pointsEarned: 33,
        pointsPossible: 40,
        percentage: 82.5,
      },
    })

    expect(actions.some((action) => action.kind === "tryAgain")).toBe(true)
    expect(actions.some((action) => action.kind === "continue")).toBe(false)
  })
})
