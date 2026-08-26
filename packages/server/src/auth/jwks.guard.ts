import type { JwksVerifier, JwtClaims } from "@liam-workspace/node-auth-server"
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common"
import { JWKS_VERIFIER } from "./tokens.js"

@Injectable()
export class JwksGuard implements CanActivate {
  constructor(@Inject(JWKS_VERIFIER) private readonly verifier: JwksVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>
      claims?: JwtClaims
    }>()

    let claims: JwtClaims | undefined = undefined

    try {
      claims = await this.verifier.verify(req.headers.authorization)
    } catch {
      throw new UnauthorizedException("invalid_token")
    }

    if (!claims.sub) {
      throw new UnauthorizedException("invalid_token")
    }

    req.claims = claims

    return true
  }
}
