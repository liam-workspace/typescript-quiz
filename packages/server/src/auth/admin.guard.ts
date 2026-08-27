import type { JwtClaims } from "@liam-workspace/node-auth-server"
import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
} from "@nestjs/common"
import { ProblemException } from "../attempts/problem.exception.js"

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ claims?: JwtClaims }>()

    if (!req.claims?.isAdmin) {
      throw new ProblemException({
        type: "admin_required",
        title: "The token carries no admin role claim.",
        status: HttpStatus.FORBIDDEN,
      })
    }

    return true
  }
}
