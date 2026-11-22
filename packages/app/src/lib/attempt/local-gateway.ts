import type { QueuedAnswer } from "../answerQueue.js"
import { canAcceptAnswerChange } from "@pp/common"
import { ApiError } from "../api-client.js"
import type {
  AttemptStart,
  FinalizedAttempt,
  FinishSectionRequest,
  FinishSectionResult,
  OfflineBundle,
  PlayGrant,
  RecordedResponse,
  RunnerEnvelope,
  RunnerSection,
  SectionEntry,
  StimulusWire,
  SubmitRequest,
  SubmitResult,
} from "../api-types.js"
import type { FlushResult } from "../flushController.js"
import type { OfflineTestRecord } from "../offline/offline-store.js"
import {
  OfflineError,
  type AttemptGateway,
  type FlushContext,
  type StartHint,
} from "./attempt-gateway.js"
import type { JournalEventDraft, JournalStore } from "./journal-store.js"
import type { JournalEventType, LocalAttemptState } from "./journal-types.js"
import { buildLocalEnvelope } from "./local-envelope.js"
import { toPendingSection } from "./local-sections.js"
import { isOwnedBy } from "./owner.js"

export interface LocalGatewayDeps {
  readonly journal: JournalStore
  /** The SAME `LocalClock` the journal sync stamps `clientSentAt` from. */
  readonly clock: { nowMs(): number }
  readonly bundles: {
    list(): Promise<OfflineTestRecord[]>
    getBundle(slug: string): Promise<OfflineBundle | null>
    getMediaBlob(key: string): Promise<Blob | null>
  }
  readonly newId: () => string
  readonly objectUrl: (blob: Blob) => string
  readonly requestSync: () => void
  /** The signed-in student's JWT `sub`; stamped on every attempt this gateway creates or mirrors. */
  readonly ownerSub: () => string | null
}

const iso = (ms: number): string => new Date(ms).toISOString()

/** The `ApiError` the server would have sent, so page error handling needs no new branch. */
function problem(
  type: string,
  status: number,
  extra: Partial<ApiError["problem"]> = {},
): ApiError {
  return new ApiError({ type, title: type, status, ...extra })
}

const questionsOf = (section: RunnerSection) =>
  section.groups.flatMap((group) => group.questions)

function findQuestion(
  state: LocalAttemptState,
  questionId: string,
): { sectionId: string; ordinal: number } | null {
  for (const section of state.sections) {
    const question = questionsOf(section).find((q) => q.id === questionId)

    if (question) {
      return { sectionId: section.id, ordinal: question.ordinal }
    }
  }

  return null
}

function findStimulus(
  state: LocalAttemptState,
  stimulusId: string,
): StimulusWire | null {
  for (const section of state.sections) {
    for (const group of section.groups) {
      if (group.stimulus?.id === stimulusId) {
        return group.stimulus
      }
    }
  }

  return null
}

const isTicking = (section: RunnerSection, nowMs: number): boolean =>
  section.status === "open" &&
  section.expiresAt !== null &&
  nowMs < Date.parse(section.expiresAt)

/** The only section the server lets the attempt enter next (`section_out_of_order`). */
function nextEnterableIndex(state: LocalAttemptState): number {
  // The LAST section already entered (not the first): ES2022, so no findLastIndex.
  for (let index = state.sections.length - 1; index >= 0; index -= 1) {
    if (state.sections[index]?.status !== "pending") {
      return index + 1
    }
  }

  return 0
}

type EnterDecision = { kind: "open" } | { kind: "enter"; index: number }

/** Every rule the server applies to `enter_section`, against one state. */
function decideEnter(
  state: LocalAttemptState,
  sectionId: string,
  nowMs: number,
): EnterDecision {
  const index = state.sections.findIndex((s) => s.id === sectionId)
  const section = state.sections.at(index)

  if (index < 0 || !section) {
    throw problem("not_found", 404)
  }

  if (isTicking(section, nowMs)) {
    return { kind: "open" }
  }

  if (section.status !== "pending") {
    throw problem("section_expired", 410)
  }

  if (state.sections.some((s) => isTicking(s, nowMs))) {
    throw problem("section_still_open", 409)
  }

  if (index !== nextEnterableIndex(state)) {
    throw problem("section_out_of_order", 409)
  }

  return { kind: "enter", index }
}

