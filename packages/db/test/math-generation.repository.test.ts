import {
  withTransaction,
  type PgQueryable,
} from "@liam-workspace/node-postgres"
import type { MathProblemSpec } from "@pp/common"
import { runner } from "node-pg-migrate"
import type pg from "pg"
import { fileURLToPath } from "node:url"
import { assert, expect, it } from "vitest"
import {
  claimQueuedGenerationRequest,
  completeGenerationRequest,
  type CandidatePresentation,
  createGenerationRequest,
  importApprovedMathCandidates,
  insertGenerationCandidate,
  InvalidMathCandidateImportError,
  listCandidates,
  listGenerationRequests,
  loadCandidateDetail,
  renewGenerationClaim,
  reviewCandidate,
} from "../src/admin.js"
import { migrateToLatest } from "../src/migrate.js"
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

const otherSpec: MathProblemSpec = {
  ...spec,
  expression: {
    kind: "divide",
    left: { kind: "integer", value: 3 },
    right: { kind: "integer", value: 4 },
  },
}

const mathBlock = (tex: string) => ({
  kind: "math" as const,
  tex,
  display: false,
})
const textBlock = (value: string) => ({ kind: "text" as const, value })

const reviewedPresentation: CandidatePresentation = {
  promptBlocks: [mathBlock("\\frac{6}{8}")],
  choices: [
    { label: "3:4", labelBlocks: [mathBlock("\\frac{3}{4}")], isCorrect: true },
    { label: "4:3", labelBlocks: [textBlock("4:3")], isCorrect: false },
  ],
  solutionBlocks: [textBlock("Divide both terms by two.")],
}

async function approvedImport(
  pool: pg.Pool,
  presentation: CandidatePresentation,
) {
  const job = await createGenerationRequest(pool, request)
  const candidate = await insertGenerationCandidate(pool, {
    requestId: job.id,
    canonicalSpec: spec,
    presentation,
  })
  await reviewCandidate(pool, {
    candidateId: candidate.id,
    decision: "approved",
    reviewerSubject: "reviewer",
  })

  return {
    id: candidate.id,
    requestId: job.id,
    submit: () =>
      importApprovedMathCandidates(pool, {
        candidateIds: [candidate.id],
        adminSubject: "admin",
        title: "Ratios",
        slug: "ratios",
        durationSeconds: 60,
      }),
  }
}

it.each<[string, Partial<CandidatePresentation>]>([
  [
    "malformed prompt TeX",
    { promptBlocks: [textBlock("Simplify"), mathBlock("\\frac{1}{")] },
  ],
  [
    "forbidden solution command",
    { solutionBlocks: [mathBlock("\\href{https://example.com}{1}")] },
  ],
  [
    "unrecognized solution command",
    { solutionBlocks: [mathBlock("\\unknownFormula")] },
  ],
  ["oversize prompt TeX", { promptBlocks: [mathBlock("1".repeat(4097))] }],
  [
    "empty choice formula",
    {
      choices: [
        {
          ...reviewedPresentation.choices[0],
          labelBlocks: [textBlock("3:4"), mathBlock("")],
        },
        reviewedPresentation.choices[1],
      ],
    },
  ],
  ["blank solution", { solutionBlocks: [textBlock(" \t ")] }],
  ["Braille blank solution", { solutionBlocks: [textBlock("\u2800")] }],
  [
    "Hangul fillers in an otherwise blank solution",
    { solutionBlocks: [textBlock("\u115f\u1160\u3164\uffa0")] },
  ],
  [
    "spacing-only solution formula",
    { solutionBlocks: [mathBlock("{}\\quad")] },
  ],
  [
    "phantom solution formula",
    { solutionBlocks: [mathBlock("\\phantom{42}")] },
  ],
  [
    "mixed-case transparent solution formula",
    { solutionBlocks: [mathBlock("\\textcolor{Transparent}{42}")] },
  ],
  [
    "uppercase transparent nested solution formula",
    { solutionBlocks: [mathBlock("\\textcolor{TRANSPARENT}{\\frac{6}{8}}")] },
  ],
  [
    "transparent color inherited by a solution glyph",
    {
      solutionBlocks: [
        mathBlock(
          "\\textcolor{Transparent}{\\frac{1}{\\textcolor{Inherit}{2}}}",
        ),
      ],
    },
  ],
  [
    "unknown child color within transparent math",
    {
      solutionBlocks: [
        mathBlock("\\textcolor{Transparent}{\\frac{1}{\\textcolor{BlUeE}{2}}}"),
      ],
    },
  ],
  [
    "transparent short hex solution formula",
    { solutionBlocks: [mathBlock("\\textcolor{#aBc0}{42}")] },
  ],
  [
    "transparent long hex solution formula",
    { solutionBlocks: [mathBlock("\\textcolor{#aBcDeF00}{42}")] },
  ],
])(
  "refuses approved content with %s before writing a draft",
  async (_label, invalid) => {
    await withDatabase(async (pool) => {
      const candidate = await approvedImport(pool, {
        ...reviewedPresentation,
        ...invalid,
      })
      await expect(candidate.submit()).rejects.toBeInstanceOf(
        InvalidMathCandidateImportError,
      )
      expect(
        (await pool.query("SELECT id FROM test WHERE slug='ratios'")).rows,
      ).toEqual([])
    })
  },
)

