import type { AnswerQueue, QueuedAnswer } from "../answerQueue.js"
import type {
  AttemptStart,
  FinishSectionRequest,
  FinishSectionResult,
  PlayGrant,
  RunnerEnvelope,
  SectionEntry,
  SubmitRequest,
  SubmitResult,
} from "../api-types.js"
import type { FlushController, FlushResult } from "../flushController.js"

export type OfflineReason =
  | "offline"
  | "not_saved"
  | "media_missing"
  | "not_hydrated"

/**
 * Thrown by a gateway for something that needs a connection (or a saved test)
 * and cannot be done right now. Distinct from `ApiError`: the server never said
 * no -- there was nobody to ask. Callers show the "needs a connection" copy;
 * they must not treat it as a refusal or retry-storm it.
 */
export class OfflineError extends Error {
  readonly kind = "offline" as const
  readonly reason: OfflineReason

  constructor(reason: OfflineReason) {
    super(`offline:${reason}`)
    this.name = "OfflineError"
    this.reason = reason
  }
}

export interface StartHint {
  /** From the library card: an attempt already in progress for this test. */
  readonly inProgressAttemptId: string | null
}

export interface FlushContext {
  readonly controller: FlushController
  readonly queue: AnswerQueue
  readonly attemptId: string
  readonly sectionId: string
}

/**
 * The attempt lifecycle as the runner sees it. `RemoteAttemptGateway` forwards
 * to the API; the hybrid implementation (Task 21) journals locally first.
 * `enterSection`, `setPosition`, `claimPlay` and `finishSection` throw
 * `ApiError` for server-style refusals in BOTH implementations (the local one
 * synthesises the same problem types), so page error handling is unchanged.
 */
export interface AttemptGateway {
  start(slug: string, hint?: StartHint): Promise<AttemptStart>
  loadEnvelope(attemptId: string): Promise<RunnerEnvelope>
  enterSection(attemptId: string, sectionId: string): Promise<SectionEntry>
  setPosition(
    attemptId: string,
    sectionId: string,
    questionId: string,
  ): Promise<void>
  claimPlay(attemptId: string, stimulusId: string): Promise<PlayGrant>
  finishSection(
    attemptId: string,
    sectionId: string,
    body: FinishSectionRequest,
  ): Promise<FinishSectionResult>
  /** Remote only. The local gateway rejects with `OfflineError("offline")`. */
  submit(attemptId: string, body: SubmitRequest): Promise<SubmitResult>
  /** Called after `queue.recordAnswer`: lets a local attempt journal the answer. */
  noteAnswer(attemptId: string, answer: QueuedAnswer): Promise<void>
  flushAnswers(ctx: FlushContext): Promise<FlushResult>
  /** True when the server does not know this attempt id yet (offline start). */
  isLocalOnly(attemptId: string): Promise<boolean>
}
