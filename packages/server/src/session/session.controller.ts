import type { JwtClaims } from "@liam-workspace/node-auth-server"
import {
  Controller,
  Get,
  NotFoundException,
  Post,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common"
import { CurrentStudent } from "../auth/current-student.decorator.js"
import { JwksGuard } from "../auth/jwks.guard.js"
import {
  SessionService,
  toStudentView,
  type StudentView,
} from "./session.service.js"

/**
 * Structural rather than express's Response: @types/express is not a
 * dependency of this package, and `status` is all this controller needs.
 */
interface StatusSettable {
  status(code: number): unknown
}

@Controller()
@UseGuards(JwksGuard)
export class SessionController {
  constructor(private readonly sessions: SessionService) {}

  /**
   * 201 when this call provisioned the row, 200 when it already existed --
   * the contract distinguishes them so a callback can detect a first
   * sign-in. Both bodies are SessionResult.
   */
  @Post("session")
  async createSession(
    @CurrentStudent() claims: JwtClaims,
    @Res({ passthrough: true }) res: StatusSettable,
  ): Promise<StudentView & { created: boolean }> {
    const { student, created } = await this.sessions.provision(
      claims,
      subjectOf(claims),
    )

    res.status(created ? 201 : 200)

    return { ...toStudentView(student, claims.isAdmin), created }
  }

  @Get("me")
  async me(@CurrentStudent() claims: JwtClaims): Promise<StudentView> {
    const student = await this.sessions.find(subjectOf(claims))

    if (!student) {
      throw new NotFoundException("student_not_provisioned")
    }

    return toStudentView(student, claims.isAdmin)
  }
}

/** JwksGuard rejects a null sub, so this is a belt-and-braces narrowing. */
function subjectOf(claims: JwtClaims): string {
  if (!claims.sub) {
    throw new UnauthorizedException("invalid_token")
  }

  return claims.sub
}
