import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@liam-public/browser-react-ui"
import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { ApiError } from "../lib/api-client.js"
import { AnswerQueue } from "../lib/answerQueue.js"
import { getRunnerEnvelope, submitAttempt } from "../lib/attempts-api.js"
import { redirectExpiredAttemptToResult } from "../lib/expired-attempt-redirect.js"
import {
  buildSubmitRemainder,
  reconcileFinalFlush,
} from "../lib/lifecycleFlush.js"
import { sameOriginPath } from "../lib/same-origin-path.js"
import type { RunnerEnvelope } from "../lib/api-types.js"

// The hand-in screen ("Confirm" -- `#s-confirm` in the prototype, the panel
// immediately before `#s-result`; the brief's `#s-hand-in` id does not
// exist in docs/prototype/index.html). Answered/Not-answered counts and the
// blank-question notice come straight from the RunnerEnvelope the previous
// screen already loaded (`answeredCount`, `unansweredOrdinals`) -- this
// screen's own loader re-fetches that same envelope (there is no other way
// for a screen reached by a full navigation to have it), but never
// recomputes those two numbers from `responses` itself.
//
// The client-side guard (spec S5: "the client refuses to submit while its
// queue is non-empty") is a courtesy on top of the server's own
// belt-and-braces remainder handling (Task 6) -- not a substitute for it.
// Because of that, `buildSubmitRemainder` is called fresh, live, at the
// moment Hand in is actually pressed, not from whatever the guard's earlier
// mount-time check saw: an answer landing in the queue between that check
// and the click is exactly the race spec S5 rule 6 exists to close.

type Outcome =
  | { readonly status: "idle" }
  | { readonly status: "submitting" }
  | { readonly status: "nothingAnswered" }
  | { readonly status: "attemptExpired"; readonly resultUrl: string | null }
  | { readonly status: "error" }

export interface HandInScreenProps {
  readonly attemptId: string
  readonly envelope: RunnerEnvelope
  readonly queue: AnswerQueue
  readonly navigate: (path: string) => void
}

// A one-time snapshot at load time, not a live countdown -- this screen
// does not re-fetch or tick, matching "this task does not fetch them again"
// for the rest of the envelope's fields.
function computeMinutesLeft(envelope: RunnerEnvelope): number | null {
  if (!envelope.expiresAt) {
    return null
  }

  const remainingMs =
    new Date(envelope.expiresAt).getTime() -
    new Date(envelope.serverTime).getTime()

  return Math.max(0, Math.round(remainingMs / 60_000))
}

