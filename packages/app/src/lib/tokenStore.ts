/**
 * A tiny persisted key-value store for this app's auth secrets: the OIDC
 * PKCE verifier, the refresh token, and the access/id token this app
 * caches between reloads. Shaped as `@liam-workspace/auth-client`'s
 * `TokenStorage` interface (`get`/`set`/`remove` on string keys) so it can
 * be handed straight to `createAuthClient({ storage: tokenStore })` in
 * `auth.ts` -- the library then persists the verifier and refresh token
 * through the exact same store `api-client.ts` reads the bearer token from.
 *
 * Persistence: `localStorage`, deliberately, not `sessionStorage`. This
 * app runs on a shared family iPad, unsupervised, mid a TIMED test.
 * `sessionStorage` is scoped to a tab and Safari aggressively discards
 * background tabs -- reclaiming one wipes `sessionStorage` and would drop
 * a child straight back to sign-in in the middle of an exam they cannot
 * restart, which is precisely the failure this whole plan exists to
 * close. The tradeoff accepted in exchange: a session credential now
 * outlives the tab on a device other family members use. That's judged
 * acceptable because the credential is short-lived and refreshed rather
 * than a long-lived secret, this app's own sign-out clears it, the
 * server's email allowlist limits whose account it can ever be, and every
 * route it unlocks is re-verified server-side against the real JWKS
 * regardless of what a stale client believes.
 */

const PREFIX = "pp.auth."

// The complete set of keys this store is ever asked to hold, so `clear()`
// (sign-out) can remove all of them without needing to enumerate
// localStorage itself.
const KNOWN_KEYS = [
  "pkce_verifier",
  "refresh_token",
  "access_token",
  "id_token",
]

function namespaced(key: string): string {
  return `${PREFIX}${key}`
}

export interface TokenStore {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
  clear(): void
}

export const tokenStore: TokenStore = {
  get(key) {
    try {
      return globalThis.localStorage.getItem(namespaced(key))
    } catch {
      // Storage unavailable (private mode, quota, non-browser test
      // context without localStorage) -- treat exactly like "not saved".
      return null
    }
  },
  set(key, value) {
    try {
      globalThis.localStorage.setItem(namespaced(key), value)
    } catch {
      // See get(): nothing else in the app can recover from this either,
      // so the session simply will not survive a reload.
    }
  },
  remove(key) {
    try {
      globalThis.localStorage.removeItem(namespaced(key))
    } catch {
      // See get().
    }
  },
  clear() {
    for (const key of KNOWN_KEYS) {
      this.remove(key)
    }
  },
}