/** Every rule the server applies to `position`, against one state. */
function checkPosition(
  state: LocalAttemptState,
  move: { readonly sectionId: string; readonly questionId: string },
  nowMs: number,
): void {
  const { sectionId, questionId } = move
  const section = state.sections.find((s) => s.id === sectionId)
  const target = findQuestion(state, questionId)

  if (!section || target?.sectionId !== sectionId) {
    throw problem("not_found", 404)
  }

  if (section.status === "closed") {
    throw problem("navigation_locked", 409)
  }

  if (!isTicking(section, nowMs)) {
    throw problem("section_expired", 410)
  }

  const current =
    state.currentQuestionId === null
      ? null
      : findQuestion(state, state.currentQuestionId)

  if (
    section.navigation === "forward_only" &&
    current?.sectionId === sectionId &&
    target.ordinal < current.ordinal
  ) {
    throw problem("navigation_locked", 409)
  }
}

/**
 * Every rule an answer must pass to be APPLIED at replay. A doomed answer is
 * refused here rather than journaled: the server would record it late or
 * rejected (and the queue would ack it away), or -- for a question outside
 * its section -- refuse the whole journal.
 */
function checkAnswer(
  state: LocalAttemptState,
  answer: Pick<QueuedAnswer, "sectionId" | "questionId" | "selectedChoiceIds">,
  nowMs: number,
): void {
  const section = state.sections.find((s) => s.id === answer.sectionId)
  const target = findQuestion(state, answer.questionId)

  if (!section || target?.sectionId !== answer.sectionId) {
    throw problem("not_found", 404)
  }

  if (!isTicking(section, nowMs)) {
    throw problem("section_expired", 410)
  }

  const current =
    state.currentQuestionId === null
      ? null
      : findQuestion(state, state.currentQuestionId)

  if (
    section.navigation === "forward_only" &&
    current?.sectionId === section.id &&
    target.ordinal < current.ordinal
  ) {
    throw problem("navigation_locked", 409)
  }

  const existing = (state.responses ?? []).find(
    (r) => r.questionId === answer.questionId,
  )

  if (
    !canAcceptAnswerChange(
      section.allowAnswerChange,
      existing ? existing.selectedChoiceIds : null,
      answer.selectedChoiceIds,
    )
  ) {
    throw problem("answer_change_not_allowed", 409)
  }
}

/** Plays already used, or the refusal the server would give for one more. */
function checkPlay(
  state: LocalAttemptState,
  stimulusId: string,
  nowMs: number,
): { used: number; stimulus: StimulusWire } {
  const stimulus = findStimulus(state, stimulusId)

  if (!stimulus) {
    throw problem("not_found", 404)
  }

  const section = state.sections.find((s) =>
    s.groups.some((group) => group.stimulus?.id === stimulusId),
  )

  if (!section || !isTicking(section, nowMs)) {
    throw problem("section_expired", 410)
  }

  const used = state.playsUsed[stimulusId] ?? 0

  if (stimulus.maxPlays !== null && used >= stimulus.maxPlays) {
    throw problem("no_plays_remaining", 409)
  }

  return { used, stimulus }
}

function withResponse(
  state: LocalAttemptState,
  response: RecordedResponse,
): LocalAttemptState {
  const others = (state.responses ?? []).filter(
    (r) => r.questionId !== response.questionId,
  )

  return { ...state, responses: [...others, response] }
}

const responseOf = (answer: QueuedAnswer): RecordedResponse => ({
  questionId: answer.questionId,
  selectedChoiceIds: answer.selectedChoiceIds,
  clientInstanceId: answer.clientInstanceId,
  seq: answer.seq,
  answeredAt: answer.answeredAt,
})

/** Raised inside a journal transaction when another tab entered the section first. */
const ALREADY_OPEN = new Error("already_open")

/**
 * Journal-first implementation of the attempt lifecycle for use with no
 * network. Every mutation appends a journal event AND updates the local
 * state in one IndexedDB transaction (`JournalStore.append`), then asks for
 * a sync. The rules the server enforces at replay (forward-only, the play
 * cap, section order, section and attempt clocks judged by `LocalClock`)
 * are re-checked INSIDE that transaction on the freshly read state, so two
 * tabs writing the same attempt cannot both spend the last play or enter
 * two sections: IndexedDB serialises their readwrite transactions.
 */
