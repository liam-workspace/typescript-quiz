import type { INestApplication } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import { AllExceptionsFilter } from "@liam-public/node-nest-common"
import { createJwksVerifier } from "@liam-workspace/node-auth-server"
import { createFixedClock } from "@pp/common"
import { migrateToLatest } from "@pp/db"
import { inject } from "vitest"
import { AppModule } from "../../src/app.module.js"
import { JWKS_VERIFIER } from "../../src/auth/tokens.js"
import { CLOCK, REQUEST_POOL } from "../../src/database/tokens.js"
import { FailedWriteCaptureFilter } from "../../src/durability/failed-write-capture.filter.js"
import { createRawBodyJsonMiddleware } from "../../src/http/raw-body-json.middleware.js"
import { ZodBodyValidationPipe } from "../../src/validation/zod-body-validation.pipe.js"
import { createTokenFactory } from "./token.js"

const JWKS_URL = "https://auth.test/.well-known/jwks.json"

/**
 * Every route from Task 6 onward sits behind JwksGuard, and AppModule builds
 * a real verifier from loadServerConfig().jwksUrl. So the harness mints its
 * own RS256 keypair, serves the matching JWKS through the verifier's
 * injectable fetchFn, and hands tests `mint` to get a bearer for a subject.
 * No network, and the signature check is the real one.
 */
export interface TestApp {
  readonly http: INestApplication
  get: INestApplication["get"]
  mint(claims: {
    sub: string
    email: string
    isAdmin?: boolean
  }): Promise<string>
  close(): Promise<void>
}

export async function createTestApp(
  options: { now?: Date; allowedEmails?: string } = {},
): Promise<TestApp> {
  process.env.DATABASE_URL = inject("postgresConnectionUri")
  process.env.JWKS_URL = JWKS_URL
  // `isEmailAllowed` rejects everything when the allowlist is empty, which is
  // the right production default but would 403 every test.
  process.env.ALLOWED_EMAILS = options.allowedEmails ?? "*@example.com"
  // `required(env, "MEDIA_SIGNING_SECRET")` has no default -- every test from
  // here on fails to boot without this set before AppModule compiles.
  process.env.MEDIA_SIGNING_SECRET = "test-media-signing-secret"

  await migrateToLatest(process.env.DATABASE_URL)

  const tokens = await createTokenFactory()
  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(JWKS_VERIFIER)
    .useValue(
      createJwksVerifier({ jwksUrl: JWKS_URL, fetchFn: tokens.fetchFn }),
    )

  if (options.now) {
    builder.overrideProvider(CLOCK).useValue(createFixedClock(options.now))
  }

  const moduleRef = await builder.compile()
  const http = moduleRef.createNestApplication({ bodyParser: false })
  // Mirror main.ts: without this, e2e tests exercise a different body
  // pipeline than production, and any assertion on rawBody/failed_write
  // capture would be fiction.
  http.use(createRawBodyJsonMiddleware(262_144))
  // Mirror main.ts. Without this the suite would assert paths production
  // never serves -- the tests would agree with the code and both would
  // disagree with the contract.
  http.setGlobalPrefix("api", { exclude: ["health"] })
  // Mirror main.ts: without this, tests exercise a different validation
  // pipeline than production and would never see the pipe reject anything.
  http.useGlobalPipes(new ZodBodyValidationPipe())
  // Mirror main.ts: without this, tests exercise a different error pipeline
  // than production and any assertion on an error body would be fiction.
  // FailedWriteCaptureFilter MUST come last -- see the verified note on the
  // filter itself for why (Nest reverses the global filter array before
  // matching).
  http.useGlobalFilters(
    new AllExceptionsFilter(),
    new FailedWriteCaptureFilter(
      moduleRef.get(REQUEST_POOL),
      moduleRef.get(CLOCK),
    ),
  )
  await http.init()

  return {
    http,
    get: http.get.bind(http),
    mint: (claims) => tokens.mint(claims),
    close: () => http.close(),
  }
}
