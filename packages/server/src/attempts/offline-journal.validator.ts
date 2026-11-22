import { isPastDeadline } from "@pp/common"
import type { JournalContextRows } from "@pp/db"
import type { OfflineJournalEvent } from "./offline-sync-request.schema.js"

/**
 * How far BELOW the server-recorded history a normalised event may land and
 * still be absorbed (clamped up to it): honest jitter -- network latency in
 * the skew estimate, a small NTP step between syncs -- is seconds. Anything
 * further means the skew itself is forged (see `effectiveTimes`).
 */
export const HISTORY_TOLERANCE_MS = 120_000

/** Beyond this the attempt's content and the student's intent are both stale. */
export const MAX_JOURNAL_AGE_MS = 72 * 60 * 60 * 1000

export interface JournalSection {
  readonly id: string
  readonly ordinal: number
  readonly durationSeconds: number
  readonly navigation: "free" | "forward_only"
  readonly allowAnswerChange: boolean
}

export interface JournalStimulus {
  readonly sectionId: string
  readonly maxPlays: number | null
}

export interface JournalQuestion {
  readonly sectionId: string
  readonly ordinal: number
}

export interface JournalSectionState {
  readonly enteredAt: Date
  readonly expiresAt: Date
  readonly completedAt: Date | null
}

/**
 * Everything `validateJournal` reads. Every map is keyed by LOWER-CASE uuid
 * (what Postgres returns); event ids are lower-cased before lookup, because
 * the request schema accepts either case, as Postgres does.
 */
export interface JournalContext {
  readonly receivedAt: Date
  readonly clientSentAt: Date
  /** The attempt's `offline_journal_cursor`: events at or below it are skipped. */
  readonly ackedThrough: number
  readonly attemptExists: boolean
  /** Submitted or expired: nothing more can be applied to it. */
  readonly attemptFinished: boolean
  readonly attemptStartedAt: Date | null
  readonly attemptExpiresAt: Date | null
  /** The attempt's server-recorded position, which a forward-only section may not move behind. */
  readonly currentPosition: {
    readonly sectionId: string
    readonly questionId: string
  } | null
  readonly versionDurationSeconds: number
  readonly sections: ReadonlyMap<string, JournalSection>
  readonly stimuli: ReadonlyMap<string, JournalStimulus>
  readonly questions: ReadonlyMap<string, JournalQuestion>
  readonly playsUsed: ReadonlyMap<string, number>
  readonly sectionStates: ReadonlyMap<string, JournalSectionState>
}

export type Disposition =
  | { readonly kind: "apply" }
  | { readonly kind: "late" }
  | { readonly kind: "rejected"; readonly reason: RejectionReason }

/** Per-event refusals a genuine client can produce; the rest of the journal still lands. */
export type RejectionReason =
  | "section_not_entered"
  | "section_already_entered"
  | "navigation_locked"

/** Structural defects a genuine client never produces; the whole request is refused. */
export type InvalidReason =
  | "event_seq_not_contiguous"
  | "client_at_after_sent_at"
  | "client_at_backwards"
  | "event_too_old"
  | "client_at_before_history"
  | "start_missing"
  | "start_for_existing_attempt"
  | "start_repeated"
  | "unknown_section"
  | "unknown_stimulus"
  | "question_not_in_section"
  | "section_still_open"
  | "section_out_of_order"

export interface PlannedEvent {
  readonly event: OfflineJournalEvent
  /** Skew-normalised server time at which the event is replayed (`now` for the repositories). */
  readonly effectiveAt: Date
  readonly disposition: Disposition
}

export type JournalValidation =
  | { readonly ok: true; readonly planned: readonly PlannedEvent[] }
  | {
      readonly ok: false
      readonly code: "offline_journal_invalid" | "offline_play_cap_exceeded"
      readonly reason: InvalidReason | "play_cap_exceeded"
      readonly eventSeq: number | null
    }

type Failure = Extract<JournalValidation, { ok: false }>

const APPLY: Disposition = { kind: "apply" }
const LATE: Disposition = { kind: "late" }
const rejected = (reason: RejectionReason): Disposition => ({
  kind: "rejected",
  reason,
})
const invalid = (reason: InvalidReason, eventSeq: number): Failure => ({
  ok: false,
  code: "offline_journal_invalid",
  reason,
  eventSeq,
})
const key = (id: string): string => id.toLowerCase()

/**
 * Turns `loadJournalContext`'s rows plus the request's clocks and cursor
 * into the lookup shape `validateJournal` reads.
 */