export class LocalAttemptGateway implements AttemptGateway {
  private readonly deps: LocalGatewayDeps

  constructor(deps: LocalGatewayDeps) {
    this.deps = deps
  }

  async start(slug: string, hint?: StartHint): Promise<AttemptStart> {
    const owner = this.mustOwner()
    const nowMs = this.deps.clock.nowMs()
    const mine = await this.myAttempts()
    const hinted = hint?.inProgressAttemptId ?? null
    // The server already has an attempt in progress for this test. A new
    // offline attempt would be refused at sync (`offline_attempt_conflict`)
    // and the student's work stranded, so only an attempt this phone already
    // holds can continue offline.
    const held =
      hinted === null
        ? mine.find((a) => a.slug === slug && a.finalized === null)
        : mine.find((a) => a.attemptId === hinted)

    if (hinted !== null && !held) {
      throw new OfflineError("not_hydrated")
    }

    if (held) {
      // A journal the server refused cannot be continued (nor replaced by a
      // second attempt the server would also refuse), and one whose clock
      // ran out is over: say so instead of resuming it.
      if (held.syncError !== null) {
        throw new OfflineError("sync_failed")
      }

      await this.assertLive(held, nowMs)

      return LocalAttemptGateway.startView(held, true, nowMs)
    }

    const bundle = await this.deps.bundles.getBundle(slug)

    if (!bundle) {
      throw new OfflineError("not_saved")
    }

    const sections = [...bundle.sections].sort((a, b) => a.ordinal - b.ordinal)
    const state: LocalAttemptState = {
      attemptId: this.deps.newId(),
      slug,
      testVersionId: bundle.testVersionId,
      title: bundle.title,
      attemptNumber: mine.filter((a) => a.slug === slug).length + 1,
      ownerSub: owner,
      origin: "offline",
      serverKnown: false,
      createdAt: iso(nowMs),
      versionDurationSeconds: bundle.durationSeconds,
      sections: sections.map(toPendingSection),
      playbackBySection: Object.fromEntries(
        sections.map((s) => [s.id, s.playback]),
      ),
      mediaKeyByStimulus: Object.fromEntries(
        bundle.media.map((m) => [m.stimulusId, m.key]),
      ),
      attemptStartedAt: null,
      attemptExpiresAt: null,
      currentSectionId: null,
      currentQuestionId: null,
      playsUsed: {},
      nextEventSeq: 1,
      syncedThrough: 0,
      finalized: null,
      syncError: null,
      responses: [],
    }

    // The attempt row and its `start` event land together or not at all.
    await this.deps.journal.createWithEvent(state, {
      type: "start",
      clientAt: iso(nowMs),
      payload: { slug, testVersionId: bundle.testVersionId },
    })
    this.deps.requestSync()

    return LocalAttemptGateway.startView(state, false, nowMs)
  }

