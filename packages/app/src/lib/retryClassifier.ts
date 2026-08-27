/**
 * Pure classification of a failed write-path request into retry-or-not,
 * per spec §5 rule 5 (`docs/api/openapi.yaml`, "Never lose an answer"):
 *
 * > Retry only what is retryable. Network and 5xx back off; 4xx other than
 * > 429 stop dead. A retried 409 is a storm, not a recovery.
 *
 * This function only ever sees FAILED attempts -- a `200` with
 * `status: "ignored_stale"` (a device replaying a write it already lost the
 * race for) or a `200` snapshot flush carrying per-item failures is not a
 * transport failure at all, so the flush controller (Task 9) never calls
 * this for those; there is no "success" branch to classify here.
 *
 * Every 4xx this app's write-path endpoints document is deliberately
 * non-retryable, and each stops dead for its own reason, not by accident:
 *   - 409 `answer_change_not_allowed` / `navigation_locked` -- the spec's
 *     own description says "Never retry these"; a retried 409 is a storm.
 *   - 410 attempt/section expired -- finalized BY THIS REQUEST. The child's
 *     test already ended; retrying is meaningless.
 *   - 413 PayloadCaptured -- the oversized body was already persisted as a
 *     `failed_write` before the error returned. Retrying it unchanged just
 *     re-captures the same bytes again.
 *   - 400 / 401 / 403 / 404 / 422 -- malformed, unauthenticated, wrong
 *     owner, unknown resource, or unprocessable. None of these change on
 *     an unmodified retry.
 * 429 is the one 4xx that DOES back off, because it means "try again
 * later", not "this request is wrong".
 */
export type RetryOutcome = { retry: false } | { retry: true; backoffMs: number }

const BASE_BACKOFF_MS = 500
const MAX_BACKOFF_MS = 30_000

/**
 * @param result The transport outcome of one write-path attempt: either the
 *   request never got an HTTP response at all (`network-error`), or it got
 *   one carrying a non-2xx `status`.
 * @param attempt The 1-indexed attempt number about to be made. Backoff
 *   grows with it; the caller (Task 9) is the one that actually sleeps,
 *   through its own injected scheduler -- this function never calls
 *   `setTimeout` itself, so it needs no fake clock to test.
 */
export function classifyForRetry(
  result: { kind: "network-error" } | { kind: "http-status"; status: number },
  attempt: number,
): RetryOutcome {
  const retryable =
    result.kind === "network-error" ||
    result.status === 429 ||
    result.status >= 500

  if (!retryable) {
    return { retry: false }
  }

  const backoffMs = Math.min(
    BASE_BACKOFF_MS * 2 ** Math.max(0, attempt - 1),
    MAX_BACKOFF_MS,
  )

  return { retry: true, backoffMs }
}
