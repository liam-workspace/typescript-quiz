import { Link, createFileRoute } from "@tanstack/react-router"
import { useEffect, useRef, type SubmitEvent } from "react"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { listAdminLearners, listAdminResults } from "../lib/admin-api.js"
import type { AdminLearnerSummary, AdminResultPage } from "../lib/api-types.js"

const searchSchema = z.object({
  search: z.string().trim().min(1).max(200).optional().catch(undefined),
  cursor: z.string().min(1).optional().catch(undefined),
  learnerId: z.guid().optional().catch(undefined),
})

type LearnersSearch = z.output<typeof searchSchema>

async function loadLearners({ search, cursor, learnerId }: LearnersSearch) {
  const page = await listAdminLearners({ limit: 20, search, cursor })
  const learner = page.items.find((item) => item.id === learnerId)
  const history = learner
    ? await listAdminResults({ limit: 5, learnerId: learner.id })
    : null

  return { page, learner, history }
}

function LearnerSearch({ search }: LearnersSearch) {
  const { t } = useTranslation("runner")
  const navigate = Route.useNavigate()

  function submitSearch(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    void navigate({
      search: searchSchema.parse({ search: fields.get("search") }),
    })
  }

  return (
    <form
      onSubmit={submitSearch}
      className="device-card mt-5 flex flex-wrap items-end gap-4"
    >
      <label className="grid min-w-48 flex-1 gap-1 text-sm font-semibold">
        {t("admin.learners.searchLabel", { defaultValue: "Name or email" })}
        <input
          type="search"
          name="search"
          defaultValue={search}
          maxLength={200}
          className="border-line bg-paper rounded-md border px-3 py-2 font-normal"
        />
      </label>
      <button type="submit" className="device-button" data-variant="secondary">
        {t("admin.learners.search", { defaultValue: "Search" })}
      </button>
      {search && (
        <Link
          to="/admin/learners"
          search={{}}
          className="text-teal inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
        >
          {t("admin.learners.clear", { defaultValue: "Clear search" })}
        </Link>
      )}
    </form>
  )
}

