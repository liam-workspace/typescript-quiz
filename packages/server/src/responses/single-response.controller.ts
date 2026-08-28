import type { PgPool } from "@liam-public/node-postgres"
import type { JwtClaims } from "@liam-workspace/node-auth-server"
import {
  AttemptNotInProgressError,
  writeResponse,
  type WriteOutcome,
} from "@pp/db"
import {
  Body,
  Controller,
  HttpStatus,
  Inject,
  Param,
  Put,
  Req,
  UseFilters,
  UseGuards,
} from "@nestjs/common"
import { ProblemException } from "../attempts/problem.exception.js"
import { ProblemExceptionFilter } from "../attempts/problem.filter.js"
import { CurrentStudent } from "../auth/current-student.decorator.js"
import { JwksGuard } from "../auth/jwks.guard.js"
import { REQUEST_POOL } from "../database/tokens.js"
import type { CapturedRequest } from "../http/raw-body-json.middleware.js"
import {
  captureAttemptNotInProgressWrite,
  captureRejection,
  captureUnexpectedWriteError,
} from "./capture.js"
import { SingleResponseWriteDto } from "./dto.js"
import { ResponseWriteService } from "./response-write.service.js"
import { mapWriteConflict, resolveSectionRules } from "./section-rules.js"

interface SingleResponseResult {
  questionId: string
  status: "applied" | "ignored_stale"
  attempt: {
    expiresAt: string | null
    sectionExpiresAt: string | null
    serverTime: string
  }
}

@Controller("attempts/:id/responses")
@UseGuards(JwksGuard)
@UseFilters(ProblemExceptionFilter)
export class SingleResponseController {
  constructor(
    private readonly responseWrites: ResponseWriteService,
    @Inject(REQUEST_POOL) private readonly pool: PgPool,
  ) {}

  @Put(":questionId")
  async save(
    @CurrentStudent() claims: JwtClaims,
    @Param("id") attemptId: string,
    @Param("questionId") questionId: string,
    @Body() body: SingleResponseWriteDto,
    @Req() req: CapturedRequest,
  ): Promise<SingleResponseResult> {
    const subject = subjectOf(claims)
    const { attempt, now } = await this.responseWrites.assertOwnsAttempt(
      subject,
      attemptId,
    )
    const rules = await resolveSectionRules(this.pool, { attempt, questionId })
    mapWriteConflict(rules, now)

    if (rules.navigationLocked) {
      throw await captureRejection(this.pool, req, {
        attemptId,
        body,
        now,
        reason: "navigation_locked",
        clientInstanceId: body.clientInstanceId,
      })
    }

    // See apply-response.ts's matching catch for why this exists: an
    // unrecognised database error (deadlock, lock timeout, serialization
    // failure) must never reach AllExceptionsFilter uncaptured -- it would
    // return Nest's bare `{statusCode, message, error}` shape, not
    // `application/problem+json`, with no `failed_write` row recorded.
    const outcome: WriteOutcome = await (async () => {
      try {
        return await writeResponse(this.pool, {
          attemptId,
          questionId,
          testVersionId: attempt.testVersionId,
          clientInstanceId: body.clientInstanceId,
          seq: body.seq,
          selectedChoiceIds: body.selectedChoiceIds,
          answeredAt: body.answeredAt ? new Date(body.answeredAt) : null,
          timeSpentMs: body.timeSpentMs ?? null,
          allowAnswerChange: rules.allowAnswerChange,
          now,
        })
      } catch (error) {
        if (error instanceof AttemptNotInProgressError) {
          await captureAttemptNotInProgressWrite(this.pool, req, {
            attemptId,
            body,
            now,
            clientInstanceId: body.clientInstanceId,
          })
          await this.responseWrites.mapAttemptNotInProgress(
            error,
            subject,
            attemptId,
          )
        }

        throw await captureUnexpectedWriteError(this.pool, req, {
          attemptId,
          body,
          now,
          clientInstanceId: body.clientInstanceId,
          error,
        })
      }
    })()

    if (outcome.kind === "rejected") {
      throw await captureRejection(this.pool, req, {
        attemptId,
        body,
        now,
        reason: outcome.reason,
        clientInstanceId: body.clientInstanceId,
      })
    }

    return {
      questionId,
      status: outcome.kind,
      attempt: {
        expiresAt: rules.attemptExpiresAt?.toISOString() ?? null,
        sectionExpiresAt: rules.sectionExpiresAt?.toISOString() ?? null,
        serverTime: now.toISOString(),
      },
    }
  }
}

function subjectOf(claims: JwtClaims): string {
  if (!claims.sub) {
    throw new ProblemException({
      type: "invalid_token",
      title: "Missing, invalid or expired token.",
      status: HttpStatus.UNAUTHORIZED,
    })
  }

  return claims.sub
}
