import { Card, CardContent } from "@liam-public/browser-react-ui"
import { createRootRoute } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
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
  component: AppLayout,
  notFoundComponent: RouteNotFound,
})
