import type { PgPool } from "@liam-public/node-postgres"
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common"
import type { Clock } from "@pp/common"
import {
  findStudentBySubject,
  startOrResumeAttempt,
  TestNotFoundError,
  type StartResult,
} from "@pp/db"
import { CLOCK, REQUEST_POOL } from "../database/tokens.js"

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

  async start(
    subjectClaim: string,
    slug: string | undefined,
  ): Promise<StartResult> {
    if (!slug || slug.trim().length === 0) {
      throw new BadRequestException("bad_slug")
    }

    const student = await findStudentBySubject(this.pool, subjectClaim)

    if (!student) {
      throw new NotFoundException("student_not_provisioned")
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
        throw new NotFoundException("test_not_found")
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
}
