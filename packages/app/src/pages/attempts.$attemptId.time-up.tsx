import { createFileRoute } from "@tanstack/react-router"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { TimeUpView } from "../components/TimeUpView.js"
import type { FinalizedAttempt } from "../lib/api-types.js"
import { getAttemptRuntime } from "../lib/attempt/runtime.js"
import { useSyncStatus } from "../lib/attempt/use-sync-status.js"
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
}

export function TimeUpScreen({
  data,
  onCheckAgain,
  syncFailed = false,
}: TimeUpScreenProps) {
  const { t } = useTranslation("runner")
  const parsedResultUrl = sameOriginPath.safeParse(data.resultUrl)

  return (
    <TimeUpView
      title={data.testTitle}
      heading={t("timeUp.title")}
      message={data.waiting ? t("offline.timeUp.waiting") : t("timeUp.message")}
      summary={{ answered: data.answeredCount, blank: data.unansweredCount }}
      waiting={
        data.waiting
          ? {
              seeResultLabel: t("timeUp.seeResult"),
              reason: t("offline.timeUp.waitingReason"),
              checkAgainLabel: t("offline.timeUp.checkAgain"),
              onCheckAgain: onCheckAgain ?? noop,
              failedMessage: syncFailed ? t("offline.timeUp.failed") : null,
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

function RouteComponent() {
  const { attemptId } = Route.useParams()
  const loaded = Route.useLoaderData()
  const status = useSyncStatus()
  const [fresh, setFresh] = useState<{
    readonly attemptId: string
    readonly data: TimeUpData
  } | null>(null)
  const checking = useRef(false)
  const data = fresh?.attemptId === attemptId ? fresh.data : loaded
  const syncFailed = status.failedAttemptIds.includes(attemptId)

  // Re-asks the server (no reload). The screen swaps to the normal result
  // link the moment the result exists; if this phone still holds unsent work
  // it stays on the waiting variant.
  const check = useCallback(
    async (requestSync: boolean): Promise<void> => {
      if (checking.current) {
        return
      }

      checking.current = true

      try {
        if (requestSync) {
          await getAttemptRuntime()
            .then(({ sync }) => {
              sync.request()
            })
            .catch(() => undefined)
        }

        setFresh({ attemptId, data: await loadTimeUp(attemptId) })
      } catch {
        // Still no answer from the server: stay as we are.
      } finally {
        checking.current = false
      }
    },
    [attemptId],
  )

  // Every sync-status change (sync finished, journal refused, back online)
  // is a reason to look again while waiting.
  useEffect(() => {
    if (
      data.waiting &&
      !status.syncing &&
      !syncFailed &&
      networkStore.getSnapshot().online
    ) {
      void Promise.resolve().then(() => check(false))
    }
  }, [check, data.waiting, status, syncFailed])

  return (
    <TimeUpScreen
      data={data}
      syncFailed={syncFailed}
      onCheckAgain={() => {
        void check(true)
      }}
    />
  )
}