it.each<[string, CandidatePresentation["solutionBlocks"]]>([
  ["nested TeX", [mathBlock("\\frac{6}{8}=\\frac{3}{4}")]],
  [
    "visible math within transparent math",
    [mathBlock("\\textcolor{Transparent}{\\frac{1}{\\textcolor{Blue}{2}}}")],
  ],
  [
    "nonzero alpha child color within transparent math",
    [
      mathBlock(
        "\\textcolor{Transparent}{\\frac{1}{\\textcolor{#aBcDeF01}{2}}}",
      ),
    ],
  ],
  [
    "visible text alongside blank characters",
    [textBlock("\u2800\u3164Divide both terms by two.")],
  ],
])(
  "imports a reviewed solution containing %s",
  async (_label, solutionBlocks) => {
    await withDatabase(async (pool) => {
      const candidate = await approvedImport(pool, {
        ...reviewedPresentation,
        solutionBlocks,
      })
      const draft = await candidate.submit()
      expect(draft.versionId).toBeTruthy()
      expect(
        (await pool.query("SELECT solution_blocks FROM question_math")).rows,
      ).toEqual([{ solution_blocks: solutionBlocks }])
    })
  },
)

it("keeps a historical published solution hidden after a request policy change", async () => {
  await withDatabase(async (pool, { databaseUrl }) => {
    const candidate = await approvedImport(pool, reviewedPresentation)
    const setPolicy = (solutionPolicy: string) =>
      pool.query("UPDATE ai_generation_request SET parameters=$1 WHERE id=$2", [
        { curriculumBrief: { solutionPolicy } },
        candidate.requestId,
      ])
    await setPolicy("hidden")
    const { versionId } = await candidate.submit()
    await pool.query("UPDATE test_version SET published_at=now() WHERE id=$1", [
      versionId,
    ])

    const options = {
      databaseUrl,
      dir: fileURLToPath(new URL("../migrations", import.meta.url)),
      migrationsTable: "pp_migrations",
      timestamp: true,
    }
    // Remove the policy column to reproduce an import from before migration 1014.
    await runner({ ...options, direction: "down", count: 1014 })
    await setPolicy("after_test")
    await runner({ ...options, direction: "up", count: 1014 })

    expect(
      (
        await pool.query(
          "SELECT show_solution_after_test FROM question_math WHERE source_candidate_id=$1",
          [candidate.id],
        )
      ).rows,
    ).toEqual([{ show_solution_after_test: false }])
  })
})

it("withholds an already-migrated published solution with an unverified flag", async () => {
  await withDatabase(async (pool, { databaseUrl }) => {
    const candidate = await approvedImport(pool, reviewedPresentation)
    const { versionId } = await candidate.submit()
    await runner({
      databaseUrl,
      dir: fileURLToPath(new URL("../migrations", import.meta.url)),
      migrationsTable: "pp_migrations",
      direction: "down",
      count: 1015,
      timestamp: true,
    })
    // This row has the same stored state as one backfilled by the original 1014.
    await pool.query(
      "UPDATE question_math SET show_solution_after_test=true WHERE source_candidate_id=$1",
      [candidate.id],
    )
    await pool.query("UPDATE test_version SET published_at=now() WHERE id=$1", [
      versionId,
    ])
    await migrateToLatest(databaseUrl)
    expect(
      (
        await pool.query(
          "SELECT after_test_solution_hash FROM question_math WHERE source_candidate_id=$1",
          [candidate.id],
        )
      ).rows,
    ).toEqual([{ after_test_solution_hash: null }])
    await expect(
      pool.query(
        "UPDATE question_math SET after_test_solution_hash=NULL WHERE source_candidate_id=$1",
        [candidate.id],
      ),
    ).rejects.toThrow(/immutable/u)
  })
})

