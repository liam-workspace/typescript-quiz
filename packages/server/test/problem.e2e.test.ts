import {
  Controller,
  Get,
  Module,
  NotFoundException,
  UseFilters,
  type INestApplication,
} from "@nestjs/common"
import { Test } from "@nestjs/testing"
import { AllExceptionsFilter } from "@liam-workspace/node-nest-common"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { ProblemException } from "../src/attempts/problem.exception.js"
import { ProblemExceptionFilter } from "../src/attempts/problem.filter.js"

/**
 * Mirrors failed-write-capture.e2e.test.ts's pattern: a throwaway probe
 * module, no DB, no AppModule -- this only needs to prove the filter's
 * wire behaviour, not any real route.
 */
@Controller("problem-probe")
@UseFilters(ProblemExceptionFilter)
class ProblemProbeController {
  @Get("attempt-expired")
  attemptExpired(): never {
    throw new ProblemException({
      type: "attempt_expired",
      title: "The attempt was past its deadline and has been finalized.",
      status: 410,
      retryable: false,
      attempt: {
        id: "attempt-1",
        status: "expired",
        submittedAt: "2026-08-27T10:00:00.000Z",
        resultUrl: "/attempts/attempt-1/result",
      },
    })
  }

  @Get("captured")
  captured(): never {
    throw new ProblemException({
      type: "payload_too_large",
      title: "Payload too large",
      status: 413,
      retryable: false,
      capturedAs: "failed-write-1",
    })
  }
}

/** No @UseFilters here at all -- proves the filter is controller-scoped. */
@Controller("plain-probe")
class PlainProbeController {
  @Get("not-found")
  notFound(): never {
    throw new NotFoundException("x")
  }
}

@Module({ controllers: [ProblemProbeController, PlainProbeController] })
class ProblemProbeModule {}

describe("ProblemExceptionFilter", () => {
  let app: INestApplication | undefined = undefined
  let url = ""

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ProblemProbeModule],
    }).compile()

    const nestApp = moduleRef.createNestApplication()
    // Mirrors main.ts's global registration -- the negative test needs the
    // REAL AllExceptionsFilter shape, not Nest's own bare default.
    nestApp.useGlobalFilters(new AllExceptionsFilter())
    await nestApp.listen(0)
    url = await nestApp.getUrl()
    app = nestApp
  })

  afterAll(async () => {
    await app?.close()
  })

  it("renders a ProblemException as application/problem+json with the exact body given", async () => {
    const res = await fetch(`${url}/problem-probe/captured`)

    expect(res.headers.get("content-type")).toMatch(
      /^application\/problem\+json/,
    )
    const body = (await res.json()) as Record<string, unknown>

    expect(body).toStrictEqual({
      type: "payload_too_large",
      title: "Payload too large",
      status: 413,
      retryable: false,
      capturedAs: "failed-write-1",
    })
    // No AllExceptionsFilter leftovers -- this is the wire body, verbatim.
    expect(body).not.toHaveProperty("error")
    expect(body).not.toHaveProperty("message")
    expect(body).not.toHaveProperty("statusCode")
  })

  it("carries extra Problem fields (attempt, capturedAs) through untouched", async () => {
    const res = await fetch(`${url}/problem-probe/attempt-expired`)

    expect(res.status).toBe(410)
    expect(res.headers.get("content-type")).toMatch(
      /^application\/problem\+json/,
    )
    const body = (await res.json()) as {
      type: string
      status: number
      attempt: {
        id: string
        status: string
        submittedAt: string
        resultUrl: string
      }
    }

    expect(body.type).toBe("attempt_expired")
    expect(body.status).toBe(410)
    expect(body.attempt).toStrictEqual({
      id: "attempt-1",
      status: "expired",
      submittedAt: "2026-08-27T10:00:00.000Z",
      resultUrl: "/attempts/attempt-1/result",
    })
  })

  it("leaves an ordinary HttpException on AllExceptionsFilter's shape, unaffected", async () => {
    const res = await fetch(`${url}/plain-probe/not-found`)

    expect(res.status).toBe(404)
    // AllExceptionsFilter's own content-type, NOT problem+json: proves
    // ProblemExceptionFilter never touched this route because it was never
    // attached to it -- the filter is controller-scoped, not global.
    expect(res.headers.get("content-type")).toMatch(/^application\/json/)
    const body = (await res.json()) as {
      statusCode: number
      message: string
      error: string
    }

    // The OLD shape -- proof of no regression on a route this filter does
    // not own.
    expect(body.statusCode).toBe(404)
    expect(body.message).toBe("x")
    expect(body.error).toBe("Not Found")
  })
})
