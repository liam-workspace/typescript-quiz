import {
  withTransaction,
  type PgQueryable,
} from "@liam-workspace/node-postgres"
import {
  adminPaginationSchema,
  verifyMathProblem,
  type AdminPagination,
  type MathProblemSpec,
  type ValidationResult,
} from "@pp/common"
import type pg from "pg"
import { InvalidCursorError } from "./catalog.repository.js"

export interface GenerationRequestInput {
  templateId?: string
  parameters: Record<string, unknown>
  provider: string
  model: string
  promptTemplateVersion: string
  seed: string
}

export interface GenerationRequest extends Omit<
  GenerationRequestInput,
  "templateId"
> {
  id: string
  templateId: string | null
  createdAt: Date
  status: "queued" | "completed"
}

export type GenerationCandidateInput =
  | {
      canonicalSpec: MathProblemSpec
      validationErrors?: string[]
      rawResponse?: unknown
    }
  | { providerFailure: string; rawResponse?: unknown }

interface CandidateValidation extends ValidationResult {
  source: "provider" | "math" | "presentation"
}

export interface CandidateSummary {
  id: string
  requestId: string
  status:
    | "draft"
    | "in_review"
    | "approved"
    | "rejected"
    | "regeneration_requested"
  contentHash: string
  validation: CandidateValidation | null
  reviewReason: string | null
  reviewerSubject: string | null
  reviewedAt: Date | null
  testVersionId: string | null
  createdAt: Date
}

export interface CandidateDetail extends CandidateSummary {
  canonicalSpec: MathProblemSpec | null
  provenance: Pick<
    GenerationRequest,
    "templateId" | "provider" | "model" | "promptTemplateVersion" | "seed"
  >
  audit?: { rawResponse: unknown }
}

export class CandidateReviewError extends Error {
  constructor(readonly code: "not_found" | "invalid_transition") {
    super(code)
  }
}

const requestColumns = `id, template_id AS "templateId", parameters, provider,
  model, prompt_template_version AS "promptTemplateVersion", seed, created_at AS "createdAt"`
const candidateColumns = `id, request_id AS "requestId", status, content_hash AS "contentHash",
  validator_reports->'validation' AS validation, validator_reports->>'reviewReason' AS "reviewReason",
  reviewer_subject AS "reviewerSubject", reviewed_at AS "reviewedAt",
  test_version_id AS "testVersionId", created_at AS "createdAt"`

export async function createGenerationRequest(
  db: PgQueryable,
  input: GenerationRequestInput,
) {
  const { rows } = await db.query<GenerationRequest>(
    `INSERT INTO ai_generation_request
       (template_id, parameters, provider, model, prompt_template_version, seed)
     VALUES ($1, $2::jsonb, $3, $4, $5, $6)
     RETURNING ${requestColumns}, 'queued' AS status`,
    [
      input.templateId ?? null,
      JSON.stringify(input.parameters),
      input.provider,
      input.model,
      input.promptTemplateVersion,
      input.seed,
    ],
  )

  return rows[0]
}

export async function listGenerationRequests(
  db: PgQueryable,
  page: AdminPagination = { limit: 25, cursor: null },
) {
  const { limit, cursor } = adminPaginationSchema.parse(page)

  if (
    cursor !== null &&
    !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu.test(cursor)
  ) {
    throw new InvalidCursorError("bad_cursor")
  }

  const { rows } = await db.query<GenerationRequest>(
    `SELECT ${requestColumns},
       CASE WHEN EXISTS (SELECT 1 FROM ai_generation_candidate WHERE request_id = r.id)
            THEN 'completed' ELSE 'queued' END AS status
       FROM ai_generation_request r
      WHERE $1::uuid IS NULL OR (r.created_at, r.id) <
          (SELECT created_at, id FROM ai_generation_request WHERE id = $1)
      ORDER BY r.created_at DESC, r.id DESC LIMIT $2`,
    [cursor, limit + 1],
  )
  const items = rows.slice(0, limit)

  return { items, nextCursor: rows.length > limit ? items[limit - 1].id : null }
}

function validationFor(input: GenerationCandidateInput): CandidateValidation {
  if ("providerFailure" in input) {
    return { valid: false, errors: [input.providerFailure], source: "provider" }
  }

  const math = verifyMathProblem(input.canonicalSpec)

  if (math.valid && input.validationErrors?.length) {
    return {
      valid: false,
      errors: input.validationErrors,
      source: "presentation",
    }
  }

  return { ...math, source: "math" }
}

