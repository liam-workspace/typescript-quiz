import {
  withTransaction,
  type PgQueryable,
} from "@liam-workspace/node-postgres"
import {
  adminPaginationSchema,
  verifyMathProblem,
  type AdminPagination,
  type ContentBlock,
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
  status: "queued" | "processing" | "completed"
}

export interface GenerationClaim extends GenerationRequest {
  status: "processing"
  claimToken: string
  leaseExpiresAt: Date
}

export interface CandidatePresentation {
  promptBlocks: ContentBlock[]
  choices: Array<{
    label: string
    labelBlocks: ContentBlock[]
    isCorrect: boolean
  }>
  solutionBlocks: ContentBlock[]
}

export type GenerationCandidateInput =
  | {
      canonicalSpec: MathProblemSpec
      presentation?: CandidatePresentation
      validationErrors?: string[]
      rawResponse?: unknown
    }
  | { providerFailure: string; rawResponse?: unknown }

interface CandidateValidation extends ValidationResult {
  source: "provider" | "math" | "presentation" | "duplicate"
  duplicateContentHash?: string
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
  promptBlocks: ContentBlock[] | null
  choices: CandidatePresentation["choices"] | null
  solutionBlocks: ContentBlock[] | null
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
  model, prompt_template_version AS "promptTemplateVersion", seed, created_at AS "createdAt", status`
const candidateColumns = `id, request_id AS "requestId", status, content_hash AS "contentHash",
  prompt_blocks AS "promptBlocks", choices, solution_blocks AS "solutionBlocks",
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
     RETURNING ${requestColumns}`,
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
    `SELECT ${requestColumns}
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
  const presentation =
    validation.valid && "canonicalSpec" in input
      ? input.presentation
      : undefined
  const canonicalSpec = JSON.stringify(
    "canonicalSpec" in input ? input.canonicalSpec : null,
  )
  const rawResponse = JSON.stringify(input.rawResponse)
  const hashSql = "encode(sha256(convert_to($2::jsonb::text, 'UTF8')), 'hex')"
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO ai_generation_candidate
       (request_id, canonical_spec, content_hash, raw_response, validator_reports,
        prompt_blocks, choices, solution_blocks)
     VALUES ($1, $2::jsonb,
       CASE WHEN $2::jsonb = 'null'::jsonb THEN 'failure:' || gen_random_uuid()::text
            ELSE ${hashSql} END,
       $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb)
     ON CONFLICT (content_hash) DO NOTHING RETURNING id`,
    [
      requestId,
      canonicalSpec,
      rawResponse,
      JSON.stringify({ validation }),
      JSON.stringify(presentation?.promptBlocks),
      JSON.stringify(presentation?.choices),
      JSON.stringify(presentation?.solutionBlocks),
    ],
  )
  let candidate = rows.at(0)

  if (!candidate) {
    // The original owns the canonical hash. Give this rejected outcome its
    // own identity and record the conflicting hash for review.
    const duplicate = await tx.query<{ id: string }>(
      `INSERT INTO ai_generation_candidate
         (request_id, canonical_spec, content_hash, raw_response, validator_reports)
       VALUES ($1, 'null'::jsonb, 'failure:' || gen_random_uuid()::text, $3::jsonb,
         jsonb_build_object('validation', jsonb_build_object('valid', false,
           'source', 'duplicate', 'errors', jsonb_build_array('Duplicate canonical content'),
           'duplicateContentHash', ${hashSql}))) RETURNING id`,
      [requestId, canonicalSpec, rawResponse],
    )
    ;[candidate] = duplicate.rows
  }

  const updated = await tx.query<CandidateSummary>(
    `UPDATE ai_generation_candidate
        SET status=CASE WHEN validator_reports->'validation'->'valid'='true'::jsonb
                        THEN 'in_review' ELSE 'rejected' END, updated_at=now()
      WHERE id=$1 RETURNING ${candidateColumns}`,
    [candidate.id],
  )

  return updated.rows[0]
}

export function insertGenerationCandidate(
  pool: pg.Pool,
  input: { requestId: string } & GenerationCandidateInput,
) {
  return withTransaction(pool, async (tx) => {
    // A direct insert historically completed the request. An active worker
    // must instead present its claim and commit its entire batch.
    const updated = await tx.query(
      "UPDATE ai_generation_request SET status='completed' WHERE id=$1 AND status <> 'processing' RETURNING id",
      [input.requestId],
    )

    if (!updated.rowCount) {
      throw new Error("Request is missing or requires a generation claim")
    }

    return writeCandidate(tx, input.requestId, input)
  })
}

type GenerateBatch = (
  request: GenerationRequest,
) => Promise<readonly GenerationCandidateInput[]>

export function claimQueuedGenerationRequest(
  pool: pg.Pool,
): Promise<GenerationClaim | null>

export function claimQueuedGenerationRequest(
  pool: pg.Pool,
  generate: GenerateBatch,
): Promise<GenerationRequest | null>

export async function claimQueuedGenerationRequest(
  pool: pg.Pool,
  generate?: GenerateBatch,
) {
  // One autocommitted statement. Once it returns, no connection or row lock
  // is reserved while the provider runs.
  const { rows } = await pool.query<GenerationClaim>(
    `UPDATE ai_generation_request SET status='processing', claim_token=gen_random_uuid(),
        lease_expires_at=clock_timestamp()+interval '5 minutes'
      WHERE id=(SELECT id FROM ai_generation_request
        WHERE status='queued' OR (status='processing' AND lease_expires_at<=clock_timestamp())
        ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING ${requestColumns}, claim_token AS "claimToken", lease_expires_at AS "leaseExpiresAt"`,
  )
  const claim = rows.at(0) ?? null

  if (!claim || !generate) {
    return claim
  }

  const batch = await generateOutcomes(generate, claim)

  return completeGenerationRequest(pool, claim, batch)
}

async function generateOutcomes(
  generate: GenerateBatch,
  claim: GenerationClaim,
): Promise<readonly GenerationCandidateInput[]> {
  try {
    return await generate(claim)
  } catch (error) {
    return [
      {
        providerFailure: "Provider request failed",
        rawResponse: error instanceof Error ? error.message : String(error),
      },
    ]
  }
}

export function completeGenerationRequest(
  pool: pg.Pool,
  claim: Pick<GenerationClaim, "id" | "claimToken">,
  batch: readonly GenerationCandidateInput[],
): Promise<GenerationRequest | null> {
  return withTransaction(pool, async (tx) => {
    const { rows } = await tx.query<GenerationRequest>(
      `UPDATE ai_generation_request SET status='completed', claim_token=NULL, lease_expires_at=NULL
        WHERE id=$1 AND status='processing' AND claim_token=$2 AND lease_expires_at>clock_timestamp()
        RETURNING ${requestColumns}`,
      [claim.id, claim.claimToken],
    )
    const job = rows.at(0)

    if (!job) {
      return null
    }

    const outcomes = batch.length
      ? batch
      : [{ providerFailure: "Provider returned no candidates" }]
    for (const input of outcomes) {
      // eslint-disable-next-line no-await-in-loop -- All outcomes commit with the fenced completion.
      await writeCandidate(tx, job.id, input)
    }

    return job
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
