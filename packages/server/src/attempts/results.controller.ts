import type { JwtClaims } from "@liam-workspace/node-auth-server"
import {
  Controller,
  Get,
  HttpStatus,
  Param,
  UseFilters,
  UseGuards,
} from "@nestjs/common"
import type { GradeResult } from "@pp/common"
import type { ReviewItem, ReviewStimulus } from "@pp/db/scoring"
import { CurrentStudent } from "../auth/current-student.decorator.js"
import { JwksGuard } from "../auth/jwks.guard.js"
import { ProblemException } from "./problem.exception.js"
import { ProblemExceptionFilter } from "./problem.filter.js"
import {
  ResultsService,
  type ReadyAttemptResult,
  type ReadyReviewItems,
} from "./results.service.js"

interface AttemptResultView {
  attemptId: string
  test: { title: string; version: number }
  status: "submitted" | "expired"
  submittedAt: Date
  elapsedSeconds: number
  score: GradeResult & { isPersonalBest: boolean }
}

function toAttemptResultView(result: ReadyAttemptResult): AttemptResultView {
  return {
    attemptId: result.attemptId,
    test: {
      title: result.testTitle,
      version: result.testVersion,
    },
    status: result.status,
    submittedAt: result.submittedAt,
    elapsedSeconds: result.elapsedSeconds,
    score: {
      ...result.score,
      isPersonalBest: result.isPersonalBest,
    },
  }
}

interface ReviewChoiceView {
  id: string
  label: string
  isCorrect: boolean
  selected: boolean
}

interface ReviewItemView {
  questionId: string
  ordinal: number
  sectionId: string
  prompt: string
  outcome: "correct" | "incorrect" | "unanswered"
  stimulus?: ReviewStimulus
  choices: ReviewChoiceView[]
}

interface ReviewPayloadView {
  attemptId: string
  items: ReviewItemView[]
}

function toReviewItemView(item: ReviewItem): ReviewItemView {
  return {
    questionId: item.questionId,
    ordinal: item.ordinal,
    sectionId: item.sectionId,
    prompt: item.prompt,
    outcome: item.outcome,
    ...(item.stimulus ? { stimulus: { ...item.stimulus } } : {}),
    choices: item.choices.map((choice) => ({
      id: choice.id,
      label: choice.label,
      isCorrect: choice.isCorrect,
      selected: choice.selected,
    })),
  }
}

function toReviewPayloadView(
  attemptId: string,
  items: ReadyReviewItems,
): ReviewPayloadView {
  return {
    attemptId,
    items: items.map(toReviewItemView),
  }
}

@Controller("attempts")
@UseGuards(JwksGuard)
@UseFilters(ProblemExceptionFilter)
export class ResultsController {
  constructor(private readonly results: ResultsService) {}

  @Get(":id/result")
  async getResult(
    @CurrentStudent() claims: JwtClaims,
    @Param("id") id: string,
  ): Promise<AttemptResultView> {
    const result = await this.results.getResult(subjectOf(claims), id)

    return toAttemptResultView(result)
  }

  @Get(":id/review")
  async getReview(
    @CurrentStudent() claims: JwtClaims,
    @Param("id") id: string,
  ): Promise<ReviewPayloadView> {
    const items = await this.results.getReview(subjectOf(claims), id)

    return toReviewPayloadView(id, items)
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
