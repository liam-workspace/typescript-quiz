import type { PgPool } from "@liam-public/node-postgres"
import type { JwtClaims } from "@liam-workspace/node-auth-server"
import { loadQuestionSectionInfo, writeResponse } from "@pp/db"
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
import { CapturableBadRequestException } from "../validation/zod-body-validation.pipe.js"
import { captureItemRejection } from "./capture.js"
import {
  ResponseSnapshotDto,
  ResponseSnapshotItemSchema,
  ResponseSnapshotQuestionIdentitySchema,
} from "./dto.js"
import { ResponseWriteService } from "./response-write.service.js"
import {
  mapWriteConflict,
  resolveSectionRules,
  type SectionRules,
} from "./section-rules.js"

interface ItemResult {
  questionId: string
  status: "applied" | "ignored_stale" | "rejected"
  reason?: string
  retryable?: false
  capturedAs?: string
}

interface FlushResult {
  results: ItemResult[]
  attempt: {
    expiresAt: string | null
    sectionExpiresAt: string | null
    serverTime: string
  }
}

function canonicalUuid(value: string): string {
  return value.toLowerCase()
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
    const parsedItems = body.responses.map((item) => ({
      raw: item,
      parsed: ResponseSnapshotItemSchema.safeParse(item),
    }))
    const questionIdentities = body.responses.flatMap((item) => {
      const identity = ResponseSnapshotQuestionIdentitySchema.safeParse(item)

      return identity.success ? [identity.data] : []
    })
    const sectionInfo = await loadQuestionSectionInfo(this.pool, {
      testVersionId: attempt.testVersionId,
      questionIds: questionIdentities.map((item) => item.questionId),
    })
    const sectionIds = new Set(
      [...sectionInfo.values()].map((info) => info.sectionId),
    )

    if (sectionIds.size > 1) {
      throw new CapturableBadRequestException(
        "mixed_sections",
        "Snapshot questions span more than one section",
      )
    }

    const firstResolvedItem = questionIdentities.find((item) =>
      sectionInfo.has(canonicalUuid(item.questionId)),
    )
    let sharedRules: SectionRules | undefined = undefined

    if (firstResolvedItem) {
      sharedRules = await resolveSectionRules(this.pool, {
        attempt,
        questionId: firstResolvedItem.questionId,
      })
      mapWriteConflict(sharedRules, now)
    }

    const results: ItemResult[] = []

    // Deliberately sequential: the contract does not forbid duplicate
    // question IDs, so processing in parallel would make their arrival order
    // nondeterministic. Each write still owns a separate transaction.
    /* eslint-disable no-await-in-loop */
    for (const { raw, parsed } of parsedItems) {
      if (!parsed.success) {
        results.push({
          questionId: raw.questionId,
          status: "rejected",
          reason: "invalid",
          retryable: false,
          capturedAs: await captureItemRejection(this.pool, req, {
            attemptId,
            body: raw,
            now,
            reason: "invalid",
            clientInstanceId: body.clientInstanceId,
          }),
        })

        continue
      }

      const item = parsed.data
      const info = sectionInfo.get(canonicalUuid(item.questionId))
      const rules = info
        ? await resolveSectionRules(this.pool, {
            attempt,
            questionId: item.questionId,
          })
        : undefined

      if (rules?.navigationLocked) {
        results.push({
          questionId: item.questionId,
          status: "rejected",
          reason: "navigation_locked",
          retryable: false,
          capturedAs: await captureItemRejection(this.pool, req, {
            attemptId,
            body: item,
            now,
            reason: "navigation_locked",
            clientInstanceId: body.clientInstanceId,
          }),
        })

        continue
      }

      const outcome = await writeResponse(this.pool, {
        attemptId,
        questionId: item.questionId,
        testVersionId: attempt.testVersionId,
        clientInstanceId: body.clientInstanceId,
        seq: item.seq,
        selectedChoiceIds: item.selectedChoiceIds,
        answeredAt: item.answeredAt ? new Date(item.answeredAt) : null,
        timeSpentMs: item.timeSpentMs ?? null,
        allowAnswerChange: rules?.allowAnswerChange ?? true,
        now,
      })

      if (outcome.kind === "rejected") {
        results.push({
          questionId: item.questionId,
          status: "rejected",
          reason: outcome.reason,
          retryable: false,
          capturedAs: await captureItemRejection(this.pool, req, {
            attemptId,
            body: item,
            now,
            reason: outcome.reason,
            clientInstanceId: body.clientInstanceId,
          }),
        })
      } else {
        results.push({ questionId: item.questionId, status: outcome.kind })
      }
    }
    /* eslint-enable no-await-in-loop */

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