export function buildJournalContext(
  rows: JournalContextRows,
  request: {
    readonly receivedAt: Date
    readonly clientSentAt: Date
    readonly ackedThrough: number
  },
): JournalContext {
  const position =
    rows.currentSectionId !== null && rows.currentQuestionId !== null
      ? {
          sectionId: key(rows.currentSectionId),
          questionId: key(rows.currentQuestionId),
        }
      : null

  return {
    receivedAt: request.receivedAt,
    clientSentAt: request.clientSentAt,
    ackedThrough: request.ackedThrough,
    attemptExists: rows.attemptStatus !== null,
    attemptFinished:
      rows.attemptStatus === "submitted" || rows.attemptStatus === "expired",
    attemptStartedAt: rows.attemptStartedAt,
    attemptExpiresAt: rows.attemptExpiresAt,
    currentPosition: position,
    versionDurationSeconds: rows.versionDurationSeconds,
    sections: new Map(
      rows.sections.map((section) => [
        key(section.id),
        { ...section, id: key(section.id) },
      ]),
    ),
    stimuli: new Map(
      rows.stimuli.map((stimulus) => [
        key(stimulus.id),
        { sectionId: key(stimulus.sectionId), maxPlays: stimulus.maxPlays },
      ]),
    ),
    questions: new Map(
      rows.questions.map((question) => [
        key(question.id),
        { sectionId: key(question.sectionId), ordinal: question.ordinal },
      ]),
    ),
    playsUsed: new Map(
      rows.playsUsed.map((play) => [key(play.stimulusId), play.playCount]),
    ),
    sectionStates: new Map(
      rows.sectionStates.map((state) => [
        key(state.sectionId),
        {
          enteredAt: state.enteredAt,
          expiresAt: state.expiresAt,
          completedAt: state.completedAt,
        },
      ]),
    ),
  }
}

/**
 * The latest instant the server has already recorded for this attempt. A
 * replayed event can never precede its own history: within
 * `HISTORY_TOLERANCE_MS` it is clamped up to it (later is the conservative
 * direction, closer to every deadline); beyond that the journal is refused.
 */
function historyFloorMs(ctx: JournalContext): number {
  const instants = [ctx.attemptStartedAt]

  for (const state of ctx.sectionStates.values()) {
    instants.push(state.enteredAt, state.completedAt)
  }

  return Math.max(
    Number.NEGATIVE_INFINITY,
    ...instants.flatMap((instant) => (instant ? [instant.getTime()] : [])),
  )
}

/**
 * Pass 1: sequence and clocks. Returns each event's effective time, or the
 * structural failure that refuses the whole journal.
 *
 * `effectiveAt = clientAt + (receivedAt - clientSentAt)` (spec §13.1): the
 * device's skew shifts every timestamp uniformly, so a phone whose clock is
 * merely wrong is neither rejected nor given time -- only the RELATIVE
 * timing it reports matters. What is checked is the device's consistency
 * with itself (no event after its own send time, no time running backwards)
 * and the journal's absolute age once normalised.
 *
 * `clientAt` and `clientSentAt` come from the SAME device clock and an
 * honest client stamps every event before it sends, so `clientAt >
 * clientSentAt` is refused outright (equality is fine). Any tolerance there
 * would be granted time: the excess is clamped away on the event but not on
 * the `enter` it is measured from, shrinking the event's offset into a
 * deadline it missed. The client must therefore stamp `clientSentAt` afresh
 * at every send, from the clock that stamps the events.
 *
 * The skew is ONE client-controlled field. For a new attempt that is
 * harmless -- every deadline is relative to the journal's own `enter`, so a
 * uniform shift cancels. For a hydrated attempt the deadlines are absolute
 * server instants, and a forged far-future `clientSentAt` would drag every
 * event below the recorded history, where a silent clamp would park them
 * all inside the deadline. Hence `client_at_before_history`.
 */
function effectiveTimes(
  events: readonly OfflineJournalEvent[],
  ctx: JournalContext,
): Date[] | Failure {
  const receivedMs = ctx.receivedAt.getTime()
  const sentMs = ctx.clientSentAt.getTime()
  const skewMs = receivedMs - sentMs
  const earliestMs = receivedMs - MAX_JOURNAL_AGE_MS
  const floorMs = historyFloorMs(ctx)
  const times: Date[] = []
  let previousClientMs = Number.NEGATIVE_INFINITY

  for (const [index, event] of events.entries()) {
    const expectedSeq = ctx.ackedThrough + 1 + index

    if (event.eventSeq !== expectedSeq) {
      return invalid("event_seq_not_contiguous", event.eventSeq)
    }

    const clientMs = Date.parse(event.clientAt)

    if (clientMs > sentMs) {
      return invalid("client_at_after_sent_at", event.eventSeq)
    }

    if (clientMs < previousClientMs) {
      return invalid("client_at_backwards", event.eventSeq)
    }

    const effectiveMs = clientMs + skewMs

    if (effectiveMs < earliestMs) {
      return invalid("event_too_old", event.eventSeq)
    }

    if (effectiveMs < floorMs - HISTORY_TOLERANCE_MS) {
      return invalid("client_at_before_history", event.eventSeq)
    }

    previousClientMs = clientMs
    // `clientMs <= sentMs` already keeps this at or before `receivedAt`.
    times.push(new Date(Math.max(effectiveMs, floorMs)))
  }

  return times
}

