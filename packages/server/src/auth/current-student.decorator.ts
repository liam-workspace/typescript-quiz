import type { JwtClaims } from "@liam-workspace/node-auth-server"
import { createParamDecorator, type ExecutionContext } from "@nestjs/common"

export const CurrentStudent = createParamDecorator(
  (_data: unknown, context: ExecutionContext): JwtClaims =>
    context.switchToHttp().getRequest<{ claims: JwtClaims }>().claims,
)
