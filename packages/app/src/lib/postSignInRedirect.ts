/**
 * The one thing the OIDC round trip cannot carry for us: the page a child
 * was trying to reach before the guard (`auth-guard.ts`) or a mid-test
 * `401` (`api-client.ts`) sent them to sign-in. `@liam-workspace/auth-client`'s
 * `getAuthorizationUrl()` sends no `state` parameter, so nothing survives
 * the trip to the identity provider and back except what THIS app stashes
 * itself before leaving. `sessionStorage`, not `tokenStore`'s localStorage:
 * this is scoped to one sign-in round trip, not a credential, and should
 * not linger once read (or across an unrelated future session on the same
 * device).
 */

const KEY = "pp.auth.post-sign-in-redirect"

export function savePostSignInRedirect(path: string): void {
  try {
    globalThis.sessionStorage.setItem(KEY, path)
  } catch {
    // Storage unavailable -- the child just lands on the library instead
    // of back where they were, which is a minor inconvenience, not a data
    // loss.
  }
}

export function readAndClearPostSignInRedirect(): string | null {
  try {
    const value = globalThis.sessionStorage.getItem(KEY)

    if (value !== null) {
      globalThis.sessionStorage.removeItem(KEY)
    }

    return value
  } catch {
    return null
  }
}
