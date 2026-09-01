import { Card, CardContent } from "@liam-public/browser-react-ui"
import { Link, createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { ApiError } from "../lib/api-client.js"
import type {
  AttemptHistoryPage,
  AttemptHistoryRow,
  SectionType,
} from "../lib/api-types.js"
import { listAttemptHistory } from "../lib/attempts-api.js"

export function loadHistory(): Promise<AttemptHistoryPage> {
  return listAttemptHistory()
}

function fraction(earned: number, possible: number): string {
  return `${earned} / ${possible}`
}

function scoreBand(percentage: number): "high" | "mid" {
  return percentage >= 90 ? "high" : "mid"
}

function sectionTypesIn(attempts: readonly AttemptHistoryRow[]): SectionType[] {
  return [
    ...new Set(
      attempts.flatMap((attempt) =>
        attempt.sections.map((section) => section.type),
      ),
    ),
  ]
}

export interface HistoryScreenProps {
  readonly initialPage: AttemptHistoryPage
}

export function HistoryScreen({ initialPage }: HistoryScreenProps) {
  const { i18n, t } = useTranslation("runner")
  const [attempts, setAttempts] = useState(initialPage.attempts)
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor)
  const [loading, setLoading] = useState(false)
  const [loadMoreFailed, setLoadMoreFailed] = useState(false)
  const sectionTypes = sectionTypesIn(attempts)
  const sectionTitles = new Map(
    attempts.flatMap((attempt) =>
      attempt.sections.map((section) => [section.type, section.title] as const),
    ),
  )
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
    <div className="device-page">
      <header className="app-bar">
        <span className="app-brand">{t("history.brand")}</span>
      </header>

      <main className="device-main mx-auto w-full max-w-6xl">
        <h1 id="history-title" className="screen-title">
          {t("history.title")}
        </h1>
        <p className="screen-subtitle">{t("history.subtitle")}</p>

        {attempts.length === 0 ? (
          <p
            role="status"
            className="device-card text-ink-2 mt-5 border-dashed py-8 text-center font-semibold"
          >
            {t("history.empty")}
          </p>
        ) : (
          <div
            role="region"
            aria-labelledby="history-title"
            tabIndex={0}
            className="mt-[15px] overflow-x-auto"
          >
            <table className="history-table min-w-[720px]">
              <thead>
                <tr>
                  <th>{t("history.column.test")}</th>
                  <th>{t("history.column.date")}</th>
                  {sectionTypes.map((type) => (
                    <th key={type}>{sectionTitles.get(type)}</th>
                  ))}
                  <th>{t("history.column.score")}</th>
                  <th>{t("history.column.ended")}</th>
                  <th>
                    <span className="sr-only">
                      {t("history.column.action")}
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((attempt) => (
                  <tr key={attempt.id}>
                    <th scope="row" className="text-ink max-w-72 font-bold">
                      {attempt.test.title}
                    </th>
                    <td className="text-ink-2 whitespace-nowrap">
                      <time dateTime={attempt.submittedAt}>
                        {dateFormatter.format(new Date(attempt.submittedAt))}
                      </time>
                    </td>
                    {sectionTypes.map((type) => {
                      const section = attempt.sections.find(
                        (candidate) => candidate.type === type,
                      )

                      return (
                        <td key={type} className="whitespace-nowrap">
                          {section
                            ? fraction(
                                section.pointsEarned,
                                section.pointsPossible,
                              )
                            : t("history.notAvailable")}
                        </td>
                      )
                    })}
                    <td className="whitespace-nowrap">
                      <span className="font-bold">
                        {fraction(attempt.pointsEarned, attempt.pointsPossible)}
                      </span>{" "}
                      <span
                        className="score-badge"
                        data-score-band={scoreBand(attempt.percentage)}
                      >
                        {t("history.percentage", {
                          percentage: numberFormatter.format(
                            attempt.percentage,
                          ),
                        })}
                      </span>
                    </td>
                    <td className="whitespace-nowrap">
                      <span
                        data-ended={attempt.status}
                        className={
                          attempt.status === "expired"
                            ? "text-amber text-[13px] font-bold"
                            : "text-ink-2 text-[13px]"
                        }
                      >
                        {t(`history.status.${attempt.status}`)}
                      </span>
                    </td>
                    <td className="text-right">
                      <a
                        className="device-button px-[11px] text-[12.5px]"
                        data-variant="ghost"
                        href={`/attempts/${attempt.id}/review`}
                      >
                        {t("history.review")}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <button
          type="button"
          className="device-button mt-3 w-full"
          data-variant="secondary"
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

      <footer className="device-footer">
        <Link className="device-button" data-variant="ghost" to="/">
          {t("history.backToLibrary")}
        </Link>
      </footer>
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
  const page = Route.useLoaderData()

  return <HistoryScreen initialPage={page} />
}
