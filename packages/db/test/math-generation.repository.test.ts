import {
  withTransaction,
  type PgQueryable,
} from "@liam-workspace/node-postgres"
import type { MathProblemSpec } from "@pp/common"
import { assert, expect, it } from "vitest"
import {
  claimQueuedGenerationRequest,
  completeGenerationRequest,
  type CandidatePresentation,
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

it("commits the claim and releases its row lock before calling the provider", async () => {
  await withDatabase(async (pool) => {
    const job = await createGenerationRequest(pool, request)
    const observed = { status: "", locked: false, idleTransactions: -1 }
    const completed = await claimQueuedGenerationRequest(pool, async () => {
      const page = await listGenerationRequests(pool)
      observed.status = page.items[0].status
      const lock = await pool.query(
        "SELECT id FROM ai_generation_request WHERE id=$1 FOR UPDATE NOWAIT",
        [job.id],
      )
      observed.locked = lock.rowCount === 1
      const { rows } = await pool.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND application_name='pp:test' AND state='idle in transaction'",
      )
      observed.idleTransactions = rows[0].count

      return [{ canonicalSpec: spec }]
    })
    expect(observed).toEqual({
      status: "processing",
      locked: true,
      idleTransactions: 0,
    })
    expect(completed).toMatchObject({ id: job.id, status: "completed" })
  })
})

it("recovers expired leases and fences expired, replaced, and replayed completions", async () => {
  await withDatabase(async (pool) => {
    const job = await createGenerationRequest(pool, request)
    const first = await claimQueuedGenerationRequest(pool)
    assert(first)
    expect(first).toMatchObject({
      id: job.id,
      status: "processing",
    })
    expect(first.claimToken).toBeTypeOf("string")
    expect(first.leaseExpiresAt).toBeInstanceOf(Date)
    expect(await claimQueuedGenerationRequest(pool)).toBeNull()
    await expect(
      insertGenerationCandidate(pool, {
        requestId: job.id,
        canonicalSpec: spec,
      }),
    ).rejects.toThrow()
    await pool.query(
      "UPDATE ai_generation_request SET lease_expires_at=now()-interval '1 second' WHERE id=$1",
      [job.id],
    )
    const batch = [{ canonicalSpec: spec }]
    expect(await completeGenerationRequest(pool, first, batch)).toBeNull()
    const next = await claimQueuedGenerationRequest(pool)
    assert(next)
    expect(next.id).toBe(first.id)
    expect(next.claimToken).not.toBe(first.claimToken)
    expect(await completeGenerationRequest(pool, first, batch)).toBeNull()
    expect(await listCandidates(pool, job.id)).toEqual([])
    const results = await Promise.all([
      completeGenerationRequest(pool, next, batch),
      completeGenerationRequest(pool, next, batch),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await completeGenerationRequest(pool, next, batch)).toBeNull()
    expect(await listCandidates(pool, job.id)).toHaveLength(1)
    expect(await claimQueuedGenerationRequest(pool)).toBeNull()
  })
})

it("keeps valid siblings and reports duplicate canonical content without starving later jobs", async () => {
  await withDatabase(async (pool) => {
    const job = await createGenerationRequest(pool, request)
    const later = await createGenerationRequest(pool, request)
    const generate = () =>
      Promise.resolve([
        { canonicalSpec: spec },
        { canonicalSpec: spec },
        { canonicalSpec: { ...spec, seed: "another" } },
      ])
    expect(await claimQueuedGenerationRequest(pool, generate)).toMatchObject({
      id: job.id,
      status: "completed",
    })
    const candidates = await listCandidates(pool, job.id)
    expect(candidates).toHaveLength(3)
    expect(candidates.filter((c) => c.status === "in_review")).toHaveLength(2)
    const rejected = candidates.find((c) => c.status === "rejected")
    assert(rejected)
    expect(rejected).toMatchObject({
      validation: { valid: false, source: "duplicate" },
    })
    expect(candidates.map((c) => c.contentHash)).toContain(
      rejected.validation?.duplicateContentHash,
    )
    expect(await loadCandidateDetail(pool, rejected.id)).toMatchObject({
      canonicalSpec: null,
    })
    expect(
      await claimQueuedGenerationRequest(pool, () =>
        Promise.resolve([{ canonicalSpec: spec }]),
      ),
    ).toMatchObject({ id: later.id, status: "completed" })
    expect(await listCandidates(pool, later.id)).toMatchObject([
      { status: "rejected", validation: { source: "duplicate" } },
    ])
    expect(await claimQueuedGenerationRequest(pool)).toBeNull()
  })
})

it("records a thrown provider error as a terminal rejection with audit-only diagnostics", async () => {
  await withDatabase(async (pool) => {
    const job = await createGenerationRequest(pool, request)
    const completed = await claimQueuedGenerationRequest(pool, () =>
      Promise.reject(new Error("private provider diagnostic")),
    )
    expect(completed).toMatchObject({ id: job.id, status: "completed" })
    const candidates = await listCandidates(pool, job.id)
    expect(candidates).toMatchObject([
      { status: "rejected", validation: { source: "provider" } },
    ])
    expect(JSON.stringify(candidates)).not.toContain(
      "private provider diagnostic",
    )
    const detail = await loadCandidateDetail(pool, candidates[0].id, {
      includeAudit: true,
    })
    expect(JSON.stringify(detail?.audit)).toContain(
      "private provider diagnostic",
    )
    expect(await claimQueuedGenerationRequest(pool)).toBeNull()
  })
})

it("round trips the normalized presentation independently of the raw provider response", async () => {
  await withDatabase(async (pool) => {
    const job = await createGenerationRequest(pool, request)
    const presentation: CandidatePresentation = {
      promptBlocks: [{ kind: "text", value: "Simplify the ratio." }],
      choices: [
        {
          label: "3/4",
          labelBlocks: [{ kind: "math", tex: "3/4", display: false }],
          isCorrect: true,
        },
        {
          label: "4/3",
          labelBlocks: [{ kind: "math", tex: "4/3", display: false }],
          isCorrect: false,
        },
      ],
      solutionBlocks: [{ kind: "text", value: "Divide both numbers by two." }],
    }
    const candidate = await insertGenerationCandidate(pool, {
      requestId: job.id,
      canonicalSpec: spec,
      presentation,
      rawResponse: { promptBlocks: ["private draft"] },
    })
    expect(await listCandidates(pool, job.id)).toMatchObject([
      { ...presentation },
    ])
    const detail = await loadCandidateDetail(pool, candidate.id)
    expect(detail).toMatchObject({ ...presentation, canonicalSpec: spec })
    expect(JSON.stringify(detail)).not.toContain("private draft")
    expect((await listGenerationRequests(pool)).items[0].status).toBe(
      "completed",
    )
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

it("revalidates the stored spec at approval even when its original report passed", async () => {
  await withDatabase(async (pool) => {
    const job = await createGenerationRequest(pool, request)
    const candidate = await insertGenerationCandidate(pool, {
      requestId: job.id,
      canonicalSpec: spec,
    })
    await pool.query(
      "UPDATE ai_generation_candidate SET canonical_spec = jsonb_set(canonical_spec, '{answer,numerator}', '99') WHERE id=$1",
      [candidate.id],
    )
    await expect(
      reviewCandidate(pool, {
        candidateId: candidate.id,
        reviewerSubject: "admin",
        decision: "approved",
      }),
    ).rejects.toMatchObject({ code: "invalid_transition" })
    expect(await loadCandidateDetail(pool, candidate.id)).toMatchObject({
      status: "in_review",
      validation: { valid: true },
    })
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
