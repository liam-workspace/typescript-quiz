import type { PgPool } from "@liam-workspace/node-postgres"
import type { CandidateDetail, GenerationRequest } from "@pp/db/admin"
import request from "supertest"
import type { App } from "supertest/types.js"
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import {
  MATH_WORDING_PROVIDER,
  type MathEnrichmentProvider,
} from "../src/math/math-generation.service.js"
import { REQUEST_POOL } from "../src/database/tokens.js"
import { createTestApp, type TestApp } from "./helpers/app.js"

const base = "/api/admin/math"
const requests = `${base}/generation-requests`
const subject = "math-reviewer"
const payload = {
  templateCode: "fraction-addition-v1",
  count: 1,
  curriculumBrief: {
    level: "primary-step-1",
    objectiveTags: ["fractions:add-like-denominators"],
    language: "en",
    difficulty: "introductory",
    solutionPolicy: "after_test",
  },
}

describe("math generation and review", () => {
  let app: TestApp | undefined = undefined
  const server = () => ready().http.getHttpServer() as App
  let admin = ""
  let learner = ""
  const pool = () => ready().get<PgPool>(REQUEST_POOL)
  let failAudit = false
  beforeAll(async () => {
    app = await createTestApp({
      beforePoolQuery: (sql) => {
        if (failAudit && sql.includes("INSERT INTO admin_audit_log")) {
          throw new Error("Audit storage unavailable")
        }

        return Promise.resolve()
      },
    })
    admin = `Bearer ${await app.mint({ sub: subject, email: "admin@example.org", isAdmin: true })}`
    learner = `Bearer ${await app.mint({ sub: "learner", email: "learner@example.org" })}`
  })
  afterEach(() => {
    failAudit = false
    vi.restoreAllMocks()
  })
  afterAll(async () => {
    await app?.close()
  })

  function ready(): TestApp {
    if (!app) {
      throw new Error("Test app failed to initialize")
    }

    return app
  }

  async function queue(body = payload) {
    const result = await request(server())
      .post(requests)
      .set("Authorization", admin)
      .send(body)
      .expect(202)
    const receipt = result.body as { requestId: string; candidatesUrl: string }
    expect(result.body).toEqual({
      requestId: receipt.requestId,
      candidatesUrl: `${requests}/${receipt.requestId}/candidates`,
      status: "queued",
    })

    return receipt
  }

  function candidates(url: string, count: number) {
    return vi.waitFor(
      async () => {
        const result = await request(server())
          .get(url)
          .set("Authorization", admin)
          .expect(200)
        const rows = result.body as CandidateDetail[]
        expect(rows).toHaveLength(count)

        return rows
      },
      { timeout: 5000 },
    )
  }

  function review(id: string, decision: string, reason?: string) {
    return request(server())
      .patch(`${base}/candidates/${id}/review`)
      .set("Authorization", admin)
      .send({ decision, reason })
  }
  function raw(id: string, bearer = admin) {
    return request(server())
      .get(`${base}/candidates/${id}?includeAudit=true`)
      .set("Authorization", bearer)
  }
  async function audits(id: string) {
    const result = await pool().query<{
      action: string
      admin_subject: string
      metadata: unknown
    }>(
      "SELECT action, admin_subject, metadata FROM admin_audit_log WHERE resource_type='math_candidate' AND resource_id=$1 ORDER BY created_at,id",
      [id],
    )

    return result.rows
  }

  it("guards every generation and review route", async () => {
    const id = "00000000-0000-4000-8000-000000000000"
    await request(server()).post(requests).send(payload).expect(401)
    await request(server())
      .post(requests)
      .set("Authorization", learner)
      .send(payload)
      .expect(403)
    await request(server())
      .get(requests)
      .set("Authorization", learner)
      .expect(403)
    await request(server())
      .get(`${requests}/${id}/candidates`)
      .set("Authorization", learner)
      .expect(403)
    await raw(id, learner).expect(403)
    await request(server())
      .patch(`${base}/candidates/${id}/review`)
      .set("Authorization", learner)
      .send({ decision: "approved" })
      .expect(403)
  })

  it("validates a bounded brief and paginates completed requests", async () => {
    await request(server())
      .post(requests)
      .set("Authorization", admin)
      .send({ ...payload, count: 21 })
      .expect(400)
    await request(server())
      .post(requests)
      .set("Authorization", admin)
      .send({ ...payload, learnerId: subject })
      .expect(400)
    const first = await queue()
    const second = await queue({
      ...payload,
      templateCode: "percentage-of-quantity-v1",
      count: 2,
    })
    const rows = await candidates(second.candidatesUrl, 2)
    for (const row of rows) {
      expect(row.status).toBe("in_review")
      expect(row.validation?.valid).toBe(true)
      expect(row.choices?.filter((choice) => choice.isCorrect)).toHaveLength(1)
    }
    expect(rows[0].promptBlocks).not.toEqual(rows[1].promptBlocks)
    const page = await request(server())
      .get(requests)
      .query({ limit: 1 })
      .set("Authorization", admin)
      .expect(200)
    expect(page.body).toMatchObject({
      items: [{ id: second.requestId, status: "completed" }],
      nextCursor: second.requestId,
    })
    const next = await request(server())
      .get(requests)
      .query({ limit: 1, cursor: second.requestId })
      .set("Authorization", admin)
      .expect(200)
    expect(
      (next.body as { items: GenerationRequest[] }).items.map(
        (item) => item.id,
      ),
    ).toEqual([first.requestId])
    await request(server())
      .get(requests)
      .query({ cursor: "broken" })
      .set("Authorization", admin)
      .expect(400)
  })

  it("returns a receipt while provider I/O holds a committed claim", async () => {
    const adapter = ready().get<MathEnrichmentProvider>(MATH_WORDING_PROVIDER)
    const started = Promise.withResolvers<boolean>()
    const response = Promise.withResolvers<unknown>()
    vi.spyOn(adapter, "enrich").mockImplementationOnce(() => {
      started.resolve(true)

      return response.promise
    })
    const receipt = await queue()
    await started.promise

    try {
      const claimed = await pool().query<{ status: string; leased: boolean }>(
        "SELECT status, claim_token IS NOT NULL AS leased FROM ai_generation_request WHERE id=$1",
        [receipt.requestId],
      )
      expect(claimed.rows).toEqual([{ status: "processing", leased: true }])
      await candidates(receipt.candidatesUrl, 0)
    } finally {
      response.resolve({ prompt: "Add.", explanation: "Add the numerators." })
    }

    const [result] = await candidates(receipt.candidatesUrl, 1)
    expect(result.status).toBe("in_review")
  })

  it("retains an invalid Unicode response alongside its valid sibling", async () => {
    const adapter = ready().get<MathEnrichmentProvider>(MATH_WORDING_PROVIDER)
    const malformed = {
      prompt: `Bad${String.fromCharCode(0)}`,
      explanation: "Add.",
    }
    vi.spyOn(adapter, "enrich").mockResolvedValueOnce(malformed)
    const receipt = await queue({ ...payload, count: 2 })
    const rows = await candidates(receipt.candidatesUrl, 2)
    expect(rows.map((row) => row.status)).toEqual(
      expect.arrayContaining(["in_review", "rejected"]),
    )
    const rejected = rows.find((row) => row.status === "rejected")

    if (!rejected) {
      throw new Error("Missing rejected outcome")
    }

    const detail = await raw(rejected.id).expect(200)
    expect((detail.body as CandidateDetail).audit?.rawResponse).toEqual({
      encoding: "json-text",
      jsonText: JSON.stringify(malformed),
    })
  })

  it("persists malformed provider output and exceptions as rejected candidates", async () => {
    const adapter = ready().get<MathEnrichmentProvider>(MATH_WORDING_PROVIDER)
    vi.spyOn(adapter, "enrich")
      .mockResolvedValueOnce({ prompt: "<unsafe>", isCorrect: true })
      .mockRejectedValueOnce(new Error("private-provider-diagnostic"))
    const receipt = await queue({ ...payload, count: 2 })
    const rows = await candidates(receipt.candidatesUrl, 2)
    expect(rows.map((row) => row.validation?.source)).toEqual(
      expect.arrayContaining(["presentation", "provider"]),
    )
    for (const row of rows) {
      expect(row).toMatchObject({
        status: "rejected",
        promptBlocks: null,
        validation: { valid: false },
      })
      // eslint-disable-next-line no-await-in-loop -- Each invalid outcome must remain terminal.
      await review(row.id, "approved").expect(409)
    }
    expect(JSON.stringify(rows)).not.toContain("private-provider-diagnostic")
    const failed = rows.find((row) => row.validation?.source === "provider")

    if (!failed) {
      throw new Error("Missing provider failure outcome")
    }

    expect((await raw(failed.id).expect(200)).body).toMatchObject({
      audit: { rawResponse: "private-provider-diagnostic" },
    })
  })

  it("audits decisions, returns detail, and prevents subsequent transitions", async () => {
    const receipt = await queue({ ...payload, count: 2 })
    const [a, b] = await candidates(receipt.candidatesUrl, 2)
    await review(a.id, "other").expect(400)
    failAudit = true
    await review(a.id, "approved").expect(500)
    failAudit = false
    const pending = await request(server())
      .get(`${base}/candidates/${a.id}`)
      .set("Authorization", admin)
      .expect(200)
    expect(pending.body).toMatchObject({
      status: "in_review",
      reviewerSubject: null,
    })
    const approved = await review(
      a.id,
      "approved",
      "Verified arithmetic",
    ).expect(200)
    expect(approved.body).toMatchObject({
      status: "approved",
      reviewerSubject: subject,
      canonicalSpec: { family: "fraction_addition" },
      reviewReason: "Verified arithmetic",
    })
    await review(a.id, "rejected").expect(409)
    await review(b.id, "rejected", "Unclear wording").expect(200)
    await review(b.id, "approved").expect(409)
    expect(await audits(a.id)).toEqual([
      {
        action: "math_candidate_reviewed",
        admin_subject: subject,
        metadata: { decision: "approved", reason: "Verified arithmetic" },
      },
    ])
    expect(await audits(b.id)).toHaveLength(1)
  })

  it("rechecks canonical math when a previous validation report says valid", async () => {
    const receipt = await queue()
    const [candidate] = await candidates(receipt.candidatesUrl, 1)
    expect(candidate.validation?.valid).toBe(true)
    await pool().query(
      "UPDATE ai_generation_candidate SET canonical_spec=jsonb_set(canonical_spec,'{answer,numerator}','999') WHERE id=$1",
      [candidate.id],
    )
    await review(candidate.id, "approved").expect(409)
    expect(await audits(candidate.id)).toEqual([])
    await review(candidate.id, "rejected", "Incorrect answer").expect(200)
  })

  it("discloses raw output only after an explicit audited admin read", async () => {
    const receipt = await queue()
    const [row] = await candidates(receipt.candidatesUrl, 1)
    const path = `${base}/candidates/${row.id}`
    expect(row).not.toHaveProperty("audit")
    const detail = await request(server())
      .get(path)
      .set("Authorization", admin)
      .expect(200)
    expect(detail.body).not.toHaveProperty("audit")
    await raw(row.id, learner).expect(403)
    expect(await audits(row.id)).toEqual([])
    failAudit = true
    const denied = await raw(row.id).expect(500)
    expect(denied.body).not.toHaveProperty("audit")
    failAudit = false
    const disclosed = await raw(row.id).expect(200)
    expect(disclosed.headers["cache-control"]).toBe("no-store")
    expect(disclosed.body).toHaveProperty("audit.rawResponse")
    expect(await audits(row.id)).toEqual([
      {
        action: "math_candidate_raw_viewed",
        admin_subject: subject,
        metadata: {},
      },
    ])
  })
})
