import type { JwtClaims } from "@liam-workspace/node-auth-server"
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common"
import type { RunnerEnvelopeRow, StartResult } from "@pp/db"
import { CurrentStudent } from "../auth/current-student.decorator.js"
import { JwksGuard } from "../auth/jwks.guard.js"
import {
  AttemptsService,
  type RunnerEnvelopeResult,
} from "./attempts.service.js"

/**
 * Structural rather than express's Response: @types/express is not a
 * dependency of this package, and `status` is all this controller needs.
 */
interface StatusSettable {
  status(code: number): unknown
}

/**
 * The contract's `AttemptStart` is FLAT; the repository's `StartResult` nests
 * the attempt because that is the shape the database work produces. Mapping
 * here keeps the wire contract from dictating the repository's internals, the
 * same split `toStudentView` makes for `GET /me`.
 */
interface AttemptStartView {
  id: string
  attemptNumber: number
  status: "in_progress"
  createdAt: Date
  startedAt: Date | null
  expiresAt: Date | null
  serverTime: Date
  resumed: boolean
  currentSectionId: string | null
  currentQuestionId: string | null
  finalizedPriorAttempt: {
    id: string
    status: "expired"
    submittedAt: Date
    resultUrl: string
  } | null
}

function toAttemptStartView(
  result: StartResult,
  serverTime: Date,
): AttemptStartView {
  const prior = result.finalizedPriorAttempt

  return {
    ...result.attempt,
    // A freshly started or resumed attempt is in_progress by construction:
    // an expired one is finalized and replaced before this returns.
    status: "in_progress",
    serverTime,
    resumed: result.resumed,
    finalizedPriorAttempt: prior
      ? {
          id: prior.id,
          // FinalizedAttempt.status is `const: expired` -- both of its uses
          // are expiry-driven, so there is nothing else it can be.
          status: "expired",
          submittedAt: prior.submittedAt,
          resultUrl: `/api/attempts/${prior.id}/result`,
        }
      : null,
  }
}

/**
 * The contract's `RunnerEnvelope` merged over `RunnerEnvelopeRow`: `id`,
 * `status`, `expiresAt`, `currentSectionId` and `currentQuestionId` come
 * straight off the `AttemptRow` the service already loaded, plus
 * `serverTime`, which is not stored anywhere -- it is read off the clock at
 * response time, same as `AttemptStartView`'s.
 */
interface RunnerEnvelopeView extends Omit<
  RunnerEnvelopeRow,
  "id" | "status" | "expiresAt"
> {
  id: string
  status: "in_progress"
  expiresAt: Date | null
  serverTime: Date
}

function toRunnerEnvelopeView(
  result: RunnerEnvelopeResult,
  serverTime: Date,
): RunnerEnvelopeView {
  return {
    ...result.envelope,
    id: result.attempt.id,
    status: "in_progress",
    expiresAt: result.attempt.expiresAt,
    currentSectionId: result.attempt.currentSectionId,
    currentQuestionId: result.attempt.currentQuestionId,
    serverTime,
  }
}

@Controller("attempts")
@UseGuards(JwksGuard)
export class AttemptsController {
  constructor(private readonly attempts: AttemptsService) {}

  /**
   * One call covers start, resume and re-attempt (spec §4): the partial
   * unique index `attempt_one_active` makes "start" and "resume" the same
   * request, so there is nothing here for the caller to distinguish and
   * nothing for this handler to branch on.
   */
  @Post()
  async start(
    @CurrentStudent() claims: JwtClaims,
    @Body("slug") slug: string | undefined,
    @Res({ passthrough: true }) res: StatusSettable,
  ): Promise<AttemptStartView> {
    const result = await this.attempts.start(subjectOf(claims), slug)

    // 201 provisions, 200 recognises -- the contract distinguishes them so a
    // client can tell a fresh attempt from a resumed one without comparing ids.
    res.status(result.resumed ? 200 : 201)

    return toAttemptStartView(result, this.attempts.now())
  }

  /**
   * The canonical runner envelope (spec: "ONE shape, read by the listening,
   * reading, hand-in and recovery screens alike"). `isCorrect` is absent by
   * construction -- `getRunnerEnvelope` never reaches `@pp/db/scoring`.
   */
  @Get(":id")
  async get(
    @CurrentStudent() claims: JwtClaims,
    @Param("id") id: string,
  ): Promise<RunnerEnvelopeView> {
    const result = await this.attempts.getRunnerEnvelope(subjectOf(claims), id)

    return toRunnerEnvelopeView(result, this.attempts.now())
  }
}

/** JwksGuard rejects a null sub, so this is a belt-and-braces narrowing. */
function subjectOf(claims: JwtClaims): string {
  if (!claims.sub) {
    throw new UnauthorizedException("invalid_token")
  }

  return claims.sub
}
