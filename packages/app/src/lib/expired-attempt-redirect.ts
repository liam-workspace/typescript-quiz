import { redirect } from "@tanstack/react-router"
import { ApiError } from "./api-client.js"
import { sameOriginPath } from "./same-origin-path.js"

/**
 * A `410 attempt_expired` from a live-runner loader (`GET /attempts/{id}`,
 * openapi.yaml) is not a failure the caller's `errorComponent` should show:
 * the attempt WAS finalized, by this exact request, and the honest
 * destination is the result screen the response already names -- the same
 * redirect-on-a-known-status shape `attempts.$attemptId.result.tsx`'s own
 * `loadResult` uses for its 409. A no-op for every other error (a network
 * blip, a 401/403, an IndexedDB failure), which the caller's own
 * `errorComponent` handles instead.
 *
 * Shared by run.tsx and hand-in.tsx: both loaders read the same envelope,
 * so both can legitimately hit this exact 410 while a child is mid-test.
 */
export function redirectExpiredAttemptToResult(error: unknown): void {
  if (
    !(error instanceof ApiError) ||
    error.problem.type !== "attempt_expired" ||
    !error.problem.attempt
  ) {
    return
  }

  const parsed = sameOriginPath.safeParse(error.problem.attempt.resultUrl)

  if (parsed.success) {
    redirect({ href: parsed.data, replace: true, throw: true })
  }
}
