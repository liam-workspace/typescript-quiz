import { Card, CardContent } from "@liam-workspace/browser-react-ui"
import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Icon } from "../components/Icon.js"
import { ApiError } from "../lib/api-client.js"
import type { AttemptHistoryPage, Student } from "../lib/api-types.js"
import { listAttemptHistory } from "../lib/attempts-api.js"
import { getCurrentStudent } from "../lib/session-api.js"

export interface HistoryData {
  initialPage: AttemptHistoryPage
  student: Student | null
}

export async function loadHistory(): Promise<HistoryData> {
  const [initialPage, student] = await Promise.all([
    listAttemptHistory(),
    getCurrentStudent().catch(() => null),
  ])

  return { initialPage, student }
}

export interface HistoryScreenProps {
  readonly initialPage: AttemptHistoryPage
  /** Kept for the route's loader shape; the screen no longer shows it. */
  readonly student?: Student | null
}

export function HistoryScreen({ initialPage }: HistoryScreenProps) {
  const { i18n, t } = useTranslation("runner")
  const [attempts, setAttempts] = useState(initialPage.attempts)
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor)
  const [loading, setLoading] = useState(false)
  const [loadMoreFailed, setLoadMoreFailed] = useState(false)
  const dateFormatter = new Intl.DateTimeFormat(i18n.language, {
    day: "numeric",
    month: "short",
  })
  const numberFormatter = new Intl.NumberFormat(i18n.language, {
    maximumFractionDigits: 2,
  })

  async function loadMore() {
    if (nextCursor === null || loading) {
      return
    }

    setLoading(true)
    setLoadMoreFailed(false)

    try {
      const page = await listAttemptHistory(nextCursor)
      setAttempts((current) => [...current, ...page.attempts])
      setNextCursor(page.nextCursor)
    } catch {
      setLoadMoreFailed(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="m-page">
      <header className="m-appbar">
        <span className="m-brand">{t("history.brand")}</span>
      </header>

      <main className="m-body">
        <h1
          id="history-title"
          className="m-title"
          tabIndex={-1}
          data-page-title
        >
          {t("history.title")}
        </h1>
        <p className="m-sub">{t("history.subtitle")}</p>

        {attempts.length === 0 ? (
          <p
            role="status"
            className="m-card text-ink-2 mt-5 border-dashed py-8 text-center font-bold"
          >
            {t("history.empty")}
          </p>
        ) : (
          <ul
            aria-labelledby="history-title"
            className="m-stack mt-4 list-none p-0"
          >
            {attempts.map((attempt) => (
              <li key={attempt.id} className="m-card">
                <div className="m-row" data-align="start">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-[16.5px] font-extrabold">
                      {attempt.test.title}
                    </h2>
                    <p className="m-meta">
                      <time dateTime={attempt.submittedAt}>
                        {dateFormatter.format(new Date(attempt.submittedAt))}
                      </time>
                    </p>
                    <div className="m-chips">
                      <span
                        className="m-chip"
                        data-tone={
                          attempt.status === "expired" ? "warn" : "good"
                        }
                        data-ended={attempt.status}
                      >
                        <Icon
                          name={
                            attempt.status === "expired" ? "clock" : "check"
                          }
                          small
                        />
                        {t(`history.status.${attempt.status}`)}
                      </span>
                    </div>
                  </div>
                  <b className="text-2xl tabular-nums">
                    {t("history.percentage", {
                      percentage: numberFormatter.format(attempt.percentage),
                    })}
                  </b>
                </div>
                <div className="m-actions">
                  <a
                    className="m-btn"
                    data-size="sm"
                    data-variant="secondary"
                    href={`/attempts/${attempt.id}/review`}
                  >
                    {t("history.review")}
                  </a>
                  <a
                    className="m-btn"
                    data-size="sm"
                    data-variant="ghost"
                    href={`/attempts/${attempt.id}/result`}
                  >
                    {t("history.resultLink")}
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          className="m-btn mt-3"
          data-variant="secondary"
          data-block="true"
          disabled={nextCursor === null || loading}
          aria-busy={loading}
          onClick={loadMore}
        >
          {t(
            nextCursor === null
              ? "history.noOlderAttempts"
              : "history.loadMore",
          )}
        </button>
        {loadMoreFailed ? (
          <p role="alert" className="text-bad mt-3 text-sm font-semibold">
            {t("history.loadMoreError")}
          </p>
        ) : null}
      </main>
    </div>
  )
}

export interface HistoryRouteErrorProps {
  readonly error: unknown
}

export function HistoryRouteError({ error }: HistoryRouteErrorProps) {
  const { t } = useTranslation("runner")
  const unauthorized = error instanceof ApiError && error.problem.status === 401

  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <Card>
        <CardContent>
          <p role="alert">
            {t(unauthorized ? "history.unauthorized" : "history.error")}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute("/history")({
  loader: loadHistory,
  errorComponent: HistoryRouteError,
  component: RouteComponent,
})

function RouteComponent() {
  const data = Route.useLoaderData()

  return <HistoryScreen initialPage={data.initialPage} student={data.student} />
}