  /**
   * Called by the hybrid gateway every time a remote envelope loads, so an
   * attempt that later loses connectivity can continue locally. It NEVER
   * overwrites local state that is ahead of the server (unsynced events, or
   * an attempt the server does not know yet), nor another student's.
   */
  async hydrate(envelope: RunnerEnvelope): Promise<void> {
    const owner = this.mustOwner()
    const nowMs = this.deps.clock.nowMs()
    // Server clock minus local clock, fixed at load: server instants are
    // re-expressed on the local timeline so deadlines are judged by one clock.
    const offset = Date.parse(envelope.serverTime) - nowMs
    const toLocal = (serverIso: string | null): string | null =>
      serverIso === null ? null : iso(Date.parse(serverIso) - offset)
    const sections = envelope.sections.map((section) => ({
      ...section,
      expiresAt: toLocal(section.expiresAt),
      completedAt: toLocal(section.completedAt),
    }))
    const playsUsed: Record<string, number> = {}

    for (const section of sections) {
      for (const group of section.groups) {
        if (group.stimulus && group.stimulus.maxPlays !== null) {
          playsUsed[group.stimulus.id] = group.stimulus.playsUsed
        }
      }
    }

    const versionDurationSeconds = sections.reduce(
      (total, s) => total + s.durationSeconds,
      0,
    )
    const attemptExpiresAt = toLocal(envelope.expiresAt)
    // The server skips every journal event at or below its cursor (and acks
    // through it): a mirror must continue its journal AFTER it, or its next
    // events would be acknowledged without ever being applied.
    const cursor = envelope.offlineJournalCursor

    // Checked and written in one transaction, so nothing appended meanwhile
    // can be overwritten.
    await this.deps.journal.replaceIfSettled(
      envelope.id,
      (existing, pending) =>
        existing &&
        (!isOwnedBy(existing, owner) ||
          !existing.serverKnown ||
          existing.syncError !== null ||
          pending > 0)
          ? null
          : {
              attemptId: envelope.id,
              slug: existing?.slug ?? null,
              testVersionId: existing?.testVersionId ?? null,
              title: envelope.testTitle,
              attemptNumber: envelope.attemptNumber,
              ownerSub: owner,
              origin: existing?.origin ?? "hydrated",
              serverKnown: true,
              createdAt: existing?.createdAt ?? iso(nowMs),
              versionDurationSeconds,
              sections,
              playbackBySection:
                existing?.playbackBySection ??
                Object.fromEntries(sections.map((s) => [s.id, playbackOf(s)])),
              mediaKeyByStimulus: existing?.mediaKeyByStimulus ?? {},
              attemptStartedAt:
                attemptExpiresAt === null
                  ? null
                  : iso(
                      Date.parse(attemptExpiresAt) -
                        versionDurationSeconds * 1000,
                    ),
              attemptExpiresAt,
              currentSectionId: envelope.currentSectionId,
              currentQuestionId: envelope.currentQuestionId,
              playsUsed,
              nextEventSeq: Math.max(existing?.nextEventSeq ?? 1, cursor + 1),
              syncedThrough: Math.max(existing?.syncedThrough ?? 0, cursor),
              finalized: null,
              syncError: null,
              responses: envelope.responses,
            },
    )
  }

  // ---- mirrors: a remote call succeeded; keep the offline copy current ----

  /** A play the server granted, so an offline claim later counts it. */
  mirrorPlay(
    attemptId: string,
    stimulusId: string,
    playsUsed: number,
  ): Promise<void> {
    return this.mirror(attemptId, (s) => ({
      ...s,
      playsUsed: {
        ...s.playsUsed,
        [stimulusId]: Math.max(s.playsUsed[stimulusId] ?? 0, playsUsed),
      },
    }))
  }

  mirrorPosition(
    attemptId: string,
    sectionId: string,
    questionId: string,
  ): Promise<void> {
    return this.mirror(attemptId, (s) => ({
      ...s,
      currentSectionId: sectionId,
      currentQuestionId: questionId,
    }))
  }

  mirrorEnter(attemptId: string, entry: SectionEntry): Promise<void> {
    const offset = Date.parse(entry.serverTime) - this.deps.clock.nowMs()
    const toLocal = (serverIso: string): string =>
      iso(Date.parse(serverIso) - offset)

    return this.mirror(attemptId, (s) => {
      const section = s.sections.find((c) => c.id === entry.sectionId)

      return {
        ...s,
        sections: s.sections.map((c) =>
          c.id === entry.sectionId
            ? {
                ...c,
                status: "open" as const,
                expiresAt: toLocal(entry.expiresAt),
              }
            : c,
        ),
        currentSectionId: entry.sectionId,
        currentQuestionId:
          section && s.currentSectionId !== entry.sectionId
            ? (questionsOf(section)[0]?.id ?? null)
            : s.currentQuestionId,
        attemptStartedAt: entry.attemptStartedAt
          ? toLocal(entry.attemptStartedAt)
          : s.attemptStartedAt,
        attemptExpiresAt: entry.attemptExpiresAt
          ? toLocal(entry.attemptExpiresAt)
          : s.attemptExpiresAt,
        playbackBySection: {
          ...s.playbackBySection,
          [entry.sectionId]: entry.playback,
        },
      }
    })
  }

  mirrorFinish(attemptId: string, sectionId: string): Promise<void> {
    const completedAt = iso(this.deps.clock.nowMs())

    return this.mirror(attemptId, (s) => ({
      ...s,
      sections: s.sections.map((c) =>
        c.id === sectionId && c.status !== "closed"
          ? { ...c, status: "closed" as const, completedAt }
          : c,
      ),
    }))
  }

