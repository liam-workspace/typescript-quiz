import { Test } from "@nestjs/testing"
import type { INestApplication } from "@nestjs/common"
import request from "supertest"
import type { App } from "supertest/types.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { HealthModule } from "../src/health/health.module.js"

describe("GET /health", () => {
  let app: INestApplication | undefined = undefined

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [HealthModule],
    }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
  })

  afterAll(async () => {
    await app?.close()
  })

  it("reports ok", async () => {
    if (!app) {
      throw new Error("Application failed to initialize")
    }

    const res = await request(app.getHttpServer() as App)
      .get("/health")
      .expect(200)
    expect(res.body).toEqual({ status: "ok" })
  })
})
