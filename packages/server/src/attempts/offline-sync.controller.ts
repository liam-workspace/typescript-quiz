import type { JwtClaims } from "@liam-workspace/node-auth-server"
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseFilters,
  UseGuards,
} from "@nestjs/common"
import { CurrentStudent } from "../auth/current-student.decorator.js"
import { JwksGuard } from "../auth/jwks.guard.js"
import type { CapturedRequest } from "../http/raw-body-json.middleware.js"
import { OfflineSyncRequestDto } from "./offline-sync-request.schema.js"
import {
  OfflineSyncService,
  type OfflineSyncResult,
} from "./offline-sync.service.js"
import { ProblemException } from "./problem.exception.js"
import { ProblemExceptionFilter } from "./problem.filter.js"

@Controller("attempts")
@UseGuards(JwksGuard)
@UseFilters(ProblemExceptionFilter)
export class OfflineSyncController {
  constructor(private readonly offlineSync: OfflineSyncService) {}

  /**
   * Replays an offline attempt journal. `200`, not Nest's POST default of
   * `201`: a sync as often acknowledges events already held as it creates
   * anything. One literal segment, so it cannot collide with
   * `POST /attempts/:id/submit` (two segments) or `POST /attempts`.
   */
  @Post("offline-sync")
  @HttpCode(200)
  sync(
    @CurrentStudent() claims: JwtClaims,
    @Body() body: OfflineSyncRequestDto,
    @Req() req: CapturedRequest,
  ): Promise<OfflineSyncResult> {
    // JwksGuard rejects a null sub; this is a belt-and-braces narrowing.
    if (!claims.sub) {
      throw new ProblemException({
        type: "invalid_token",
        title: "Missing, invalid or expired token.",
        status: HttpStatus.UNAUTHORIZED,
      })
    }

    return this.offlineSync.sync(claims.sub, body, req)
  }
}
