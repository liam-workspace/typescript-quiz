import type { PgPool } from "@liam-public/node-postgres"
import { Inject, Injectable, HttpStatus } from "@nestjs/common"
import type { Clock } from "@pp/common"
import {
  claimPlay as claimPlayRow,
  enterSection as enterSectionRow,
  findStudentBySubject,
  loadRunnerEnvelope,
  loadRunningOwnedAttempt,
  loadSectionBrief,
  SectionExpiredError,
  setPosition as setPositionRow,
  startOrResumeAttempt,
  TestNotFoundError,
  type AttemptRow,
  type FinalizedAttemptRow,
  type RunnerEnvelopeRow,
  type SectionBriefRow,
  type SectionEntryRow,
  type StartResult,
} from "@pp/db"
import { loadServerConfig } from "../config.js"
import { CLOCK, REQUEST_POOL } from "../database/tokens.js"
import { signMediaUrl } from "../media/media-signing.js"
import { ProblemException } from "./problem.exception.js"

export interface RunnerEnvelopeResult {
  attempt: AttemptRow
  envelope: Omit<
    RunnerEnvelopeRow,
    "id" | "status" | "expiresAt" | "currentSectionId" | "currentQuestionId"
  >
}

export interface SectionEntryResult {
  entry: SectionEntryRow
  section: SectionBriefRow
}

export interface PlayGrant {
  stimulusId: string
  playsUsed: number
  playsRemaining: number | null
  mediaUrl: string
  urlExpiresAt: Date
}

/** How long a signed media URL stays valid after `POST /play` issues it. */
const PLAY_URL_TTL_MS = 5 * 60 * 1000

/**
 * `NotYourAttempt` (contract: "the attempt belongs to another student").
 * Also thrown for a caller who never provisioned a student row: an unowned
 * attempt and one owned by nobody the token can prove it is are the same
 * answer to the caller, and the contract declares no 404 for this route.
 */
function notYourAttemptError(): ProblemException {
  return new ProblemException({
    type: "not_your_attempt",
    title: "The attempt belongs to another student.",
    status: HttpStatus.FORBIDDEN,
  })
}

/**
 * `AttemptExpired`: the attempt was past its deadline and has just been
 * finalized by `loadRunningOwnedAttempt`'s lazy-expiry check. Carries the
 * finalized attempt so the client can render the time-up screen without a
 * follow-up read, mirroring `finalizedPriorAttempt` in `toAttemptStartView`.
 */
function attemptExpiredError(finalized: FinalizedAttemptRow): ProblemException {
  return new ProblemException({
    type: "attempt_expired",
    title: "The attempt was past its deadline and has been finalized.",
    status: HttpStatus.GONE,
    retryable: false,
    attempt: {
      id: finalized.id,
      status: finalized.status,
      submittedAt: finalized.submittedAt.toISOString(),
      resultUrl: `/api/attempts/${finalized.id}/result`,
    },
  })
}

/**
 * `409`, contract: "A previous section is still open." Section closing is a
 * side effect of the phase-4/5 answer-submission path, not of entering
 * another section, so this is refused rather than closed on the caller's
 * behalf.
 */
function sectionStillOpenError(): ProblemException {
  return new ProblemException({
    type: "section_still_open",
    title: "A previous section is still open.",
    status: HttpStatus.CONFLICT,
  })
}

/** `409`, contract: "this section runs forward only." */
function navigationLockedError(): ProblemException {
  return new ProblemException({
    type: "navigation_locked",
    title: "This section runs forward only.",
    status: HttpStatus.CONFLICT,
  })
}

/** `410`, contract: the section clock elapsed while the attempt remains live. */
function sectionExpiredError(): ProblemException {
  return new ProblemException({
    type: "section_expired",
    title: "The section's clock ran out.",
    status: HttpStatus.GONE,
    retryable: false,
  })
}

/** `409`, contract: "No plays remaining." */
function noPlaysRemainingError(): ProblemException {
  return new ProblemException({
    type: "no_plays_remaining",
    title: "No plays remaining.",
    status: HttpStatus.CONFLICT,
  })
}

