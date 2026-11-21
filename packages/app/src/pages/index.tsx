import { Link, createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { ApiError } from "../lib/api-client.js"
import type { Student, TestCard, TestCatalogPage } from "../lib/api-types.js"
import { listTests } from "../lib/catalog-api.js"
import { getCurrentStudent } from "../lib/session-api.js"
import { signOut } from "../lib/auth.js"
import { SIGN_IN_PATH } from "../lib/authPaths.js"
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

const primaryActionClass = "device-button whitespace-nowrap"
const secondaryActionClass = "device-button whitespace-nowrap"

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
          data-variant="secondary"
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
      className={`device-card ${highlighted ? "border-teal" : "border-line"}`}
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
    <div className="device-page">
      <header className="app-bar">
        <span className="app-brand">{t("library.brand")}</span>
        <span className="grow" />
        {student ? (
          <>
            <span className="truncate text-[13.5px] font-bold">
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
      </header>

      <main className="device-main">
        <h1 className="screen-title">
          {student
            ? t("library.greeting.named", { name: student.displayName })
            : t("library.greeting.anonymous")}
        </h1>
        <p className="screen-subtitle">
          {t("library.waiting", { count: tests.length })}
        </p>

        {tests.length === 0 ? (
          <p
            role="status"
            className="device-card text-ink-2 mt-5 border-dashed py-8 text-center font-semibold"
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
            className="device-button mt-[11px] w-full"
            data-variant="secondary"
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

        <div className="mt-[17px] flex flex-wrap items-center gap-3">
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
          <Link
            to="/history"
            className={secondaryActionClass}
            data-variant="secondary"
          >
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

/**
 * The API answers `404 student_not_provisioned` (a valid token whose account
 * has no student profile) or `403` (the account lacks the role that allows a
 * profile to be created). Both mean "this account cannot use the app", which
 * retrying cannot fix: say so, and let the person switch account.
 */
function isNoAccess(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.problem.type === "student_not_provisioned" ||
      error.problem.status === 403)
  )
}

export function LibraryRouteError({ error }: LibraryRouteErrorProps) {
  const { t } = useTranslation("runner")
  const unauthorized = error instanceof ApiError && error.problem.status === 401
  const noAccess = !unauthorized && isNoAccess(error)
  let message = "library.error"

  if (unauthorized) {
    message = "library.unauthorized"
  } else if (noAccess) {
    message = "library.noAccess"
  }

  return (
    <div className="device-page">
      <main className="center-main">
        <div className="device-card max-w-xl">
          <p role="alert">{t(message)}</p>
          {noAccess ? (
            <p className="text-ink-2 mt-2 text-sm">
              {t("library.noAccess.detail")}
            </p>
          ) : null}
          {/* Every error state gets a way out. Plain links, not router calls:
              this component also renders where there is no router (tests, the
              route's own error boundary), and a full navigation is what a
              retry or a fresh sign-in wants anyway. */}
          <div className="mt-4 flex flex-wrap gap-2">
            {unauthorized || noAccess ? null : (
              <a href="/" className={primaryActionClass}>
                {t("library.errorRetry")}
              </a>
            )}
            <a
              href={SIGN_IN_PATH}
              className={secondaryActionClass}
              data-variant="secondary"
              onClick={() => {
                signOut()
              }}
            >
              {t("menu.signOut")}
            </a>
          </div>
        </div>
      </main>
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
