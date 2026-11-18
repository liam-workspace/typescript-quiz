import {
  withTransaction,
  type PgQueryable,
} from "@liam-workspace/node-postgres"
import type { MathProblemSpec } from "@pp/common"
import { expect, it } from "vitest"
import {
  claimQueuedGenerationRequest,
  createGenerationRequest,
  insertGenerationCandidate,
  listCandidates,
  listGenerationRequests,
  loadCandidateDetail,
  reviewCandidate,
} from "../src/admin.js"
import { withDatabase } from "./helpers/database.js"

const request = {
  parameters: { count: 1 },
  provider: "test",
  model: "math",
  promptTemplateVersion: "v1",
  seed: "sample",
}
const spec: MathProblemSpec = {
  family: "ratio",
  expression: {
    kind: "divide",
    left: { kind: "integer", value: 6 },
    right: { kind: "integer", value: 8 },
  },
  answer: { kind: "rational", numerator: 3, denominator: 4 },
  seed: "sample",
  constraints: { min: 0, max: 10, nonNegative: true },
  variables: {},
}

it("skips a locked request, completes the next batch once, and lists both pages", async () => {
  await withDatabase(async (pool) => {
    const first = await createGenerationRequest(pool, request)
    const second = await createGenerationRequest(pool, request)
    const locker = await pool.connect()

    try {
      await locker.query("BEGIN")
      await locker.query(
        "SELECT id FROM ai_generation_request WHERE id=$1 FOR UPDATE",
        [first.id],
      )
      const claimed = await claimQueuedGenerationRequest(pool, (job) => {
        expect(job).toMatchObject({ id: second.id, ...request })

        return Promise.resolve([{ canonicalSpec: spec }])
      })
      expect(claimed?.id).toBe(second.id)
      expect(
        await claimQueuedGenerationRequest(pool, () =>
          Promise.resolve([{ canonicalSpec: spec }]),
        ),
      ).toBeNull()
    } finally {
      await locker.query("ROLLBACK")
      locker.release()
    }

    const page = await listGenerationRequests(pool, {
      limit: 1,
      cursor: null,
    })
    expect(page.items).toMatchObject([{ id: second.id, status: "completed" }])
    const next = await listGenerationRequests(pool, {
      limit: 1,
      cursor: page.nextCursor,
    })
    expect(next.items).toMatchObject([{ id: first.id, status: "queued" }])
    expect(next.nextCursor).toBeNull()
    expect(await listCandidates(pool, first.id)).toEqual([])
  })
})

it("rolls back partial batches and releases the request for another worker", async () => {
  await withDatabase(async (pool) => {
    const job = await createGenerationRequest(pool, request)
    await expect(
      claimQueuedGenerationRequest(pool, () =>
        Promise.resolve([{ canonicalSpec: spec }, { canonicalSpec: spec }]),
      ),
    ).rejects.toMatchObject({ code: "23505" })
    expect(await listCandidates(pool, job.id)).toEqual([])
    const claimed = await claimQueuedGenerationRequest(pool, () =>
      Promise.resolve([{ canonicalSpec: spec }]),
    )
    expect(claimed?.id).toBe(job.id)
  })
})

it("persists provider failures with audit-only raw output and bars approval", async () => {
  await withDatabase(async (pool) => {
    const job = await createGenerationRequest(pool, request)
    const rawResponse = { internal: "audit-only-marker" }
    await claimQueuedGenerationRequest(pool, () =>
      Promise.resolve([{ providerFailure: "timeout", rawResponse }]),
    )
    const summaries = await listCandidates(pool, job.id)
    expect(summaries).toMatchObject([
      {
        status: "rejected",
        validation: { valid: false, errors: ["timeout"] },
      },
    ])
    expect(JSON.stringify(summaries)).not.toContain("audit-only-marker")
    expect(JSON.stringify(await listGenerationRequests(pool))).not.toContain(
      "audit-only-marker",
    )
    const detail = await loadCandidateDetail(pool, summaries[0].id)
    expect(detail).toMatchObject({
      canonicalSpec: null,
      validation: { source: "provider" },
      requestId: job.id,
    })
    expect(JSON.stringify(detail)).not.toContain("audit-only-marker")
    const audit = await loadCandidateDetail(pool, summaries[0].id, {
      includeAudit: true,
    })
    expect(audit?.audit).toEqual({ rawResponse })
    await expect(
      reviewCandidate(pool, {
        candidateId: summaries[0].id,
        reviewerSubject: "admin",
        decision: "approved",
      }),
    ).rejects.toThrow()
  })
})

