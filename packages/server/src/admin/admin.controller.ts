import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common"
import type { TestDocument } from "@pp/common"
import { AdminGuard } from "../auth/admin.guard.js"
import { JwksGuard } from "../auth/jwks.guard.js"
import {
  AdminService,
  type ImportResult,
  type PublishResult,
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
