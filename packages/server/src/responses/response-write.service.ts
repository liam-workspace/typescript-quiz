import type { PgPool } from "@liam-public/node-postgres"
import type { Clock } from "@pp/common"
import {
  findStudentBySubject,
  insertFailedWrite,
  loadRunningOwnedAttempt,
  type AttemptRow,
  type FinalizedAttemptRow,
} from "@pp/db"
import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common"
import { CLOCK, REQUEST_POOL } from "../database/tokens.js"
import type { CapturedRequest } from "../http/raw-body-json.middleware.js"
import type { SingleResponseWriteDto } from "./dto.js"

interface ResponseRequest extends CapturedRequest {
  method?: string
  originalUrl?: string
  url?: string
}

export interface AttemptOwnership {
  attempt: AttemptRow
  now: Date
}

export interface SectionRules {
  allowAnswerChange: boolean
  attemptExpiresAt: Date | null
  sectionExpiresAt: Date | null
  navigationLocked: boolean
}

interface SectionRulesDbRow {
  allow_answer_change: boolean
  navigation: "free" | "forward_only"
  question_ordinal: number
  current_ordinal: number | null
  section_expires_at: Date | null
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

export function sectionExpiredError(): HttpException {
  return new HttpException(
    {
      type: "section_expired",
      title: "The section's clock ran out.",
      status: HttpStatus.GONE,
      retryable: false,
    },
    HttpStatus.GONE,
  )
}

function rejectionTitle(reason: string): string {
  switch (reason) {
    case "answer_change_not_allowed":
      return "Answer changes are not allowed in this section."

    case "navigation_locked":
      return "This section runs forward only."

    default:
      return "The response could not be applied."
  }
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

  async resolveSectionRules(
    attempt: AttemptRow,
    questionId: string,
  ): Promise<SectionRules> {
    const { rows } = await this.pool.query<SectionRulesDbRow>(
      `SELECT ts.allow_answer_change,
              ts.navigation,
              target.ordinal AS question_ordinal,
              CASE
                WHEN current_group.test_section_id = ts.id
                THEN current.ordinal
                ELSE NULL
              END AS current_ordinal,
              attempt_section.expires_at AS section_expires_at
         FROM question target
         JOIN question_group target_group
           ON target_group.id = target.question_group_id
         JOIN test_section ts
           ON ts.id = target_group.test_section_id
          AND ts.test_version_id = target.test_version_id
         LEFT JOIN question current
           ON current.id = $3
          AND current.test_version_id = target.test_version_id
         LEFT JOIN question_group current_group
           ON current_group.id = current.question_group_id
         LEFT JOIN attempt_section
           ON attempt_section.attempt_id = $4
          AND attempt_section.test_section_id = ts.id
        WHERE target.id = $1 AND target.test_version_id = $2`,
      [
        questionId,
        attempt.testVersionId,
        attempt.currentQuestionId,
        attempt.id,
      ],
    )

    if (rows.length === 0) {
      return {
        allowAnswerChange: true,
        attemptExpiresAt: attempt.expiresAt,
        sectionExpiresAt: null,
        navigationLocked: false,
      }
    }

    const [row] = rows

    return {
      allowAnswerChange: row.allow_answer_change,
      attemptExpiresAt: attempt.expiresAt,
      sectionExpiresAt: row.section_expires_at,
      navigationLocked:
        row.navigation === "forward_only" &&
        row.current_ordinal !== null &&
        row.question_ordinal < row.current_ordinal,
    }
  }

  async captureRejection(
    req: ResponseRequest,
    input: {
      attemptId: string
      body: SingleResponseWriteDto
      now: Date
      reason: string
    },
  ): Promise<HttpException> {
    const rawBody =
      req.rawBody !== undefined
        ? req.rawBody.toString("utf8")
        : JSON.stringify(input.body)
    const captured = await insertFailedWrite(this.pool, {
      attemptId: input.attemptId,
      route: `${req.method ?? ""} ${req.originalUrl ?? req.url ?? ""}`,
      reason: input.reason,
      rawBody,
      byteSize: req.rawBodyByteCount ?? Buffer.byteLength(rawBody),
      clientVersion:
        typeof req.headers["x-client-version"] === "string"
          ? req.headers["x-client-version"]
          : null,
      clientInstanceId: input.body.clientInstanceId,
      now: input.now,
    })

    return new HttpException(
      {
        type: input.reason,
        title: rejectionTitle(input.reason),
        status: HttpStatus.CONFLICT,
        retryable: false,
        capturedAs: captured.id,
      },
      HttpStatus.CONFLICT,
    )
  }
}
