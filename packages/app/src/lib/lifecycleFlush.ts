import { currentAccessToken } from "./auth.js"
import { getDevBearerToken } from "./dev-auth.js"
import type { AnswerQueue } from "./answerQueue.js"

/**
 * Spec §5 rule 6 (`docs/api/openapi.yaml`, "Flush at end of life and before
 * submit"):
 *
 * > pagehide sends a keepalive snapshot, and POST /submit carries the
 * > queue's remainder in its own body -- closing the race where the
 * > debounced flush is still in flight when Hand in is tapped.
 *
 * pagehide, not beforeunload: pagehide fires reliably on iOS Safari's
 * tab-close and app-switch paths -- the target device for this app is an
 * iPad, and beforeunload does not fire there. keepalive:true is what lets
 * the request outlive the page; a normal fetch is cancelled the instant the
 * page unloads.
 *
 * A retry loop cannot run during page teardown -- there is no time left for
 * a backoff, and nothing left to await a response on -- so this is
 * deliberately a one-shot, fire-and-forget send, never routed through
 * FlushController. Because no response is awaited (and for a real
 * pagehide, none may ever arrive: the page is gone), no ack can ever
 * reconcile the queue for this send. AnswerQueue.ackItem only clears an
 * item on a per-item ack (spec §5 rule 1) -- with no ack possible here, the
 * safe behaviour is to send and clear nothing, and let the next session's
 * flush or submit re-send the same answers. Losing a duplicate send is
 * free (the server's clientInstanceId/seq guard makes a replay a no-op);
 * losing an answer is not.
 */
// This is the public contract fixed by the plan (queue, getOpenSection,
// urlFor, fetchImpl?) -- fetchImpl exists solely so tests can inject a
// spy in place of the real global fetch, the same shape flushController
// (Task 9) takes for its own injected collaborators.
// oxlint-disable-next-line max-params
export function registerPagehideFlush(
  queue: AnswerQueue,
  getOpenSection: () => { attemptId: string; sectionId: string } | null,
  urlFor: (attemptId: string) => string,
  fetchImpl: typeof fetch = fetch,
): () => void {
  const handler = (): void => {
    const open = getOpenSection()

    if (!open) {
      return
    }

    // Fire-and-forget by design: nothing here is awaited by the caller,
    // because the pagehide event handler itself cannot be made async in any
    // way the browser will wait on. The queue is intentionally left
    // untouched -- see the class doc above -- so this promise chain exists
    // only to let the snapshot read complete before the fetch is issued.
    void queue
      .snapshotForSection(open.attemptId, open.sectionId)
      .then((items) => {
        if (items.length === 0) {
          return
        }

        const body = {
          clientInstanceId: queue.clientInstanceId(),
          responses: items.map((item) => ({
            questionId: item.questionId,
            seq: item.seq,
            selectedChoiceIds: item.selectedChoiceIds,
            answeredAt: item.answeredAt,
            timeSpentMs: item.timeSpentMs ?? undefined,
          })),
        }

        // Same base and credentials every other write in this app uses
        // (`apiFetch`, `lib/api-client.ts`): production APIs live under
        // `/api` (`packages/server/src/main.ts`), and every route requires
        // a bearer token. A prior version of this handler sent neither --
        // the request landed on an unprefixed, unauthenticated path and
        // failed twice over, silently, because nothing here awaits or
        // inspects the response (see the class doc above). `urlFor` keeps
        // returning the same un-prefixed path shape every other caller of
        // `apiFetch` uses (e.g. `/attempts/${id}/responses`); the `/api`
        // prefix is added here, not by the caller, exactly like `apiFetch`
        // adds it for every other write. The real signed-in session's
        // token takes priority over the dev fallback, same as
        // `api-client.ts`'s `sendRequest` -- a dev token must never shadow
        // a real one. No refresh-on-401 here (unlike `apiFetch`): pagehide
        // cannot await a token refresh round trip before the page is gone,
        // and per the class doc above this send is one-shot and
        // unreconciled regardless of how it fails.
        const token = currentAccessToken() ?? getDevBearerToken()
        const headers: Record<string, string> = {
          "content-type": "application/json",
        }

        if (token) {
          headers.authorization = `Bearer ${token}`
        }

        void fetchImpl(`/api${urlFor(open.attemptId)}`, {
          method: "PATCH",
          keepalive: true,
          headers,
          body: JSON.stringify(body),
        })
      })
  }

  window.addEventListener("pagehide", handler)

  return () => {
    window.removeEventListener("pagehide", handler)
  }
}

/**
 * Called by the submit flow immediately before POST /submit, to build the
 * request body's `responses` remainder (`SubmitRequest`,
 * `docs/api/openapi.yaml`). Reads the queue LIVE at call time -- not a
 * snapshot captured by an earlier "is the queue empty" check -- because an
 * answer landing between that earlier check and the actual submit call is
 * exactly the race spec §5 rule 6 exists to close: only a fresh read here,
 * as late as possible before the request is sent, closes it.
 *
 * Reads across every section of the attempt via `snapshotForAttempt`
 * (Task 8), not `snapshotForSection`: unlike the section flush and the
 * pagehide handler, which both only ever care about the one currently open
 * section, submit must carry whatever the queue still holds anywhere in
 * the attempt, since the child may have left answers unflushed in a
 * section they already navigated away from.
 */
export async function buildSubmitRemainder(
  queue: AnswerQueue,
  attemptId: string,
): Promise<{
  clientInstanceId: string
  responses: Array<{
    questionId: string
    seq: number
    selectedChoiceIds: string[]
    answeredAt: string
    timeSpentMs?: number
  }>
}> {
  const items = await queue.snapshotForAttempt(attemptId)

  return {
    clientInstanceId: queue.clientInstanceId(),
    responses: items.map((item) => ({
      questionId: item.questionId,
      seq: item.seq,
      selectedChoiceIds: item.selectedChoiceIds,
      answeredAt: item.answeredAt,
      timeSpentMs: item.timeSpentMs ?? undefined,
    })),
  }
}

/** The finish-section counterpart to buildSubmitRemainder, scoped to one section. */
export async function buildSectionFinishRemainder(
  queue: AnswerQueue,
  attemptId: string,
  sectionId: string,
): Promise<{
  clientInstanceId: string
  responses: Array<{
    questionId: string
    seq: number
    selectedChoiceIds: string[]
    answeredAt: string
    timeSpentMs?: number
  }>
}> {
  const items = await queue.snapshotForSection(attemptId, sectionId)

  return {
    clientInstanceId: queue.clientInstanceId(),
    responses: items.map((item) => ({
      questionId: item.questionId,
      seq: item.seq,
      selectedChoiceIds: item.selectedChoiceIds,
      answeredAt: item.answeredAt,
      timeSpentMs: item.timeSpentMs ?? undefined,
    })),
  }
}

/** Reconciles finish/submit per-item acknowledgements against the durable queue. */
// oxlint-disable-next-line max-params
export async function reconcileFinalFlush(
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
