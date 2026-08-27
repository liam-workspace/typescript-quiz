import type { PgPool } from "@liam-public/node-postgres"
import type { Clock } from "@pp/common"
import {
  findStudentBySubject,
  loadRunningOwnedAttempt,
  type AttemptRow,
  type FinalizedAttemptRow,
} from "@pp/db"
import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common"
import { CLOCK, REQUEST_POOL } from "../database/tokens.js"

export interface AttemptOwnership {
  attempt: AttemptRow
  now: Date
}

function notYourAttemptError(): HttpException {
  return new HttpException(
    {
      type: "not_your_attempt",
      title: "The attempt belongs to another student.",
      status: HttpStatus.FORBIDDEN,
    },
    HttpStatus.FORBIDDEN,
  )
}

function attemptExpiredError(finalized: FinalizedAttemptRow): HttpException {
  return new HttpException(
    {
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
    },
    HttpStatus.GONE,
  )
}

@Injectable()
export class ResponseWriteService {
  constructor(
    @Inject(REQUEST_POOL) private readonly pool: PgPool,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async assertOwnsAttempt(
    subjectClaim: string,
    attemptId: string,
  ): Promise<AttemptOwnership> {
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

    return { attempt: result.attempt, now }
  }
}