/** Pass 2: exactly one `start`, first, and only for an attempt that does not exist yet. */
function checkStart(
  events: readonly OfflineJournalEvent[],
  ctx: JournalContext,
): Failure | null {
  const starts = events.filter((event) => event.type === "start")
  const [first] = events

  if (ctx.attemptExists && starts.length > 0) {
    return invalid("start_for_existing_attempt", starts[0].eventSeq)
  }

  if (!ctx.attemptExists && first.type !== "start") {
    return invalid("start_missing", first.eventSeq)
  }

  if (starts.length > 1) {
    return invalid("start_repeated", starts[1].eventSeq)
  }

  return null
}

type StepResult = Disposition | Failure

const isFailure = (result: StepResult): result is Failure => "ok" in result

/**
 * Pass 3: replays the journal against a working copy of the attempt's
 * state, mirroring what the repositories will do when the plan is applied
 * with `now = effectiveAt`. Only `apply` events change the working state,
 * so a late or rejected event can never unlock anything for a later one.
 */
class Replay {
  private readonly states: Map<string, JournalSectionState>
  private readonly plays: Map<string, number>
  private readonly lastPosition = new Map<string, number>()
  private attemptDeadline: Date | null

  constructor(private readonly ctx: JournalContext) {
    this.states = new Map(ctx.sectionStates)
    this.plays = new Map(ctx.playsUsed)
    this.attemptDeadline = ctx.attemptExpiresAt

    const position = ctx.currentPosition
    const question = position ? ctx.questions.get(position.questionId) : null

    if (position && question) {
      this.lastPosition.set(position.sectionId, question.ordinal)
    }
  }

  step(event: OfflineJournalEvent, at: Date): StepResult {
    switch (event.type) {
      case "start":
        return APPLY

      case "enter_section":
        return this.enter(key(event.payload.sectionId), event.eventSeq, at)

      case "play":
        return this.play(key(event.payload.stimulusId), event.eventSeq, at)

      case "position":
        return this.move(event, at)

      case "answer":
        return this.move(event, at)

      case "finish_section":
        return this.finish(key(event.payload.sectionId), event.eventSeq, at)
    }
  }

  /** Attempt finished, or its whole-test clock (first enter + version duration) ran out. */
  private attemptOver(at: Date): boolean {
    return this.ctx.attemptFinished || isPastDeadline(this.attemptDeadline, at)
  }

  private static sectionOver(state: JournalSectionState, at: Date): boolean {
    return state.completedAt !== null || isPastDeadline(state.expiresAt, at)
  }

  /**
   * Sections are entered strictly in ordinal order, one at a time: the next
   * one is the lowest ordinal above every section already entered. The
   * runner only ever offers that one, so anything else is a forged journal.
   */
  private nextSectionOrdinal(): number | null {
    const entered = [...this.states.keys()].flatMap((id) => {
      const section = this.ctx.sections.get(id)

      return section ? [section.ordinal] : []
    })
    const highest = Math.max(Number.NEGATIVE_INFINITY, ...entered)
    const later = [...this.ctx.sections.values()]
      .map((section) => section.ordinal)
      .filter((ordinal) => ordinal > highest)

    return later.length === 0 ? null : Math.min(...later)
  }

  private enter(sectionId: string, eventSeq: number, at: Date): StepResult {
    const section = this.ctx.sections.get(sectionId)

    if (!section) {
      return invalid("unknown_section", eventSeq)
    }

    if (this.attemptOver(at)) {
      return LATE
    }

    const existing = this.states.get(sectionId)

    if (existing) {
      // Re-entering the OPEN section is the repository's idempotent path;
      // re-entering a closed one would be a second attempt_section row.
      return Replay.sectionOver(existing, at)
        ? rejected("section_already_entered")
        : APPLY
    }

    if (section.ordinal !== this.nextSectionOrdinal()) {
      return invalid("section_out_of_order", eventSeq)
    }

    const ticking = [...this.states.values()].some(
      (state) => !Replay.sectionOver(state, at),
    )

    if (ticking) {
      return invalid("section_still_open", eventSeq)
    }

    // The first entry starts the whole-test clock, as `enterSection` does.
    this.attemptDeadline ??= new Date(
      at.getTime() + this.ctx.versionDurationSeconds * 1000,
    )

    this.states.set(sectionId, {
      enteredAt: at,
      expiresAt: new Date(at.getTime() + section.durationSeconds * 1000),
      completedAt: null,
    })

    return APPLY
  }