const UNIQUE_VIOLATION_SQLSTATE = "23505"
const ACTIVE_ATTEMPT_CONSTRAINT = "attempt_one_active"

/**
 * True only for the exact race `POST /attempts` is meant to absorb: two
 * requests both find no live attempt and both try to insert one for the
 * same (student, version). Any other unique violation is a genuine bug
 * and must still surface as a 500 rather than be silently retried.
 */
function isActiveAttemptRace(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false
  }

  const { code, constraint } = error as { code?: unknown; constraint?: unknown }

  return (
    code === UNIQUE_VIOLATION_SQLSTATE &&
    constraint === ACTIVE_ATTEMPT_CONSTRAINT
  )
}

@Injectable()
export class AttemptsService {
  constructor(
    @Inject(REQUEST_POOL) private readonly pool: PgPool,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** The contract's `serverTime`: authoritative, and the only clock a client may trust. */
  now(): Date {
    return this.clock.now()
  }

  async start(
    subjectClaim: string,
    slug: string | undefined,
  ): Promise<StartResult> {
    if (!slug || slug.trim().length === 0) {
      throw new ProblemException({
        type: "bad_slug",
        title: "The slug is missing or blank.",
        status: HttpStatus.BAD_REQUEST,
      })
    }

    const student = await findStudentBySubject(this.pool, subjectClaim)

    if (!student) {
      throw new ProblemException({
        type: "student_not_provisioned",
        title: "No student profile exists for this token.",
        status: HttpStatus.NOT_FOUND,
      })
    }

    const now = this.clock.now()

    try {
      return await startOrResumeAttempt(this.pool, {
        studentId: student.id,
        slug,
        now,
      })
    } catch (error) {
      if (error instanceof TestNotFoundError) {
        // 409, not 404: the contract declares exactly 200/201/401/409 for
        // this operation, with 409 as "The test is not published." A slug
        // that names nothing and a slug whose version is still a draft are
        // the same answer to the student -- there is nothing here you can
        // start -- and collapsing them also stops the response from
        // distinguishing "no such test" from "not published yet", which
        // would leak the existence of unpublished content.
        throw new ProblemException({
          type: "test_not_published",
          title: "The test is not published.",
          status: HttpStatus.CONFLICT,
        })
      }

      if (isActiveAttemptRace(error)) {
        // The losing side of a double-tapped Start: another request's
        // INSERT already won, so re-running finds it in_progress and
        // resumes it -- the correct response for a request that asked
        // for exactly this attempt.
        return startOrResumeAttempt(this.pool, {
          studentId: student.id,
          slug,
          now,
        })
      }

      throw error
    }
  }

  /**
   * The runner projection (spec: "ONE shape, read by the listening,
   * reading, hand-in and recovery screens alike"). loadRunningOwnedAttempt
   * is the load-bearing check: it is what turns a stale in-progress attempt
   * into a 410 by finalizing it on this very request, rather than handing
   * back content for an attempt that is secretly already over.
   */
  async getRunnerEnvelope(
    subjectClaim: string,
    attemptId: string,
  ): Promise<RunnerEnvelopeResult> {
    const student = await findStudentBySubject(this.pool, subjectClaim)

    if (!student) {
      throw notYourAttemptError()
    }

    const now = this.clock.now()
    const result = await loadRunningOwnedAttempt(this.pool, {
      attemptId,
      studentId: student.id,
      now,
    })

    if (!result.attempt) {
      if (result.finalized) {
        throw attemptExpiredError(result.finalized)
      }

      throw notYourAttemptError()
    }

    const envelope = await loadRunnerEnvelope(this.pool, {
      attemptId: result.attempt.id,
      testVersionId: result.attempt.testVersionId,
    })

    return { attempt: result.attempt, envelope }
  }

  /**
   * "I'm ready" for one section (spec: this is where the clock starts).
   * `loadRunningOwnedAttempt` is the same load-bearing check
   * `getRunnerEnvelope` runs first, so a stale attempt is finalized into a
   * 410 here too rather than having its clock started by mistake.
   */
  async enterSection(
    subjectClaim: string,
    attemptId: string,
    sectionId: string,
  ): Promise<SectionEntryResult> {
    const student = await findStudentBySubject(this.pool, subjectClaim)

    if (!student) {
      throw notYourAttemptError()
    }

    const now = this.clock.now()
    const result = await loadRunningOwnedAttempt(this.pool, {
      attemptId,
      studentId: student.id,
      now,
    })

    if (!result.attempt) {
      if (result.finalized) {
        throw attemptExpiredError(result.finalized)
      }

      throw notYourAttemptError()
    }

    const outcome = await enterSectionRow(this.pool, {
      attemptId: result.attempt.id,
      sectionId,
      now,
    })

    if (!outcome.ok) {
      throw sectionStillOpenError()
    }

    const section = await loadSectionBrief(this.pool, sectionId)

    if (!section) {
      // `enterSectionRow`'s INSERT already satisfied the composite FK tying
      // sectionId to this attempt's test_version -- a missing brief row
      // here would mean that FK and this read disagree about which
      // sections a version has, which should be unreachable.
      throw new Error(`section ${sectionId} has no brief row after entry`)
    }

    return { entry: outcome.entry, section }
  }

  /**
   * Records the runner's reload position after the same owned/running check
   * as every attempt-scoped mutation. A forward-only section rejects only
   * a lower target ordinal; moving forward and re-confirming the current
   * question both remain legal.
   */
  async setPosition(
    subjectClaim: string,
    attemptId: string,
    sectionId: string,
    questionId: string,
  ): Promise<void> {
    const student = await findStudentBySubject(this.pool, subjectClaim)

    if (!student) {
      throw notYourAttemptError()
    }

    const now = this.clock.now()
    const result = await loadRunningOwnedAttempt(this.pool, {
      attemptId,
      studentId: student.id,
      now,
    })

    if (!result.attempt) {
      if (result.finalized) {
        throw attemptExpiredError(result.finalized)
      }

      throw notYourAttemptError()
    }

    try {
      const outcome = await setPositionRow(this.pool, {
        attemptId: result.attempt.id,
        sectionId,
        questionId,
        now,
      })

      if (!outcome.ok) {
        throw navigationLockedError()
      }
    } catch (error) {
      if (error instanceof SectionExpiredError) {
        throw sectionExpiredError()
      }

      throw error
    }
  }

  /**
   * Claims one play against a (possibly) capped stimulus and, only on
   * success, issues a short-lived signed URL -- the ONLY way to obtain
   * audio for a capped stimulus (spec: a URL in the runner payload would
   * let a student fetch the file directly and replay it forever).
   * `loadRunningOwnedAttempt` is the same load-bearing 403/410 check every
   * other attempt-scoped route runs first.
   */
  async claimPlay(
    subjectClaim: string,
    attemptId: string,
    stimulusId: string,
  ): Promise<PlayGrant> {
    const student = await findStudentBySubject(this.pool, subjectClaim)

    if (!student) {
      throw notYourAttemptError()
    }

    const now = this.clock.now()
    const result = await loadRunningOwnedAttempt(this.pool, {
      attemptId,
      studentId: student.id,
      now,
    })

    if (!result.attempt) {
      if (result.finalized) {
        throw attemptExpiredError(result.finalized)
      }

      throw notYourAttemptError()
    }

    const claimed = await claimPlayRow(this.pool, {
      attemptId: result.attempt.id,
      stimulusId,
      testVersionId: result.attempt.testVersionId,
      now,
    })

    if (!claimed.ok) {
      throw noPlaysRemainingError()
    }

    const urlExpiresAt = new Date(now.getTime() + PLAY_URL_TTL_MS)
    const mediaUrl = signMediaUrl(
      claimed.claim.filename,
      urlExpiresAt,
      loadServerConfig().mediaSigningSecret,
    )

    return {
      stimulusId,
      playsUsed: claimed.claim.playsUsed,
      playsRemaining: claimed.claim.playsRemaining,
      mediaUrl,
      urlExpiresAt,
    }
  }
}
