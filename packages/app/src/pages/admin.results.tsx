import { Link, createFileRoute } from "@tanstack/react-router"
import type { SubmitEvent } from "react"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { getAdminAttempt, listAdminResults } from "../lib/admin-api.js"
import type {
  AdminAttemptDetail,
  AdminResultSummary,
} from "../lib/api-types.js"

const idPattern =
  "[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}"
const optionalId = z.guid().optional().catch(undefined)
const searchSchema = z.object({
  testId: optionalId,
  learnerId: optionalId,
  cursor: z.string().min(1).optional().catch(undefined),
  attemptId: optionalId,
})
const selectedChoicesSchema = z.object({
  selectedChoiceIds: z.array(z.string()),
})

type ResultsSearch = z.output<typeof searchSchema>

async function loadResults({
  testId,
  learnerId,
  cursor,
  attemptId,
}: ResultsSearch) {
  if (attemptId) {
    return {
      view: "attempt" as const,
      attempt: await getAdminAttempt(attemptId),
    }
  }

  return {
    view: "results" as const,
    page: await listAdminResults({ limit: 20, testId, learnerId, cursor }),
  }
}

function ResultsPending() {
  const { t } = useTranslation("runner")

  return (
    <p role="status" className="device-card text-ink-2">
      {t("admin.results.loading", { defaultValue: "Loading results…" })}
    </p>
  )
}

function ResultsError() {
  const { t } = useTranslation("runner")
  const { testId, learnerId, cursor, attemptId } = Route.useSearch()

  return (
    <div className="device-card">
      <p role="alert" className="text-bad">
        {attemptId
          ? t("admin.results.attemptError", {
              defaultValue: "Could not load this attempt.",
            })
          : t("admin.results.error", {
              defaultValue: "Could not load results. Please try again.",
            })}
      </p>
      {attemptId && <BackToResults search={{ testId, learnerId, cursor }} />}
    </div>
  )
}

function BackToResults({ search }: { readonly search: ResultsSearch }) {
  const { t } = useTranslation("runner")

  return (
    <Link
      to="/admin/results"
      search={search}
      className="text-teal inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
    >
      {t("admin.results.back", { defaultValue: "Back to results" })}
    </Link>
  )
}

function ResultsFilters({ testId, learnerId }: ResultsSearch) {
  const { t } = useTranslation("runner")
  const navigate = Route.useNavigate()

  function applyFilters(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const search = searchSchema.parse({
      testId: fields.get("testId"),
      learnerId: fields.get("learnerId"),
    })
    void navigate({ search })
  }

  return (
    <form
      onSubmit={applyFilters}
      className="device-card mt-5 flex flex-wrap items-end gap-4"
    >
      <label className="grid min-w-48 flex-1 gap-1 text-sm font-semibold">
        {t("admin.results.quizId", { defaultValue: "Quiz ID" })}
        <input
          className="border-line bg-paper rounded-md border px-3 py-2 font-normal"
          name="testId"
          defaultValue={testId}
          pattern={idPattern}
          title={t("admin.results.idHint", { defaultValue: "Enter a UUID." })}
        />
      </label>
      <label className="grid min-w-48 flex-1 gap-1 text-sm font-semibold">
        {t("admin.results.learnerId", { defaultValue: "Learner ID" })}
        <input
          className="border-line bg-paper rounded-md border px-3 py-2 font-normal"
          name="learnerId"
          defaultValue={learnerId}
          pattern={idPattern}
          title={t("admin.results.idHint", { defaultValue: "Enter a UUID." })}
        />
      </label>
      <button type="submit" className="device-button" data-variant="secondary">
        {t("admin.results.apply", { defaultValue: "Apply filters" })}
      </button>
      {(testId ?? learnerId) && (
        <Link
          to="/admin/results"
          search={{}}
          className="text-teal inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
        >
          {t("admin.results.clear", { defaultValue: "Clear filters" })}
        </Link>
      )}
    </form>
  )
}

