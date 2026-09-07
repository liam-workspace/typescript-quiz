import request from "supertest"
import type { App } from "supertest/types.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createTestApp, type TestApp } from "./helpers/app.js"

interface SessionBody {
  id: string
  displayName: string
  email: string
  level: string | null
  isAdmin: boolean
  created?: boolean
  pictureUrl?: string
}

function body(res: { body: unknown }): SessionBody {
  return res.body as SessionBody
}

const SUB = "google-oauth2|session-test"
const EMAIL = "tom@example.com"

describe("POST /session and GET /me", () => {
  let app: TestApp | undefined = undefined

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app?.close()
  })

  function ready(): TestApp {
    if (!app) {
      throw new Error("Application failed to initialize")
    }

    return app
  }

  it("POST /session provisions on first call with created: true", async () => {
    const a = ready()
    const token = await a.mint({ sub: SUB, email: EMAIL })

    const res = await request(a.http.getHttpServer() as App)
      .post("/api/session")
      .set("Authorization", `Bearer ${token}`)
      .expect(201)

    expect(body(res).created).toBe(true)
    expect(body(res).email).toBe(EMAIL)
    expect(body(res).isAdmin).toBe(false)
    expect(body(res).id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it("POST /session is idempotent and returns created: false", async () => {
    const a = ready()
    const token = await a.mint({ sub: `${SUB}-idem`, email: EMAIL })

    const first = await request(a.http.getHttpServer() as App)
      .post("/api/session")
      .set("Authorization", `Bearer ${token}`)
      .expect(201)

    // The contract distinguishes these: 201 provisions, 200 recognises.
    const second = await request(a.http.getHttpServer() as App)
      .post("/api/session")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)

    expect(body(first).created).toBe(true)
    expect(body(second).created).toBe(false)
    expect(body(second).id).toBe(body(first).id)
  })

  it("POST /session refuses a token with no grant for the required role", async () => {
    const a = ready()
    const token = await a.mint({
      sub: `${SUB}-outsider`,
      email: "stranger@elsewhere.org",
      rolesByApp: {},
    })

    await request(a.http.getHttpServer() as App)
      .post("/api/session")
      .set("Authorization", `Bearer ${token}`)
      .expect(403)
  })

  it("GET /me returns the profile and no `created` key", async () => {
    const a = ready()
    const token = await a.mint({ sub: `${SUB}-me`, email: EMAIL })

    await request(a.http.getHttpServer() as App)
      .post("/api/session")
      .set("Authorization", `Bearer ${token}`)
      .expect(201)

    const res = await request(a.http.getHttpServer() as App)
      .get("/api/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)

    expect(body(res).email).toBe(EMAIL)
    // Student is additionalProperties: false, and neither field is in it.
    expect(body(res)).not.toHaveProperty("created")
    expect(body(res)).not.toHaveProperty("pictureUrl")
  })

  it("GET /me is 404 for a valid token that never called POST /session", async () => {
    const a = ready()
    const token = await a.mint({ sub: `${SUB}-unprovisioned`, email: EMAIL })

    await request(a.http.getHttpServer() as App)
      .get("/api/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(404)
  })

  it("reports isAdmin from the token, not the database", async () => {
    const a = ready()
    // Same subject provisioned twice: first as a plain student, then with an
    // admin token. There is no admin column -- isAdmin must follow the token
    // presented on THIS request, so granting or revoking the role at the
    // identity provider takes effect immediately rather than after a sync.
    const sub = `${SUB}-admin`
    const plain = await a.mint({ sub, email: EMAIL })
    const admin = await a.mint({ sub, email: EMAIL, isAdmin: true })

    const first = await request(a.http.getHttpServer() as App)
      .post("/api/session")
      .set("Authorization", `Bearer ${plain}`)
      .expect(201)
    expect(body(first).isAdmin).toBe(false)

    const elevated = await request(a.http.getHttpServer() as App)
      .get("/api/me")
      .set("Authorization", `Bearer ${admin}`)
      .expect(200)
    expect(body(elevated).isAdmin).toBe(true)
    expect(body(elevated).id).toBe(body(first).id)
  })

  it("GET /me without a token is 401", async () => {
    const a = ready()

    await request(a.http.getHttpServer() as App)
      .get("/api/me")
      .expect(401)
  })
})
