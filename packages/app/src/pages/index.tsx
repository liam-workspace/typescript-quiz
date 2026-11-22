import { createFileRoute } from "@tanstack/react-router"
import { useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { InstallCard } from "../components/Banners.js"
import { Icon } from "../components/Icon.js"
import { InstallSheet } from "../components/InstallSheet.js"
import { LibraryFilter } from "../components/LibraryFilter.js"
import { LibrarySkeleton } from "../components/LibrarySkeleton.js"
import { LibraryTestCard } from "../components/LibraryTestCard.js"
import {
  SaveOfflineControl,
  type SaveOfflineState,
} from "../components/SaveOfflineControl.js"
import { ApiError } from "../lib/api-client.js"
import type { Student, TestCard, TestCatalogPage } from "../lib/api-types.js"
import { listTests } from "../lib/catalog-api.js"
import {
  blockingTest,
  matchesFilter,
  waitingCount,
  type LibraryFilterValue,
} from "../lib/library-state.js"
import { startGate } from "../lib/offline/start-gate.js"
import {
  useOfflineLibrary,
  type OfflineLibraryApi,
} from "../lib/offline/use-offline.js"
import { startInstall } from "../lib/pwa/install-flow.js"
import { pwaStore } from "../lib/pwa/pwa-store.js"
import { getCurrentStudent } from "../lib/session-api.js"
import { signOut } from "../lib/auth.js"
import { SIGN_IN_PATH } from "../lib/authPaths.js"
import { startTestAndRulesPath } from "../lib/start-test.js"
import { toastStore } from "../lib/toast.js"

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

export interface LibraryScreenProps {
  readonly initialPage: TestCatalogPage
  readonly student: Student | null
  readonly navigate?: (path: string) => void
  readonly renderCardExtras?: (test: TestCard) => ReactNode
  readonly startDisabledReason?: (test: TestCard) => string | null
}

const assign = (path: string): void => {
  window.location.assign(path)
}

export function LibraryScreen({
  initialPage,
  student,
  navigate = assign,
  renderCardExtras,
  startDisabledReason,
}: LibraryScreenProps) {
  const { i18n, t } = useTranslation("runner")
  const [tests, setTests] = useState(initialPage.tests)
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor)
  const [loading, setLoading] = useState(false)
  const [loadMoreFailed, setLoadMoreFailed] = useState(false)
  const [filter, setFilter] = useState<LibraryFilterValue>("all")
  const [startingId, setStartingId] = useState<string | null>(null)
  const [startFailed, setStartFailed] = useState(false)
  const [installKind, setInstallKind] = useState<"ios" | "manual" | null>(null)
  const installRef = useRef<HTMLButtonElement>(null)
  const pwa = useSyncExternalStore(
    (listener) => pwaStore.subscribe(listener),
    () => pwaStore.getSnapshot(),
  )
  const numberFormatter = new Intl.NumberFormat(i18n.language, {
    maximumFractionDigits: 2,
  })
  const blocker = blockingTest(tests)
  const waiting = waitingCount(tests)
  const visible = tests.filter((test) => matchesFilter(test, filter))

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

  function handleStart(test: TestCard): void {
    if (startingId !== null) {
      return
    }

    setStartingId(test.id)
    setStartFailed(false)

    startTestAndRulesPath(test.slug, {
      inProgressAttemptId: test.inProgressAttemptId,
    })
      .then(navigate)
      .catch(() => {
        setStartingId(null)
        setStartFailed(true)
      })
  }

  async function handleInstall(): Promise<void> {
    const step = await startInstall()

    if (step === "accepted") {
      toastStore.show(t("toast.installed"), "check")
    } else if (step === "show-ios" || step === "show-manual") {
      setInstallKind(step === "show-ios" ? "ios" : "manual")
    }
  }

  function reasonFor(test: TestCard): string | null {
    if (test.inProgressAttemptId === null && blocker) {
      return t("library.blockedByActive", { title: blocker.title })
    }

    return startDisabledReason?.(test) ?? null
  }

  const showInstall = !pwa.standalone && !pwa.installDismissed

  return (
    <div className="m-page">
      <header className="m-appbar">
        <span className="m-brand">{t("library.brand")}</span>
        <span className="grow" />
        {student ? (
          <span aria-hidden="true" className="m-avatar">
            {student.displayName[0]}
          </span>
        ) : null}
      </header>

      <main className="m-body">
        <h1 className="m-title" tabIndex={-1} data-page-title>
          {student
            ? t("library.greeting.named", { name: student.displayName })
            : t("library.greeting.anonymous")}
        </h1>
        <p className="m-sub">
          {waiting === 0
            ? t("library.caughtUp")
            : t("library.waiting", { count: waiting })}
        </p>

        {showInstall ? (
          <InstallCard
            installRef={installRef}
            onInstall={() => {
              void handleInstall()
            }}
            onDismiss={() => {
              pwaStore.dismissInstall()
            }}
          />
        ) : null}

        <LibraryFilter value={filter} onChange={setFilter} />

        {visible.length === 0 ? (
          <p
            role="status"
            className="m-card text-ink-2 border-dashed py-8 text-center font-bold"
          >
            {tests.length === 0 ? t("library.empty") : t("library.filterEmpty")}
          </p>
        ) : (
          <div className="m-stack">
            {visible.map((test) => (
              <LibraryTestCard
                key={test.id}
                test={test}
                highlighted={
                  test.inProgressAttemptId !== null || test.attemptCount === 0
                }
                starting={startingId === test.id}
                disabledReason={reasonFor(test)}
                onStart={handleStart}
                extras={renderCardExtras?.(test)}
              />
            ))}
          </div>
        )}

        {nextCursor !== null ? (
          <button
            type="button"
            className="m-btn mt-3"
            data-variant="secondary"
            data-block="true"
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
        {startFailed ? (
          <p role="alert" className="text-bad mt-3 text-sm font-semibold">
            {t("brief.startError")}
          </p>
        ) : null}

        <dl className="m-stats">
          <div>
            <dt>{t("library.summary.attempts")}</dt>
            <dd>{initialPage.summary.attemptCount}</dd>
          </div>
          <div>
            <dt>{t("library.summary.average")}</dt>
            <dd>
              {t("library.percentage", {
                percentage: numberFormatter.format(
                  initialPage.summary.averagePct,
                ),
              })}
            </dd>
          </div>
          <div>
            <dt>{t("library.summary.best")}</dt>
            <dd>
              {t("library.percentage", {
                percentage: numberFormatter.format(initialPage.summary.bestPct),
              })}
            </dd>
          </div>
        </dl>
      </main>

      <InstallSheet
        open={installKind !== null}
        onOpenChange={(open) => {
          if (!open) {
            setInstallKind(null)
          }
        }}
        kind={installKind ?? "manual"}
        returnFocusRef={installRef}
        onConfirm={() => {
          pwaStore.markInstalled()
          setInstallKind(null)
          toastStore.show(t("toast.installed"), "check")
        }}
      />
    </div>
  )
}

/** Route pending view: the page chrome with the prototype's skeleton cards. */
export function LibraryPending() {
  const { t } = useTranslation("runner")

  return (
    <div className="m-page">
      <header className="m-appbar">
        <span className="m-brand">{t("library.brand")}</span>
      </header>
      <main className="m-body">
        <LibrarySkeleton />
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
    <div className="m-page">
      <main className="m-hero">
        <div className="m-logo" data-tone="clay" aria-hidden="true">
          <Icon name="lock" />
        </div>
        <div role="alert">
          <h1
            className="m-title"
            tabIndex={-1}
            data-page-title
            data-size={noAccess ? "long" : undefined}
          >
            {t(message)}
          </h1>
        </div>
        {noAccess ? (
          <p className="m-sub">{t("library.noAccess.detail")}</p>
        ) : null}
        {/* Every error state gets a way out. Plain links, not router calls:
            this component also renders where there is no router (tests, the
            route's own error boundary), and a full navigation is what a
            retry or a fresh sign-in wants anyway. */}
        {unauthorized || noAccess ? null : (
          <a href="/" className="m-btn" data-block="true">
            {t("library.errorRetry")}
          </a>
        )}
        <a
          href={SIGN_IN_PATH}
          className="m-btn"
          data-variant={unauthorized || noAccess ? undefined : "secondary"}
          data-block="true"
          onClick={() => {
            signOut()
          }}
        >
          <Icon name="logout" /> {t("menu.signOut")}
        </a>
      </main>
    </div>
  )
}

export const Route = createFileRoute("/")({
  loader: loadLibrary,
  pendingComponent: LibraryPending,
  pendingMs: 150,
  errorComponent: LibraryRouteError,
  component: RouteComponent,
})

const BYTES_PER_MB = 1_048_576

/** Whole MB for the label, at least 1; a missing or non-finite size reads as 1. */
function sizeInMb(bytes: number): number {
  return Number.isFinite(bytes)
    ? Math.max(1, Math.round(bytes / BYTES_PER_MB))
    : 1
}

/** Download state: none, saving (in progress here), or ready (stale if the test changed since). */
export function offlineStateFor(
  test: TestCard,
  offline: OfflineLibraryApi,
): SaveOfflineState {
  const percent = offline.progressPercent.get(test.slug)

  if (percent !== undefined) {
    return { kind: "saving", percent }
  }

  const record = offline.saved.get(test.slug)

  return record
    ? { kind: "ready", stale: record.testVersionId !== test.testVersionId }
    : { kind: "none" }
}

export type LibraryWithOfflineProps = Omit<
  LibraryScreenProps,
  "renderCardExtras" | "startDisabledReason"
> & { readonly offline: OfflineLibraryApi }

/**
 * The library with the save-offline row and the offline Start gate plugged in
 * through LibraryScreen's extension props. "Finish X first" is decided inside
 * LibraryScreen and wins over the connection reason there, so the gate is
 * asked only about the connection (`activeOtherTitle: null`).
 */
export function LibraryWithOffline({
  offline,
  ...screenProps
}: LibraryWithOfflineProps) {
  const { t } = useTranslation("runner")

  return (
    <LibraryScreen
      {...screenProps}
      startDisabledReason={(test) => {
        const gate = startGate({
          online: offline.online,
          saved: offline.saved.has(test.slug),
          // Task 21 supplies the real local-state lookup.
          continuableLocally: false,
          isContinue: test.inProgressAttemptId !== null,
          activeOtherTitle: null,
        })

        return gate.enabled ? null : t("offline.needsConnection")
      }}
      renderCardExtras={(test) =>
        test.inProgressAttemptId === null ? (
          <SaveOfflineControl
            title={test.title}
            sizeMb={sizeInMb(test.mediaBytes)}
            online={offline.online}
            state={offlineStateFor(test, offline)}
            onSave={() => {
              offline.save(test.slug, test.title)
            }}
          />
        ) : null
      }
    />
  )
}

function RouteComponent() {
  const data = Route.useLoaderData()
  const offline = useOfflineLibrary()

  return (
    <LibraryWithOffline
      initialPage={data.initialPage}
      student={data.student}
      offline={offline}
    />
  )
}
