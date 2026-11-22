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
import type { FlushResult } from "../flushController.js"
import {
  OfflineError,
  type AttemptGateway,
  type FlushContext,
  type StartHint,
} from "./attempt-gateway.js"
import type { JournalStore } from "./journal-store.js"
import type { JournalSync } from "./journal-sync.js"
import type { LocalAttemptGateway } from "./local-gateway.js"

export interface HybridDeps {
  readonly remote: AttemptGateway
  readonly local: LocalAttemptGateway
  readonly journal: JournalStore
  readonly sync: JournalSync
  readonly isOnline: () => boolean
}

type Route = "local" | "remote"

/**
 * `fetch` rejects with a TypeError when no response was received at all. An
 * `ApiError` (the server answered, with a refusal) and an `OfflineError` are
 * deliberately NOT network failures: a refusal must reach the page unchanged.
 */
function isNetworkFailure(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof DOMException && error.name === "AbortError")
  )
}

/**
 * Chooses, per call, between the journal-first local gateway and the server.
 *
 *   - No local state for the signed-in student -> remote (today's behaviour).
 *   - Local-only, unsynced events, or a refused journal -> local: the server
 *     is BEHIND the journal and talking to it directly would reorder
 *     history. When online it syncs first, so this window closes as soon as
 *     it can (a refused journal is never re-sent behind the student's back).
 *   - Server-known and fully synced -> remote while online, local when not.
 *
 * Every remote load refreshes the local mirror (`hydrate`) and every remote
 * mutation updates it, so a network that dies mid-test continues locally
 * from where the student really is, with the plays already spent online.
 *
 * Known limit (spec §13.4): if a remote `claimPlay` reaches the server and
 * only its RESPONSE is lost, the local fallback spends the play again; the
 * server audits that at sync (`offline_play_cap_exceeded`).
 */
export class HybridAttemptGateway implements AttemptGateway {
  private readonly d: HybridDeps

  constructor(deps: HybridDeps) {
    this.d = deps
  }

  async start(slug: string, hint?: StartHint): Promise<AttemptStart> {
    if (this.d.isOnline()) {
      try {
        return await this.d.remote.start(slug, hint)
      } catch (error) {
        if (!isNetworkFailure(error)) {
          throw error
        }
      }
    }

    return this.d.local.start(slug, hint)
  }

  async loadEnvelope(attemptId: string): Promise<RunnerEnvelope> {
    if ((await this.pick(attemptId)) === "local") {
      return this.d.local.loadEnvelope(attemptId)
    }

    try {
      const envelope = await this.d.remote.loadEnvelope(attemptId)

      // Keep a local mirror so a later loss of connectivity can continue offline.
      await this.d.local.hydrate(envelope).catch(() => undefined)

      return envelope
    } catch (error) {
      if (
        isNetworkFailure(error) &&
        (await this.d.local.getMine(attemptId)) !== null
      ) {
        return this.d.local.loadEnvelope(attemptId)
      }

      throw error
    }
  }

  enterSection(attemptId: string, sectionId: string): Promise<SectionEntry> {
    return this.dispatch(attemptId, {
      remote: () => this.d.remote.enterSection(attemptId, sectionId),
      local: () => this.d.local.enterSection(attemptId, sectionId),
      mirror: (entry) => this.d.local.mirrorEnter(attemptId, entry),
    })
  }

  setPosition(
    attemptId: string,
    sectionId: string,
    questionId: string,
  ): Promise<void> {
    return this.dispatch(attemptId, {
      remote: () => this.d.remote.setPosition(attemptId, sectionId, questionId),
      local: () => this.d.local.setPosition(attemptId, sectionId, questionId),
      mirror: () =>
        this.d.local.mirrorPosition(attemptId, sectionId, questionId),
    })
  }

  claimPlay(attemptId: string, stimulusId: string): Promise<PlayGrant> {
    return this.dispatch(attemptId, {
      remote: () => this.d.remote.claimPlay(attemptId, stimulusId),
      local: () => this.d.local.claimPlay(attemptId, stimulusId),
      mirror: (grant) =>
        this.d.local.mirrorPlay(attemptId, stimulusId, grant.playsUsed),
    })
  }

  finishSection(
    attemptId: string,
    sectionId: string,
    body: FinishSectionRequest,
  ): Promise<FinishSectionResult> {
    return this.dispatch(attemptId, {
      remote: () => this.d.remote.finishSection(attemptId, sectionId, body),
      local: () => this.d.local.finishSection(attemptId, sectionId, body),
      mirror: () => this.d.local.mirrorFinish(attemptId, sectionId),
    })
  }

  async submit(attemptId: string, body: SubmitRequest): Promise<SubmitResult> {
    if ((await this.pick(attemptId)) === "local") {
      // Still local after trying to sync: nothing the server can submit yet.
      throw new OfflineError("offline")
    }

    try {
      const result = await this.d.remote.submit(attemptId, body)

      await this.d.journal.deleteAttempt(attemptId).catch(() => undefined)

      return result
    } catch (error) {
      if (isNetworkFailure(error)) {
        throw new OfflineError("offline")
      }

      throw error
    }
  }

  async noteAnswer(attemptId: string, answer: QueuedAnswer): Promise<void> {
    const state = await this.d.local.getMine(attemptId)

    if (!state) {
      return
    }

    const mustJournal =
      !state.serverKnown ||
      state.syncError !== null ||
      !this.d.isOnline() ||
      (await this.d.journal.pendingCount(attemptId)) > 0

    await (mustJournal
      ? this.d.local.noteAnswer(attemptId, answer)
      : this.d.local.mirrorAnswer(attemptId, answer))
  }

  async flushAnswers(ctx: FlushContext): Promise<FlushResult> {
    if ((await this.pick(ctx.attemptId)) === "local") {
      return this.d.local.flushAnswers(ctx)
    }

    return this.d.remote.flushAnswers(ctx)
  }

  isLocalOnly(attemptId: string): Promise<boolean> {
    return this.d.local.isLocalOnly(attemptId)
  }

  private async route(attemptId: string): Promise<Route> {
    const state = await this.d.local.getMine(attemptId)

    if (!state) {
      return "remote"
    }

    if (
      !state.serverKnown ||
      state.syncError !== null ||
      (await this.d.journal.pendingCount(attemptId)) > 0
    ) {
      return "local"
    }

    return this.d.isOnline() ? "remote" : "local"
  }

  /** `route`, but when online and behind, catch the server up first. */
  private async pick(attemptId: string): Promise<Route> {
    const route = await this.route(attemptId)

    if (route === "remote" || !this.d.isOnline()) {
      return route
    }

    const state = await this.d.local.getMine(attemptId)

    if (state?.syncError !== null) {
      return "local"
    }

    await this.d.sync.syncNow(attemptId)

    return this.route(attemptId)
  }

  private async dispatch<T>(
    attemptId: string,
    calls: {
      readonly remote: () => Promise<T>
      readonly local: () => Promise<T>
      readonly mirror: (result: T) => Promise<void>
    },
  ): Promise<T> {
    if ((await this.pick(attemptId)) === "local") {
      return calls.local()
    }

    try {
      const result = await calls.remote()

      // Never fails the call: the server already did what was asked.
      await calls.mirror(result).catch(() => undefined)

      return result
    } catch (error) {
      if (
        isNetworkFailure(error) &&
        (await this.d.local.getMine(attemptId)) !== null
      ) {
        return calls.local()
      }

      throw error
    }
  }
}
