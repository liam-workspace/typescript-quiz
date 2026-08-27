import type { JwtClaims } from "@liam-workspace/node-auth-server"
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Res,
  Req,
  UseFilters,
  UseGuards,
} from "@nestjs/common"
import type { RunnerEnvelopeRow, SectionBriefRow, StartResult } from "@pp/db"
import { CurrentStudent } from "../auth/current-student.decorator.js"
import { JwksGuard } from "../auth/jwks.guard.js"
import { ProblemException } from "./problem.exception.js"
import { ProblemExceptionFilter } from "./problem.filter.js"
import type { CapturedRequest } from "../http/raw-body-json.middleware.js"
import {
  AttemptsService,
  type PlayGrant,
  type RunnerEnvelopeResult,
  type SectionEntryResult,
  type SubmitResultView,
} from "./attempts.service.js"
import { SubmitRequestDto } from "./submit-request.schema.js"

/**
 * Structural rather than express's Response: @types/express is not a
 * dependency of this package, and `status` is all this controller needs.
 */
interface StatusSettable {
  status(code: number): unknown
}

interface PositionBody {
  sectionId: string
  questionId: string
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

/**
 * The contract's `SectionEntry` is FLAT: `sectionId` plus the entry's own
 * clock fields plus the section's rules content, all as one object -- not
 * `{ entry, section }` the way the service's `SectionEntryResult` splits
 * them for its own two data sources.
 */
interface SectionEntryView {
  sectionId: string
  title: string
  type: SectionBriefRow["type"]
  questionCount: number
  enteredAt: Date
  expiresAt: Date
  serverTime: Date
  attemptStartedAt?: Date
  attemptExpiresAt?: Date
  navigation: SectionBriefRow["navigation"]
  allowAnswerChange: boolean
  playback: SectionBriefRow["playback"]
  instructions: string[]
}

function toSectionEntryView(
  result: SectionEntryResult,
  serverTime: Date,
): SectionEntryView {
  const { entry, section } = result

  return {
    sectionId: entry.sectionId,
    title: section.title,
    type: section.type,
    questionCount: section.questionCount,
    enteredAt: entry.enteredAt,
    expiresAt: entry.expiresAt,
    serverTime,
    // Present only on the FIRST entry (contract description on
    // `attemptStartedAt`) -- `enterSection` only sets both together.
    ...(entry.attemptStartedAt && entry.attemptExpiresAt
      ? {
          attemptStartedAt: entry.attemptStartedAt,
          attemptExpiresAt: entry.attemptExpiresAt,
        }
      : {}),
    navigation: section.navigation,
    allowAnswerChange: section.allowAnswerChange,
    playback: section.playback,
    instructions: section.instructions,
  }
}

@Controller("attempts")
@UseGuards(JwksGuard)
@UseFilters(ProblemExceptionFilter)
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

  /** Final queue flush first, one-time grading second; 201 creates finality. */
  @Post(":id/submit")
  async submit(
    @CurrentStudent() claims: JwtClaims,
    @Param("id") id: string,
    @Body() body: SubmitRequestDto,
    @Req() req: CapturedRequest,
    @Res({ passthrough: true }) res: StatusSettable,
  ): Promise<SubmitResultView> {
    const result = await this.attempts.submit(subjectOf(claims), id, body, req)

    // 201 finalizes, 200 recognizes an already-finalized submitted row.
    res.status(result.alreadySubmitted ? 200 : 201)

    return result.view
  }

  /**
   * "I'm ready" -- fired on tap, NOT on screen load (spec: reading the
   * section rules is untimed). The FIRST entry also starts the whole-test
   * clock. `200`, not Nest's POST default of `201`: this recognises an
   * already-open section on a refresh as often as it creates one.
   */
  @Post(":id/sections/:sectionId/enter")
  @HttpCode(200)
  async enter(
    @CurrentStudent() claims: JwtClaims,
    @Param("id") id: string,
    @Param("sectionId") sectionId: string,
  ): Promise<SectionEntryView> {
    const result = await this.attempts.enterSection(
      subjectOf(claims),
      id,
      sectionId,
    )

    return toSectionEntryView(result, this.attempts.now())
  }

  /**
   * Full replacement of the runner's singleton reload position. A 204 has
   * no representation, so the repository/service outcome deliberately does
   * not escape this controller as a response body.
   */
  @Put(":id/position")
  @HttpCode(204)
  async setPosition(
    @CurrentStudent() claims: JwtClaims,
    @Param("id") id: string,
    @Body() body: PositionBody,
  ): Promise<void> {
    await this.attempts.setPosition(
      subjectOf(claims),
      id,
      body.sectionId,
      body.questionId,
    )
  }

  /**
   * Claims one play and, only then, issues a short-lived signed URL --
   * the ONLY way a client obtains audio for a capped stimulus. `200`, not
   * Nest's POST default of `201`: this recognises a claim against existing
   * state (the play counter), not the creation of a new resource.
   */
  @Post(":id/stimuli/:stimulusId/play")
  @HttpCode(200)
  play(
    @CurrentStudent() claims: JwtClaims,
    @Param("id") id: string,
    @Param("stimulusId") stimulusId: string,
  ): Promise<PlayGrant> {
    return this.attempts.claimPlay(subjectOf(claims), id, stimulusId)
  }
}

/** JwksGuard rejects a null sub, so this is a belt-and-braces narrowing. */
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
