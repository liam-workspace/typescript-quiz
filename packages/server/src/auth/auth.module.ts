import { Global, Module } from "@nestjs/common"
import { createJwksVerifier } from "@liam-workspace/node-auth-server"
import { loadServerConfig } from "../config.js"
import { JWKS_VERIFIER } from "./tokens.js"

@Global()
@Module({
  providers: [
    {
      provide: JWKS_VERIFIER,
      useFactory: () =>
        createJwksVerifier({ jwksUrl: loadServerConfig().jwksUrl }),
    },
  ],
  exports: [JWKS_VERIFIER],
})
export class AuthModule {}
