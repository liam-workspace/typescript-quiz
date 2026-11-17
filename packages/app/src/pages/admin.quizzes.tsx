import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { listAdminTests } from "../lib/admin-api.js"
import type { AdminTestPage } from "../lib/api-types.js"

export function loadAdminQuizzes(): Promise<AdminTestPage> {
  return listAdminTests({ limit: 20 })
}

export function AdminQuizzesPending() {
  const { t } = useTranslation("runner")

  return (
    <p role="status" className="device-card text-ink-2">
      {t("admin.quizzes.loading", { defaultValue: "Loading quizzes…" })}
    </p>
  )
}

export function AdminQuizzesError() {
  const { t } = useTranslation("runner")

  return (
    <p role="alert" className="device-card text-bad">
      {t("admin.quizzes.error", {
        defaultValue: "Could not load quizzes. Please refresh to try again.",
      })}
    </p>
  )
}

const lifecycleLabels = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
}

export function AdminQuizzesScreen({
  initialPage,
}: {
  readonly initialPage: AdminTestPage
}) {
  const { i18n, t } = useTranslation("runner")
  const [items, setItems] = useState(initialPage.items)
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor)
  const [loading, setLoading] = useState(false)
  const [loadMoreFailed, setLoadMoreFailed] = useState(false)
  const dates = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" })

  async function loadMore() {
    if (nextCursor === null || loading) {
      return
    }

    setLoading(true)
    setLoadMoreFailed(false)

    try {
      const page = await listAdminTests({ limit: 20, cursor: nextCursor })
      setItems((current) => [...current, ...page.items])
      setNextCursor(page.nextCursor)
    } catch {
      setLoadMoreFailed(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <section aria-labelledby="admin-quizzes-title">
      <h2 id="admin-quizzes-title" className="screen-title">
        {t("admin.quizzes.title", { defaultValue: "Quizzes" })}
      </h2>
      <p className="screen-subtitle">
        {t("admin.quizzes.subtitle", {
          defaultValue:
            "Browse quizzes and open their details to review content.",
        })}
      </p>
      {items.length === 0 ? (
        <p
          role="status"
          className="device-card text-ink-2 mt-5 border-dashed py-8 text-center font-semibold"
        >
          {t("admin.quizzes.empty", { defaultValue: "No quizzes yet." })}
        </p>
      ) : (
        <div
          role="region"
          aria-label={t("admin.quizzes.catalogue", {
            defaultValue: "Quiz catalogue",
          })}
          tabIndex={0}
          className="mt-5 overflow-x-auto"
        >
          <table className="history-table w-full min-w-[560px]">
            <caption className="sr-only">
              {t("admin.quizzes.catalogue", { defaultValue: "Quiz catalogue" })}
            </caption>
            <thead>
              <tr>
                <th scope="col">
                  {t("admin.quizzes.column.title", { defaultValue: "Quiz" })}
                </th>
                <th scope="col">
                  {t("admin.quizzes.column.status", { defaultValue: "Status" })}
                </th>
                <th scope="col">
                  {t("admin.quizzes.column.updated", {
                    defaultValue: "Last updated",
                  })}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((quiz) => (
                <tr key={quiz.id}>
                  <th scope="row" className="text-ink max-w-80 font-bold">
                    <a
                      href={`/admin/quizzes/${encodeURIComponent(quiz.id)}`}
                      className="text-teal inline-flex min-h-11 items-center underline underline-offset-4"
                    >
                      {quiz.title}
                    </a>
                  </th>
                  <td>
                    <span
                      className={
                        quiz.status === "published"
                          ? "bg-teal-bg text-teal rounded-full px-3 py-1 text-sm font-semibold"
                          : "bg-paper text-ink-2 rounded-full px-3 py-1 text-sm font-semibold"
                      }
                    >
                      {t(`admin.quizzes.status.${quiz.status}`, {
                        defaultValue: lifecycleLabels[quiz.status],
                      })}
                    </span>
                  </td>
                  <td className="text-ink-2 whitespace-nowrap">
                    <time dateTime={quiz.updatedAt}>
                      {dates.format(new Date(quiz.updatedAt))}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {nextCursor !== null ? (
        <button
          type="button"
          className="device-button mt-4 w-full sm:w-auto"
          data-variant="secondary"
          disabled={loading}
          aria-busy={loading}
          onClick={loadMore}
        >
          {loading
            ? t("admin.quizzes.loadingMore", {
                defaultValue: "Loading more quizzes…",
              })
            : t("admin.quizzes.loadMore", {
                defaultValue: "Load more quizzes",
              })}
        </button>
      ) : null}
      {loading ? (
        <p role="status" className="text-ink-2 mt-3 text-sm">
          {t("admin.quizzes.loadingMore", {
            defaultValue: "Loading more quizzes…",
          })}
        </p>
      ) : null}
      {loadMoreFailed ? (
        <p role="alert" className="text-bad mt-3 text-sm font-semibold">
          {t("admin.quizzes.loadMoreError", {
            defaultValue: "Could not load more quizzes. Please try again.",
          })}
        </p>
      ) : null}
    </section>
  )
}

export const Route = createFileRoute("/admin/quizzes")({
  loader: loadAdminQuizzes,
  pendingComponent: AdminQuizzesPending,
  errorComponent: AdminQuizzesError,
  component: QuizzesRouteComponent,
})

function QuizzesRouteComponent() {
  return <AdminQuizzesScreen initialPage={Route.useLoaderData()} />
}
