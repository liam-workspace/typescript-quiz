import type { PgPool } from "@liam-public/node-postgres"
import { HttpStatus, Inject, Injectable } from "@nestjs/common"
import type { Clock } from "@pp/common"
import { loadAttemptResult, type AttemptResultOutcome } from "@pp/db"
import { CLOCK, REQUEST_POOL } from "../database/tokens.js"
import { resolveOwnedAttempt } from "./ownership.js"
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

    return outcome.result
  }
}