function ResultsTable({
  items,
  search,
}: {
  readonly items: AdminResultSummary[]
  readonly search: ResultsSearch
}) {
  const { i18n, t } = useTranslation("runner")
  const dates = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" })
  const caption = t("admin.results.completedAttempts", {
    defaultValue: "Completed attempts",
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
              {t("admin.results.quiz", { defaultValue: "Quiz" })}
            </th>
            <th scope="col">
              {t("admin.results.score", { defaultValue: "Score" })}
            </th>
            <th scope="col">
              {t("admin.results.completed", { defaultValue: "Completed" })}
            </th>
            <th scope="col">
              {t("admin.results.attempt", { defaultValue: "Attempt" })}
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.attemptId}>
              <th scope="row">
                <Link
                  to="/admin/results"
                  search={{ testId: item.testId, learnerId: search.learnerId }}
                  aria-label={t("admin.results.filterQuiz", {
                    defaultValue: "Filter by quiz {{title}}",
                    title: item.testTitle,
                  })}
                  className="text-teal inline-flex min-h-11 items-center underline underline-offset-4"
                >
                  {item.testTitle}
                </Link>
              </th>
              <td className="font-bold whitespace-nowrap">
                {item.score} / {item.maxScore}
              </td>
              <td className="whitespace-nowrap">
                <time dateTime={item.completedAt}>
                  {dates.format(new Date(item.completedAt))}
                </time>
              </td>
              <td>
                <Link
                  to="/admin/results"
                  search={{ ...search, attemptId: item.attemptId }}
                  preload={false}
                  aria-label={t("admin.results.viewAttemptLabel", {
                    defaultValue: "View attempt on {{quiz}}",
                    quiz: item.testTitle,
                  })}
                  className="text-teal inline-flex min-h-11 items-center font-semibold whitespace-nowrap underline underline-offset-4"
                >
                  {t("admin.results.viewAttempt", {
                    defaultValue: "View attempt",
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

function AttemptResponse({ response }: { readonly response: unknown }) {
  const { t } = useTranslation("runner")
  const choices = selectedChoicesSchema.safeParse(response)

  if (!choices.success) {
    return t("admin.results.unavailableResponse", {
      defaultValue: "Response unavailable",
    })
  }

  if (choices.data.selectedChoiceIds.length === 0) {
    return t("admin.results.unanswered", { defaultValue: "Unanswered" })
  }

  return (
    <ul className="font-mono">
      {choices.data.selectedChoiceIds.map((id) => (
        <li key={id}>{id}</li>
      ))}
    </ul>
  )
}

function AttemptAnswers({
  answers,
}: {
  readonly answers: AdminAttemptDetail["answers"]
}) {
  const { t } = useTranslation("runner")
  const caption = t("admin.results.answers", { defaultValue: "Answers" })

  if (answers.length === 0) {
    return (
      <p className="text-ink-2 mt-4">
        {t("admin.results.noAnswers", {
          defaultValue: "No answers are recorded.",
        })}
      </p>
    )
  }

  return (
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className="mt-4 overflow-x-auto"
    >
      <table className="history-table min-w-[520px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">
              {t("admin.results.questionId", { defaultValue: "Question ID" })}
            </th>
            <th scope="col">
              {t("admin.results.selectedChoices", {
                defaultValue: "Selected choice IDs",
              })}
            </th>
            <th scope="col">
              {t("admin.results.score", { defaultValue: "Score" })}
            </th>
          </tr>
        </thead>
        <tbody>
          {answers.map((answer) => (
            <tr key={answer.questionId}>
              <th scope="row" className="font-mono font-normal">
                {answer.questionId}
              </th>
              <td>
                <AttemptResponse response={answer.response} />
              </td>
              <td className="font-bold whitespace-nowrap">
                {answer.score} / {answer.maxScore}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AttemptDetail({
  attempt,
  search,
}: {
  readonly attempt: AdminAttemptDetail
  readonly search: ResultsSearch
}) {
  const { i18n, t } = useTranslation("runner")
  const dates = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  })

  return (
    <section aria-labelledby="attempt-detail-title">
      <BackToResults search={search} />
      <h2 id="attempt-detail-title" className="screen-title">
        {t("admin.results.detailTitle", { defaultValue: "Attempt detail" })}
      </h2>
      <p className="screen-subtitle">
        {t("admin.results.detailAudit", {
          defaultValue: "Read-only attempt. Access is audited.",
        })}
      </p>
      <dl className="device-card mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-ink-2 text-sm">
            {t("admin.results.quiz", { defaultValue: "Quiz" })}
          </dt>
          <dd className="font-bold">{attempt.testTitle}</dd>
        </div>
        <div>
          <dt className="text-ink-2 text-sm">
            {t("admin.results.learner", { defaultValue: "Learner" })}
          </dt>
          <dd className="font-bold">{attempt.learnerName}</dd>
        </div>
        <div>
          <dt className="text-ink-2 text-sm">
            {t("admin.results.score", { defaultValue: "Score" })}
          </dt>
          <dd className="font-bold tabular-nums">
            {attempt.score} / {attempt.maxScore}
          </dd>
        </div>
        <div>
          <dt className="text-ink-2 text-sm">
            {t("admin.results.completed", { defaultValue: "Completed" })}
          </dt>
          <dd className="font-bold">
            <time dateTime={attempt.completedAt}>
              {dates.format(new Date(attempt.completedAt))}
            </time>
          </dd>
        </div>
      </dl>
      <AttemptAnswers answers={attempt.answers} />
    </section>
  )
}

function ResultsRouteComponent() {
  const { t } = useTranslation("runner")
  const { testId, learnerId, cursor } = Route.useSearch()
  const data = Route.useLoaderData()
  const search = { testId, learnerId, cursor }

  if (data.view === "attempt") {
    return <AttemptDetail attempt={data.attempt} search={search} />
  }

  return (
    <section aria-labelledby="admin-results-title">
      <h2 id="admin-results-title" className="screen-title">
        {t("admin.results.title", { defaultValue: "Results" })}
      </h2>
      <p className="screen-subtitle">
        {t("admin.results.subtitle", {
          defaultValue:
            "Review completed-attempt scores. Filter by quiz ID or learner ID.",
        })}
      </p>
      <ResultsFilters key={`${testId ?? ""}:${learnerId ?? ""}`} {...search} />
      {data.page.items.length > 0 ? (
        <ResultsTable items={data.page.items} search={search} />
      ) : (
        <p
          role="status"
          className="device-card text-ink-2 mt-5 border-dashed py-8 text-center font-semibold"
        >
          {testId || learnerId
            ? t("admin.results.filteredEmpty", {
                defaultValue: "No results match these filters.",
              })
            : t("admin.results.empty", {
                defaultValue: "No completed attempts yet.",
              })}
        </p>
      )}
      {(cursor ?? data.page.nextCursor) && (
        <nav
          aria-label={t("admin.results.pagination", {
            defaultValue: "Results pages",
          })}
          className="mt-4 flex flex-wrap gap-3"
        >
          {cursor && (
            <Link
              to="/admin/results"
              search={{ testId, learnerId }}
              className="device-button"
              data-variant="secondary"
            >
              {t("admin.results.firstPage", { defaultValue: "First page" })}
            </Link>
          )}
          {data.page.nextCursor && (
            <Link
              to="/admin/results"
              search={{ ...search, cursor: data.page.nextCursor }}
              className="device-button"
              data-variant="secondary"
            >
              {t("admin.results.nextPage", { defaultValue: "Next page" })}
            </Link>
          )}
        </nav>
      )}
    </section>
  )
}

export const Route = createFileRoute("/admin/results")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: {
    handler: ({ deps }) => loadResults(deps),
    staleReloadMode: "blocking",
  },
  // Reopening a detail must go through the audited read again.
  gcTime: 0,
  pendingComponent: ResultsPending,
  errorComponent: ResultsError,
  component: ResultsRouteComponent,
})