it("requires a passing deterministic report even for an in-review row", async () => {
  await withDatabase(async (pool) => {
    const job = await createGenerationRequest(pool, request)
    const invalid = await insertGenerationCandidate(pool, {
      requestId: job.id,
      canonicalSpec: {
        ...spec,
        answer: { kind: "integer", numerator: 1, denominator: 1 },
      },
    })
    expect(invalid).toMatchObject({
      status: "rejected",
      validation: { valid: false, source: "math" },
    })
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO ai_generation_candidate(request_id, canonical_spec, content_hash) VALUES ($1, $2, 'legacy') RETURNING id",
      [job.id, spec],
    )
    await pool.query(
      "UPDATE ai_generation_candidate SET status='in_review' WHERE id=$1",
      [rows[0].id],
    )
    await expect(
      reviewCandidate(pool, {
        candidateId: rows[0].id,
        reviewerSubject: "admin",
        decision: "approved",
      }),
    ).rejects.toThrow()
  })
})

it("records the rejection reason and keeps the original validation evidence", async () => {
  await withDatabase(async (pool) => {
    const job = await createGenerationRequest(pool, request)
    const candidate = await insertGenerationCandidate(pool, {
      requestId: job.id,
      canonicalSpec: spec,
    })
    expect(candidate).toMatchObject({
      status: "in_review",
      validation: { valid: true },
    })
    const rejected = await reviewCandidate(pool, {
      candidateId: candidate.id,
      reviewerSubject: "admin",
      decision: "rejected",
      reason: "Too difficult",
    })
    expect(rejected).toMatchObject({
      status: "rejected",
      reviewerSubject: "admin",
      reviewReason: "Too difficult",
    })
    const detail = await loadCandidateDetail(pool, candidate.id)
    expect(detail?.reviewedAt).toBeInstanceOf(Date)
    expect(detail).toMatchObject({
      status: "rejected",
      reviewReason: "Too difficult",
      validation: { valid: true },
      provenance: {
        provider: "test",
        model: "math",
        promptTemplateVersion: "v1",
        seed: "sample",
      },
    })
  })
})

// Release the blocking transaction only after both reviewers reach the row.
async function waitForBothReviewers(db: PgQueryable) {
  await expect
    .poll(async () => {
      const { rows } = await db.query<{ waiting: number }>(
        "SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND application_name='pp:test'",
      )

      return rows[0].waiting
    })
    .toBe(2)
}

it("lets exactly one of two reviewers approve and preserves the winning subject", async () => {
  await withDatabase(async (pool) => {
    const job = await createGenerationRequest(pool, request)
    const candidate = await insertGenerationCandidate(pool, {
      requestId: job.id,
      canonicalSpec: spec,
    })
    const review = (reviewerSubject: string) =>
      reviewCandidate(pool, {
        candidateId: candidate.id,
        reviewerSubject,
        decision: "approved",
      })
    const { pending } = await withTransaction(pool, async (locker) => {
      await locker.query(
        "SELECT id FROM ai_generation_candidate WHERE id=$1 FOR UPDATE",
        [candidate.id],
      )
      const reviews = Promise.allSettled([review("one"), review("two")])
      await waitForBothReviewers(pool)

      return { pending: reviews }
    })
    const results = await pending
    const winners = results
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value)
    expect(winners).toHaveLength(1)
    expect(winners[0].status).toBe("approved")
    expect(await loadCandidateDetail(pool, candidate.id)).toMatchObject({
      status: "approved",
      reviewerSubject: winners[0].reviewerSubject,
    })
  })
})

it("allows a reviewer to reject a pending draft before verification", async () => {
  await withDatabase(async (pool) => {
    const job = await createGenerationRequest(pool, request)
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO ai_generation_candidate(request_id, canonical_spec, content_hash, validator_reports) VALUES ($1,$2,'unverified', $3) RETURNING id",
      [job.id, spec, JSON.stringify(["historic report"])],
    )
    const rejected = await reviewCandidate(pool, {
      candidateId: rows[0].id,
      reviewerSubject: "admin",
      decision: "rejected",
      reason: "Template withdrawn",
    })
    const stored = await pool.query<{ previous: string[] }>(
      "SELECT validator_reports->'previousReports' AS previous FROM ai_generation_candidate WHERE id=$1",
      [rows[0].id],
    )
    expect(stored.rows[0].previous).toEqual(["historic report"])
    expect(rejected).toMatchObject({
      status: "rejected",
      validation: null,
      reviewReason: "Template withdrawn",
    })
  })
})
