import { Card, CardContent } from "@liam-workspace/browser-react-ui"
import { createRootRoute } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { requireAuth } from "../lib/auth-guard.js"
import { AppLayout } from "./layout.js"

/**
 * Shown for genuinely unknown routes. The registered `/` route is the test
 * library, while this remains the readable fallback for mistyped or stale
 * URLs and leaves the child a way back to their attempts.
 */
function RouteNotFound() {
  const { t } = useTranslation("runner")

  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <Card>
        <CardContent className="space-y-3">
          <p role="status">{t("notFound.message")}</p>
          <a className="font-bold underline" href="/history">
            {t("notFound.goToHistory")}
          </a>
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createRootRoute({
  // ONE guard for every route, here rather than per-page (plan, Task 4):
  // every route beneath the root runs this `beforeLoad` before its own
  // loader, so a page cannot forget to add it. `/sign-in` and `/callback`
  // are the only two routes `requireAuth` itself exempts.
  beforeLoad: ({ location }) => {
    requireAuth(location.pathname)
  },
  component: AppLayout,
  notFoundComponent: RouteNotFound,
})
