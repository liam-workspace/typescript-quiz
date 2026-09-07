import { isRedirect } from "@tanstack/react-router"
import { describe, expect, it } from "vitest"
import { ApiError } from "./api-client.js"
import { redirectExpiredAttemptToResult } from "./expired-attempt-redirect.js"

function attemptExpired(resultUrl: string): ApiError {
  return new ApiError({
    type: "attempt_expired",
    title: "The attempt was past its deadline and has been finalized.",
    status: 410,
    attempt: {
      id: "attempt-1",
      status: "expired",
      submittedAt: "2026-08-27T09:25:00.000Z",
      resultUrl,
    },
  })
}

function thrownBy(fn: () => void): unknown {
  try {
    fn()

    return undefined
  } catch (error) {
    return error
  }
}

describe("redirectExpiredAttemptToResult", () => {
  it("redirects to the same-origin resultUrl a 410 attempt_expired carries", () => {
    const thrown = thrownBy(() =>
      redirectExpiredAttemptToResult(
        attemptExpired("/attempts/attempt-1/result"),
      ),
    )

    expect(isRedirect(thrown)).toBe(true)

    if (!isRedirect(thrown)) {
      throw new Error("Expected a TanStack Router redirect")
    }

    expect(thrown.options.href).toBe("/attempts/attempt-1/result")
  })

  // oxlint-disable-next-line no-script-url -- the hostile scheme IS the fixture
  it("does not redirect when the resultUrl is not same-origin", () => {
    const javascriptUrl = ["java", "script:alert(1)"].join("")

    expect(() =>
      redirectExpiredAttemptToResult(attemptExpired(javascriptUrl)),
    ).not.toThrow()
  })

  it("is a no-op for a 410 section_expired -- the attempt is still running", () => {
    const error = new ApiError({
      type: "section_expired",
      title: "The section's clock ran out.",
      status: 410,
    })

    expect(() => {
      redirectExpiredAttemptToResult(error)
    }).not.toThrow()
  })

  it("is a no-op for a 403 not_your_attempt", () => {
    const error = new ApiError({
      type: "not_your_attempt",
      title: "The attempt belongs to another student.",
      status: 403,
    })

    expect(() => {
      redirectExpiredAttemptToResult(error)
    }).not.toThrow()
  })

  it("is a no-op for a plain network error, not an ApiError at all", () => {
    expect(() => {
      redirectExpiredAttemptToResult(new TypeError("Failed to fetch"))
    }).not.toThrow()
  })
})
