import type { AnswerQueue } from "./answerQueue.js"
import { classifyForRetry } from "./retryClassifier.js"

export type Scheduler = (delayMs: number) => Promise<void>

export interface ItemAckResult {
  questionId: string
  status: "applied" | "ignored_stale" | "rejected"
}

export interface FlushHttp {
  patch(
    url: string,
    body: unknown,
  ): Promise<
    | { kind: "network-error" }
    | { kind: "ok"; status: number; body: { results: ItemAckResult[] } }
    | { kind: "http-error"; status: number; body: unknown }
  >
}

const DEFAULT_MAX_ATTEMPTS = 5

export type SettledSaveState =
  | { readonly status: "saved"; readonly pendingCount: 0 }
  | { readonly status: "pending"; readonly pendingCount: number }
  | { readonly status: "failed"; readonly pendingCount: 0 }

export interface FlushResult {
  readonly flushed: boolean
  readonly rejectedQuestionIds: string[]
  readonly saveState: SettledSaveState
  readonly outcome: "success" | "retryable-failure" | "terminal-failure"
}

/**
 * Rule 2's client half (snapshot, not delta -- every item currently queued
 * for the section, every attempt) and rule 3's client half (one rejected
 * item does not roll back the rest; item failures never fail the envelope).
 * Rule 5 governs whether a FAILED request (network error or non-2xx) is
 * retried at all; classifyForRetry (Task 7) is the single source of truth
 * for that, never re-decided here.
 *
 * The queue is re-read into the request body on every attempt -- including
 * retries -- rather than the first read being cached and resent verbatim.
 * That is what "snapshot, not delta" buys on a retry: an answer recorded
 * locally in between attempt 1 and attempt 2 rides along on attempt 2
 * instead of waiting for a whole extra flush cycle.
 */
export class FlushController {
  private readonly queue: AnswerQueue
  private readonly http: FlushHttp
  private readonly scheduler: Scheduler

  constructor(queue: AnswerQueue, http: FlushHttp, scheduler: Scheduler) {
    this.queue = queue
    this.http = http
    this.scheduler = scheduler
  }

  // This is the public flush contract fixed by the plan (attemptId,
  // sectionId, url, maxAttempts?); Task 10's pagehide handler and
  // submit-remainder builder call `queue.snapshotForSection` directly
  // instead of through this method, so no other call site needs a
  // different shape.
  // oxlint-disable-next-line max-params
  async flushSection(
    attemptId: string,
    sectionId: string,
    url: string,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
  ): Promise<FlushResult> {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      // Re-read the queue on every attempt, not just once before the loop:
      // it is the section's whole current snapshot that must ride along on
      // a retry, not a body captured before the first attempt.
      // eslint-disable-next-line no-await-in-loop
      const items = await this.queue.snapshotForSection(attemptId, sectionId)

      if (items.length === 0) {
        return {
          flushed: true,
          rejectedQuestionIds: [],
          saveState: { status: "saved", pendingCount: 0 },
          outcome: "success",
        }
      }

      const body = {
        clientInstanceId: this.queue.clientInstanceId(),
        responses: items.map((item) => ({
          questionId: item.questionId,
          seq: item.seq,
          selectedChoiceIds: item.selectedChoiceIds,
          answeredAt: item.answeredAt,
          timeSpentMs: item.timeSpentMs ?? undefined,
        })),
      }

      // eslint-disable-next-line no-await-in-loop
      const response = await this.http.patch(url, body)

      if (response.kind === "ok") {
        // eslint-disable-next-line no-await-in-loop
        const rejectedQuestionIds = await this.reconcile(
          attemptId,
          items,
          response.body.results,
        )

        if (rejectedQuestionIds.length > 0) {
          return {
            flushed: true,
            rejectedQuestionIds,
            saveState: { status: "failed", pendingCount: 0 },
            outcome: "terminal-failure",
          }
        }

        return {
          flushed: true,
          rejectedQuestionIds,
          // eslint-disable-next-line no-await-in-loop
          saveState: await this.pendingStateFor(attemptId, sectionId),
          outcome: "success",
        }
      }

      const classification = classifyForRetry(
        response.kind === "network-error"
          ? { kind: "network-error" }
          : { kind: "http-status", status: response.status },
        attempt,
      )

      if (!classification.retry) {
        // Envelope-level failure: nothing was settled. The whole snapshot
        // stays queued -- it is neither acked nor marked terminal -- so the
        // next flush carries it again. Not a per-item terminal rejection
        // either (B5): the ENVELOPE was refused, not any one answer, so
        // there is nothing question-specific to report here -- the caller
        // still sees `flushed: false`.
        return {
          flushed: false,
          rejectedQuestionIds: [],
          saveState: { status: "failed", pendingCount: 0 },
          outcome: "terminal-failure",
        }
      }

      // eslint-disable-next-line no-await-in-loop
      await this.scheduler(classification.backoffMs)
    }

    return {
      flushed: false,
      rejectedQuestionIds: [],
      saveState: await this.pendingStateFor(attemptId, sectionId),
      outcome: "retryable-failure",
    }
  }

  private async pendingStateFor(
    attemptId: string,
    sectionId: string,
  ): Promise<SettledSaveState> {
    const pendingCount = (
      await this.queue.snapshotForSection(attemptId, sectionId)
    ).length

    return pendingCount > 0
      ? { status: "pending", pendingCount }
      : { status: "saved", pendingCount: 0 }
  }

  /**
   * Per-item results, never all-or-nothing (spec §5 rule 3): each item's
   * outcome is settled independently against the queue.
   *
   *  - "applied"       -- ack it, it is gone from the queue.
   *  - "ignored_stale" -- also a settled outcome, not a failure. Ack it too,
   *    or it would be resent forever even though the server already
   *    disposed of it.
   *  - "rejected"       -- a terminal item rejection (unknown question,
   *    answer-change refusal). markTerminalRejection excludes it from
   *    future snapshots without deleting the record, so it stops being
   *    resent forever without pretending the ack succeeded. Retrying it is
   *    the storm spec §5.5 warns about.
   *  - absent from `results` entirely -- not a success and not settled.
   *    Left alone: it stays queued and rides the next flush.
   */
  private async reconcile(
    attemptId: string,
    items: Array<{ questionId: string; seq: number }>,
    results: ItemAckResult[],
  ): Promise<string[]> {
    const seqByQuestion = new Map(
      items.map((item) => [item.questionId, item.seq]),
    )
    const rejectedQuestionIds: string[] = []

    for (const result of results) {
      const seq = seqByQuestion.get(result.questionId)

      if (seq === undefined) {
        continue
      }

      if (result.status === "applied" || result.status === "ignored_stale") {
        // eslint-disable-next-line no-await-in-loop
        await this.queue.ackItem(attemptId, result.questionId, seq)
      } else {
        // eslint-disable-next-line no-await-in-loop
        await this.queue.markTerminalRejection(attemptId, result.questionId)
        // B5: a terminal per-item rejection used to be silent -- the queue
        // stopped resending it (correctly: retrying a terminal rejection is
        // the storm spec §5.5 warns about) but nothing ever told the child
        // their answer did not save. Reported back to the caller so it can
        // surface this honestly instead of leaving an optimistic selection
        // on screen that the server will never grade.
        rejectedQuestionIds.push(result.questionId)
      }
    }

    return rejectedQuestionIds
  }
}
