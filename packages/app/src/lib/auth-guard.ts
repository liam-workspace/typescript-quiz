import { redirect } from "@tanstack/react-router"
import { hasSession } from "./auth.js"
import { CALLBACK_PATH, SIGN_IN_PATH } from "./authPaths.js"
import { savePostSignInRedirect } from "./postSignInRedirect.js"

export { CALLBACK_PATH, SIGN_IN_PATH }

const PUBLIC_PATHS = new Set<string>([SIGN_IN_PATH, CALLBACK_PATH])

/**
 * Wired into `__root.tsx`'s `beforeLoad` -- ONE guard for every route
 * rather than one per page, per the plan ("every existing route assumes a
 * token already exists"). `/sign-in` and `/callback` are the only two
 * routes exempt: they are how a session comes to exist in the first
 * place, so guarding them would make signing in impossible.
 *
 * On redirect, the intended destination is remembered
 * (`postSignInRedirect.ts`) so the sign-in/callback flow can return the
 * child to where they were rather than always landing on the library.
 */
export function requireAuth(pathname: string): void {
  if (PUBLIC_PATHS.has(pathname) || hasSession()) {
    return
  }

  savePostSignInRedirect(pathname)

  // `throw: true` makes `redirect()` throw internally -- no literal
  // `throw` at the call site (matches `expired-attempt-redirect.ts`'s
  // same pattern), which is also what keeps this a `Response`-shaped
  // throw rather than tripping the "only throw Error objects" lint rule.
  redirect({ href: SIGN_IN_PATH, replace: true, throw: true })
}
