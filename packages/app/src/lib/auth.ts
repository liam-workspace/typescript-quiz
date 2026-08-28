import {
  createAuthClient,
  type AuthClient,
  type AuthClientConfig,
} from "@liam-workspace/auth-client"
import { SIGN_IN_PATH } from "./authPaths.js"
import { savePostSignInRedirect } from "./postSignInRedirect.js"
import { establishSession } from "./session-api.js"
import { tokenStore } from "./tokenStore.js"
import type { SessionResult } from "./api-types.js"

/**
 * `offline_access` is requested deliberately (plan: "the difference
 * between a refresh token and none is a child being signed out in the
 * middle of a timed test"). `roles` carries `isAdmin`
 * (session.controller.ts reads it off the verified claims, not off any
 * scope the client asserts, but the scope has to be granted for the claim
 * to be issued at all).
 */
const SCOPES = ["openid", "email", "profile", "roles", "offline_access"]

function readAuthConfig(): AuthClientConfig {
  // Read from configuration, never hardcoded: dev (`auth-dev.icovn.me`)
  // and production (`auth.icovn.me`) differ by exactly these three
  // `.env.local` / deployment values, never by a code change.
  //
  // Each accessed as a LITERAL `import.meta.env.KEY` expression, never
  // through an intermediate variable (`const env = import.meta.env`).
  // Vite's static env replacement only matches the literal pattern per
  // key; go through a variable and Vite can't resolve it statically, so it
  // embeds the WHOLE `import.meta.env` object in the bundle instead --
  // every `VITE_*` value that happens to be set at build time, including
  // `VITE_DEV_AUTH_TOKEN`, a real credential. Confirmed the hard way by
  // `test/dev-auth-prod-build.test.ts`: THIS function, not `dev-auth.ts`,
  // was the one still leaking the canary secret after `dev-auth.ts` was
  // fixed to use literal access, because a single bare `import.meta.env`
  // reference anywhere in the bundle forces Vite to materialize the whole
  // object for every module that shares it.
  const issuer = import.meta.env.VITE_AUTH_ISSUER as string | undefined
  const clientId = import.meta.env.VITE_AUTH_CLIENT_ID as string | undefined
  const redirectUri = import.meta.env.VITE_AUTH_REDIRECT_URI as
    | string
    | undefined

  if (!issuer || !clientId || !redirectUri) {
    throw new Error(
      "Auth is not configured: VITE_AUTH_ISSUER, VITE_AUTH_CLIENT_ID and " +
        "VITE_AUTH_REDIRECT_URI must all be set (see packages/app/.env.example).",
    )
  }

  return {
    issuer,
    clientId,
    redirectUri,
    scopes: SCOPES,
    // Our own persisted store, not the library's default localStorage
    // adapter: this is the SAME store `api-client.ts` reads the bearer
    // token from, so a signed-in session survives a reload without a
    // network round trip (see hydrateFromTokenStore below).
    storage: tokenStore,
    // A thin proxy that looks up `globalThis.fetch` on every call, rather
    // than closing over whatever `fetch` was at client-construction time.
    // `createAuthClient` itself binds `config.fetchFn ?? fetch` ONCE, so
    // without this indirection a test that stubs `globalThis.fetch` after
    // the (lazily-created, module-singleton) client already exists would
    // be silently ignored.
    fetchFn: (input, init) => globalThis.fetch(input, init),
  }
}

let client: AuthClient | undefined = undefined

function hydrateFromTokenStore(authClient: AuthClient): void {
  const accessToken = tokenStore.get("access_token")
  const idToken = tokenStore.get("id_token")

  if (!accessToken || !idToken) {
    return
  }

  authClient.setTokens({
    accessToken,
    idToken,
    refreshToken: tokenStore.get("refresh_token") ?? undefined,
  })
}

function createClient(): AuthClient {
  const authClient = createAuthClient(readAuthConfig())

  // The library keeps `accessToken`/`idToken` in memory only (only
  // `refreshToken` goes through `storage`, via its own internal
  // "refresh_token" key) -- mirror the full set into `tokenStore` on every
  // change so a reload has something to hydrate from without a network
  // call, and `api-client.ts` has a synchronous place to read the current
  // bearer token from.
  authClient.onTokenChange((tokens) => {
    if (tokens) {
      tokenStore.set("access_token", tokens.accessToken)
      tokenStore.set("id_token", tokens.idToken)
    } else {
      tokenStore.remove("access_token")
      tokenStore.remove("id_token")
    }
  })

  hydrateFromTokenStore(authClient)

  return authClient
}

