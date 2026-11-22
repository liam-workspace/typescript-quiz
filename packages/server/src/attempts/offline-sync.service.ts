import {
  withTransaction,
  type PgPool,
  type PgQueryable,
} from "@liam-workspace/node-postgres"
import { HttpStatus, Inject, Injectable } from "@nestjs/common"
import type { Clock } from "@pp/common"
import {
  AttemptNotInProgressError,
  advanceJournalCursor,
  applyResponse,
  claimPlay,
  createOfflineAttemptInTransaction,
  enterSectionInTransaction,
  findStudentBySubject,
  finishSectionInTransaction,
  getJournalCursor,
  insertFailedWrite,
  loadJournalContext,
  loadOwnedAttempt,
  loadRunningOwnedAttempt,
  SectionExpiredError,
  setPositionInTransaction,
} from "@pp/db"
import { CLOCK, REQUEST_POOL } from "../database/tokens.js"
import type { CapturedRequest } from "../http/raw-body-json.middleware.js"
import {
  buildJournalContext,
  validateJournal,
  type PlannedEvent,
} from "./offline-journal.validator.js"
import type {
  OfflineJournalEvent,
  OfflineSyncRequest,
} from "./offline-sync-request.schema.js"
import { resolveOwnedAttempt } from "./ownership.js"
import { ProblemException } from "./problem.exception.js"

export interface OfflineSyncResult {
  attemptId: string
  /** Highest eventSeq the server now holds for this attempt. */
  ackedThrough: number
  /** Events applied, answers included (an answer the reorder guard ignores as stale counts too). */
  applied: number
  /** Recorded (captured), not applied: after a section or attempt deadline, or the attempt is over. */
  late: number
  /** Recorded (captured), not applied: refused by a navigation or answer rule. */
  rejected: number
  /** Answer events applied or ignored as stale; drives the client's "N answers sent" toast. */
  answersAcked: number
  finalized: { status: "expired" | "submitted"; resultUrl: string } | null
}

type RefusalType =
  | "not_your_attempt"
  | "offline_journal_invalid"
  | "offline_attempt_conflict"

const REFUSAL_STATUS: Record<RefusalType, number> = {
  not_your_attempt: HttpStatus.FORBIDDEN,
  offline_journal_invalid: HttpStatus.UNPROCESSABLE_ENTITY,
  offline_attempt_conflict: HttpStatus.CONFLICT,
}

const REFUSAL_TITLE: Record<RefusalType, string> = {
  not_your_attempt: "The attempt belongs to another student.",
  offline_journal_invalid: "The offline journal is structurally impossible.",
  offline_attempt_conflict: "A live attempt already exists for this test.",
}

/**
 * Thrown inside the sync transaction to refuse the WHOLE journal. Throwing
 * (rather than returning) is what rolls back anything the transaction did
 * before the refusal was discovered; the capture happens afterwards, on the
 * pool, so the rollback cannot erase it.
 */
class JournalRefusal extends Error {
  constructor(
    readonly type: RefusalType,
    readonly reason: string,
    readonly eventSeq: number | null,
  ) {
    super(type)
  }
}

/**
 * `createOfflineAttempt` reported the attempt as already adopted. Under the
 * advisory lock no other sync can create it between the ownership check and
 * the insert, so this is a belt-and-braces signal: roll back and run the
 * sync again, this time against the existing attempt and its real cursor.
 */
class AttemptAdoptedMeanwhile extends Error {}

type EventOutcome =
  | { kind: "applied" }
  | { kind: "answer" }
  | { kind: "late" }
  | { kind: "rejected"; reason: string }
  /** The attempt ended during replay; this and every later event is late. */
  | { kind: "attempt_over" }

interface ReplayTarget {
  attemptId: string
  studentId: string
  testVersionId: string
  /** By lower-case section id. */
  allowAnswerChange: ReadonlyMap<string, boolean>
}

interface SyncInput {
  subjectClaim: string
  body: OfflineSyncRequest
  /** Lower-cased: the advisory-lock key and JS comparisons are case-sensitive. */
  attemptId: string
  receivedAt: Date
}

const canonical = (id: string): string => id.toLowerCase()

/**
 * `POST /attempts/offline-sync` (spec D6, §13.1): adopts and replays an
 * offline attempt journal through the SAME repository functions the live
 * routes use, each event at its skew-normalised `effectiveAt`, so expiry,
 * grading and finalisation rules are reused rather than re-implemented.
 *
 * One transaction per sync, holding a per-attempt advisory lock: ownership,
 * cursor, context, validation, every applied event, every per-event
 * capture and the cursor advance commit together or not at all. A crash
 * anywhere leaves the attempt exactly as the cursor describes it, so the
 * retry neither restarts an adopted attempt nor re-counts an applied play.
 */
