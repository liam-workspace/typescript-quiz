import type { JwtClaims } from "@liam-workspace/node-auth-server"
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from "@nestjs/common"
import { ProblemExceptionFilter } from "../attempts/problem.filter.js"
import { AdminGuard } from "../auth/admin.guard.js"
import { JwksGuard } from "../auth/jwks.guard.js"
import { MathGenerationService } from "./math-generation.service.js"

interface AdminRequest {
  claims: JwtClaims & { sub: string }
}

@Controller("admin/math")
@UseGuards(JwksGuard, AdminGuard)
@UseFilters(ProblemExceptionFilter)
export class MathGenerationController {
  constructor(
    @Inject(MathGenerationService)
    private readonly generation: MathGenerationService,
  ) {}

  @Post("generation-requests")
  @HttpCode(202)
  create(@Body() body: unknown, @Req() request: AdminRequest) {
    return this.generation.createRequest(body, request.claims.sub)
  }

  @Get("generation-requests")
  requests(@Query() query: Record<string, unknown>) {
    return this.generation.requests(query)
  }

  @Get("generation-requests/:id/candidates")
  candidates(@Param("id") id: string) {
    return this.generation.candidates(id)
  }

  @Get("candidates/:id")
  @Header("Cache-Control", "no-store")
  detail(
    @Param("id") id: string,
    @Query() query: Record<string, unknown>,
    @Req() request: AdminRequest,
  ) {
    return this.generation.detail(id, query, request.claims.sub)
  }

  @Patch("candidates/:id/review")
  review(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AdminRequest,
  ) {
    return this.generation.review(id, body, request.claims.sub)
  }
}
