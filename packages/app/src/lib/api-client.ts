import { createAuthedFetch } from "@liam-workspace/auth-client"
import {
  clearSessionAndRedirectToSignIn,
  getAuthClient,
  hasSession,
} from "./auth.js"
import { getDevBearerToken } from "./dev-auth.js"
import type { FinalizedAttempt } from "./api-types.js"

export class ApiError extends Error {
  public readonly problem: {
    type: string
    title: string
    status: number
    detail?: string
    // Present only on `410 attempt_expired` (openapi.yaml `AttemptExpiredProblem`) --
    // the request finalized the attempt itself, so the caller can render the
    // time-up screen without a follow-up read.
    attempt?: FinalizedAttempt
  }

  public constructor(problem: ApiError["problem"]) {
    super(problem.type)
    this.problem = problem
  }
}

// A thin proxy that looks up `globalThis.fetch` on every call rather than
// closing over whatever `fetch` was at construction time -- the same
// reason `auth.ts`'s `readAuthConfig` does this for the OIDC client
// itself. Without it, a test that stubs `globalThis.fetch` after this
// memoized instance already exists would be silently ignored.
const proxyFetch: typeof fetch = (input, init) => globalThis.fetch(input, init)

let authedFetch: typeof fetch | undefined = undefined

/**
 * `createAuthedFetch` attaches the current bearer token and, on a `401`,
 * does a single-flight refresh (de-duped across concurrent callers) plus
 * one retry before giving the `401` back -- exactly Task 2 Step 5's "an
 * expired access token is refreshed using the stored refresh token
 * WITHOUT sending the child back to sign-in". Memoized so that
 * single-flight de-dupe actually applies across separate `apiFetch` calls
 * made around the same time, not just within one.
 */
function getAuthedFetch(): typeof fetch {
  authedFetch ??= createAuthedFetch(getAuthClient(), proxyFetch)

  return authedFetch
}

/** Test-only seam, mirroring `auth.ts`'s `resetAuthClientForTests`. */
export function resetApiClientForTests(): void {
  authedFetch = undefined
}

/**
 * Real session (`tokenStore`, via `hasSession()`) takes priority over
 * `VITE_DEV_AUTH`'s pre-issued token -- a dev token never shadows a real
 * signed-in session (plan, Task 1 Step 3). Only a real session gets the
 * refresh-on-401 treatment: a raw dev bearer token has no refresh token
 * behind it to retry with.
 */
function sendRequest(url: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers)

  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json")
  }

  if (hasSession()) {
    return getAuthedFetch()(url, { ...init, headers })
  }

  const token = getDevBearerToken()

  if (token && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${token}`)
  }

  return fetch(url, { ...init, headers })
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await sendRequest(`/api${path}`, init)

  if (response.status === 401) {
    // Either there was no session to refresh, or a real one's refresh
    // token was itself rejected -- either way, a stale local session
    // cannot be trusted, so clear it and send the child back to sign-in
    // rather than leaving them on a dead screen with a running clock.
    // Deliberately does NOT touch AnswerQueue/IndexedDB: queued answers
    // must still be there after they sign back in.
    clearSessionAndRedirectToSignIn()
  }

  if (response.status === 204) {
    return undefined as T
  }

  const body: unknown = await response.json()

  if (!response.ok) {
    throw new ApiError(body as ApiError["problem"])
  }

  return body as T
}
