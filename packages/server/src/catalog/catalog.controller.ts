import type { JwtClaims } from "@liam-workspace/node-auth-server"
import {
  Controller,
  Get,
  Param,
  Query,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common"
import type { ListPublishedTestsResult, TestBriefRow } from "@pp/db"
import { CurrentStudent } from "../auth/current-student.decorator.js"
import { JwksGuard } from "../auth/jwks.guard.js"
import { CatalogService } from "./catalog.service.js"

@Controller("tests")
@UseGuards(JwksGuard)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  list(
    @CurrentStudent() claims: JwtClaims,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ): Promise<ListPublishedTestsResult> {
    return this.catalog.list(subjectOf(claims), limit, cursor ?? null)
  }

  @Get(":slug")
  getBrief(
    @CurrentStudent() claims: JwtClaims,
    @Param("slug") slug: string,
  ): Promise<TestBriefRow> {
    return this.catalog.getBrief(subjectOf(claims), slug)
  }
}

/** JwksGuard rejects a null sub, so this is a belt-and-braces narrowing. */
function subjectOf(claims: JwtClaims): string {
  if (!claims.sub) {
    throw new UnauthorizedException("invalid_token")
  }

  return claims.sub
}
