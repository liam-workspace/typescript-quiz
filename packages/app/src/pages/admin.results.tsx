import { Await, Link, createFileRoute } from "@tanstack/react-router"
import type { SubmitEvent } from "react"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import {
  getAdminAttempt,
  getAdminResultRollups,
  listAdminResults,
} from "../lib/admin-api.js"
import type {
  AdminAttemptDetail,
  AdminResultPage,
  AdminResultRollups,
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
const rollupLimit = 20

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
    rollups: getAdminResultRollups({ limit: rollupLimit, testId }).catch(
      () => null,
    ),
    page: listAdminResults({ limit: 20, testId, learnerId, cursor }).catch(
      () => null,
    ),
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

function RollupTable({
  title,
  rows,
  activeTestId,
  onFilterTest,
}: {
  readonly title: string
  readonly rows: AdminResultRollups[keyof AdminResultRollups]
  readonly activeTestId?: string
  readonly onFilterTest?: (testId: string) => void
}) {
  const { i18n, t } = useTranslation("runner")
  const numbers = new Intl.NumberFormat(i18n.language)

  return (
    <div className="device-card min-w-0">
      <h4 className="mb-3 font-bold">{title}</h4>
      {rows.length === 0 ? (
        <p className="text-ink-2 text-sm">
          {t("admin.results.rollups.dimensionEmpty", {
            defaultValue: "No data for this group.",
          })}
        </p>
      ) : (
        <div
          role="region"
          aria-label={title}
          tabIndex={0}
          className="max-h-72 overflow-auto"
        >
          <table className="history-table min-w-[410px]">
            <caption className="sr-only">{title}</caption>
            <thead className="bg-paper sticky top-0">
              <tr>
                <th scope="col">
                  {t("admin.results.rollups.label", { defaultValue: "Label" })}
                </th>
                <th scope="col">
                  {t("admin.results.rollups.attempts", {
                    defaultValue: "Attempts",
                  })}
                </th>
                <th scope="col">
                  {t("admin.results.rollups.totalScore", {
                    defaultValue: "Total score",
                  })}
                </th>
                <th scope="col">
                  {t("admin.results.rollups.answered", {
                    defaultValue: "Answered",
                  })}
                </th>
                <th scope="col">
                  {t("admin.results.rollups.correct", {
                    defaultValue: "Correct",
                  })}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row" className="wrap-anywhere">
                    {onFilterTest && activeTestId !== row.id ? (
                      <button
                        type="button"
                        onClick={() => onFilterTest(row.id)}
                        aria-label={t("admin.results.filterQuiz", {
                          defaultValue: "Filter by quiz {{title}}",
                          title: row.label,
                        })}
                        className="text-teal min-h-8 text-left underline underline-offset-4"
                      >
                        {row.label}
                      </button>
                    ) : (
                      row.label
                    )}
                  </th>
                  <td>{numbers.format(row.attemptCount)}</td>
                  <td className="font-bold whitespace-nowrap">
                    {numbers.format(row.score)} / {numbers.format(row.maxScore)}
                  </td>
                  <td>{numbers.format(row.answeredCount)}</td>
                  <td>{numbers.format(row.correctCount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function RollupTables({
  data,
  testId,
  onFilterTest,
}: {
  readonly data: AdminResultRollups | null
  readonly testId?: string
  readonly onFilterTest: (testId: string) => void
}) {
  const { t } = useTranslation("runner")

  if (!data) {
    return (
      <p role="alert" className="device-card text-bad">
        {t("admin.results.rollups.error", {
          defaultValue: "Could not load result rollups. Please try again.",
        })}
      </p>
    )
  }

  const dimensions = [
    {
      title: t("admin.results.rollups.tests", { defaultValue: "By quiz" }),
      rows: data.tests,
    },
    {
      title: t("admin.results.rollups.versions", {
        defaultValue: "By version",
      }),
      rows: data.versions,
    },
    {
      title: t("admin.results.rollups.sections", {
        defaultValue: "By section",
      }),
      rows: data.sections,
    },
    {
      title: t("admin.results.rollups.questions", {
        defaultValue: "By question",
      }),
      rows: data.questions,
    },
  ]

  if (dimensions.every(({ rows }) => rows.length === 0)) {
    return (
      <p role="status" className="device-card text-ink-2">
        {testId
          ? t("admin.results.rollups.filteredEmpty", {
              defaultValue: "No rollups for this quiz.",
            })
          : t("admin.results.rollups.empty", {
              defaultValue: "No result rollups yet.",
            })}
      </p>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {dimensions.map(({ title, rows }) => (
        <RollupTable
          key={title}
          title={title}
          rows={rows}
          activeTestId={testId}
          onFilterTest={rows === data.tests ? onFilterTest : undefined}
        />
      ))}
    </div>
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

function CompletedAttempts({
  page,
  search,
}: {
  readonly page: AdminResultPage | null
  readonly search: ResultsSearch
}) {
  const { t } = useTranslation("runner")
  const { testId, learnerId, cursor } = search

  if (!page) {
    return (
      <p role="alert" className="device-card text-bad">
        {t("admin.results.error", {
          defaultValue: "Could not load results. Please try again.",
        })}
      </p>
    )
  }

  return (
    <>
      {page.items.length > 0 ? (
        <ResultsTable items={page.items} search={search} />
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
      {(cursor ?? page.nextCursor) && (
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
          {page.nextCursor && (
            <Link
              to="/admin/results"
              search={{ ...search, cursor: page.nextCursor }}
              className="device-button"
              data-variant="secondary"
            >
              {t("admin.results.nextPage", { defaultValue: "Next page" })}
            </Link>
          )}
        </nav>
      )}
    </>
  )
}

function ResultsRouteComponent() {
  const { t } = useTranslation("runner")
  const { testId, learnerId, cursor } = Route.useSearch()
  const data = Route.useLoaderData()
  const navigate = Route.useNavigate()
  const search = { testId, learnerId, cursor }

  if (data.view === "attempt") {
    return <AttemptDetail attempt={data.attempt} search={search} />
  }

  function filterQuiz(id: string) {
    void navigate({ search: { testId: id, learnerId } })
  }

  return (
    <section aria-labelledby="admin-results-title">
      <h2 id="admin-results-title" className="screen-title">
        {t("admin.results.title", { defaultValue: "Results" })}
      </h2>
      <p className="screen-subtitle">
        {t("admin.results.filterScope", {
          defaultValue:
            "Quiz ID filters rollups and attempts. Learner ID filters attempts only.",
        })}
      </p>
      <ResultsFilters key={`${testId ?? ""}:${learnerId ?? ""}`} {...search} />
      <section aria-labelledby="result-rollups-title" className="mt-6">
        <h3 id="result-rollups-title" className="screen-title">
          {t("admin.results.rollups.title", { defaultValue: "Result rollups" })}
        </h3>
        <p className="screen-subtitle mb-4">
          {t("admin.results.rollups.limit", {
            defaultValue:
              "Up to {{count}} rows per group, ranked by completed attempts.",
            count: rollupLimit,
          })}
        </p>
        <Await
          key={testId}
          promise={data.rollups}
          fallback={
            <p role="status" className="device-card text-ink-2">
              {t("admin.results.rollups.loading", {
                defaultValue: "Loading rollups…",
              })}
            </p>
          }
        >
          {(rollups) => (
            <RollupTables
              data={rollups}
              testId={testId}
              onFilterTest={filterQuiz}
            />
          )}
        </Await>
      </section>
      <section className="mt-6">
        <h3 className="screen-title">
          {t("admin.results.completedAttempts", {
            defaultValue: "Completed attempts",
          })}
        </h3>
        <Await promise={data.page} fallback={<ResultsPending />}>
          {(page) => <CompletedAttempts page={page} search={search} />}
        </Await>
      </section>
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
