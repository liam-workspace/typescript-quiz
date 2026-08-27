import {
  Button,
  Card,
  CardContent,
  CardFooter,
} from "@liam-public/browser-react-ui"
import { createFileRoute } from "@tanstack/react-router"
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
    year: "numeric",
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
    <div className="mx-auto flex min-h-screen max-w-6xl items-center px-4 py-8 sm:px-8">
      <Card className="w-full overflow-hidden border-stone-200 bg-stone-50 shadow-md">
        <CardContent className="px-5 py-7 sm:px-8">
          <h1 className="text-2xl font-extrabold tracking-tight text-stone-900">
            {t("history.title")}
          </h1>
          <p className="mt-1 text-sm text-stone-600">{t("history.subtitle")}</p>

          {attempts.length === 0 ? (
            <p
              role="status"
              className="mt-8 rounded-xl border border-dashed border-stone-300 bg-white px-5 py-8 text-center font-semibold text-stone-600"
            >
              {t("history.empty")}
            </p>
          ) : (
            <div className="mt-6 overflow-x-auto rounded-xl border border-stone-200 bg-white">
              <table className="w-full min-w-max border-collapse text-left text-sm">
                <thead className="bg-stone-100 text-xs tracking-wide text-stone-600 uppercase">
                  <tr>
                    <th className="px-4 py-3 font-extrabold">
                      {t("history.column.test")}
                    </th>
                    <th className="px-4 py-3 font-extrabold">
                      {t("history.column.date")}
                    </th>
                    {sectionTypes.map((type) => (
                      <th key={type} className="px-4 py-3 font-extrabold">
                        {sectionTitles.get(type)}
                      </th>
                    ))}
                    <th className="px-4 py-3 font-extrabold">
                      {t("history.column.score")}
                    </th>
                    <th className="px-4 py-3 font-extrabold">
                      {t("history.column.ended")}
                    </th>
                    <th className="px-4 py-3">
                      <span className="sr-only">
                        {t("history.column.action")}
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200">
                  {attempts.map((attempt) => (
                    <tr key={attempt.id} className="text-stone-800">
                      <th
                        scope="row"
                        className="max-w-72 px-4 py-4 font-bold text-stone-950"
                      >
                        {attempt.test.title}
                      </th>
                      <td className="px-4 py-4 whitespace-nowrap text-stone-600">
                        <time dateTime={attempt.submittedAt}>
                          {dateFormatter.format(new Date(attempt.submittedAt))}
                        </time>
                      </td>
                      {sectionTypes.map((type) => {
                        const section = attempt.sections.find(
                          (candidate) => candidate.type === type,
                        )

                        return (
                          <td
                            key={type}
                            className="px-4 py-4 whitespace-nowrap tabular-nums"
                          >
                            {section
                              ? fraction(
                                  section.pointsEarned,
                                  section.pointsPossible,
                                )
                              : t("history.notAvailable")}
                          </td>
                        )
                      })}
                      <td className="px-4 py-4 whitespace-nowrap tabular-nums">
                        <span className="font-bold">
                          {fraction(
                            attempt.pointsEarned,
                            attempt.pointsPossible,
                          )}
                        </span>{" "}
                        <span className="ml-1 inline-flex rounded-full bg-teal-100 px-2.5 py-1 text-xs font-extrabold text-teal-900">
                          {t("history.percentage", {
                            percentage: numberFormatter.format(
                              attempt.percentage,
                            ),
                          })}
                        </span>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <span
                          className={
                            attempt.status === "expired"
                              ? "font-bold text-amber-700"
                              : "text-stone-600"
                          }
                        >
                          {t(`history.status.${attempt.status}`)}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <Button
                          asChild
                          variant="outline"
                          size="sm"
                          className="h-11 min-w-11 touch-manipulation select-none"
                        >
                          <a href={`/attempts/${attempt.id}/review`}>
                            {t("history.review")}
                          </a>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4 h-11 w-full touch-manipulation select-none"
            disabled={nextCursor === null || loading}
            aria-busy={loading}
            onClick={loadMore}
          >
            {t(
              nextCursor === null
                ? "history.noOlderAttempts"
                : "history.loadMore",
            )}
          </Button>
          {loadMoreFailed ? (
            <p
              role="alert"
              className="mt-3 text-sm font-semibold text-rose-700"
            >
              {t("history.loadMoreError")}
            </p>
          ) : null}
        </CardContent>

        <CardFooter className="border-t border-stone-200 bg-white px-5 sm:px-8">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-11 min-w-11 touch-manipulation select-none"
          >
            <a href="/">{t("history.backToLibrary")}</a>
          </Button>
        </CardFooter>
      </Card>
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
