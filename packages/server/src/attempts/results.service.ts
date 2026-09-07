import type { PgPool } from "@liam-public/node-postgres"
import { HttpStatus, Inject, Injectable } from "@nestjs/common"
import type { Clock } from "@pp/common"
import {
  finalizeAttempt,
  loadAttemptResult,
  type AttemptResultOutcome,
} from "@pp/db"
import { loadReview, type ReviewItem, type ReviewOutcome } from "@pp/db/scoring"
import { CLOCK, REQUEST_POOL } from "../database/tokens.js"
import { resolveOwnedAttempt } from "./ownership.js"
import { signMediaUrl } from "../media/media-signing.js"
import { loadServerConfig } from "../config.js"
import { ProblemException } from "./problem.exception.js"

function notYourAttemptError(): ProblemException {
  return new ProblemException({
    type: "not_your_attempt",
    title: "The attempt belongs to another student.",
    status: HttpStatus.FORBIDDEN,
  })
}

function stillRunningError(): ProblemException {
  return new ProblemException({
    type: "still_running",
    title: "Attempt still running",
    status: HttpStatus.CONFLICT,
    retryable: false,
  })
}

export type ReadyAttemptResult = Extract<
  AttemptResultOutcome,
  { kind: "ready" }
>["result"]

export type ReadyReviewItems = Extract<
  ReviewOutcome,
  { kind: "ready" }
>["items"]

/**
 * Review media is signed with a generous TTL rather than left bare.
 * `/media/:filename` refuses any CAPPED filename without a valid signature,
 * and it cannot check who is asking -- an `<audio src>` sends no bearer. So
 * "the attempt is over, the cap no longer applies" has to be expressed by
 * handing the client a URL that already carries authority, not by relaxing
 * the serving route for everyone.
 */
const REVIEW_URL_TTL_MS = 6 * 60 * 60 * 1000

@Injectable()
export class ResultsService {
  constructor(
    @Inject(REQUEST_POOL) private readonly pool: PgPool,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async getResult(
    subjectClaim: string,
    attemptId: string,
  ): Promise<ReadyAttemptResult> {
    const owned = await resolveOwnedAttempt(this.pool, {
      attemptId,
      subjectClaim,
    })

    if (owned.kind !== "ok") {
      throw notYourAttemptError()
    }

    const outcome = await loadAttemptResult(this.pool, {
      attemptId,
      now: this.clock.now(),
    })

    if (outcome.kind === "not_found") {
      // The ownership lookup already found this row. Attempts are never
      // deleted, but preserve the operation's declared 403 if that invariant
      // is ever broken rather than inventing a 404 response.
      throw notYourAttemptError()
    }

    if (outcome.kind === "still_running") {
      throw stillRunningError()
    }

    if (outcome.kind === "expired_unfinalized") {
      // The contract is explicit that this read finalizes rather than
      // refuses: "the result has just become available, so denying it would
      // be perverse." 409 is StillRunning, and an attempt past its deadline
      // is not running -- refusing here shows a child whose timed test ran
      // out an error instead of their score.
      //
      // finalizeAttempt is idempotent (its UPDATE carries
      // `AND status = 'in_progress'` and recurses on conflict), so two
      // concurrent reads cannot double-grade. It also pins submitted_at to
      // expires_at in SQL for the expired path, which is what keeps
      // attempt_expired_pins_deadline satisfied -- a JS Date round-trip
      // truncates Postgres's microseconds and violates it.
      await finalizeAttempt(this.pool, {
        attemptId,
        status: "expired",
        submittedAt: outcome.expiresAt,
      })

      const finalized = await loadAttemptResult(this.pool, {
        attemptId,
        now: this.clock.now(),
      })

      if (finalized.kind !== "ready") {
        throw stillRunningError()
      }

      return finalized.result
    }

    return outcome.result
  }

  async getReview(
    subjectClaim: string,
    attemptId: string,
  ): Promise<ReviewItem[]> {
    const owned = await resolveOwnedAttempt(this.pool, {
      attemptId,
      subjectClaim,
    })

    if (owned.kind !== "ok") {
      throw notYourAttemptError()
    }

    const outcome = await loadReview(this.pool, {
      attemptId,
      now: this.clock.now(),
      // Runner and play-grant payloads already establish `/media` as the
      // public URL mount. loadServerConfig().mediaRoot is a filesystem path
      // and must never be serialized as though it were this URL base.
      mediaUrlFor: (filename) =>
        signMediaUrl(
          filename,
          new Date(this.clock.now().getTime() + REVIEW_URL_TTL_MS),
          loadServerConfig().mediaSigningSecret,
        ),
    })

    if (outcome.kind === "not_found") {
      throw notYourAttemptError()
    }

    if (outcome.kind === "still_running") {
      throw stillRunningError()
    }

    if (outcome.kind === "expired_unfinalized") {
      await finalizeAttempt(this.pool, {
        attemptId,
        status: "expired",
        submittedAt: outcome.expiresAt,
      })

      const finalized = await loadReview(this.pool, {
        attemptId,
        now: this.clock.now(),
        mediaUrlFor: (filename) =>
          signMediaUrl(
            filename,
            new Date(this.clock.now().getTime() + REVIEW_URL_TTL_MS),
            loadServerConfig().mediaSigningSecret,
          ),
      })

      if (finalized.kind !== "ready") {
        throw stillRunningError()
      }

      return finalized.items
    }

    return outcome.items
  }
}
