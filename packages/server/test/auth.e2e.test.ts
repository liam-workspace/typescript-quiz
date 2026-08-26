import {
  Controller,
  Get,
  type INestApplication,
  UseGuards,
} from "@nestjs/common"
import { Test } from "@nestjs/testing"
import {
  createJwksVerifier,
  type JwtClaims,
} from "@liam-workspace/node-auth-server"
import request from "supertest"
import type { App } from "supertest/types.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { AdminGuard } from "../src/auth/admin.guard.js"
import { AuthModule } from "../src/auth/auth.module.js"
import { CurrentStudent } from "../src/auth/current-student.decorator.js"
import { JwksGuard } from "../src/auth/jwks.guard.js"
import { JWKS_VERIFIER } from "../src/auth/tokens.js"
import { createTokenFactory, type TokenFactory } from "./helpers/token.js"

@Controller("auth-probe")
@UseGuards(JwksGuard)
class AuthProbeController {
  @Get()
  getStudent(@CurrentStudent() claims: JwtClaims): { sub: string | null } {
    return { sub: claims.sub }
  }
}

@Controller("admin-probe")
@UseGuards(JwksGuard, AdminGuard)
class AdminProbeController {
  @Get()
  getAdmin() {
    return { ok: true }
  }
}

describe("authentication guards", () => {
  let app: INestApplication | undefined = undefined
  let tokens: TokenFactory | undefined = undefined
  let foreignTokens: TokenFactory | undefined = undefined

  beforeAll(async () => {
    tokens = await createTokenFactory()
    foreignTokens = await createTokenFactory()

    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule],
      controllers: [AuthProbeController, AdminProbeController],
      providers: [JwksGuard, AdminGuard],
    })
      .overrideProvider(JWKS_VERIFIER)
      .useValue(
        createJwksVerifier({
          jwksUrl: "https://auth.test/.well-known/jwks.json",
          fetchFn: tokens.fetchFn,
        }),
      )
      .compile()

    app = moduleRef.createNestApplication()
    await app.init()
  })

  afterAll(async () => {
    await app?.close()
  })

  it("rejects a request with no Authorization header", async () => {
    if (!app) {
      throw new Error("Application failed to initialize")
    }

    await request(app.getHttpServer() as App)
      .get("/auth-probe")
      .expect(401)
  })

  it("rejects a token signed by a different key", async () => {
    if (!app || !foreignTokens) {
      throw new Error("Application failed to initialize")
    }

    const token = await foreignTokens.mint({
      sub: "foreign-student",
      email: "foreign@example.com",
    })

    await request(app.getHttpServer() as App)
      .get("/auth-probe")
      .set("Authorization", `Bearer ${token}`)
      .expect(401)
  })

  it("admits a valid token and exposes its sub", async () => {
    if (!app || !tokens) {
      throw new Error("Application failed to initialize")
    }

    const token = await tokens.mint({
      sub: "student-123",
      email: "student@example.com",
    })

    const response = await request(app.getHttpServer() as App)
      .get("/auth-probe")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)

    expect(response.body).toEqual({ sub: "student-123" })
  })

  it("refuses a non-admin on an admin route", async () => {
    if (!app || !tokens) {
      throw new Error("Application failed to initialize")
    }

    const token = await tokens.mint({
      sub: "student-123",
      email: "student@example.com",
    })

    await request(app.getHttpServer() as App)
      .get("/admin-probe")
      .set("Authorization", `Bearer ${token}`)
      .expect(403)
  })

  it("admits an admin on an admin route", async () => {
    if (!app || !tokens) {
      throw new Error("Application failed to initialize")
    }

    const token = await tokens.mint({
      sub: "admin-123",
      email: "admin@example.com",
      isAdmin: true,
    })

    await request(app.getHttpServer() as App)
      .get("/admin-probe")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
  })
})