async function writeCandidate(
  tx: PgQueryable,
  requestId: string,
  input: GenerationCandidateInput,
) {
  const validation = validationFor(input)
  // JSON null represents a failed provider call without a canonical problem.
  // Only such failures use a synthetic hash. PostgreSQL canonicalizes jsonb
  // object keys before hashing real specs, regardless of JS property order.
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO ai_generation_candidate
       (request_id, canonical_spec, content_hash, raw_response, validator_reports)
     VALUES ($1, $2::jsonb,
       CASE WHEN $2::jsonb = 'null'::jsonb THEN 'failure:' || gen_random_uuid()::text
            ELSE encode(sha256(convert_to($2::jsonb::text, 'UTF8')), 'hex') END,
       $3::jsonb, $4::jsonb) RETURNING id`,
    [
      requestId,
      JSON.stringify("canonicalSpec" in input ? input.canonicalSpec : null),
      JSON.stringify(input.rawResponse),
      JSON.stringify({ validation }),
    ],
  )
  const updated = await tx.query<CandidateSummary>(
    `UPDATE ai_generation_candidate SET status=$2, updated_at=now()
      WHERE id=$1 RETURNING ${candidateColumns}`,
    [rows[0].id, validation.valid ? "in_review" : "rejected"],
  )

  return updated.rows[0]
}

export function insertGenerationCandidate(
  pool: pg.Pool,
  input: { requestId: string } & GenerationCandidateInput,
) {
  return withTransaction(pool, (tx) =>
    writeCandidate(tx, input.requestId, input),
  )
}

/**
 * Holds the request row lock until the entire batch is durable. A worker
 * returns a providerFailure outcome for a provider error. A crash or aborted
 * transaction releases the lock and rolls back all partial writes.
 */
export function claimQueuedGenerationRequest(
  pool: pg.Pool,
  generate: (
    request: GenerationRequest,
  ) => Promise<readonly GenerationCandidateInput[]>,
): Promise<GenerationRequest | null> {
  return withTransaction(pool, async (tx) => {
    for (;;) {
      // eslint-disable-next-line no-await-in-loop -- Retry the selection with a fresh snapshot after a concurrent commit.
      const { rows } = await tx.query<GenerationRequest>(
        `SELECT ${requestColumns}, 'queued' AS status FROM ai_generation_request r
          WHERE NOT EXISTS (SELECT 1 FROM ai_generation_candidate WHERE request_id=r.id)
          ORDER BY created_at, id LIMIT 1 FOR UPDATE OF r SKIP LOCKED`,
      )
      const job = rows.at(0)

      if (!job) {
        return null
      }

      // The selection's snapshot might predate a worker committing just
      // before we acquired the lock. Check again under the acquired lock.
      // eslint-disable-next-line no-await-in-loop -- Recheck under the row lock.
      const existing = await tx.query(
        "SELECT 1 FROM ai_generation_candidate WHERE request_id=$1 LIMIT 1",
        [job.id],
      )

      if (existing.rows.length) {
        continue
      }

      // eslint-disable-next-line no-await-in-loop -- Generate only after claiming this request.
      const batch = await generate(job)

      if (batch.length === 0) {
        throw new Error(
          "Generation batch requires a candidate or failure report",
        )
      }

      for (const input of batch) {
        // eslint-disable-next-line no-await-in-loop -- Batch inserts share a single transaction client.
        await writeCandidate(tx, job.id, input)
      }

      return { ...job, status: "completed" }
    }
  })
}

export async function listCandidates(db: PgQueryable, requestId: string) {
  const { rows } = await db.query<CandidateSummary>(
    `SELECT ${candidateColumns} FROM ai_generation_candidate
      WHERE request_id=$1 ORDER BY created_at, id`,
    [requestId],
  )

  return rows
}

export async function loadCandidateDetail(
  db: PgQueryable,
  candidateId: string,
  options: { includeAudit?: boolean } = {},
): Promise<CandidateDetail | null> {
  const audit = options.includeAudit
    ? ", jsonb_build_object('rawResponse', raw_response) AS audit"
    : ""
  const { rows } = await db.query<CandidateDetail>(
    `SELECT ${candidateColumns}, canonical_spec AS "canonicalSpec" ${audit},
       (SELECT jsonb_build_object('templateId', r.template_id, 'provider', r.provider,
          'model', r.model, 'promptTemplateVersion', r.prompt_template_version, 'seed', r.seed)
          FROM ai_generation_request r WHERE r.id=c.request_id) AS provenance
       FROM ai_generation_candidate c WHERE c.id=$1`,
    [candidateId],
  )

  return rows.at(0) ?? null
}

export function reviewCandidate(
  pool: pg.Pool,
  input: {
    candidateId: string
    reviewerSubject: string
    decision: "approved" | "rejected"
    reason?: string
  },
): Promise<CandidateSummary> {
  return withTransaction(pool, async (tx) => {
    const { rows } = await tx.query<
      Pick<CandidateDetail, "status" | "validation" | "canonicalSpec">
    >(
      `SELECT status, validator_reports->'validation' AS validation, canonical_spec AS "canonicalSpec" FROM ai_generation_candidate
        WHERE id=$1 FOR UPDATE`,
      [input.candidateId],
    )
    const candidate = rows.at(0)

    if (!candidate) {
      throw new CandidateReviewError("not_found")
    }

    const canReject =
      input.decision === "rejected" &&
      (candidate.status === "in_review" || candidate.status === "draft")
    const canApprove =
      input.decision === "approved" &&
      candidate.status === "in_review" &&
      candidate.validation?.valid === true &&
      candidate.canonicalSpec !== null &&
      verifyMathProblem(candidate.canonicalSpec).valid

    if (!canReject && !canApprove) {
      throw new CandidateReviewError("invalid_transition")
    }

    const updated = await tx.query<CandidateSummary>(
      `UPDATE ai_generation_candidate SET status=$2, reviewer_subject=$3,
         reviewed_at=now(), updated_at=now(), validator_reports=(
           CASE WHEN validator_reports IS NULL THEN '{}'::jsonb
                WHEN jsonb_typeof(validator_reports) = 'object' THEN validator_reports
                ELSE jsonb_build_object('previousReports', validator_reports) END
         ) || jsonb_build_object('reviewReason', $4::text)
       WHERE id=$1 RETURNING ${candidateColumns}`,
      [
        input.candidateId,
        input.decision,
        input.reviewerSubject,
        input.reason ?? null,
      ],
    )

    return updated.rows[0]
  })
}
