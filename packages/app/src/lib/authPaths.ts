/**
 * Shared between `auth-guard.ts` (which redirects TO sign-in and exempts
 * these two routes from the guard) and `auth.ts` (whose mid-session
 * `clearSessionAndRedirectToSignIn` redirects to the same place) --
 * pulled out on its own so neither has to import the other just for a
 * string constant.
 */
export const SIGN_IN_PATH = "/sign-in"

export const CALLBACK_PATH = "/callback"
