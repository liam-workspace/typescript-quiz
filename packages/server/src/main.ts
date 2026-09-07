import "reflect-metadata"
import { existsSync } from "node:fs"
import { AllExceptionsFilter } from "@liam-public/node-nest-common"
import { waitForDatabase } from "@liam-public/node-postgres"
import type { ExceptionFilter } from "@nestjs/common"
import { NestFactory } from "@nestjs/core"
import { migrateToLatest } from "@pp/db"
import express, { type Express } from "express"
import { AppModule } from "./app.module.js"
import { loadServerConfig } from "./config.js"
import { CLOCK, REQUEST_POOL } from "./database/tokens.js"
import { FailedWriteCaptureFilter } from "./durability/failed-write-capture.filter.js"
import { createRawBodyJsonMiddleware } from "./http/raw-body-json.middleware.js"
import { SpaFallbackFilter } from "./spa/spa-fallback.filter.js"
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

  const { spaRoot } = config

  // Real static files (JS/CSS chunks etc.) only -- `index: false` so this
  // never auto-serves index.html for `/`; that's SpaFallbackFilter's job
  // below. Safe to mount this early: it only responds when a request path
  // matches an actual file on disk and calls `next()` otherwise, so it never
  // competes with any `/api` or `/health` route Nest registers later.
  if (spaRoot && existsSync(spaRoot)) {
    const server = app.getHttpAdapter().getInstance() as Express
    server.use(express.static(spaRoot, { index: false }))
  }

  // The contract (openapi.yaml) declares `servers: [{ url: /api }]`, so every operation in
  // the contract lives under /api. /health is excluded: it is the container
  // healthcheck's target and is not part of the published contract.
  app.setGlobalPrefix("api", { exclude: ["health"] })
  app.useGlobalPipes(new ZodBodyValidationPipe())
  // Registration order for these three matters, and it is NOT the order you'd
  // guess from reading top to bottom: `@nestjs/core`'s
  // RouterExceptionFilters reverses the globally-registered filter array
  // before selecting a match, so the filter that must win an exception it
  // declares goes LAST, not first. AllExceptionsFilter's `@Catch()` is
  // unconditional (catches everything), so it must be registered FIRST --
  // checked last -- or it would win every exception before the two filters
  // below ever get a look. SpaFallbackFilter and FailedWriteCaptureFilter
  // both declare narrow `@Catch()` lists that don't overlap, so their order
  // relative to each other doesn't matter; see the verified note on
  // FailedWriteCaptureFilter, and SpaFallbackFilter's own note on why it has
  // to be a filter at all rather than Express middleware.
  const filters: ExceptionFilter[] = [new AllExceptionsFilter()]

  if (spaRoot && existsSync(spaRoot)) {
    filters.push(new SpaFallbackFilter(spaRoot))
  }

  filters.push(
    new FailedWriteCaptureFilter(app.get(REQUEST_POOL), app.get(CLOCK)),
  )
  app.useGlobalFilters(...filters)

  await app.listen(config.port)
}

await bootstrap()
