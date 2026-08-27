import { apiFetch, ApiError } from "./api-client.js"
import type { FlushHttp, ItemAckResult } from "./flushController.js"

/**
 * The `FlushHttp` the runner actually uses in the browser: `PATCH
 * /attempts/{id}/responses` (`docs/api/openapi.yaml`, "Flush a section
 * snapshot") sent through the app's own `apiFetch` -- the same `/api` base
 * and bearer-token header every other write in this app goes through
 * (`attempts-api.ts`). `url` is the same un-prefixed path style every other
 * caller of `apiFetch` uses (e.g. `/attempts/${id}/responses`); `apiFetch`
 * adds the `/api` prefix itself.
 *
 * `apiFetch` already does the JSON round trip and throws `ApiError` for any
 * non-2xx response, so this is purely a mapping from that contract onto
 * `FlushController`'s three-way `patch()` result:
 *
 *  - success -> "ok". The route's only documented success is a `200`
 *    (`FlushResult`); `apiFetch` gives no way to read the raw status back,
 *    and there is nothing else it could be per the spec, so `200` is
 *    hardcoded here rather than threaded through as a guess.
 *  - `ApiError` -> "http-error", carrying the parsed problem body
 *    (`error.problem` -- `apiFetch` casts the parsed JSON straight into it)
 *    so `classifyForRetry` sees the real status, and a rejection's
 *    `capturedAs` / `reason` are not thrown away even though this layer
 *    itself never reads them.
 *  - anything else (the fetch itself rejected -- offline, DNS, a body that
 *    failed to parse as JSON) -> "network-error". There is no HTTP status to
 *    report in any of these cases, and `classifyForRetry` always retries a
 *    network error, which is the safe default per "never lose an answer":
 *    an ambiguous failure is retried, never quietly treated as a rejection
 *    the server never actually issued.
 */
export const apiFlushHttp: FlushHttp = {
  async patch(url, body) {
    try {
      const responseBody = await apiFetch<{ results: ItemAckResult[] }>(url, {
        method: "PATCH",
        body: JSON.stringify(body),
      })

      return { kind: "ok", status: 200, body: responseBody }
    } catch (error) {
      if (error instanceof ApiError) {
        return {
          kind: "http-error",
          status: error.problem.status,
          body: error.problem,
        }
      }

      return { kind: "network-error" }
    }
  },
}
