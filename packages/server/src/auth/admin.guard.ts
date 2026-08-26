import type { JwtClaims } from "@liam-workspace/node-auth-server"
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common"

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ claims?: JwtClaims }>()

    if (!req.claims?.isAdmin) {
      throw new ForbiddenException("admin_required")
    }

    return true
  }
}
