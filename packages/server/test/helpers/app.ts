import type { INestApplication } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import { createFixedClock } from "@pp/common"
import { migrateToLatest } from "@pp/db"
import { inject } from "vitest"
import { AppModule } from "../../src/app.module.js"
import { CLOCK } from "../../src/database/tokens.js"

export interface TestApp {
  readonly http: INestApplication
  get: INestApplication["get"]
  close(): Promise<void>
}

export async function createTestApp(
  options: { now?: Date } = {},
): Promise<TestApp> {
  process.env.DATABASE_URL = inject("postgresConnectionUri")
  process.env.JWKS_URL = "http://127.0.0.1:0/.well-known/jwks.json"

  await migrateToLatest(process.env.DATABASE_URL)

  const builder = Test.createTestingModule({ imports: [AppModule] })

  if (options.now) {
    builder.overrideProvider(CLOCK).useValue(createFixedClock(options.now))
  }

  const moduleRef = await builder.compile()
  const http = moduleRef.createNestApplication()
  await http.init()

  return {
    http,
    get: http.get.bind(http),
    close: () => http.close(),
  }
}
