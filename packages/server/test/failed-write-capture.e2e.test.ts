import {
  Body,
  Controller,
  Module,
  Post,
  type INestApplication,
} from "@nestjs/common"
import { Test } from "@nestjs/testing"
import { AllExceptionsFilter } from "@liam-workspace/node-nest-common"
import { z } from "zod"
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest"
import { createFixedClock } from "@pp/common"
import { createRawBodyJsonMiddleware } from "../src/http/raw-body-json.middleware.js"
import { FailedWriteCaptureFilter } from "../src/durability/failed-write-capture.filter.js"
import { ZodBodyValidationPipe } from "../src/validation/zod-body-validation.pipe.js"
import { REQUEST_POOL, CLOCK } from "../src/database/tokens.js"
import { DatabaseModule } from "../src/database/database.module.js"
import { migrateToLatest } from "@pp/db"
import type { PgPool } from "@liam-workspace/node-postgres"

const NOW = new Date("2026-08-27T10:00:00.000Z")
const MAX_BYTES = 64

const ProbeSchema = z.strictObject({ clientInstanceId: z.string().min(1) })

class ProbeDto implements z.infer<typeof ProbeSchema> {
  static readonly schema = ProbeSchema
  declare clientInstanceId: string
}

@Controller("probe")
class ProbeController {
  @Post()
  accept(@Body() body: ProbeDto): { received: string } {
    return { received: body.clientInstanceId }
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

describe("FailedWriteCaptureFilter + ZodBodyValidationPipe", () => {
  let app: INestApplication | undefined = undefined
  let url = ""
  let pool: PgPool | undefined = undefined

  beforeAll(async () => {
    process.env.DATABASE_URL = inject("postgresConnectionUri")
    await migrateToLatest(process.env.DATABASE_URL)

    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, ProbeModule],
    })
      .overrideProvider(CLOCK)
      .useValue(createFixedClock(NOW))
      .compile()

    const nestApp = moduleRef.createNestApplication({ bodyParser: false })
    nestApp.use(createRawBodyJsonMiddleware(MAX_BYTES))
    nestApp.useGlobalPipes(new ZodBodyValidationPipe())
    // FailedWriteCaptureFilter MUST come last: see the verified note on the
    // filter itself for why (Nest reverses the global filter array before
    // matching, so the first-registered filter is evaluated LAST).
    nestApp.useGlobalFilters(
      new AllExceptionsFilter(),
      new FailedWriteCaptureFilter(
        moduleRef.get(REQUEST_POOL),
        moduleRef.get(CLOCK),
      ),
    )
    pool = moduleRef.get(REQUEST_POOL)
    await nestApp.listen(0)
    url = await nestApp.getUrl()
    app = nestApp
  })

  afterAll(async () => {
    await app?.close()
  })

  it("admits a body the schema accepts", async () => {
    const res = await fetch(`${url}/probe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientInstanceId: "c1" }),
    })
    expect(res.status).toBe(201)
  })

  it("captures a schema-rejected body verbatim BEFORE the 400 returns, and names the capture", async () => {
    const badBody = JSON.stringify({})
    const res = await fetch(`${url}/probe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: badBody,
    })

    expect(res.status).toBe(400)
    // PayloadCaptured's contract content-type -- verified against the
    // registration order note above, not merely assumed.
    expect(res.headers.get("content-type")).toMatch(
      /^application\/problem\+json/,
    )
    const problem = (await res.json()) as {
      capturedAs: string
      retryable: boolean
    }
    expect(problem.retryable).toBe(false)
    expect(typeof problem.capturedAs).toBe("string")

    if (!pool) {
      throw new Error("pool not initialized")
    }

    const { rows } = await pool.query<{
      raw_body: string
      received_at: Date
      route: string
    }>("SELECT raw_body, received_at, route FROM failed_write WHERE id = $1", [
      problem.capturedAs,
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].raw_body).toBe(badBody)
    expect(rows[0].received_at).toEqual(NOW)
    expect(rows[0].route).toContain("/probe")
  })

  it("falls back to raw bytes for an oversized body that was never parsed", async () => {
    const oversized = "x".repeat(MAX_BYTES * 4)
    const res = await fetch(`${url}/probe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: oversized,
    })

    expect(res.status).toBe(413)
    expect(res.headers.get("content-type")).toMatch(
      /^application\/problem\+json/,
    )
    const problem = (await res.json()) as { capturedAs: string }

    if (!pool) {
      throw new Error("pool not initialized")
    }

    const { rows } = await pool.query<{ raw_body: string; reason: string }>(
      "SELECT raw_body, reason FROM failed_write WHERE id = $1",
      [problem.capturedAs],
    )
    expect(rows).toHaveLength(1)
    // Truncated to the capture cap, but non-empty -- proof the fallback
    // used the streamed bytes, not `req.body` (which never existed).
    expect(rows[0].raw_body.length).toBeGreaterThan(0)
    expect(rows[0].raw_body.length).toBeLessThanOrEqual(MAX_BYTES)
    expect(rows[0].reason).toBe("payload_too_large")
  })
})
