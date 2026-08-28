import { describe, expect, it } from "vitest"
import type { FinalizedAttempt } from "../src/lib/api-types.js"
import {
  storeTimeUpAttempt,
  takeTimeUpAttempt,
} from "../src/lib/time-up-navigation.js"

const attempt: FinalizedAttempt = {
  id: "attempt-1",
  status: "expired",
  submittedAt: "2026-08-28T10:25:00.000Z",
  resultUrl: "/attempts/attempt-1/result",
}

function createStorage(): Storage {
  const values = new Map<string, string>()

  return {
    get length() {
      return values.size
    },
    clear() {
      values.clear()
    },
    getItem(key) {
      return values.get(key) ?? null
    },
    key(index) {
      return [...values.keys()][index] ?? null
    },
    removeItem(key) {
      values.delete(key)
    },
    setItem(key, value) {
      values.set(key, value)
    },
  }
}

describe("time-up navigation handoff", () => {
  it("carries the finalized attempt once across a full-page navigation", () => {
    const storage = createStorage()

    storeTimeUpAttempt(storage, attempt)

    expect(takeTimeUpAttempt(storage, "attempt-1")).toEqual(attempt)
    expect(takeTimeUpAttempt(storage, "attempt-1")).toBeUndefined()
  })

  it("rejects malformed stored data instead of trusting browser state", () => {
    const storage = createStorage()
    storage.setItem("time-up:attempt-1", JSON.stringify({ id: "attempt-1" }))

    expect(takeTimeUpAttempt(storage, "attempt-1")).toBeUndefined()
  })
})
