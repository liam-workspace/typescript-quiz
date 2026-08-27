import type { JwksVerifier, JwtClaims } from "@liam-workspace/node-auth-server"
import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from "@nestjs/common"
import { ProblemException } from "../attempts/problem.exception.js"
import { JWKS_VERIFIER } from "./tokens.js"

/**
 * Every controller this guard is attached to also mounts
 * `ProblemExceptionFilter`, so a single conversion here covers every route's
 * 401 -- see the repo-wide note on `ProblemException` itself.
 */
function invalidTokenError(): ProblemException {
  return new ProblemException({
    type: "invalid_token",
    title: "Missing, invalid or expired token.",
    status: HttpStatus.UNAUTHORIZED,
  })
}

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
      throw invalidTokenError()
    }

    if (!claims.sub) {
      throw invalidTokenError()
    }

    req.claims = claims

    return true
  }
}
