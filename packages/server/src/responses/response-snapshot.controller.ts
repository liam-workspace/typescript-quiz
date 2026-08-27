import type { PgPool } from "@liam-public/node-postgres"
import type { JwtClaims } from "@liam-workspace/node-auth-server"
import { writeResponse } from "@pp/db"
import {
  Body,
  Controller,
  HttpStatus,
  Inject,
  Param,
  Patch,
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
import { applyResponseItems, type ItemResult } from "./apply-response.js"
import { ResponseSnapshotDto } from "./dto.js"
import { ResponseWriteService } from "./response-write.service.js"

interface FlushResult {
  results: ItemResult[]
  attempt: {
    expiresAt: string | null
    sectionExpiresAt: string | null
    serverTime: string
  }
}

@Controller("attempts/:id/responses")
@UseGuards(JwksGuard)
@UseFilters(ProblemExceptionFilter)
export class ResponseSnapshotController {
  constructor(
    private readonly responseWrites: ResponseWriteService,
    @Inject(REQUEST_POOL) private readonly pool: PgPool,
  ) {}

  @Patch()
  async flush(
    @CurrentStudent() claims: JwtClaims,
    @Param("id") attemptId: string,
    @Body() body: ResponseSnapshotDto,
    @Req() req: CapturedRequest,
  ): Promise<FlushResult> {
    const { attempt, now } = await this.responseWrites.assertOwnsAttempt(
      subjectOf(claims),
      attemptId,
    )
    const { results, sharedRules } = await applyResponseItems(this.pool, {
      attempt,
      clientInstanceId: body.clientInstanceId,
      responses: body.responses,
      now,
      req,
      write: (input) => writeResponse(this.pool, input),
    })

    return {
      results,
      attempt: {
        expiresAt: attempt.expiresAt?.toISOString() ?? null,
        sectionExpiresAt: sharedRules?.sectionExpiresAt?.toISOString() ?? null,
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
