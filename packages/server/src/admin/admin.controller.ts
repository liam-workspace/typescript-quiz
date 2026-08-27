import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common"
import { FileInterceptor } from "@nestjs/platform-express"
import type { TestDocument } from "@pp/common"
import { AdminGuard } from "../auth/admin.guard.js"
import { JwksGuard } from "../auth/jwks.guard.js"
import {
  AdminService,
  type ImportResult,
  type MulterFile,
  type PublishResult,
  type UploadMediaResult,
} from "./admin.service.js"

@Controller("admin/tests")
@UseGuards(JwksGuard, AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Post("import")
  @HttpCode(201)
  import(@Body() body: unknown): Promise<ImportResult> {
    return this.admin.import(body)
  }

  @Post(":testId/publish")
  @HttpCode(200)
  publish(@Param("testId") testId: string): Promise<PublishResult> {
    return this.admin.publish(testId)
  }

  @Get(":testId/export")
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
