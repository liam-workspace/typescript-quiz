import type { JwtClaims } from "@liam-workspace/node-auth-server"
import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Put,
  UseFilters,
  UseGuards,
} from "@nestjs/common"
import { ProblemException } from "../attempts/problem.exception.js"
import { ProblemExceptionFilter } from "../attempts/problem.filter.js"
import { CurrentStudent } from "../auth/current-student.decorator.js"
import { JwksGuard } from "../auth/jwks.guard.js"
import { ReminderSubscriptionDto } from "./reminder.dto.js"
import { RemindersService } from "./reminders.service.js"

/**
 * The body of a PUT here is a credential (the push `auth` secret).
 * FailedWriteCaptureFilter keeps it out of `failed_write` through a ROUTE
 * DENYLIST (`REDACTED_ROUTE`): every future secret-bearing route must be added
 * there too.
 */
@Controller("me/reminders")
@UseGuards(JwksGuard)
@UseFilters(ProblemExceptionFilter)
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Put()
  @HttpCode(HttpStatus.NO_CONTENT)
  async save(
    @CurrentStudent() claims: JwtClaims,
    @Body() body: ReminderSubscriptionDto,
  ): Promise<void> {
    await this.reminders.save(subjectOf(claims), body)
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentStudent() claims: JwtClaims): Promise<void> {
    await this.reminders.remove(subjectOf(claims))
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
