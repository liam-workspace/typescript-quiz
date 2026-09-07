/**
 * VITE_DEV_AUTH is a development shortcut, not a bypass: whatever token
 * this returns is still verified by the SERVER against the real JWKS
 * (`packages/server/src/auth/jwks.guard.ts`) -- it exercises the true
 * authenticated path without the interactive OIDC round trip.
 *
 * `api-client.ts` only ever reaches for this as a FALLBACK, behind the
 * real token store (`tokenStore.ts`, populated by the OIDC round trip in
 * `auth.ts`) -- a dev token never shadows a real signed-in session.
 *
 * It must be impossible to enable in a deployed build, not merely
 * undocumented, so this is gated twice:
 *
 *  - `import.meta.env.DEV`: Vite statically replaces this with the
 *    literal `false` in every `vite build` (production) output, so
 *    `if (!import.meta.env.DEV) return null` is dead code a production
 *    build's minifier strips entirely -- the branch below cannot ship,
 *    let alone run, from a deployed bundle.
 *  - `VITE_DEV_AUTH === "true"`: an explicit opt-in even in dev, so
 *    running `vite dev` without it configured behaves like production.
 *
 * Both checks reference `import.meta.env.VITE_*` as LITERAL member
 * expressions, deliberately never through an intermediate variable
 * (`const env = import.meta.env`). Vite's static env replacement matches
 * the literal `import.meta.env.KEY` pattern per key -- go through a
 * variable instead and Vite cannot resolve it statically, so it falls back
 * to embedding the WHOLE `import.meta.env` object (every `VITE_*` value,
 * including a real `VITE_DEV_AUTH_TOKEN` secret) in the bundle regardless
 * of whether the code path is reachable.
 *
 * HONESTY NOTE on how strongly that is established. The literal-member form
 * below is the documented, safe way and costs nothing, so it stays. But the
 * leak was NOT reproducible on review: three vulnerable shapes were built
 * for real -- an `as Record<...>` cast, a plain `const env =
 * import.meta.env`, and `{ ...import.meta.env }` -- and none of them put the
 * token in `dist`. The check was not vacuous either; `VITE_AUTH_ISSUER` and
 * `VITE_AUTH_CLIENT_ID` DO appear in the bundle, so the env is genuinely
 * loaded at build time.
 *
 * So `test/dev-auth-prod-build.test.ts` passes with each of those shapes as
 * well as with this one, and is therefore a guard nobody has yet made fail.
 * It is kept because it builds for real and would catch a wholesale env dump
 * cheaply -- but it should not be trusted as proof that this pattern is what
 * protects the secret. What IS verified, directly against the built
 * artifact: no credential reaches the bundle today.
 */
export function getDevBearerToken(): string | null {
  if (!import.meta.env.DEV) {
    return null
  }

  if (import.meta.env.VITE_DEV_AUTH !== "true") {
    return null
  }

  const token = import.meta.env.VITE_DEV_AUTH_TOKEN as string | undefined

  return token && token.length > 0 ? token : null
}
