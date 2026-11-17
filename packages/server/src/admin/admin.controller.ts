import type { JwtClaims } from "@liam-workspace/node-auth-server"
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common"
import { FileInterceptor } from "@nestjs/platform-express"
import type {
  AdminAttemptDetail,
  AdminLearnerPage,
  AdminOverview,
  AdminQuestion,
  AdminQuestionPage,
  AdminResultPage,
  AdminTestDetail,
  AdminTestPage,
  TestDocument,
} from "@pp/common"
import { AdminGuard } from "../auth/admin.guard.js"
import { JwksGuard } from "../auth/jwks.guard.js"
import { ProblemExceptionFilter } from "../attempts/problem.filter.js"
import {
  AdminService,
  type ImportResult,
  type MulterFile,
  type PublishResult,
  type UploadMediaResult,
} from "./admin.service.js"
import { MulterPayloadTooLargeFilter } from "./multer-payload-too-large.filter.js"

@Controller("admin")
@UseGuards(JwksGuard, AdminGuard)
@UseFilters(ProblemExceptionFilter)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("overview")
  overview(): Promise<AdminOverview> {
    return this.admin.overview()
  }

  @Get("tests")
  listTests(@Query() query: Record<string, unknown>): Promise<AdminTestPage> {
    return this.admin.listTests(query)
  }

  @Get("tests/:testId")
  testDetail(@Param("testId") testId: string): Promise<AdminTestDetail> {
    return this.admin.testDetail(testId)
  }

  @Get("questions")
  listQuestions(
    @Query() query: Record<string, unknown>,
  ): Promise<AdminQuestionPage> {
    return this.admin.listQuestions(query)
  }

  @Patch("drafts/:versionId/questions/:questionId")
  patchDraftQuestion(
    @Param("versionId") versionId: string,
    @Param("questionId") questionId: string,
    @Body() body: unknown,
    @Req() request: { claims: JwtClaims & { sub: string } },
  ): Promise<AdminQuestion> {
    return this.admin.patchDraftQuestion(
      versionId,
      questionId,
      body,
      request.claims.sub,
    )
  }

  @Get("results")
  listResults(
    @Query() query: Record<string, unknown>,
  ): Promise<AdminResultPage> {
    return this.admin.listResults(query)
  }

  @Get("results/attempts/:id")
  attemptDetail(
    @Param("id") attemptId: string,
    @Req() request: { claims: JwtClaims & { sub: string } },
  ): Promise<AdminAttemptDetail> {
    return this.admin.attemptDetail(attemptId, request.claims.sub)
  }

  @Get("learners")
  listLearners(
    @Query() query: Record<string, unknown>,
  ): Promise<AdminLearnerPage> {
    return this.admin.listLearners(query)
  }

  @Post("tests/import")
  @HttpCode(201)
  import(@Body() body: unknown): Promise<ImportResult> {
    return this.admin.import(body)
  }

  @Post("tests/:testId/publish")
  @HttpCode(200)
  publish(@Param("testId") testId: string): Promise<PublishResult> {
    return this.admin.publish(testId)
  }

  @Get("tests/:testId/export")
  export(
    @Param("testId") testId: string,
    @Query("version") version?: string,
  ): Promise<TestDocument> {
    return this.admin.export(testId, version)
  }
}

/**
 * A separate controller, not another method on `AdminController`: the
 * contract routes this at `/admin/media`, a sibling of `/admin/tests`
 * rather than a path under it. Same guard pair, same `AdminService`.
 */
@Controller("admin/media")
@UseGuards(JwksGuard, AdminGuard)
@UseFilters(ProblemExceptionFilter, MulterPayloadTooLargeFilter)
export class AdminMediaController {
  constructor(private readonly admin: AdminService) {}

  @Post()
  @HttpCode(201)
  @UseInterceptors(FileInterceptor("file"))
  upload(
    @Body("kind") kind: unknown,
    @UploadedFile() file: MulterFile | undefined,
  ): Promise<UploadMediaResult> {
    return this.admin.uploadMedia(kind, file)
  }
}