@Injectable()
export class OfflineSyncService {
  constructor(
    @Inject(REQUEST_POOL) private readonly pool: PgPool,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async sync(
    subjectClaim: string,
    body: OfflineSyncRequest,
    req: CapturedRequest,
  ): Promise<OfflineSyncResult> {
    const input = {
      subjectClaim,
      body,
      attemptId: canonical(body.attemptId),
      receivedAt: this.clock.now(),
    }
    const once = (): Promise<OfflineSyncResult> =>
      withTransaction(this.pool, (tx) => this.replay(tx, input))

    try {
      // A second pass runs only after the first rolled back.
      return await once().catch((error: unknown) => {
        if (error instanceof AttemptAdoptedMeanwhile) {
          return once()
        }

        throw error
      })
    } catch (error) {
      if (error instanceof JournalRefusal) {
        throw await this.refuse(req, input, error)
      }

      throw await this.unexpected(req, input, error)
    }
  }

  private async replay(
    tx: PgQueryable,
    input: SyncInput,
  ): Promise<OfflineSyncResult> {
    const { body, attemptId, receivedAt } = input

    // Every sync of this attempt id -- any student, any device -- queues
    // here until the previous one commits, so the reads below see its work.
    await tx.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('offline-sync:' || $1, 0))",
      [attemptId],
    )

    // Ownership BEFORE anything attempt-scoped: loadJournalContext throws
    // on a foreign attempt, and a foreign id must be a 403, never a 500.
    const owned = await resolveOwnedAttempt(tx, {
      attemptId,
      subjectClaim: input.subjectClaim,
    })

    if (owned.kind === "forbidden") {
      throw new JournalRefusal("not_your_attempt", "not_your_attempt", null)
    }

    const student =
      owned.kind === "ok"
        ? { id: owned.studentId }
        : await findStudentBySubject(tx, input.subjectClaim)

    if (!student) {
      throw new JournalRefusal("not_your_attempt", "not_your_attempt", null)
    }

    const attempt =
      owned.kind === "ok"
        ? await loadOwnedAttempt(tx, { attemptId, studentId: student.id })
        : null
    // The version comes from the attempt row, or for a new attempt from its
    // `start` event -- never from any other request field.
    const testVersionId =
      attempt?.testVersionId ?? (await this.startVersion(tx, body))
    const cursor = attempt ? await getJournalCursor(tx, attemptId) : 0
    const rows = await loadJournalContext(tx, {
      attempt: attempt ? { attemptId, studentId: student.id } : null,
      testVersionId,
    })
    const validation = validateJournal(
      body.events,
      buildJournalContext(rows, {
        receivedAt,
        clientSentAt: new Date(body.clientSentAt),
        ackedThrough: cursor,
      }),
    )

    if (!validation.ok) {
      throw new JournalRefusal(
        validation.code,
        validation.reason,
        validation.eventSeq,
      )
    }

    const target: ReplayTarget = {
      attemptId,
      studentId: student.id,
      testVersionId,
      allowAnswerChange: new Map(
        rows.sections.map((section) => [
          canonical(section.id),
          section.allowAnswerChange,
        ]),
      ),
    }
    const tally = { applied: 0, late: 0, rejected: 0, answersAcked: 0 }
    let attemptOver = false

    // Strictly in journal order: each event's legality depends on the ones
    // before it (an answer after the `position` that unlocks it).
    /* eslint-disable no-await-in-loop */
    for (const planned of validation.planned) {
      const outcome: EventOutcome = attemptOver
        ? { kind: "late" }
        : await this.outcomeOf(tx, planned, target)

      if (outcome.kind === "applied" || outcome.kind === "answer") {
        tally.applied += 1
        tally.answersAcked += outcome.kind === "answer" ? 1 : 0

        continue
      }

      // Unapplied: captured one by one, on this transaction.
      attemptOver ||= outcome.kind === "attempt_over"

      if (outcome.kind === "rejected") {
        tally.rejected += 1
      } else {
        tally.late += 1
      }

      await this.captureEvent(tx, {
        attemptId,
        reason:
          outcome.kind === "rejected"
            ? `offline_${outcome.reason}`
            : "offline_late",
        event: planned.event,
        now: receivedAt,
      })
    }
    /* eslint-enable no-await-in-loop */

    const lastSeq = validation.planned.at(-1)?.event.eventSeq ?? cursor

    if (lastSeq > cursor) {
      await advanceJournalCursor(tx, attemptId, lastSeq)
    }