/**
 * Lazy, memoized: real app code only ever needs one instance for the
 * lifetime of a page load, and constructing it eagerly at module scope
 * would make importing this file (transitively, via `api-client.ts`)
 * throw in any environment missing `VITE_AUTH_*` config, even for code
 * paths that never sign anyone in.
 */
export function getAuthClient(): AuthClient {
  client ??= createClient()

  return client
}

/**
 * Test-only seam: real app code never calls this. Config is static for
 * the lifetime of a page load, but a test that stubs `VITE_AUTH_*` after
 * an earlier test already constructed the memoized client would otherwise
 * keep exercising the FIRST test's config.
 */
export function resetAuthClientForTests(): void {
  client = undefined
}

// True once we hold a bearer token -- independent of whether the OIDC
// client itself has been constructed, so callers that only need to
// answer "is someone signed in" (the route guard, `api-client.ts`'s
// header selection) never risk throwing on missing auth config just to
// ask the question.
export function hasSession(): boolean {
  return tokenStore.get("access_token") !== null
}

export function currentAccessToken(): string | null {
  return tokenStore.get("access_token")
}

/**
 * Building the authorize URL is not local work: the client fetches the
 * issuer's discovery document first, so this call is only as reliable as the
 * network between a home iPad and auth.icovn.me.
 *
 * The timeout is the point. `sign-in.tsx` already catches a REJECTION and
 * shows a retry, but a request that hangs never rejects -- and a promise
 * that never settles leaves the button spinning with no error, no redirect
 * and nothing for a child to do. That is exactly what a CORS-blocked
 * discovery fetch produced during the browser pass: the issuer returns no
 * `access-control-allow-origin`, so the browser refuses the request and the
 * screen simply sat there.
 *
 * Bounding it converts "silently broken forever" into "failed, try again",
 * which is a state the screen can already render honestly. An unreachable
 * issuer on home wifi is routine, not exceptional.
 */
const AUTHORIZE_URL_TIMEOUT_MS = 10_000

export async function startSignIn(): Promise<void> {
  const url = await Promise.race([
    getAuthClient().getAuthorizationUrl(),
    new Promise<never>((_, reject) => {
      globalThis.setTimeout(
        () =>
          reject(
            new Error(
              `Could not reach the sign-in service within ${String(
                AUTHORIZE_URL_TIMEOUT_MS,
              )}ms.`,
            ),
          ),
        AUTHORIZE_URL_TIMEOUT_MS,
      )
    }),
  ])

  globalThis.location.assign(url)
}

/**
 * Exchanges the code with the verifier stashed by `startSignIn`, stores
 * the resulting tokens, THEN calls `POST /api/session` exactly once. The
 * order is structural, not incidental: `establishSession` goes through
 * `apiFetch`, which reads the bearer token from `tokenStore` -- and
 * `handleCallback` writes to `tokenStore` (via the `onTokenChange`
 * listener above) before this function's `await` resolves, so the session
 * call physically cannot be sent without a token already in place.
 */
export async function completeSignIn(code: string): Promise<SessionResult> {
  const callbackUrl = new URL(globalThis.location.origin)

  callbackUrl.pathname = "/callback"
  callbackUrl.searchParams.set("code", code)

  await getAuthClient().handleCallback(callbackUrl.toString())

  return establishSession()
}

export function signOut(): void {
  if (client) {
    client.signOut()
  } else {
    tokenStore.clear()
  }
}

/**
 * `api-client.ts` calls this when a `401` survives its own refresh
 * attempt (`createAuthedFetch`'s single retry) or there was never a
 * session to refresh in the first place -- "a 401 from any API call must
 * clear the store and return to sign-in rather than leaving a child on a
 * dead screen with a running clock" (plan, Task 4). A full navigation
 * (`location.assign`), not a router `redirect()`: `apiFetch` is called
 * from places with no router loader context at all (a background
 * autosave flush mid-test), so this has to work uniformly regardless of
 * call site. It does NOT touch `AnswerQueue`/IndexedDB -- the queued
 * answers a child has not yet had acknowledged must still be there after
 * they sign back in.
 */
export function clearSessionAndRedirectToSignIn(): void {
  signOut()
  savePostSignInRedirect(
    globalThis.location.pathname + globalThis.location.search,
  )
  globalThis.location.assign(SIGN_IN_PATH)
}
