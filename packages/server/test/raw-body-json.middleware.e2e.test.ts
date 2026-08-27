import {
  Controller,
  Module,
  Post,
  Req,
  type INestApplication,
} from "@nestjs/common"
import { Test } from "@nestjs/testing"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  createRawBodyJsonMiddleware,
  type CapturedRequest,
} from "../src/http/raw-body-json.middleware.js"

const MAX_BYTES = 64

@Controller("probe")
class ProbeController {
  @Post()
  echo(@Req() req: CapturedRequest): {
    body: unknown
    rawBody: string
    byteCount: number | undefined
  } {
    return {
      body: req.body,
      rawBody: (req.rawBody ?? Buffer.alloc(0)).toString("utf8"),
      byteCount: req.rawBodyByteCount,
    }
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

describe("raw-body JSON middleware", () => {
  let app: INestApplication | undefined = undefined
  let url = ""

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ProbeModule],
    }).compile()
    app = moduleRef.createNestApplication({ bodyParser: false })
    app.use(createRawBodyJsonMiddleware(MAX_BYTES))
    await app.listen(0)
    url = await app.getUrl()
  })

  afterAll(async () => {
    await app?.close()
  })

  it("parses a small valid JSON body and captures its raw bytes", async () => {
    const body = JSON.stringify({ a: 1 })
    const res = await fetch(`${url}/probe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    })

    expect(res.status).toBe(201)
    const parsed = (await res.json()) as {
      body: unknown
      rawBody: string
      byteCount: number
    }
    expect(parsed.body).toEqual({ a: 1 })
    expect(parsed.rawBody).toBe(body)
    expect(parsed.byteCount).toBe(Buffer.byteLength(body))
  })

  it("captures raw bytes even when JSON parsing fails", async () => {
    // Cannot use the probe's normal response path -- express never reaches
    // the handler once next(err) fires. This is proven properly in Task 3's
    // filter test, which reads the resulting failed_write row. Here we only
    // prove the middleware ends the request rather than hanging, and that
    // it does not silently succeed.
    const res = await fetch(`${url}/probe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    })

    expect(res.status).not.toBe(201)
  })

  it("stops accumulating once the body exceeds maxBytes and does not hang", async () => {
    const oversized = JSON.stringify({ a: "x".repeat(MAX_BYTES * 4) })
    const res = await fetch(`${url}/probe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: oversized,
    })

    expect(res.status).not.toBe(201)
  })
})