  mirrorAnswer(attemptId: string, answer: QueuedAnswer): Promise<void> {
    return this.mirror(attemptId, (s) => withResponse(s, responseOf(answer)))
  }

  // ---- the AttemptGateway lifecycle ----

  async loadEnvelope(attemptId: string): Promise<RunnerEnvelope> {
    const state = await this.mustGet(attemptId)
    const nowMs = this.deps.clock.nowMs()

    await this.assertLive(state, nowMs)

    return buildLocalEnvelope(state, nowMs, async (stimulusId, existingUrl) => {
      const blob = await this.mediaBlobFor(state, stimulusId)

      return blob ? this.deps.objectUrl(blob) : existingUrl
    })
  }

  async enterSection(
    attemptId: string,
    sectionId: string,
  ): Promise<SectionEntry> {
    const state = await this.mustGet(attemptId)
    const nowMs = this.deps.clock.nowMs()

    await this.assertLive(state, nowMs)

    const decision = decideEnter(state, sectionId, nowMs)
    const section = state.sections.find((s) => s.id === sectionId)

    if (!section) {
      throw problem("not_found", 404)
    }

    if (decision.kind === "open") {
      return LocalAttemptGateway.entryView(state, section, {
        nowMs,
        first: false,
      })
    }

    // A section whose clock ran out without a `finish_section` is closed by
    // an explicit event first. The server's skew estimate can put this
    // phone's "ran out" a little before its own, and an `enter_section`
    // while it still thinks the last section is open refuses the WHOLE
    // journal (`section_still_open`); after a finish it never can.
    for (const stale of state.sections.filter((s) => s.status === "open")) {
      // eslint-disable-next-line no-await-in-loop
      await this.record(
        attemptId,
        { type: "finish_section", payload: { sectionId: stale.id }, nowMs },
        (s) => ({
          ...s,
          sections: s.sections.map((c) =>
            c.id === stale.id && c.status === "open"
              ? { ...c, status: "closed" as const, completedAt: c.expiresAt }
              : c,
          ),
        }),
      )
    }

    const expiresAt = iso(nowMs + section.durationSeconds * 1000)
    const first = state.attemptStartedAt === null
    const next = await this.record(
      attemptId,
      { type: "enter_section", payload: { sectionId }, nowMs },
      (s) => {
        if (decideEnter(s, sectionId, nowMs).kind === "open") {
          throw ALREADY_OPEN
        }

        const isFirst = s.attemptStartedAt === null

        return {
          ...s,
          sections: s.sections.map((c) =>
            c.id === sectionId
              ? { ...c, status: "open" as const, expiresAt }
              : c,
          ),
          currentSectionId: sectionId,
          currentQuestionId: questionsOf(section)[0]?.id ?? null,
          attemptStartedAt: isFirst ? iso(nowMs) : s.attemptStartedAt,
          attemptExpiresAt: isFirst
            ? iso(nowMs + s.versionDurationSeconds * 1000)
            : s.attemptExpiresAt,
        }
      },
    ).catch((error: unknown) => {
      // Another tab entered it between our read and our write: same answer.
      if (error === ALREADY_OPEN) {
        return this.mustGet(attemptId)
      }

      throw error
    })

    const entered = next.sections.find((s) => s.id === sectionId) ?? section

    return LocalAttemptGateway.entryView(next, entered, { nowMs, first })
  }

  async setPosition(
    attemptId: string,
    sectionId: string,
    questionId: string,
  ): Promise<void> {
    const state = await this.mustGet(attemptId)
    const nowMs = this.deps.clock.nowMs()

    await this.assertLive(state, nowMs)
    checkPosition(state, { sectionId, questionId }, nowMs)

    await this.record(
      attemptId,
      { type: "position", payload: { sectionId, questionId }, nowMs },
      (s) => {
        checkPosition(s, { sectionId, questionId }, nowMs)

        return {
          ...s,
          currentSectionId: sectionId,
          currentQuestionId: questionId,
        }
      },
    )
  }