  private play(stimulusId: string, eventSeq: number, at: Date): StepResult {
    const stimulus = this.ctx.stimuli.get(stimulusId)

    if (!stimulus) {
      return invalid("unknown_stimulus", eventSeq)
    }

    const state = this.states.get(stimulus.sectionId)

    if (this.attemptOver(at)) {
      return LATE
    }

    if (!state) {
      return rejected("section_not_entered")
    }

    if (Replay.sectionOver(state, at)) {
      return LATE
    }

    const used = (this.plays.get(stimulusId) ?? 0) + 1

    if (stimulus.maxPlays !== null && used > stimulus.maxPlays) {
      return {
        ok: false,
        code: "offline_play_cap_exceeded",
        reason: "play_cap_exceeded",
        eventSeq,
      }
    }

    this.plays.set(stimulusId, used)

    return APPLY
  }

  private move(
    event: Extract<OfflineJournalEvent, { type: "position" | "answer" }>,
    at: Date,
  ): StepResult {
    const sectionId = key(event.payload.sectionId)
    const section = this.ctx.sections.get(sectionId)
    const question = this.ctx.questions.get(key(event.payload.questionId))

    if (!section || !question || question.sectionId !== sectionId) {
      return invalid("question_not_in_section", event.eventSeq)
    }

    if (this.attemptOver(at)) {
      return LATE
    }

    const state = this.states.get(sectionId)

    if (!state) {
      return rejected("section_not_entered")
    }

    if (Replay.sectionOver(state, at)) {
      return LATE
    }

    const last = this.lastPosition.get(sectionId)

    // The same rule as `canSetPosition`: in a forward-only section neither a
    // move nor an answer may reach behind the furthest position. Answers do
    // not move the position (the online runner writes them separately).
    if (
      section.navigation === "forward_only" &&
      last !== undefined &&
      question.ordinal < last
    ) {
      return rejected("navigation_locked")
    }

    if (event.type === "position") {
      this.lastPosition.set(sectionId, question.ordinal)
    }

    return APPLY
  }

  private finish(sectionId: string, eventSeq: number, at: Date): StepResult {
    if (!this.ctx.sections.has(sectionId)) {
      return invalid("unknown_section", eventSeq)
    }

    if (this.attemptOver(at)) {
      return LATE
    }

    const state = this.states.get(sectionId)

    if (!state) {
      return rejected("section_not_entered")
    }

    // Already finished, or its clock ran out first: the section closed at its
    // own boundary (the next enter closes it lazily, pinned to the deadline),
    // so this tap changes nothing.
    if (Replay.sectionOver(state, at)) {
      return LATE
    }

    this.states.set(sectionId, { ...state, completedAt: at })

    return APPLY
  }
}

/**
 * Pure replay planner for an offline journal (spec D6, §13.1). It never
 * touches the database: the caller passes in everything it needs and gets
 * back either a structural failure (the WHOLE request is refused and
 * captured) or one disposition per not-yet-acknowledged event.
 *
 * Two classes of problem, deliberately handled differently:
 *   - Structural (sequence gaps, time running backwards, unknown ids,
 *     sections out of order or overlapping, the play cap): a genuine client
 *     never produces these, and applying a half-valid history would corrupt
 *     the attempt, so the request fails as a unit.
 *   - Per-event (late, navigation-locked, section not entered): a genuine
 *     client CAN produce these -- a clock that ran out mid-flight -- so the
 *     event is kept (as late/rejected, never applied) and the rest of the
 *     journal still lands.
 *
 * Two deadlines are enforced independently: the attempt's (first enter +
 * whole-test duration) and each section's (its enter + section duration).
 * A deadline instant is itself late, matching `isPastDeadline`.
 */
export function validateJournal(
  allEvents: readonly OfflineJournalEvent[],
  ctx: JournalContext,
): JournalValidation {
  const events = allEvents.filter((event) => event.eventSeq > ctx.ackedThrough)

  if (events.length === 0) {
    return { ok: true, planned: [] }
  }

  const times = effectiveTimes(events, ctx)

  if (!Array.isArray(times)) {
    return times
  }

  const startFailure = checkStart(events, ctx)

  if (startFailure) {
    return startFailure
  }

  const replay = new Replay(ctx)
  const planned: PlannedEvent[] = []

  for (const [index, event] of events.entries()) {
    const effectiveAt = times[index]
    const result = replay.step(event, effectiveAt)

    if (isFailure(result)) {
      return result
    }

    planned.push({ event, effectiveAt, disposition: result })
  }

  return { ok: true, planned }
}
