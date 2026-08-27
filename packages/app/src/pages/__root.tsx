import { Card, CardContent } from "@liam-public/browser-react-ui"
import { createRootRoute } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { AppLayout } from "./layout.js"

/**
 * Shown for any route this app does not register -- most concretely `/`,
 * which the result and history screens both offer as "Back to library".
 * The library screen is not built yet, so that button is a dead end, and
 * without this a child tapping it after every single test lands on the
 * router's bare default with nothing to read and nowhere to go.
 *
 * This does not make the library exist. It makes the dead end honest and
 * leaves the child a way back to their attempts, which is the part that
 * matters while it is still missing.
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
