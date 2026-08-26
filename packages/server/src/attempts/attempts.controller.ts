import type { JwtClaims } from "@liam-workspace/node-auth-server"
import {
  Body,
  Controller,
  Post,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common"
import type { StartResult } from "@pp/db"
import { CurrentStudent } from "../auth/current-student.decorator.js"
import { JwksGuard } from "../auth/jwks.guard.js"
import { AttemptsService } from "./attempts.service.js"

/**
 * Structural rather than express's Response: @types/express is not a
 * dependency of this package, and `status` is all this controller needs.
 */
interface StatusSettable {
  status(code: number): unknown
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
  ): Promise<StartResult> {
    const result = await this.attempts.start(subjectOf(claims), slug)

    res.status(201)

    return result
  }
}

/** JwksGuard rejects a null sub, so this is a belt-and-braces narrowing. */
function subjectOf(claims: JwtClaims): string {
  if (!claims.sub) {
    throw new UnauthorizedException("invalid_token")
  }

  return claims.sub
}
