import { describe, expect, it } from "vitest"
import { classifyForRetry } from "../src/lib/retryClassifier.js"

describe("classifyForRetry", () => {
  it("retries a network error with backoff", () => {
    const outcome = classifyForRetry({ kind: "network-error" }, 1)

    if (!outcome.retry) {
      throw new Error("expected retryable")
    }

    expect(typeof outcome.backoffMs).toBe("number")
  })

  it.each([500, 502, 503, 504])("retries a 5xx (%d) with backoff", (status) => {
    const outcome = classifyForRetry({ kind: "http-status", status }, 1)

    if (!outcome.retry) {
      throw new Error("expected retryable")
    }

    expect(typeof outcome.backoffMs).toBe("number")
  })

  it("retries 429 with backoff", () => {
    const outcome = classifyForRetry({ kind: "http-status", status: 429 }, 1)

    if (!outcome.retry) {
      throw new Error("expected retryable")
    }

    expect(typeof outcome.backoffMs).toBe("number")
  })

  // Every documented 4xx other than 429, per openapi.yaml:
  //   400 malformed body, 401 unauthorized, 403 not-your-attempt,
  //   404 unknown resource, 409 answer_change_not_allowed/navigation_locked
  //   (never retry, per the spec's own description text), 410
  //   section/attempt expired (finalized by this request -- retrying is
  //   meaningless), 413 PayloadCaptured (the oversized body was already
  //   persisted as a failed_write before the error returned -- retrying
  //   unchanged just re-captures it), 422 unprocessable.
  it.each([400, 401, 403, 404, 409, 410, 413, 422])(
    "stops dead on 4xx other than 429 (%d) and surfaces it",
    (status) => {
      const outcome = classifyForRetry({ kind: "http-status", status }, 1)

      expect(outcome).toEqual({ retry: false })
    },
  )

  it("a retried 409 is a storm, not a recovery -- never retries", () => {
    const outcome = classifyForRetry({ kind: "http-status", status: 409 }, 1)

    expect(outcome).toEqual({ retry: false })
  })

  it("a 410 (attempt/section already finalized by this request) never retries", () => {
    const outcome = classifyForRetry({ kind: "http-status", status: 410 }, 1)

    expect(outcome).toEqual({ retry: false })
  })

  it("a 413 (payload already captured as a failed_write) never retries", () => {
    const outcome = classifyForRetry({ kind: "http-status", status: 413 }, 1)

    expect(outcome).toEqual({ retry: false })
  })

  it("backoff grows with the attempt number rather than staying constant", () => {
    const first = classifyForRetry({ kind: "network-error" }, 1)
    const second = classifyForRetry({ kind: "network-error" }, 2)

    if (!first.retry || !second.retry) {
      throw new Error("expected both to be retryable")
    }

    expect(second.backoffMs).toBeGreaterThan(first.backoffMs)
  })

  it("backoff for a retryable 5xx also grows with the attempt number", () => {
    const first = classifyForRetry({ kind: "http-status", status: 503 }, 1)
    const second = classifyForRetry({ kind: "http-status", status: 503 }, 3)

    if (!first.retry || !second.retry) {
      throw new Error("expected both to be retryable")
    }

    expect(second.backoffMs).toBeGreaterThan(first.backoffMs)
  })

  it("backoff is capped rather than growing without bound", () => {
    const outcome = classifyForRetry({ kind: "network-error" }, 100)

    if (!outcome.retry) {
      throw new Error("expected retryable")
    }

    expect(Number.isFinite(outcome.backoffMs)).toBe(true)
    expect(outcome.backoffMs).toBeLessThanOrEqual(30_000)
  })

  it("a non-retryable outcome never carries a backoffMs field", () => {
    const outcome = classifyForRetry({ kind: "http-status", status: 409 }, 1)

    expect(outcome).not.toHaveProperty("backoffMs")
  })
})
