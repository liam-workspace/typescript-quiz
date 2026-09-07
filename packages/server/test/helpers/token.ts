import { exportJWK, generateKeyPair, SignJWT } from "jose"

/**
 * Mirrors config.ts's `loadServerConfig()` defaults (`accessAppId:
 * "quiz-web"`, `accessRole: "student"`) so a `mint()` call with no
 * `rolesByApp` override carries the grant every e2e test needs to get past
 * sign-in, exactly as the live issuer grants it today.
 */
const DEFAULT_ROLES_BY_APP: Record<string, string[]> = {
  "quiz-web": ["student"],
}

export interface TokenFactory {
  readonly fetchFn: typeof fetch
  mint(claims: {
    sub: string
    email: string
    isAdmin?: boolean
    /**
     * Issuer `roles` claim as the app actually receives it: a map keyed by
     * client_id (parsed into `claims.rolesByApp`, never the flat
     * `claims.roles` array -- see session.service.ts's `authorizedEmail`).
     * Defaults to the grant every e2e test needs to get past sign-in;
     * override with `{}` (or an app id / role that isn't `quiz-web:
     * ["student"]`) to exercise the refusal path.
     */
    rolesByApp?: Record<string, string[]>
  }): Promise<string>
}

export async function createTokenFactory(): Promise<TokenFactory> {
  const { publicKey, privateKey } = await generateKeyPair("RS256", {
    extractable: true,
  })
  const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256" }

  const fetchFn = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ keys: [jwk] }), {
        headers: { "content-type": "application/json" },
      }),
    )) as unknown as typeof fetch

  return {
    fetchFn,
    mint({ sub, email, isAdmin = false, rolesByApp = DEFAULT_ROLES_BY_APP }) {
      // `roles` carries the app-scoped map (-> `claims.rolesByApp`), so
      // `isAdmin` is signalled through the separate top-level `isAdmin`
      // claim node-auth-server's parser also honours
      // (`payload.isAdmin === true`) -- the same claim can't be both an
      // array (-> `claims.roles`) and a map (-> `claims.rolesByApp`) at
      // once.
      return new SignJWT({ email, roles: rolesByApp, isAdmin })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setSubject(sub)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey)
    },
  }
}