it("preserves the approval digest across a downgrade attempt and upgrade", async () => {
  await withDatabase(async (pool, { databaseUrl }) => {
    const candidate = await approvedImport(pool, reviewedPresentation)
    await pool.query(
      "UPDATE ai_generation_candidate SET solution_blocks=$2 WHERE id=$1",
      [candidate.id, JSON.stringify([textBlock("Altered after approval.")])],
    )
    await expect(candidate.submit()).rejects.toBeInstanceOf(
      InvalidMathCandidateImportError,
    )

    await expect(
      runner({
        databaseUrl,
        dir: fileURLToPath(new URL("../migrations", import.meta.url)),
        direction: "down",
        count: 1013,
        timestamp: true,
        migrationsTable: "pp_migrations",
      }),
    ).rejects.toThrow(/disabled down migration on file: 1013/u)
    await migrateToLatest(databaseUrl)

    await expect(candidate.submit()).rejects.toBeInstanceOf(
      InvalidMathCandidateImportError,
    )
    expect(
      (await pool.query("SELECT id FROM test WHERE slug='ratios'")).rows,
    ).toEqual([])
  })
})

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
    expect(await renewGenerationClaim(pool, first)).toBe(false)
    const batch = [{ canonicalSpec: spec }]
    expect(await completeGenerationRequest(pool, first, batch)).toBeNull()
    const next = await claimQueuedGenerationRequest(pool)
    assert(next)
    expect(next.id).toBe(first.id)
    expect(next.claimToken).not.toBe(first.claimToken)
    expect(await renewGenerationClaim(pool, first)).toBe(false)
    await pool.query(
      "UPDATE ai_generation_request SET lease_expires_at=now()+interval '20 seconds' WHERE id=$1",
      [next.id],
    )
    expect(await renewGenerationClaim(pool, next)).toBe(true)
    const renewal = await pool.query<{ extended: boolean; token: string }>(
      `SELECT lease_expires_at > clock_timestamp()+interval '4 minutes' AS extended,
              claim_token AS token FROM ai_generation_request WHERE id=$1`,
      [next.id],
    )
    expect(renewal.rows).toEqual([{ extended: true, token: next.claimToken }])
    expect(await completeGenerationRequest(pool, first, batch)).toBeNull()
    expect(await listCandidates(pool, job.id)).toEqual([])
    const results = await Promise.all([
      completeGenerationRequest(pool, next, batch),
      completeGenerationRequest(pool, next, batch),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await renewGenerationClaim(pool, next)).toBe(false)
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
        { canonicalSpec: otherSpec },
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

it("rejects a second request for the same math despite changed metadata, seed, bounds and choices", async () => {
  await withDatabase(async (pool) => {
    const choices = [
      { answer: spec.answer, isCorrect: true },
      { answer: { ...spec.answer, numerator: 1 }, isCorrect: false },
    ]
    const first = await createGenerationRequest(pool, request)
    const owner = await insertGenerationCandidate(pool, {
      requestId: first.id,
      canonicalSpec: { ...spec, choices },
    })
    await reviewCandidate(pool, {
      candidateId: owner.id,
      reviewerSubject: "admin",
      decision: "approved",
    })
    const second = await createGenerationRequest(pool, {
      ...request,
      seed: "next",
    })
    const annotated = {
      kind: "divide" as const,
      source: "provider",
      left: { kind: "integer" as const, value: 6, note: "six" },
      right: { kind: "integer" as const, value: 8, confidence: 1 },
    }
    const duplicate = await insertGenerationCandidate(pool, {
      requestId: second.id,
      canonicalSpec: {
        ...spec,
        expression: annotated,
        seed: second.seed,
        constraints: { ...spec.constraints, max: 100 },
        choices: choices.toReversed(),
      },
    })
    expect(duplicate).toMatchObject({
      status: "rejected",
      validation: {
        source: "duplicate",
        duplicateContentHash: owner.contentHash,
      },
    })
    await expect(
      reviewCandidate(pool, {
        candidateId: duplicate.id,
        reviewerSubject: "admin",
        decision: "approved",
      }),
    ).rejects.toMatchObject({ code: "invalid_transition" })
  })
})

it("accepts corrected wording after the presentation failed validation", async () => {
  await withDatabase(async (pool) => {
    const first = await createGenerationRequest(pool, request)
    const failed = await insertGenerationCandidate(pool, {
      requestId: first.id,
      canonicalSpec: spec,
      validationErrors: ["Invalid wording"],
    })
    expect(failed).toMatchObject({
      status: "rejected",
      validation: { source: "presentation" },
    })
    const second = await createGenerationRequest(pool, request)
    const corrected = await insertGenerationCandidate(pool, {
      requestId: second.id,
      canonicalSpec: spec,
      presentation: {
        promptBlocks: [{ kind: "text", value: "Simplify the ratio 6:8." }],
        choices: [
          {
            label: "3:4",
            labelBlocks: [{ kind: "text", value: "3:4" }],
            isCorrect: true,
          },
          {
            label: "4:3",
            labelBlocks: [{ kind: "text", value: "4:3" }],
            isCorrect: false,
          },
        ],
        solutionBlocks: [{ kind: "text", value: "Divide both terms by two." }],
      },
    })
    expect(corrected.status).toBe("in_review")
    expect(failed.contentHash).toMatch(/^failure:/u)
  })
})

it("backfills an approved owner, rejects pending collisions, and releases old invalid wording", async () => {
  await withDatabase(async (pool, { databaseUrl }) => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public")
    await runner({
      databaseUrl,
      dir: fileURLToPath(new URL("../migrations", import.meta.url)),
      direction: "up",
      count: 11,
      migrationsTable: "pp_migrations",
    })
    const job = await createGenerationRequest(pool, request)
    const { rows: legacy } = await pool.query<{ id: string }>(
      `INSERT INTO ai_generation_candidate(request_id, canonical_spec, content_hash, validator_reports)
       VALUES ($1, jsonb_set($2::jsonb, '{expression,note}', '"first"'), 'old-pending', $5), ($1, $3, 'old-approved', $5),
              ($1, $4, 'old-invalid', '{"validation":{"valid":false,"source":"presentation"}}'),
              ($1, 'null', 'failure:old-duplicate', '{"validation":{"valid":false,"source":"duplicate","duplicateContentHash":"old-pending"}}'),
              ($1, $2, 'old-second-approval', $5),
              ($1, $4, 'old-released-owner', $5),
              ($1, 'null', 'old-released-duplicate', '{"validation":{"valid":false,"source":"duplicate","duplicateContentHash":"old-released-owner"}}')
       RETURNING id`,
      [
        job.id,
        spec,
        {
          ...spec,
          expression: { ...spec.expression, providerAnnotation: true },
          seed: "another",
        },
        otherSpec,
        { validation: { valid: true, source: "math", errors: [] } },
      ],
    )
    await pool.query(
      "UPDATE ai_generation_candidate SET status='in_review' WHERE id=ANY($1::uuid[])",
      [[legacy[0].id, legacy[1].id, legacy[4].id, legacy[5].id]],
    )
    await pool.query(
      "UPDATE ai_generation_candidate SET status='approved', reviewer_subject='first reviewer' WHERE id=$1",
      [legacy[1].id],
    )
    await pool.query(
      "UPDATE ai_generation_candidate SET status='approved', reviewer_subject='later reviewer', created_at=created_at+interval '1 second' WHERE id=$1",
      [legacy[4].id],
    )
    await pool.query(
      "UPDATE ai_generation_candidate SET status='rejected' WHERE id=ANY($1::uuid[])",
      [[legacy[2].id, legacy[3].id, legacy[5].id, legacy[6].id]],
    )

    // Under 1011 a reviewer could release the annotated owner's raw AST hash
    // after a duplicate report had already recorded it.
    await runner({
      databaseUrl,
      dir: fileURLToPath(new URL("../migrations", import.meta.url)),
      direction: "up",
      count: 1,
      migrationsTable: "pp_migrations",
    })
    const annotated = { ...otherSpec.expression, note: "owner on 1011" }
    const input = {
      requestId: job.id,
      canonicalSpec: { ...otherSpec, expression: annotated },
    }
    const temporaryOwner = await insertGenerationCandidate(pool, input)
    const duplicateOn1011 = await insertGenerationCandidate(pool, input)
    expect(duplicateOn1011.validation?.duplicateContentHash).toBe(
      temporaryOwner.contentHash,
    )
    await reviewCandidate(pool, {
      candidateId: temporaryOwner.id,
      reviewerSubject: "reviewer",
      decision: "rejected",
    })

    await migrateToLatest(databaseUrl)

    const approved = await loadCandidateDetail(pool, legacy[1].id)
    assert(approved)
    expect(approved).toMatchObject({
      status: "approved",
      reviewerSubject: "first reviewer",
    })
    expect(await loadCandidateDetail(pool, legacy[4].id)).toMatchObject({
      status: "approved",
      reviewerSubject: "later reviewer",
      canonicalSpec: spec,
    })
    const duplicate = {
      status: "rejected",
      validation: {
        source: "duplicate",
        duplicateContentHash: approved.contentHash,
      },
    }
    expect(await loadCandidateDetail(pool, legacy[0].id)).toMatchObject(
      duplicate,
    )
    expect(await loadCandidateDetail(pool, legacy[3].id)).toMatchObject(
      duplicate,
    )
    expect(
      await insertGenerationCandidate(pool, {
        requestId: job.id,
        canonicalSpec: { ...spec, seed: "new" },
      }),
    ).toMatchObject(duplicate)
    const replacement = await insertGenerationCandidate(pool, {
      requestId: job.id,
      canonicalSpec: otherSpec,
    })
    expect(replacement.status).toBe("in_review")
    const historicalDuplicates = await Promise.all(
      [legacy[6].id, duplicateOn1011.id].map((id) =>
        loadCandidateDetail(pool, id),
      ),
    )
    for (const historicalDuplicate of historicalDuplicates) {
      expect(historicalDuplicate).toMatchObject({
        validation: {
          source: "duplicate",
          duplicateContentHash: replacement.contentHash,
        },
      })
    }
  })
})

