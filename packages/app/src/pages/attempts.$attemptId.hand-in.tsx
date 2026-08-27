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
import { buildSubmitRemainder } from "../lib/lifecycleFlush.js"
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

/**
 * Openapi.yaml: "`finalFlush`... Always present, so the client can clear
 * its queue from this response alone." Mirrors FlushController's own
 * per-item reconcile (Task 9) -- applied/ignored_stale are both settled
 * successes and get acked, rejected becomes a terminal rejection -- kept
 * as a small local function here rather than reaching into
 * FlushController's private method, since that class's public contract is
 * fixed to `flushSection` and this is a different endpoint's response
 * shape.
 */
// oxlint-disable-next-line max-params
async function reconcileFinalFlush(
  queue: AnswerQueue,
  attemptId: string,
  sentResponses: ReadonlyArray<{
    readonly questionId: string
    readonly seq: number
  }>,
  finalFlush: ReadonlyArray<{
    readonly questionId: string
    readonly status: string
  }>,
): Promise<void> {
  const seqByQuestion = new Map(
    sentResponses.map((item) => [item.questionId, item.seq]),
  )

  for (const result of finalFlush) {
    const seq = seqByQuestion.get(result.questionId)

    if (seq === undefined) {
      continue
    }

    if (result.status === "applied" || result.status === "ignored_stale") {
      // eslint-disable-next-line no-await-in-loop
      await queue.ackItem(attemptId, result.questionId, seq)
    } else {
      // eslint-disable-next-line no-await-in-loop
      await queue.markTerminalRejection(attemptId, result.questionId)
    }
  }
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
  // Null = still checking; the button stays disabled until this resolves,
  // so it never flashes enabled before the queue has actually been read.
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
  const disabled =
    pendingCount === null || pendingCount > 0 || outcome.status === "submitting"

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
      <Button onClick={handleKeepWorking}>{t("handIn.keepWorking")}</Button>
      <Button
        data-testid="hand-in-button"
        onClick={handleSubmit}
        disabled={disabled}
      >
        {t("runner.handIn")}
      </Button>
    </div>
  )
}

export const Route = createFileRoute("/attempts/$attemptId/hand-in")({
  loader: async ({ params }) => {
    const [envelope, queue] = await Promise.all([
      getRunnerEnvelope(params.attemptId),
      AnswerQueue.open(),
    ])

    return { envelope, queue }
  },
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
