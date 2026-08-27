import "reflect-metadata"
import { AllExceptionsFilter } from "@liam-public/node-nest-common"
import { waitForDatabase } from "@liam-public/node-postgres"
import { NestFactory } from "@nestjs/core"
import { migrateToLatest } from "@pp/db"
import { AppModule } from "./app.module.js"
import { loadServerConfig } from "./config.js"
import { CLOCK, REQUEST_POOL } from "./database/tokens.js"
import { FailedWriteCaptureFilter } from "./durability/failed-write-capture.filter.js"
import { createRawBodyJsonMiddleware } from "./http/raw-body-json.middleware.js"
import { ZodBodyValidationPipe } from "./validation/zod-body-validation.pipe.js"

async function bootstrap(): Promise<void> {
  const config = loadServerConfig()
  await waitForDatabase(config.databaseUrl, { retries: 30, delayMs: 1000 })
  await migrateToLatest(config.databaseUrl)

  // `bodyParser: false` + the middleware below replaces Nest's default body
  // parser app-wide, so raw bytes are captured before any size check or
  // JSON.parse can reject a request -- see raw-body-json.middleware.ts.
  const app = await NestFactory.create(AppModule, { bodyParser: false })
  app.use(createRawBodyJsonMiddleware(config.requestBodyMaxBytes))
  // The contract (openapi.yaml) declares `servers: [{ url: /api }]`, so every operation in
  // the contract lives under /api. /health is excluded: it is the container
  // healthcheck's target and is not part of the published contract.
  app.setGlobalPrefix("api", { exclude: ["health"] })
  app.useGlobalPipes(new ZodBodyValidationPipe())
  // FailedWriteCaptureFilter MUST be registered last: Nest's
  // RouterExceptionFilters reverses the globally-registered filter array
  // before selecting a match, so the filter that must win an exception it
  // declares goes last, not first -- see the verified note on
  // FailedWriteCaptureFilter itself.
  app.useGlobalFilters(
    new AllExceptionsFilter(),
    new FailedWriteCaptureFilter(app.get(REQUEST_POOL), app.get(CLOCK)),
  )
  await app.listen(config.port)
}

await bootstrap()