it("completes concurrent batches that share canonical hashes in opposite order", async () => {
  await withDatabase(async (pool) => {
    await createGenerationRequest(pool, request)
    await createGenerationRequest(pool, request)
    const first = await claimQueuedGenerationRequest(pool)
    const second = await claimQueuedGenerationRequest(pool)
    assert(first && second)
    const batch = [
      { canonicalSpec: spec },
      { canonicalSpec: { ...otherSpec, seed: "z" } },
    ]

    // Hold each worker at its first successful insert until both sessions
    // are waiting. Unordered workers would now own opposite unique keys.
    await pool.query(`
      CREATE FUNCTION pause_after_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_advisory_xact_lock_shared(2026); RETURN NEW; END $$;
      CREATE TRIGGER pause_after_insert AFTER INSERT ON ai_generation_candidate
        FOR EACH ROW EXECUTE FUNCTION pause_after_insert();`)
    const gate = await pool.connect()
    await gate.query("SELECT pg_advisory_lock(2026)")
    const completions = Promise.allSettled([
      completeGenerationRequest(pool, first, batch),
      completeGenerationRequest(pool, second, [
        { canonicalSpec: { ...otherSpec, seed: "a" } },
        { canonicalSpec: { ...spec, seed: "z" } },
      ]),
    ])

    try {
      await expect
        .poll(async () => {
          const { rows } = await pool.query<{ waiting: number }>(
            `SELECT count(*)::int AS waiting FROM pg_stat_activity
            WHERE datname=current_database() AND application_name='pp:test'
              AND wait_event_type='Lock' AND query LIKE '%INSERT INTO ai_generation_candidate%'`,
          )

          return rows[0].waiting
        })
        .toBe(2)
    } finally {
      await gate.query("SELECT pg_advisory_unlock(2026)")
      gate.release()
      await completions
    }

    expect(await completions).toMatchObject([
      { status: "fulfilled", value: { id: first.id, status: "completed" } },
      { status: "fulfilled", value: { id: second.id, status: "completed" } },
    ])
    const candidates = [
      ...(await listCandidates(pool, first.id)),
      ...(await listCandidates(pool, second.id)),
    ]
    const owners = candidates.filter((row) => row.status === "in_review")
    const duplicates = candidates.filter(
      (row) => row.validation?.source === "duplicate",
    )
    expect(owners).toHaveLength(2)
    expect(duplicates).toHaveLength(2)
    expect(
      new Set(duplicates.map((row) => row.validation?.duplicateContentHash)),
    ).toEqual(new Set(owners.map((row) => row.contentHash)))
  })
})