    return {
      attemptId,
      ackedThrough: Math.max(cursor, lastSeq),
      ...tally,
      finalized: await this.finalizedState(tx, {
        attemptId,
        studentId: student.id,
        now: receivedAt,
      }),
    }
  }

  /**
   * A new attempt's version, read from its `start` event and checked
   * against the slug it names: published, and belonging to that test.
   */
  private async startVersion(
    tx: PgQueryable,
    body: OfflineSyncRequest,
  ): Promise<string> {
    const [first] = body.events

    if (first.type !== "start") {
      throw new JournalRefusal(
        "offline_journal_invalid",
        "start_missing",
        first.eventSeq,
      )
    }

    const testVersionId = canonical(first.payload.testVersionId)
    const { rows } = await tx.query(
      `SELECT 1
         FROM test_version tv
         JOIN test t ON t.id = tv.test_id
        WHERE tv.id = $1 AND t.slug = $2 AND tv.published_at IS NOT NULL`,
      [testVersionId, first.payload.slug],
    )

    if (rows.length === 0) {
      throw new JournalRefusal(
        "offline_journal_invalid",
        "version_unavailable",
        first.eventSeq,
      )
    }

    return testVersionId
  }

  private outcomeOf(
    tx: PgQueryable,
    planned: PlannedEvent,
    target: ReplayTarget,
  ): Promise<EventOutcome> {
    switch (planned.disposition.kind) {
      case "late":
        return Promise.resolve({ kind: "late" })

      case "rejected":
        return Promise.resolve({
          kind: "rejected",
          reason: planned.disposition.reason,
        })

      case "apply":
        return this.applyEvent(tx, planned, target)
    }
  }

  /**
   * Applies one event through the live route's repository function with
   * `now = effectiveAt`. A refusal the repository reports (a rule the
   * validator cannot see, such as a forbidden answer change) is a
   * per-event rejection; an error it throws for a known condition maps to
   * late; anything else propagates and rolls the whole sync back.
   */
  private async applyEvent(
    tx: PgQueryable,
    planned: PlannedEvent,
    target: ReplayTarget,
  ): Promise<EventOutcome> {
    const { event, effectiveAt: now } = planned
    const { attemptId } = target

    try {
      switch (event.type) {
        case "start":
          return await this.adopt(tx, event, target, now)

        case "enter_section": {
          const entered = await enterSectionInTransaction(tx, {
            attemptId,
            sectionId: canonical(event.payload.sectionId),
            now,
          })

          return entered.ok
            ? { kind: "applied" }
            : { kind: "rejected", reason: entered.reason }
        }

        case "play": {
          const claimed = await claimPlay(tx, {
            attemptId,
            stimulusId: canonical(event.payload.stimulusId),
            testVersionId: target.testVersionId,
            now,
          })

          return claimed.ok
            ? { kind: "applied" }
            : { kind: "rejected", reason: claimed.reason }
        }

        case "position": {
          const moved = await setPositionInTransaction(tx, {
            attemptId,
            sectionId: canonical(event.payload.sectionId),
            questionId: canonical(event.payload.questionId),
            now,
          })

          return moved.ok
            ? { kind: "applied" }
            : { kind: "rejected", reason: moved.reason }
        }

        case "answer": {
          const sectionId = canonical(event.payload.sectionId)
          const written = await applyResponse(tx, {
            attemptId,
            questionId: canonical(event.payload.questionId),
            testVersionId: target.testVersionId,
            clientInstanceId: event.payload.clientInstanceId,
            seq: event.payload.seq,
            selectedChoiceIds: event.payload.selectedChoiceIds.map(canonical),
            answeredAt: now,
            timeSpentMs: event.payload.timeSpentMs ?? null,
            // Fail closed: an unknown section never permits a change.
            allowAnswerChange: target.allowAnswerChange.get(sectionId) ?? false,
            now,
          })

          return written.kind === "rejected"
            ? { kind: "rejected", reason: written.reason }
            : { kind: "answer" }
        }

        case "finish_section": {
          const finished = await finishSectionInTransaction(tx, {
            attemptId,
            sectionId: canonical(event.payload.sectionId),
            now,
            // Offline answers are journal events, applied in order before
            // this one; there is no separate queue remainder to flush.
            applyRemainder: () => Promise.resolve([]),
          })

          if (finished.kind === "finished") {
            return { kind: "applied" }
          }

          return finished.kind === "already_expired"
            ? { kind: "attempt_over" }
            : { kind: "rejected", reason: finished.kind }
        }
      }
    } catch (error) {
      if (error instanceof SectionExpiredError) {
        return { kind: "late" }
      }

      if (error instanceof AttemptNotInProgressError) {
        return { kind: "attempt_over" }
      }

      throw error
    }
  }

  /** The `start` event: adopt the client's uuid as a new attempt at its claimed time. */
  private async adopt(
    tx: PgQueryable,
    event: Extract<OfflineJournalEvent, { type: "start" }>,
    target: ReplayTarget,
    now: Date,
  ): Promise<EventOutcome> {
    const created = await createOfflineAttemptInTransaction(tx, {
      attemptId: target.attemptId,
      studentId: target.studentId,
      testVersionId: target.testVersionId,
      slug: event.payload.slug,
      now,
    })

    if (created.kind === "exists") {
      throw new AttemptAdoptedMeanwhile()
    }

    if (created.kind === "conflict") {
      throw new JournalRefusal(
        "offline_attempt_conflict",
        "offline_attempt_conflict",
        event.eventSeq,
      )
    }

    if (created.kind === "version_unavailable") {
      throw new JournalRefusal(
        "offline_journal_invalid",
        "version_unavailable",
        event.eventSeq,
      )
    }

    return { kind: "applied" }
  }

  /**
   * Lazy expiry, as the live routes do on their next touch: if the
   * whole-attempt deadline has passed by the time the server RECEIVED the
   * journal, finalize now so the result exists. Then report any terminal
   * state, however the attempt got there.
   */
  private async finalizedState(
    tx: PgQueryable,
    input: { attemptId: string; studentId: string; now: Date },
  ): Promise<OfflineSyncResult["finalized"]> {
    await loadRunningOwnedAttempt(tx, input)

    const attempt = await loadOwnedAttempt(tx, input)

    if (!attempt || attempt.status === "in_progress") {
      return null
    }

    return {
      status: attempt.status,
      resultUrl: `/attempts/${input.attemptId}/result`,
    }
  }

  /**
   * One failed_write per unapplied event (spec §5 rule 4: the server keeps
   * what it refuses), its own JSON as the body. Written on the sync
   * transaction, so it commits with the cursor that skips the event next
   * time and a retry never captures it twice.
   */
  private async captureEvent(
    db: PgQueryable,
    input: {
      attemptId: string
      reason: string
      event: OfflineJournalEvent
      now: Date
    },
  ): Promise<void> {
    const rawBody = JSON.stringify(input.event)

    await insertFailedWrite(db, {
      attemptId: input.attemptId,
      route: "POST /api/attempts/offline-sync (event)",
      reason: input.reason,
      rawBody,
      byteSize: Buffer.byteLength(rawBody),
      clientVersion: null,
      clientInstanceId:
        input.event.type === "answer"
          ? input.event.payload.clientInstanceId
          : null,
      now: input.now,
    })
  }

  /** The whole request, verbatim (raw bytes when the middleware kept them), on the pool. */
  private async captureRequest(
    req: CapturedRequest & { method?: string; originalUrl?: string },
    { body, attemptId, receivedAt }: SyncInput,
    reason: string,
  ): Promise<string> {
    const rawBody = req.rawBody?.toString("utf8") ?? JSON.stringify(body)
    const clientVersion = req.headers["x-client-version"]
    const captured = await insertFailedWrite(this.pool, {
      attemptId,
      route: `${req.method ?? "POST"} ${req.originalUrl ?? "/api/attempts/offline-sync"}`,
      reason,
      rawBody,
      byteSize: req.rawBodyByteCount ?? Buffer.byteLength(rawBody),
      clientVersion: typeof clientVersion === "string" ? clientVersion : null,
      clientInstanceId: null,
      now: receivedAt,
    })

    return captured.id
  }

  private async refuse(
    req: CapturedRequest,
    input: SyncInput,
    refusal: JournalRefusal,
  ): Promise<ProblemException> {
    const capturedAs = await this.captureRequest(req, input, refusal.type)

    return new ProblemException({
      type: refusal.type,
      title: REFUSAL_TITLE[refusal.type],
      status: REFUSAL_STATUS[refusal.type],
      retryable: false,
      reason: refusal.reason,
      eventSeq: refusal.eventSeq,
      capturedAs,
    })
  }

  /**
   * Anything unclassified (a deadlock, a lock or statement timeout, a bug):
   * the transaction rolled back, so nothing of this journal was applied and
   * the identical retry may succeed. Captured first, like every other
   * refused write, then reported as the retryable `unexpected_error`.
   */
  private async unexpected(
    req: CapturedRequest,
    input: SyncInput,
    error: unknown,
  ): Promise<ProblemException> {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined
    const capturedAs = await this.captureRequest(
      req,
      input,
      typeof code === "string" ? `db_error:${code}` : "unexpected_error",
    )

    return new ProblemException({
      type: "unexpected_error",
      title:
        "The journal could not be applied because of an unexpected server error.",
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      retryable: true,
      capturedAs,
    })
  }
}
