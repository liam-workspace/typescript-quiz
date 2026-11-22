import { createFileRoute } from "@tanstack/react-router"
import { useSyncExternalStore } from "react"
import { useTranslation } from "react-i18next"
import { TimeUpView } from "../components/TimeUpView.js"
import type { FinalizedAttempt } from "../lib/api-types.js"
import { getAttemptRuntime } from "../lib/attempt/runtime.js"
import { useSyncStatus } from "../lib/attempt/use-sync-status.js"
import { useWaitingRecheck } from "../lib/attempt/use-waiting-recheck.js"
import { loadWaitingSummary } from "../lib/attempt/waiting-summary.js"
import { getAttemptResult } from "../lib/attempts-api.js"
import { networkStore } from "../lib/network.js"
import { sameOriginPath } from "../lib/same-origin-path.js"
import { takeTimeUpAttempt } from "../lib/time-up-navigation.js"

export interface TimeUpData {
  readonly testTitle: string
  readonly answeredCount: number
  readonly unansweredCount: number
  readonly resultUrl: string
  /** No result yet: this phone holds work the server has not seen. */
  readonly waiting?: true
}

export async function loadTimeUp(
  attemptId: string,
  attempt?: FinalizedAttempt,
): Promise<TimeUpData> {
  try {
    const result = await getAttemptResult(attemptId)

    return {
      testTitle: result.test.title,
      answeredCount: result.score.answered,
      unansweredCount: result.score.unanswered,
      resultUrl:
        attempt?.id === result.attemptId
          ? attempt.resultUrl
          : `/attempts/${result.attemptId}/result`,
    }
  } catch (error) {
    // The clock may have run out while offline: the server has no result yet
    // because it has not seen the journal. Only say "waiting" when this
    // device really holds that unsent work; anything else is a real failure.
    const summary = await loadWaitingSummary(attemptId).catch(() => null)

    if (summary === null) {
      throw error
    }

    return {
      ...summary,
      resultUrl: attempt?.resultUrl ?? `/attempts/${attemptId}/result`,
      waiting: true,
    }
  }
}

const noop = (): void => undefined

export interface TimeUpScreenProps {
  readonly data: TimeUpData
  readonly onCheckAgain?: () => void
  /** The server refused this attempt's journal (it is kept on the phone). */
  readonly syncFailed?: boolean
  /** A re-check failed and nothing is left to send: say so, stay retryable. */
  readonly checkFailed?: boolean
}

export function TimeUpScreen({
  data,
  onCheckAgain,
  syncFailed = false,
  checkFailed = false,
}: TimeUpScreenProps) {
  const { t } = useTranslation("runner")
  const parsedResultUrl = sameOriginPath.safeParse(data.resultUrl)

  let message = t("timeUp.message")

  if (data.waiting) {
    // Waiting copy only while something is really waiting to be sent.
    message = t("offline.timeUp.waiting")

    if (syncFailed) {
      message = t("offline.timeUp.failed")
    } else if (checkFailed) {
      message = t("offline.timeUp.waitingReason")
    }
  }

  return (
    <TimeUpView
      title={data.testTitle}
      heading={t("timeUp.title")}
      message={message}
      messageRole={syncFailed ? "alert" : "status"}
      summary={{ answered: data.answeredCount, blank: data.unansweredCount }}
      waiting={
        data.waiting
          ? {
              seeResultLabel: t("timeUp.seeResult"),
              reason: t("offline.timeUp.waitingReason"),
              checkAgainLabel: t("offline.timeUp.checkAgain"),
              onCheckAgain: onCheckAgain ?? noop,
              failed: syncFailed,
              retryMessage: checkFailed
                ? t("sectionRules.error.generic")
                : null,
            }
          : undefined
      }
      action={
        parsedResultUrl.success
          ? {
              kind: "link",
              href: parsedResultUrl.data,
              label: t("timeUp.seeResult"),
            }
          : null
      }
    />
  )
}

export const Route = createFileRoute("/attempts/$attemptId/time-up")({
  loader: ({ params }) =>
    loadTimeUp(
      params.attemptId,
      takeTimeUpAttempt(window.sessionStorage, params.attemptId),
    ),
  component: RouteComponent,
})

const requestSync = (): Promise<void> =>
  getAttemptRuntime().then(({ sync }) => {
    sync.request()
  })

function RouteComponent() {
  const { attemptId } = Route.useParams()
  const loaded = Route.useLoaderData()
  const status = useSyncStatus()
  const online = useSyncExternalStore(
    (listener) => networkStore.subscribe(listener),
    () => networkStore.getSnapshot().online,
    () => true,
  )
  const { data, syncFailed, checkFailed, checkAgain } = useWaitingRecheck({
    attemptId,
    data: loaded,
    status,
    online,
    load: loadTimeUp,
    requestSync,
  })

  return (
    <TimeUpScreen
      data={data}
      syncFailed={syncFailed}
      checkFailed={checkFailed}
      onCheckAgain={checkAgain}
    />
  )
}
