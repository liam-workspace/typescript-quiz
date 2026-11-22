import { describe, expect, it } from "vitest"
import type { TestCard } from "./api-types.js"
import { blockingTest, matchesFilter, waitingCount } from "./library-state.js"

const base: TestCard = {
  id: "t",
  slug: "t",
  title: "T",
  level: "primary-step-1",
  durationSeconds: 1200,
  sections: [{ type: "listening", questionCount: 4 }],
  inProgressAttemptId: null,
  attemptCount: 0,
  bestAttempt: null,
  testVersionId: "ver-1",
  mediaBytes: 0,
}
const fresh = { ...base, id: "fresh" }
const finished = { ...base, id: "finished", attemptCount: 2 }
const running = {
  ...base,
  id: "running",
  attemptCount: 1,
  inProgressAttemptId: "a1",
}

describe("library-state", () => {
  it("filters like the prototype: todo = never finished or in progress, done = any finished attempt", () => {
    expect(matchesFilter(fresh, "todo")).toBe(true)
    expect(matchesFilter(finished, "todo")).toBe(false)
    expect(matchesFilter(running, "todo")).toBe(true)
    expect(matchesFilter(fresh, "done")).toBe(false)
    expect(matchesFilter(finished, "done")).toBe(true)
    expect(matchesFilter(running, "done")).toBe(true)
    expect(matchesFilter(finished, "all")).toBe(true)
  })

  it("counts only tests with no attempts as waiting", () => {
    expect(waitingCount([fresh, finished, running])).toBe(1)
    expect(waitingCount([])).toBe(0)
  })

  it("finds the one test that is in progress", () => {
    expect(blockingTest([fresh, running, finished])?.id).toBe("running")
    expect(blockingTest([fresh, finished])).toBeUndefined()
  })
})