it("bounds malformed audit data without losing any sibling outcomes", async () => {
  await withDatabase(async (pool) => {
    const job = await createGenerationRequest(pool, request)
    const malformed = { "private\0key": "private\ud800" }
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const raw = [malformed, circular, 1n, "private".repeat(100_000)]
    const candidates = raw.map((rawResponse, i) => ({
      providerFailure: `provider failure ${i}`,
      rawResponse,
    }))
    const completed = await claimQueuedGenerationRequest(pool, () =>
      Promise.resolve([...candidates, { canonicalSpec: spec }]),
    )
    expect(completed?.id).toBe(job.id)
    const summaries = await listCandidates(pool, job.id)
    expect(summaries).toHaveLength(5)
    expect(summaries.filter((row) => row.status === "in_review")).toHaveLength(
      1,
    )
    expect(JSON.stringify(summaries)).not.toContain("private")
    const byError = new Map(
      summaries.map((row) => [row.validation?.errors[0], row]),
    )
    const audited = await Promise.all(
      raw.map(async (_, i) => {
        const summary = byError.get(`provider failure ${i}`)
        assert(summary)
        expect(await loadCandidateDetail(pool, summary.id)).not.toHaveProperty(
          "audit",
        )
        const detail = await loadCandidateDetail(pool, summary.id, {
          includeAudit: true,
        })

        return detail?.audit?.rawResponse
      }),
    )
    expect(audited[0]).toEqual({
      encoding: "json-text",
      jsonText: JSON.stringify(malformed),
    })
    for (const unavailable of audited.slice(1)) {
      expect(unavailable).toMatchObject({ omitted: true })
    }
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

it("bars approval when the stored spec has changed to another owner's valid math", async () => {
  await withDatabase(async (pool) => {
    const job = await createGenerationRequest(pool, request)
    const first = await insertGenerationCandidate(pool, {
      requestId: job.id,
      canonicalSpec: spec,
    })
    await reviewCandidate(pool, {
      candidateId: first.id,
      reviewerSubject: "admin",
      decision: "approved",
    })
    const second = await insertGenerationCandidate(pool, {
      requestId: job.id,
      canonicalSpec: otherSpec,
    })
    await pool.query(
      "UPDATE ai_generation_candidate SET canonical_spec=$2 WHERE id=$1",
      [second.id, spec],
    )
    await expect(
      reviewCandidate(pool, {
        candidateId: second.id,
        reviewerSubject: "admin",
        decision: "approved",
      }),
    ).rejects.toMatchObject({ code: "invalid_transition" })
    // The HTTP review and its audit record share a separate transaction.
    await expect(
      pool.query(
        "UPDATE ai_generation_candidate SET status='approved' WHERE id=$1",
        [second.id],
      ),
    ).rejects.toMatchObject({ code: "23514" })
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
      reason: "Ambiguous wording",
    })
    expect(rejected).toMatchObject({
      status: "rejected",
      reviewerSubject: "admin",
      reviewReason: "Ambiguous wording",
    })
    const detail = await loadCandidateDetail(pool, candidate.id)
    expect(detail?.reviewedAt).toBeInstanceOf(Date)
    expect(detail).toMatchObject({
      status: "rejected",
      reviewReason: "Ambiguous wording",
      validation: { valid: true },
      provenance: {
        provider: "test",
        model: "math",
        promptTemplateVersion: "v1",
        seed: "sample",
      },
    })
    const next = await createGenerationRequest(pool, request)
    expect(
      await insertGenerationCandidate(pool, {
        requestId: next.id,
        canonicalSpec: spec,
      }),
    ).toMatchObject({ status: "in_review" })
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
