import { Card, CardContent } from "@liam-public/browser-react-ui"
import { Link, createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { ApiError } from "../lib/api-client.js"
import type { Student, TestCard, TestCatalogPage } from "../lib/api-types.js"
import { listTests } from "../lib/catalog-api.js"
import { getCurrentStudent } from "../lib/session-api.js"
import { testCardActions, type TestCardAction } from "../lib/testCardState.js"

export interface LibraryData {
  initialPage: TestCatalogPage
  student: Student | null
}

export async function loadLibrary(): Promise<LibraryData> {
  const [initialPage, student] = await Promise.all([
    listTests(),
    getCurrentStudent().catch(() => null),
  ])

  return { initialPage, student }
}

const primaryActionClass =
  "inline-flex size-11 w-auto touch-manipulation items-center justify-center rounded-[9px] border border-teal bg-teal px-5 text-sm font-bold whitespace-nowrap text-paper select-none hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
const secondaryActionClass =
  "inline-flex size-11 w-auto touch-manipulation items-center justify-center rounded-[9px] border border-line bg-paper px-4 text-sm font-bold whitespace-nowrap text-ink select-none hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"

function CardActionLink({
  action,
  test,
}: {
  readonly action: TestCardAction
  readonly test: TestCard
}) {
  const { t } = useTranslation("runner")

  switch (action.kind) {
    case "continue":
      return (
        <Link
          to="/attempts/$attemptId/run"
          params={{ attemptId: action.attemptId }}
          className={primaryActionClass}
        >
          {t("library.action.continue")}
        </Link>
      )

    case "start":
      return (
        <a href={`/tests/${test.slug}`} className={primaryActionClass}>
          {t("library.action.start")}
        </a>
      )

    case "tryAgain":
      return (
        <a href={`/tests/${test.slug}`} className={primaryActionClass}>
          {t("library.action.tryAgain")}
        </a>
      )

    case "seeResult":
      return (
        <Link
          to="/attempts/$attemptId/result"
          params={{ attemptId: action.attemptId }}
          className={secondaryActionClass}
        >
          {t("library.action.seeResult")}
        </Link>
      )
  }
}

function TestLibraryCard({ test }: { readonly test: TestCard }) {
  const { t } = useTranslation("runner")
  const actions = testCardActions(test)
  const highlighted =
    test.inProgressAttemptId !== null || test.attemptCount === 0
  const titleId = `test-card-${test.id}`

  return (
    <article
      aria-labelledby={titleId}
      className={`bg-paper rounded-[11px] border px-[19px] py-[17px] ${
        highlighted ? "border-teal" : "border-line"
      }`}
    >
      <div className="flex flex-wrap items-start gap-3.5">
        <div className="min-w-0 flex-[1_1_15rem]">
          <h2 id={titleId} className="text-ink text-[15.5px] font-extrabold">
            {test.title}
          </h2>
          <div className="text-ink-2 mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px]">
            <span>
              {t(
                test.level === "primary-step-1"
                  ? "library.step.1"
                  : "library.step.2",
              )}
            </span>
            {test.sections.map((section) => (
              <span
                key={section.type}
                className="before:mr-1.5 before:content-['·']"
              >
                {t("library.sectionCount", {
                  section: t(`library.section.${section.type}`),
                  count: section.questionCount,
                })}
              </span>
            ))}
            <span className="before:mr-1.5 before:content-['·']">
              {t("library.durationMinutes", {
                count: Math.round(test.durationSeconds / 60),
              })}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {actions.map((action) => (
            <CardActionLink key={action.kind} action={action} test={test} />
          ))}
        </div>
      </div>
    </article>
  )
}

export interface LibraryScreenProps {
  readonly initialPage: TestCatalogPage
  readonly student: Student | null
}

export function LibraryScreen({ initialPage, student }: LibraryScreenProps) {
  const { i18n, t } = useTranslation("runner")
  const [tests, setTests] = useState(initialPage.tests)
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor)
  const [loading, setLoading] = useState(false)
  const [loadMoreFailed, setLoadMoreFailed] = useState(false)
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
      const page = await listTests(nextCursor)
      setTests((current) => [...current, ...page.tests])
      setNextCursor(page.nextCursor)
    } catch {
      setLoadMoreFailed(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-surface text-ink min-h-screen">
      <header className="border-line bg-paper border-b">
        <div className="mx-auto flex min-h-14 max-w-4xl items-center gap-3 px-4 sm:px-6">
          <span className="text-ink font-extrabold tracking-tight">
            {t("library.brand")}
          </span>
          <span className="grow" />
          {student ? (
            <>
              <span className="text-ink truncate text-sm font-bold">
                {student.displayName}
              </span>
              <span
                aria-hidden="true"
                className="bg-teal text-paper grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold"
              >
                {student.displayName[0]}
              </span>
            </>
          ) : null}
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-7 sm:px-6 sm:py-9">
        <h1 className="text-ink text-[21px] font-extrabold tracking-[-0.015em]">
          {student
            ? t("library.greeting.named", { name: student.displayName })
            : t("library.greeting.anonymous")}
        </h1>
        <p className="text-ink-2 mt-1 text-sm">
          {t("library.waiting", { count: tests.length })}
        </p>

        {tests.length === 0 ? (
          <p
            role="status"
            className="border-line bg-paper text-ink-2 mt-5 rounded-[11px] border border-dashed px-5 py-8 text-center font-semibold"
          >
            {t("library.empty")}
          </p>
        ) : (
          <div className="mt-5 space-y-[11px]">
            {tests.map((test) => (
              <TestLibraryCard key={test.id} test={test} />
            ))}
          </div>
        )}

        {nextCursor !== null ? (
          <button
            type="button"
            className="border-line bg-paper text-ink hover:bg-surface focus-visible:outline-teal disabled:text-faint mt-[11px] size-11 w-full touch-manipulation rounded-[9px] border px-4 text-sm font-bold select-none focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-wait"
            disabled={loading}
            aria-busy={loading}
            onClick={loadMore}
          >
            {t("library.showMore")}
          </button>
        ) : null}
        {loadMoreFailed ? (
          <p role="alert" className="text-bad mt-3 text-sm font-semibold">
            {t("library.loadMoreError")}
          </p>
        ) : null}

        <div className="border-line mt-5 flex flex-wrap items-center gap-3 border-t pt-5">
          <dl className="flex flex-1 flex-wrap gap-6">
            <div>
              <dt className="text-faint text-[11px] font-bold tracking-[0.07em] uppercase">
                {t("library.summary.attempts")}
              </dt>
              <dd className="text-ink font-bold tabular-nums">
                {initialPage.summary.attemptCount}
              </dd>
            </div>
            <div>
              <dt className="text-faint text-[11px] font-bold tracking-[0.07em] uppercase">
                {t("library.summary.average")}
              </dt>
              <dd className="text-ink font-bold tabular-nums">
                {t("library.percentage", {
                  percentage: numberFormatter.format(
                    initialPage.summary.averagePct,
                  ),
                })}
              </dd>
            </div>
            <div>
              <dt className="text-faint text-[11px] font-bold tracking-[0.07em] uppercase">
                {t("library.summary.best")}
              </dt>
              <dd className="text-ink font-bold tabular-nums">
                {t("library.percentage", {
                  percentage: numberFormatter.format(
                    initialPage.summary.bestPct,
                  ),
                })}
              </dd>
            </div>
          </dl>
          <Link to="/history" className={secondaryActionClass}>
            {t("library.allAttempts")}
          </Link>
        </div>
      </main>
    </div>
  )
}

export interface LibraryRouteErrorProps {
  readonly error: unknown
}

export function LibraryRouteError({ error }: LibraryRouteErrorProps) {
  const { t } = useTranslation("runner")
  const unauthorized = error instanceof ApiError && error.problem.status === 401

  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <Card className="border-line bg-paper">
        <CardContent>
          <p role="alert">
            {t(unauthorized ? "library.unauthorized" : "library.error")}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute("/")({
  loader: loadLibrary,
  errorComponent: LibraryRouteError,
  component: RouteComponent,
})

function RouteComponent() {
  const data = Route.useLoaderData()

  return <LibraryScreen initialPage={data.initialPage} student={data.student} />
}
