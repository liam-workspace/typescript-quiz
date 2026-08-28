import { Card, CardContent } from "@liam-public/browser-react-ui"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { ApiError } from "../lib/api-client.js"
import { completeSignIn as completeSignInImpl } from "../lib/auth.js"
import { readAndClearPostSignInRedirect as readAndClearPostSignInRedirectImpl } from "../lib/postSignInRedirect.js"

// The registered redirect URI's path (`http://localhost:3000/callback`,
// plan "The registration") -- not `/auth/callback`, which the plan's own
// Task 3 originally said before the live registration corrected it.

export interface LoadCallbackDeps {
  readonly completeSignIn: (
    code: string,
  ) => ReturnType<typeof completeSignInImpl>
  readonly readAndClearPostSignInRedirect: () => string | null
}

const defaultDeps: LoadCallbackDeps = {
  completeSignIn: completeSignInImpl,
  readAndClearPostSignInRedirect: readAndClearPostSignInRedirectImpl,
}

/**
 * On mount with `?code=`: exchanges it and provisions the session
 * (`completeSignIn`, `auth.ts`), then resolves the destination to return
 * to -- the page the guard (`auth-guard.ts`) remembered before sending the
 * child to sign in, or the library if nothing was remembered (a direct,
 * unguarded sign-in). Deliberately returns the target rather than
 * navigating itself, so the router wiring below decides HOW to get there
 * (a loader `redirect()`) while this stays trivially testable.
 */
export async function loadCallback(
  code: string | undefined,
  deps: LoadCallbackDeps = defaultDeps,
): Promise<string> {
  if (!code) {
    throw new Error(
      "The sign-in callback was reached with no authorization code.",
    )
  }

  await deps.completeSignIn(code)

  return deps.readAndClearPostSignInRedirect() ?? "/"
}

export function CallbackScreen() {
  const { t } = useTranslation("runner")

  return (
    <div className="bg-surface text-ink flex min-h-screen items-center justify-center px-4">
      <p role="status" className="text-ink-2 text-sm font-semibold">
        {t("callback.working")}
      </p>
    </div>
  )
}

export interface CallbackRouteErrorProps {
  readonly error: unknown
}

/**
 * `403` (email not on the allowlist) is a real, renderable state, not an
 * error to swallow -- and with two account types (Google and Microsoft)
 * it is the likely outcome of signing in with the wrong one. No retry
 * loop: retrying the same disallowed account produces the same `403`
 * forever. Every other failure (a network blip, a bad/expired code, the
 * token exchange itself failing) gets one honest retry back to sign-in
 * instead.
 */
export function CallbackRouteError({ error }: CallbackRouteErrorProps) {
  const { t } = useTranslation("runner")
  const notAllowed = error instanceof ApiError && error.problem.status === 403

  return (
    <div className="bg-surface min-h-screen px-4 py-12">
      <Card className="border-line bg-paper mx-auto max-w-xl">
        <CardContent className="space-y-3">
          <p role="alert">
            {t(notAllowed ? "callback.notAllowed" : "callback.error")}
          </p>
          {notAllowed ? (
            <p className="text-ink-2 text-sm">
              {t("callback.notAllowed.detail")}
            </p>
          ) : (
            <a
              href="/sign-in"
              className="text-teal focus-visible:outline-teal inline-flex size-11 w-auto touch-manipulation items-center justify-center px-4 font-bold underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {t("callback.retry")}
            </a>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

const searchSchema = z.object({ code: z.string().optional() })

export const Route = createFileRoute("/callback")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const target = await loadCallback(deps.code)

    // See auth-guard.ts: `throw: true` makes `redirect()` throw
    // internally, so no literal `throw` is needed (or wanted) here.
    redirect({ href: target, replace: true, throw: true })
  },
  pendingComponent: CallbackScreen,
  errorComponent: CallbackRouteError,
  component: CallbackScreen,
})