function LearnerDirectory({
  items,
  search,
}: {
  readonly items: AdminLearnerSummary[]
  readonly search: LearnersSearch
}) {
  const { i18n, t } = useTranslation("runner")
  const dates = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" })
  const caption = t("admin.learners.roster", {
    defaultValue: "Local learner profiles",
  })

  return (
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className="mt-5 overflow-x-auto"
    >
      <table className="history-table min-w-[620px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">
              {t("admin.learners.name", { defaultValue: "Learner" })}
            </th>
            <th scope="col">
              {t("admin.learners.email", { defaultValue: "Email" })}
            </th>
            <th scope="col">
              {t("admin.learners.attempts", { defaultValue: "Attempts" })}
            </th>
            <th scope="col">
              {t("admin.learners.lastAttempt", {
                defaultValue: "Last attempt",
              })}
            </th>
            <th scope="col">
              {t("admin.learners.history", { defaultValue: "History" })}
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((learner) => (
            <tr key={learner.id}>
              <th scope="row" className="font-bold">
                {learner.displayName}
              </th>
              <td className="break-all">{learner.email}</td>
              <td>{learner.attemptCount}</td>
              <td className="whitespace-nowrap">
                {learner.lastAttemptAt ? (
                  <time dateTime={learner.lastAttemptAt}>
                    {dates.format(new Date(learner.lastAttemptAt))}
                  </time>
                ) : (
                  t("admin.learners.noAttempts", { defaultValue: "None yet" })
                )}
              </td>
              <td>
                <Link
                  to="/admin/learners"
                  search={{ ...search, learnerId: learner.id }}
                  hash="learner-result-history"
                  aria-label={t("admin.learners.viewHistoryLabel", {
                    defaultValue: "View history for {{name}}",
                    name: learner.displayName,
                  })}
                  className="text-teal inline-flex min-h-11 items-center font-semibold whitespace-nowrap underline underline-offset-4"
                >
                  {t("admin.learners.viewHistory", {
                    defaultValue: "View history",
                  })}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function LearnerHistory({
  learner,
  history,
}: {
  readonly learner: AdminLearnerSummary
  readonly history: AdminResultPage
}) {
  const { i18n, t } = useTranslation("runner")
  const dates = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" })
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [learner.id])

  return (
    <section
      id="learner-result-history"
      aria-labelledby="learner-history-title"
      className="device-card mt-6"
    >
      <h3
        id="learner-history-title"
        ref={headingRef}
        tabIndex={-1}
        className="text-lg font-bold"
      >
        {t("admin.learners.historyTitle", {
          defaultValue: "Result history for {{name}}",
          name: learner.displayName,
        })}
      </h3>
      {history.items.length > 0 ? (
        <>
          <ul className="mt-2">
            {history.items.map((item) => (
              <li
                key={item.attemptId}
                className="border-line grid grid-cols-[1fr_auto] gap-x-3 border-b py-3"
              >
                <span className="font-semibold">{item.testTitle}</span>
                <span className="font-bold tabular-nums">
                  {item.score} / {item.maxScore}
                </span>
                <time
                  dateTime={item.completedAt}
                  className="text-ink-2 text-sm"
                >
                  {dates.format(new Date(item.completedAt))}
                </time>
              </li>
            ))}
          </ul>
          <Link
            to="/admin/results"
            search={{ learnerId: learner.id }}
            className="text-teal mt-2 inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
          >
            {t("admin.learners.allResults", {
              defaultValue: "View all results",
            })}
          </Link>
        </>
      ) : (
        <p className="text-ink-2 mt-2">
          {t("admin.learners.noResults", {
            defaultValue: "No completed attempts yet.",
          })}
        </p>
      )}
    </section>
  )
}

function LearnersRouteComponent() {
  const { t } = useTranslation("runner")
  const { search, cursor } = Route.useSearch()
  const { page, learner, history } = Route.useLoaderData()

  return (
    <section aria-labelledby="admin-learners-title">
      <h2 id="admin-learners-title" className="screen-title">
        {t("admin.learners.title", { defaultValue: "Learners" })}
      </h2>
      <LearnerSearch key={search} search={search} />
      {page.items.length > 0 ? (
        <LearnerDirectory items={page.items} search={{ search, cursor }} />
      ) : (
        <p
          role="status"
          className="device-card text-ink-2 mt-5 border-dashed py-8 text-center font-semibold"
        >
          {search
            ? t("admin.learners.filteredEmpty", {
                defaultValue: "No learners match this search.",
              })
            : t("admin.learners.empty", { defaultValue: "No learners yet." })}
        </p>
      )}
      {(cursor ?? page.nextCursor) && (
        <nav
          aria-label={t("admin.learners.pagination", {
            defaultValue: "Learner pages",
          })}
          className="mt-4 flex flex-wrap gap-3"
        >
          {cursor && (
            <Link
              to="/admin/learners"
              search={{ search }}
              className="device-button"
              data-variant="secondary"
            >
              {t("admin.learners.firstPage", { defaultValue: "First page" })}
            </Link>
          )}
          {page.nextCursor && (
            <Link
              to="/admin/learners"
              search={{ search, cursor: page.nextCursor }}
              className="device-button"
              data-variant="secondary"
            >
              {t("admin.learners.nextPage", { defaultValue: "Next page" })}
            </Link>
          )}
        </nav>
      )}
      {learner && history && (
        <LearnerHistory learner={learner} history={history} />
      )}
    </section>
  )
}

function LearnersPending() {
  const { t } = useTranslation("runner")

  return (
    <p role="status" className="device-card text-ink-2">
      {t("admin.learners.loading", { defaultValue: "Loading learners…" })}
    </p>
  )
}

function LearnersError() {
  const { t } = useTranslation("runner")

  return (
    <p role="alert" className="device-card text-bad">
      {t("admin.learners.error", {
        defaultValue: "Could not load learner information. Please try again.",
      })}
    </p>
  )
}

export const Route = createFileRoute("/admin/learners")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => loadLearners(deps),
  pendingComponent: LearnersPending,
  errorComponent: LearnersError,
  component: LearnersRouteComponent,
})
