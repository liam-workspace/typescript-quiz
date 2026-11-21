import { Link, createFileRoute } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { getAdminOverview } from "../lib/admin-api.js"
import type { AdminOverview } from "../lib/api-types.js"

export function loadAdminOverview(): Promise<AdminOverview> {
  return getAdminOverview()
}

export function AdminOverviewPending() {
  const { t } = useTranslation("runner")

  return (
    <p role="status" className="device-card text-ink-2">
      {t("admin.overview.loading", { defaultValue: "Loading overview…" })}
    </p>
  )
}

export function AdminOverviewError() {
  const { t } = useTranslation("runner")

  return (
    <p role="alert" className="device-card text-bad">
      {t("admin.overview.error", {
        defaultValue:
          "Could not load the overview. Please refresh to try again.",
      })}
    </p>
  )
}

export function AdminOverviewScreen({
  overview,
}: {
  readonly overview: AdminOverview
}) {
  const { i18n, t } = useTranslation("runner")
  const counts = [
    {
      key: "totalQuizzes",
      label: "Total quizzes",
      value: overview.tests.total,
    },
    {
      key: "draftQuizzes",
      label: "Draft quizzes",
      value: overview.tests.drafts,
    },
    {
      key: "publishedQuizzes",
      label: "Published quizzes",
      value: overview.tests.published,
    },
    {
      key: "totalAttempts",
      label: "Total attempts",
      value: overview.attempts.total,
    },
    {
      key: "inProgress",
      label: "In progress",
      value: overview.attempts.inProgress,
    },
    {
      key: "completed",
      label: "Completed",
      value: overview.attempts.completed,
    },
    { key: "learners", label: "Learners", value: overview.learners.total },
  ]
  const numbers = new Intl.NumberFormat(i18n.language)

  return (
    <section aria-labelledby="admin-overview-title">
      <h2 id="admin-overview-title" className="screen-title">
        {t("admin.overview.title", { defaultValue: "Overview" })}
      </h2>
      <p className="screen-subtitle">
        {t("admin.overview.subtitle", {
          defaultValue: "Quiz publishing and learner activity at a glance.",
        })}
      </p>
      <dl className="my-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {counts.map(({ key, label, value }) => (
          <div key={key} className="device-card min-w-0">
            <dt className="text-ink-2 text-sm font-semibold">
              {t(`admin.overview.${key}`, { defaultValue: label })}
            </dt>
            <dd className="text-ink mt-2 text-3xl font-extrabold tabular-nums">
              {numbers.format(value)}
            </dd>
          </div>
        ))}
      </dl>
      <Link to="/admin/quizzes" className="device-button">
        {t("admin.overview.browseQuizzes", { defaultValue: "Browse quizzes" })}
      </Link>
    </section>
  )
}

export const Route = createFileRoute("/admin/")({
  loader: loadAdminOverview,
  pendingComponent: AdminOverviewPending,
  errorComponent: AdminOverviewError,
  component: OverviewRouteComponent,
})

function OverviewRouteComponent() {
  return <AdminOverviewScreen overview={Route.useLoaderData()} />
}