export function HandInScreen({
  attemptId,
  envelope,
  queue,
  navigate,
}: HandInScreenProps) {
  const { t } = useTranslation("runner")
  // Defect B4: `pendingCount` used to also gate the Hand-in BUTTON --
  // disabled whenever it was non-zero, and never rechecked after the
  // mount-time snapshot that set it. `buildSubmitRemainder` (called fresh,
  // live, in `handleSubmit` below) already reads the queue at the moment
  // Hand in is actually pressed, and `POST /submit`'s `finalFlush` already
  // applies that remainder atomically, server-side -- exactly the path
  // spec S5 built so the client never has to guarantee an empty queue
  // before submitting. Gating the button on the same condition the server
  // already handles left a child stuck on "Waiting…" forever the moment a
  // flush never landed (offline, a slow network, a server hiccup), unable
  // to reach the one path that WOULD have gotten their answers in. Now
  // `pendingCount` is purely informational (the "Waiting for your last
  // answers to save" notice below); it never disables anything.
  const [pendingCount, setPendingCount] = useState<number | null>(null)
  const [outcome, setOutcome] = useState<Outcome>({ status: "idle" })

  useEffect(() => {
    let cancelled = false

    queue.snapshotForAttempt(attemptId).then((items) => {
      if (!cancelled) {
        setPendingCount(items.length)
      }
    })

    return () => {
      cancelled = true
    }
  }, [queue, attemptId])

  const handleKeepWorking = (): void => {
    navigate(`/attempts/${attemptId}/run`)
  }

  const handleSubmit = (): void => {
    if (outcome.status === "submitting") {
      return
    }

    setOutcome({ status: "submitting" })

    buildSubmitRemainder(queue, attemptId)
      .then((body) =>
        submitAttempt(attemptId, body).then(async (result) => {
          await reconcileFinalFlush(
            queue,
            attemptId,
            body.responses,
            result.finalFlush,
          )

          return result
        }),
      )
      .then((result) => {
        // A 200 (already submitted) and a 201 (graded and finalized) are
        // both successes here -- apiFetch only throws for a non-2xx
        // response, so reaching this branch at all already means the
        // attempt is finalized, regardless of which status the server used.
        const resultUrl = sameOriginPath.safeParse(result.resultUrl)

        navigate(
          resultUrl.success ? resultUrl.data : `/attempts/${attemptId}/run`,
        )
      })
      .catch((error: unknown) => {
        if (!(error instanceof ApiError)) {
          throw error
        }

        if (error.problem.type === "attempt_expired" && error.problem.attempt) {
          const resultUrl = sameOriginPath.safeParse(
            error.problem.attempt.resultUrl,
          )

          setOutcome({
            status: "attemptExpired",
            resultUrl: resultUrl.success ? resultUrl.data : null,
          })

          return
        }

        if (error.problem.type === "nothing_answered") {
          setOutcome({ status: "nothingAnswered" })

          return
        }

        setOutcome({ status: "error" })
      })
  }

  // 410 attempt_expired: finalized BY THIS REQUEST -- the time-up screen,
  // not an error toast (openapi.yaml `AttemptExpired`). Reuses the exact
  // wording SectionRulesScreen and the runner components already use for
  // the same condition, rather than inventing a hand-in-specific string.
  if (outcome.status === "attemptExpired") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("sectionRules.expired.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p>{t("sectionRules.expired.attemptMessage")}</p>
          {outcome.resultUrl ? (
            <a href={outcome.resultUrl}>
              {t("sectionRules.expired.viewResult")}
            </a>
          ) : null}
        </CardContent>
      </Card>
    )
  }

  const unansweredCount = envelope.unansweredOrdinals.length
  const minutesLeft = computeMinutesLeft(envelope)
  // Not gated on `pendingCount` -- see its declaration above. Submitting
  // twice concurrently is the only thing this still has to prevent.
  const disabled = outcome.status === "submitting"

  return (
    <div>
      <Card>
        <CardHeader>
          <CardTitle>{t("handIn.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p>{t("handIn.subtitle")}</p>
          <div>
            <span>{t("handIn.answered")}</span> <b>{envelope.answeredCount}</b>
          </div>
          <div>
            <span>{t("handIn.notAnswered")}</span> <b>{unansweredCount}</b>
          </div>
          {unansweredCount > 0 ? (
            <p>
              {t("handIn.notice.blankQuestions", {
                count: unansweredCount,
                list: envelope.unansweredOrdinals.join(", "),
              })}
              {minutesLeft !== null
                ? ` ${t("handIn.notice.timeLeft", {
                    count: minutesLeft,
                    minutes: minutesLeft,
                  })}`
                : null}
            </p>
          ) : null}
          {pendingCount !== null && pendingCount > 0 ? (
            <p role="status">{t("handIn.pendingSync")}</p>
          ) : null}
          {outcome.status === "nothingAnswered" ? (
            <div>
              <p role="alert">{t("handIn.error.nothingAnswered.title")}</p>
              <p>{t("handIn.error.nothingAnswered.message")}</p>
            </div>
          ) : null}
          {outcome.status === "error" ? (
            <p role="alert">{t("sectionRules.error.generic")}</p>
          ) : null}
        </CardContent>
      </Card>
      <Button
        className="h-11 min-w-11 touch-manipulation select-none"
        onClick={handleKeepWorking}
      >
        {t("handIn.keepWorking")}
      </Button>
      <Button
        className="h-11 min-w-11 touch-manipulation select-none"
        data-testid="hand-in-button"
        onClick={handleSubmit}
        disabled={disabled}
      >
        {t("runner.handIn")}
      </Button>
    </div>
  )
}

/**
 * This screen is the other one (with run.tsx) live during a timed test, so
 * it gets the same error boundary for the same reason -- see run.tsx's
 * `RunRouteError` doc comment. Reusing its `runError.*` strings rather than
 * minting hand-in-specific ones: the failure (this screen's own envelope
 * load) and the honest response to it (nothing is lost, reload costs
 * nothing) are identical.
 */
export interface HandInRouteErrorProps {
  readonly error: unknown
}

export function HandInRouteError(_props: HandInRouteErrorProps) {
  const { t } = useTranslation("runner")

  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>{t("runError.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p role="alert">{t("runError.message")}</p>
          <Button
            className="h-11 min-w-11 touch-manipulation select-none"
            onClick={() => {
              window.location.reload()
            }}
          >
            {t("runError.retry")}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * Exported, like run.tsx's `loadRunRouteData`, so the 410 redirect below is
 * testable directly rather than only reachable through the router.
 */
export async function loadHandInRouteData(attemptId: string): Promise<{
  envelope: RunnerEnvelope
  queue: AnswerQueue
}> {
  try {
    const [envelope, queue] = await Promise.all([
      getRunnerEnvelope(attemptId),
      AnswerQueue.open(),
    ])

    return { envelope, queue }
  } catch (error) {
    // Same reasoning as run.tsx's loader: a 410 attempt_expired here
    // means THIS load finalized the attempt, so the honest destination is
    // the result screen it names, not an error page.
    redirectExpiredAttemptToResult(error)

    throw error
  }
}

export const Route = createFileRoute("/attempts/$attemptId/hand-in")({
  loader: ({ params }) => loadHandInRouteData(params.attemptId),
  errorComponent: HandInRouteError,
  component: RouteComponent,
})

function RouteComponent() {
  const { attemptId } = Route.useParams()
  const { envelope, queue } = Route.useLoaderData()

  // Same stand-in as run.tsx and sections.$sectionId.rules.tsx: no typed
  // route exists yet for either destination (back to the runner, or on to
  // the result screen) without inventing their contracts early.
  const navigate = (path: string): void => {
    window.location.assign(path)
  }

  return (
    <HandInScreen
      attemptId={attemptId}
      envelope={envelope}
      queue={queue}
      navigate={navigate}
    />
  )
}