  async claimPlay(attemptId: string, stimulusId: string): Promise<PlayGrant> {
    const state = await this.mustGet(attemptId)
    const nowMs = this.deps.clock.nowMs()

    await this.assertLive(state, nowMs)

    const { stimulus } = checkPlay(state, stimulusId, nowMs)
    // The play is only spent if the audio is actually on this phone:
    // claiming first and failing to play would burn the student's single
    // play for nothing.
    const blob = await this.mediaBlobFor(state, stimulusId)

    if (!blob) {
      throw new OfflineError("media_missing")
    }

    let playsUsed = 0

    await this.record(
      attemptId,
      { type: "play", payload: { stimulusId }, nowMs },
      (s) => {
        // Re-counted on the state read inside the transaction: another tab may
        // have spent the play since the check above.
        playsUsed = checkPlay(s, stimulusId, nowMs).used + 1

        return { ...s, playsUsed: { ...s.playsUsed, [stimulusId]: playsUsed } }
      },
    )

    return {
      stimulusId,
      playsUsed,
      playsRemaining:
        stimulus.maxPlays === null ? null : stimulus.maxPlays - playsUsed,
      mediaUrl: this.deps.objectUrl(blob),
      urlExpiresAt: iso(nowMs + 5 * 60_000),
    }
  }

  async finishSection(
    attemptId: string,
    sectionId: string,
    body: FinishSectionRequest,
  ): Promise<FinishSectionResult> {
    const state = await this.mustGet(attemptId)
    const nowMs = this.deps.clock.nowMs()

    await this.assertLive(state, nowMs)

    const index = state.sections.findIndex((s) => s.id === sectionId)
    const section = state.sections.at(index)

    if (index < 0 || !section) {
      throw problem("not_found", 404)
    }

    // Answers normally travel as their own journal events, noted before
    // this call; `finalFlush` stays empty because the journal sync acks the
    // queue once the server holds them.
    const done: FinishSectionResult = {
      sectionId,
      status: "finished",
      nextSectionId: state.sections[index + 1]?.id ?? null,
      finalFlush: [],
    }

    if (section.status === "closed") {
      return done
    }

    if (section.status !== "open" || state.currentSectionId !== sectionId) {
      throw problem("section_not_open", 409)
    }

    await this.journalRemainder(state, sectionId, body)

    await this.record(
      attemptId,
      { type: "finish_section", payload: { sectionId }, nowMs },
      (s) => ({
        ...s,
        sections: s.sections.map((c) =>
          c.id === sectionId && c.status === "open"
            ? { ...c, status: "closed" as const, completedAt: iso(nowMs) }
            : c,
        ),
      }),
    )

    return done
  }

  /**
   * The queue's remainder for this section (`body.responses`) may hold
   * answers that never reached the journal: tapped while the attempt was
   * online and synced (only mirrored, the FlushController owned the send)
   * and the network went before that send landed. Journal them BEFORE the
   * `finish_section`, or the sync would close the section first and every
   * later send of them would be refused. Already-journaled ones (same
   * device seq) are skipped, and an answer the rules refuse is left out.
   */
  private async journalRemainder(
    state: LocalAttemptState,
    sectionId: string,
    body: FinishSectionRequest,
  ): Promise<void> {
    const remainder = body.responses ?? []

    if (remainder.length === 0) {
      return
    }

    const journaled = new Set(
      (
        await this.deps.journal.eventsAfter(
          state.attemptId,
          state.syncedThrough,
        )
      )
        .filter((e) => e.type === "answer")
        .map(
          (e) =>
            `${String(e.payload.clientInstanceId)}:${String(e.payload.seq)}`,
        ),
    )

    for (const item of remainder) {
      if (journaled.has(`${body.clientInstanceId}:${item.seq}`)) {
        continue
      }

      // eslint-disable-next-line no-await-in-loop
      await this.noteAnswer(state.attemptId, {
        attemptId: state.attemptId,
        sectionId,
        questionId: item.questionId,
        clientInstanceId: body.clientInstanceId,
        seq: item.seq,
        selectedChoiceIds: item.selectedChoiceIds,
        answeredAt: item.answeredAt,
        timeSpentMs: item.timeSpentMs ?? null,
        terminalRejection: false,
      }).catch((error: unknown) => {
        // A refused answer would be applied nowhere; never let it block the finish.
        if (!(error instanceof ApiError)) {
          throw error
        }
      })
    }
  }

