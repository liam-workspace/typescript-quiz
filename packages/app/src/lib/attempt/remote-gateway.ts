import type { QueuedAnswer } from "../answerQueue.js"
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
import {
  claimPlay,
  enterSection,
  finishSection,
  getRunnerEnvelope,
  setPosition,
  startAttempt,
  submitAttempt,
} from "../attempts-api.js"
import type { FlushResult } from "../flushController.js"
import type {
  AttemptGateway,
  FlushContext,
  StartHint,
} from "./attempt-gateway.js"

/** The slice of `attempts-api.ts` the remote gateway forwards to. */
export interface RemoteAttemptApi {
  readonly startAttempt: typeof startAttempt
  readonly getRunnerEnvelope: typeof getRunnerEnvelope
  readonly enterSection: typeof enterSection
  readonly setPosition: typeof setPosition
  readonly claimPlay: typeof claimPlay
  readonly finishSection: typeof finishSection
  readonly submitAttempt: typeof submitAttempt
}

/**
 * Looked up through the module bindings on every call (not captured once),
 * so a test that mocks `attempts-api.js` is honoured exactly as it was
 * before this seam existed.
 */
const attemptsApi: RemoteAttemptApi = {
  startAttempt: (slug) => startAttempt(slug),
  getRunnerEnvelope: (attemptId) => getRunnerEnvelope(attemptId),
  enterSection: (attemptId, sectionId) => enterSection(attemptId, sectionId),
  setPosition: (attemptId, sectionId, questionId) =>
    setPosition(attemptId, sectionId, questionId),
  claimPlay: (attemptId, stimulusId) => claimPlay(attemptId, stimulusId),
  finishSection: (attemptId, sectionId, body) =>
    finishSection(attemptId, sectionId, body),
  submitAttempt: (attemptId, body) => submitAttempt(attemptId, body),
}

/** Today's behaviour, verbatim: every call goes straight to the API. */
export class RemoteAttemptGateway implements AttemptGateway {
  private readonly api: RemoteAttemptApi

  constructor(api: RemoteAttemptApi = attemptsApi) {
    this.api = api
  }

  start(slug: string, _hint?: StartHint): Promise<AttemptStart> {
    return this.api.startAttempt(slug)
  }

  loadEnvelope(attemptId: string): Promise<RunnerEnvelope> {
    return this.api.getRunnerEnvelope(attemptId)
  }

  enterSection(attemptId: string, sectionId: string): Promise<SectionEntry> {
    return this.api.enterSection(attemptId, sectionId)
  }

  setPosition(
    attemptId: string,
    sectionId: string,
    questionId: string,
  ): Promise<void> {
    return this.api.setPosition(attemptId, sectionId, questionId)
  }

  claimPlay(attemptId: string, stimulusId: string): Promise<PlayGrant> {
    return this.api.claimPlay(attemptId, stimulusId)
  }

  finishSection(
    attemptId: string,
    sectionId: string,
    body: FinishSectionRequest,
  ): Promise<FinishSectionResult> {
    return this.api.finishSection(attemptId, sectionId, body)
  }

  submit(attemptId: string, body: SubmitRequest): Promise<SubmitResult> {
    return this.api.submitAttempt(attemptId, body)
  }

  // The three members below are fixed by the `AttemptGateway` contract and
  // have nothing remote to do: the answer is already durable in the
  // AnswerQueue, the FlushController owns the send, and the server always
  // knows a remotely started attempt.

  // oxlint-disable-next-line class-methods-use-this
  noteAnswer(_attemptId: string, _answer: QueuedAnswer): Promise<void> {
    return Promise.resolve()
  }

  // oxlint-disable-next-line class-methods-use-this
  flushAnswers(ctx: FlushContext): Promise<FlushResult> {
    return ctx.controller.flushSection(
      ctx.attemptId,
      ctx.sectionId,
      `/attempts/${ctx.attemptId}/responses`,
    )
  }

  // oxlint-disable-next-line class-methods-use-this
  isLocalOnly(_attemptId: string): Promise<boolean> {
    return Promise.resolve(false)
  }

  // oxlint-disable-next-line class-methods-use-this
  hasPendingJournal(_attemptId: string): Promise<boolean> {
    return Promise.resolve(false)
  }
}