  // Fixed by the AttemptGateway contract: handing in always needs the server.
  // oxlint-disable-next-line class-methods-use-this
  submit(_attemptId: string, _body: SubmitRequest): Promise<SubmitResult> {
    return Promise.reject(new OfflineError("offline"))
  }

  async noteAnswer(attemptId: string, answer: QueuedAnswer): Promise<void> {
    const state = await this.mustGet(attemptId)
    const nowMs = this.deps.clock.nowMs()

    await this.assertLive(state, nowMs)
    checkAnswer(state, answer, nowMs)

    await this.record(
      attemptId,
      {
        type: "answer",
        payload: {
          sectionId: answer.sectionId,
          questionId: answer.questionId,
          clientInstanceId: answer.clientInstanceId,
          seq: answer.seq,
          selectedChoiceIds: answer.selectedChoiceIds,
          ...(answer.timeSpentMs === null
            ? {}
            : { timeSpentMs: answer.timeSpentMs }),
        },
        nowMs,
      },
      (s) => {
        checkAnswer(s, answer, nowMs)

        return withResponse(s, responseOf(answer))
      },
    )
  }

  async flushAnswers(ctx: FlushContext): Promise<FlushResult> {
    this.deps.requestSync()

    const pending = (
      await ctx.queue.snapshotForSection(ctx.attemptId, ctx.sectionId)
    ).length

    return pending === 0
      ? {
          flushed: true,
          rejectedQuestionIds: [],
          saveState: { status: "saved", pendingCount: 0 },
          outcome: "success",
        }
      : {
          flushed: false,
          rejectedQuestionIds: [],
          saveState: { status: "pending", pendingCount: pending },
          outcome: "retryable-failure",
        }
  }

  async isLocalOnly(attemptId: string): Promise<boolean> {
    const state = await this.getMine(attemptId)

    return state !== null && !state.serverKnown
  }

  async hasPendingJournal(attemptId: string): Promise<boolean> {
    const state = await this.getMine(attemptId)

    return (
      state !== null && (await this.deps.journal.pendingCount(attemptId)) > 0
    )
  }

  /** This student's local state for the attempt, or null (absent or another student's). */
  async getMine(attemptId: string): Promise<LocalAttemptState | null> {
    const state = await this.deps.journal.getAttempt(attemptId)

    return state && isOwnedBy(state, this.deps.ownerSub()) ? state : null
  }

  // ---- internals ----

  /** Nothing is created or mirrored without a student to own it. */
  private mustOwner(): string {
    const owner = this.deps.ownerSub()

    if (owner === null) {
      throw new OfflineError("no_owner")
    }

    return owner
  }

  private async myAttempts(): Promise<LocalAttemptState[]> {
    const me = this.deps.ownerSub()

    return (await this.deps.journal.listAttempts()).filter((a) =>
      isOwnedBy(a, me),
    )
  }

  private async mustGet(attemptId: string): Promise<LocalAttemptState> {
    const state = await this.getMine(attemptId)

    if (!state) {
      throw new OfflineError("not_hydrated")
    }

    return state
  }

  /** Only an up-to-date mirror is touched: never one with unsynced local work. */
  private async mirror(
    attemptId: string,
    mutate: (s: LocalAttemptState) => LocalAttemptState,
  ): Promise<void> {
    const me = this.deps.ownerSub()

    await this.deps.journal.replaceIfSettled(attemptId, (state, pending) =>
      state &&
      isOwnedBy(state, me) &&
      state.serverKnown &&
      state.syncError === null &&
      pending === 0
        ? mutate(state)
        : null,
    )
  }

  /**
   * Journal-first: the event and the state it produces commit together, and
   * `mutate` (which may throw a refusal) sees the state read inside that
   * transaction. Resolves with the committed state.
   */
  private async record(
    attemptId: string,
    event: {
      readonly type: JournalEventType
      readonly payload: JournalEventDraft["payload"]
      readonly nowMs: number
    },
    mutate: (s: LocalAttemptState) => LocalAttemptState,
  ): Promise<LocalAttemptState> {
    const committed: { state: LocalAttemptState | null } = { state: null }

    await this.deps.journal.append(
      attemptId,
      { type: event.type, clientAt: iso(event.nowMs), payload: event.payload },
      (s) => {
        committed.state = mutate(s)

        return committed.state
      },
    )
    this.deps.requestSync()

    if (committed.state === null) {
      throw new Error(`journal append for ${attemptId} applied no state`)
    }

    return committed.state
  }

  private async assertLive(
    state: LocalAttemptState,
    nowMs: number,
  ): Promise<void> {
    if (state.finalized) {
      throw LocalAttemptGateway.expired(state)
    }

    if (
      state.attemptExpiresAt !== null &&
      nowMs >= Date.parse(state.attemptExpiresAt)
    ) {
      const finalized = {
        status: "expired" as const,
        submittedAt: state.attemptExpiresAt,
      }

      await this.deps.journal.update(state.attemptId, (s) => ({
        ...s,
        finalized,
      }))

      throw LocalAttemptGateway.expired({ ...state, finalized })
    }
  }

  private static expired(state: LocalAttemptState): ApiError {
    const attempt: FinalizedAttempt = {
      id: state.attemptId,
      status: "expired",
      submittedAt:
        state.finalized?.submittedAt ?? state.attemptExpiresAt ?? iso(0),
      resultUrl: `/attempts/${state.attemptId}/result`,
    }

    return problem("attempt_expired", 410, { attempt })
  }

  private async mediaBlobFor(
    state: LocalAttemptState,
    stimulusId: string,
  ): Promise<Blob | null> {
    const key = await this.mediaKeyFor(state, stimulusId)

    return key === null ? null : this.deps.bundles.getMediaBlob(key)
  }

  private async mediaKeyFor(
    state: LocalAttemptState,
    stimulusId: string,
  ): Promise<string | null> {
    const direct = state.mediaKeyByStimulus[stimulusId]

    if (direct) {
      return direct
    }

    // A hydrated attempt has no bundle of its own: find the saved test whose
    // media manifest names this stimulus (stimulus ids are unique per version).
    for (const record of await this.deps.bundles.list()) {
      // eslint-disable-next-line no-await-in-loop
      const bundle = await this.deps.bundles.getBundle(record.slug)
      const hit = bundle?.media.find((m) => m.stimulusId === stimulusId)

      if (hit) {
        return hit.key
      }
    }

    return null
  }

  private static startView(
    state: LocalAttemptState,
    resumed: boolean,
    nowMs: number,
  ): AttemptStart {
    return {
      id: state.attemptId,
      attemptNumber: state.attemptNumber,
      status: "in_progress",
      createdAt: state.createdAt,
      startedAt: state.attemptStartedAt,
      expiresAt: state.attemptExpiresAt,
      serverTime: iso(nowMs),
      resumed,
      currentSectionId: state.currentSectionId,
      currentQuestionId: state.currentQuestionId,
      finalizedPriorAttempt: null,
    }
  }

  private static entryView(
    state: LocalAttemptState,
    section: RunnerSection,
    view: { readonly nowMs: number; readonly first: boolean },
  ): SectionEntry {
    const { nowMs, first } = view
    const expiresAt = section.expiresAt ?? iso(nowMs)

    return {
      sectionId: section.id,
      title: section.title,
      type: section.type,
      questionCount: section.questionCount,
      enteredAt: iso(Date.parse(expiresAt) - section.durationSeconds * 1000),
      expiresAt,
      serverTime: iso(nowMs),
      ...(first && state.attemptStartedAt && state.attemptExpiresAt
        ? {
            attemptStartedAt: state.attemptStartedAt,
            attemptExpiresAt: state.attemptExpiresAt,
          }
        : {}),
      navigation: section.navigation,
      allowAnswerChange: section.allowAnswerChange,
      playback: state.playbackBySection[section.id] ?? null,
      instructions: section.instructions,
    }
  }
}

/** A hydrated section's playback rules, from its capped stimulus (if any). */
function playbackOf(section: RunnerSection) {
  const capped = section.groups.find(
    (group) =>
      group.stimulus?.maxPlays !== null && group.stimulus !== undefined,
  )?.stimulus

  return capped && capped.maxPlays !== null
    ? {
        maxPlays: capped.maxPlays,
        allowPause: capped.allowPause,
        allowSeek: capped.allowSeek,
      }
    : null
}
