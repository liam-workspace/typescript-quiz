import { createHash, randomUUID } from "node:crypto"
import { withTransaction, type PgPool } from "@liam-workspace/node-postgres"
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
} from "@nestjs/common"
import {
  adminPaginationSchema,
  verifyMathProblem,
  type ContentBlock,
  type MathAnswer,
  type MathProblemSpec,
} from "@pp/common"
import {
  claimQueuedGenerationRequest,
  createGenerationRequest,
  listCandidates,
  listGenerationRequests,
  loadCandidateDetail,
  type GenerationCandidateInput,
  type GenerationRequest,
} from "@pp/db/admin"
import { z } from "zod"
import { ProblemException } from "../attempts/problem.exception.js"
import { REQUEST_POOL, JOB_POOL } from "../database/tokens.js"

const briefSchema = z.strictObject({
  level: z.enum(["primary-step-1", "primary-step-2"]),
  objectiveTags: z
    .array(z.string().regex(/^[a-z0-9][a-z0-9:-]{0,79}$/u))
    .min(1)
    .max(10),
  language: z.literal("en"),
  difficulty: z.literal("introductory"),
  solutionPolicy: z.enum(["after_test", "hidden"]),
})
const batchSchema = z.strictObject({
  templateCode: z.enum(["fraction-addition-v1", "percentage-of-quantity-v1"]),
  count: z.number().int().min(1).max(20),
  curriculumBrief: briefSchema,
})
const pageSchema = z.strictObject({
  limit: z
    .string()
    .regex(/^\d+$/u)
    .transform(Number)
    .pipe(adminPaginationSchema.shape.limit)
    .default(25),
  cursor: z.uuid().nullable().default(null),
})
const detailQuerySchema = z.strictObject({
  includeAudit: z.enum(["true", "false"]).optional(),
})
const reviewSchema = z.strictObject({
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().min(1).max(2000).refine(databaseText).optional(),
})
const wording = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .refine(databaseText)
  .refine((value) => !/[<>\\]|(?:https?:|www\.)/iu.test(value))
const enrichmentSchema = z.strictObject({
  prompt: wording,
  explanation: wording,
})
type Brief = z.infer<typeof briefSchema>
type TemplateCode = z.infer<typeof batchSchema>["templateCode"]

export interface MathEnrichmentProvider {
  readonly provider: string
  readonly model: string
  enrich(
    brief: Brief,
    spec: MathProblemSpec,
    signal: AbortSignal,
  ): Promise<unknown>
}

export const MATH_WORDING_PROVIDER = "MATH_WORDING_PROVIDER"

// An offline adapter keeps the first two templates usable without a provider account.
export const templateWordingProvider: MathEnrichmentProvider = {
  provider: "local",
  model: "template-v1",
  enrich(_brief, spec) {
    return Promise.resolve(
      spec.family === "fraction_addition"
        ? {
            prompt: "Add the fractions.",
            explanation: "Keep the denominator and add the numerators.",
          }
        : {
            prompt: "Find the percentage of the given quantity.",
            explanation:
              "Multiply the quantity by the percentage divided by one hundred.",
          },
    )
  },
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)

  if (!result.success) {
    throw new ProblemException({
      type: "invalid_math_request",
      status: 400,
      title: "The math request failed validation.",
      issues: result.error.issues,
    })
  }

  return result.data
}
// PostgreSQL text/jsonb cannot represent NUL or unpaired UTF-16 surrogates.
function databaseText(value: string): boolean {
  return value.isWellFormed() && !value.includes("\0")
}
function auditPayload(value: unknown): unknown {
  const json = JSON.stringify(value)

  // JSON.stringify escapes these code units as ASCII. The string preserves the
  // entire response losslessly even when the database cannot decode it as JSONB.
  return json && /\\u(?:0000|d[89a-f][\da-f]{2})/iu.test(json)
    ? { encoding: "json-text", jsonText: json }
    : value
}

function missing(): ProblemException {
  return new ProblemException({
    type: "math_candidate_not_found",
    status: 404,
    title: "No such math candidate exists.",
  })
}

function answer(numerator: number, denominator: number): MathAnswer {
  return {
    kind: denominator === 1 ? "integer" : "rational",
    numerator,
    denominator,
  }
}
function displayAnswer(value: MathAnswer) {
  return value.denominator === 1
    ? String(value.numerator)
    : `\\frac{${value.numerator}}{${value.denominator}}`
}

function makeProblem(code: TemplateCode, seed: string, index: number) {
  const offset = createHash("sha256").update(seed).digest().readUInt16BE(0)
  const n = (offset + index) % 24
  const fraction = code === "fraction-addition-v1"
  const denominator = fraction ? 4 + Math.floor(n / 4) : 1
  const left = fraction ? 1 + (n % 4) : [10, 25, 50][n % 3]
  const right = fraction ? 1 + (offset % 3) : 20 * (1 + Math.floor(n / 3))
  const numerator = fraction ? left + right : (left * right) / 100
  const result = answer(numerator, denominator)
  const expression: MathProblemSpec["expression"] = fraction
    ? {
        kind: "add",
        left: { kind: "fraction", numerator: left, denominator },
        right: { kind: "fraction", numerator: right, denominator },
      }
    : {
        kind: "multiply",
        left: { kind: "fraction", numerator: left, denominator: 100 },
        right: { kind: "integer", value: right },
      }
  const exprTex = fraction
    ? `\\frac{${left}}{${denominator}}+\\frac{${right}}{${denominator}}`
    : `${left}\\%\\times ${right}`
  const correctIndex = (offset + index) % 4
  const answers = Array.from({ length: 4 }, (_, position) => {
    const delta = (position - correctIndex + 4) % 4

    return {
      answer: answer(numerator + delta, denominator),
      isCorrect: delta === 0,
    }
  })
  const spec: MathProblemSpec = {
    family: fraction ? "fraction_addition" : "percentage_of_quantity",
    seed: `${seed}:${index}`,
    variables: {},
    expression,
    answer: result,
    constraints: { min: 0, max: 200, nonNegative: true },
    choices: answers,
  }
  const choices = answers.map((choice) => {
    const tex = displayAnswer(choice.answer)
    const label =
      choice.answer.denominator === 1
        ? String(choice.answer.numerator)
        : `${choice.answer.numerator}/${choice.answer.denominator}`

    return {
      label,
      labelBlocks: [{ kind: "math" as const, tex, display: false }],
      isCorrect: choice.isCorrect,
    }
  })

  return { spec, exprTex, choices }
}

async function enrichCandidate(
  adapter: MathEnrichmentProvider,
  brief: Brief,
  problem: ReturnType<typeof makeProblem>,
): Promise<GenerationCandidateInput> {
  const { spec, exprTex, choices } = problem
  const controller = new AbortController()
  let timeout: NodeJS.Timeout | undefined = undefined
  let rawResponse: unknown = undefined

  try {
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort()
        reject(new Error("Provider timed out"))
      }, 10_000)
    })
    rawResponse = await Promise.race([
      adapter.enrich(
        structuredClone(brief),
        structuredClone(spec),
        controller.signal,
      ),
      deadline,
    ])
  } catch (error) {
    return {
      providerFailure: "Provider request failed",
      rawResponse: auditPayload(
        error instanceof Error ? error.message : String(error),
      ),
    }
  } finally {
    clearTimeout(timeout)
  }

  const parsed = enrichmentSchema.safeParse(rawResponse)

  if (!parsed.success) {
    return {
      canonicalSpec: spec,
      validationErrors: ["Provider wording failed the presentation schema"],
      rawResponse: auditPayload(rawResponse),
    }
  }

  const mathBlock = (tex: string): ContentBlock => ({
    kind: "math",
    tex,
    display: false,
  })

  return {
    canonicalSpec: spec,
    rawResponse,
    presentation: {
      promptBlocks: [
        { kind: "text", value: parsed.data.prompt },
        mathBlock(exprTex),
      ],
      solutionBlocks: [
        { kind: "text", value: parsed.data.explanation },
        mathBlock(`${exprTex}=${displayAnswer(spec.answer)}`),
      ],
      choices,
    },
  }
}

@Injectable()
export class MathGenerationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MathGenerationService.name)
  private timer?: NodeJS.Timeout
  private running?: Promise<void>
  private stopping = false
  constructor(
    @Inject(REQUEST_POOL) private readonly pool: PgPool,
    @Inject(JOB_POOL) private readonly jobs: PgPool,
    @Inject(MATH_WORDING_PROVIDER)
    private readonly adapter: MathEnrichmentProvider,
  ) {}

  onModuleInit() {
    // Periodic claims also pick up work queued before startup or left with an expired lease.
    this.timer = setInterval(() => this.wakeWorker(), 5_000)
    this.timer.unref()
  }
  async onModuleDestroy() {
    this.stopping = true
    clearInterval(this.timer)
    await this.running
  }
  private wakeWorker() {
    if (!this.running && !this.stopping) {
      this.running = this.drain()
        .catch(() =>
          this.logger.error("Unable to process the math generation queue"),
        )
        .finally(() => {
          this.running = undefined
        })
    }
  }
  private async drain() {
    while (!this.stopping) {
      // The claim commits before the callback runs. Completion is fenced by its lease token.
      // eslint-disable-next-line no-await-in-loop -- Claim the next batch after the current one finishes.
      const completed = await claimQueuedGenerationRequest(
        this.jobs,
        (request) => this.generate(request),
      )

      if (!completed) {
        return
      }
    }
  }
  private async generate(request: GenerationRequest) {
    const batch = batchSchema.parse(request.parameters)

    if (
      request.provider !== this.adapter.provider ||
      request.model !== this.adapter.model ||
      request.promptTemplateVersion !== "1"
    ) {
      throw new Error(
        "Recorded wording provider or template version is unavailable",
      )
    }

    const outcomes: GenerationCandidateInput[] = []
    for (let index = 0; index < batch.count; index += 1) {
      outcomes.push(
        // eslint-disable-next-line no-await-in-loop -- Bound provider concurrency and preserve batch order.
        await enrichCandidate(
          this.adapter,
          batch.curriculumBrief,
          makeProblem(batch.templateCode, request.seed, index),
        ),
      )
    }

    return outcomes
  }
  async createRequest(body: unknown, adminSubject: string) {
    const batch = parse(batchSchema, body)
    const request = await withTransaction(this.pool, async (tx) => {
      const family =
        batch.templateCode === "fraction-addition-v1"
          ? "fraction_addition"
          : "percentage_of_quantity"
      const template = await tx.query<{ id: string }>(
        `INSERT INTO math_problem_template (name,version,family) VALUES ($1,'1',$2)
        ON CONFLICT (name,version) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
        [batch.templateCode, family],
      )
      const job = await createGenerationRequest(tx, {
        templateId: template.rows[0].id,
        parameters: batch,
        provider: this.adapter.provider,
        model: this.adapter.model,
        promptTemplateVersion: "1",
        seed: randomUUID(),
      })
      await tx.query(
        `INSERT INTO admin_audit_log (admin_subject,action,resource_type,resource_id) VALUES ($1,'math_generation_requested','math_generation_request',$2)`,
        [adminSubject, job.id],
      )

      return job
    })
    this.wakeWorker()

    return {
      requestId: request.id,
      status: "queued" as const,
      candidatesUrl: `/api/admin/math/generation-requests/${request.id}/candidates`,
    }
  }
  requests(query: unknown) {
    return listGenerationRequests(this.pool, parse(pageSchema, query))
  }
  async candidates(id: string) {
    const exists =
      z.uuid().safeParse(id).success &&
      (
        await this.pool.query(
          "SELECT 1 FROM ai_generation_request WHERE id=$1",
          [id],
        )
      ).rowCount

    if (!exists) {
      throw new ProblemException({
        type: "generation_request_not_found",
        status: 404,
        title: "No such generation request exists.",
      })
    }

    return listCandidates(this.pool, id)
  }
  async detail(id: string, query: unknown, adminSubject: string) {
    const { includeAudit } = parse(detailQuerySchema, query)
    const audit = includeAudit === "true"
    const candidate =
      z.uuid().safeParse(id).success &&
      (await loadCandidateDetail(this.pool, id, { includeAudit: audit }))

    if (!candidate) {
      throw missing()
    }

    if (audit) {
      await this.pool.query(
        `INSERT INTO admin_audit_log (admin_subject,action,resource_type,resource_id) VALUES ($1,'math_candidate_raw_viewed','math_candidate',$2)`,
        [adminSubject, id],
      )
    }

    return candidate
  }

  review(id: string, body: unknown, reviewerSubject: string) {
    const decision = parse(reviewSchema, body)

    if (!z.uuid().safeParse(id).success) {
      throw missing()
    }

    // The repository's standalone review commits its own transaction. This HTTP
    // decision must commit together with the immutable audit entry.
    return withTransaction(this.pool, async (tx) => {
      const locked = await tx.query(
        "SELECT id FROM ai_generation_candidate WHERE id=$1 FOR UPDATE",
        [id],
      )
      const candidate = locked.rowCount && (await loadCandidateDetail(tx, id))

      if (!candidate) {
        throw missing()
      }

      const canReview =
        decision.decision === "rejected"
          ? candidate.status === "in_review" || candidate.status === "draft"
          : candidate.status === "in_review" &&
            candidate.validation?.valid === true &&
            candidate.canonicalSpec !== null &&
            verifyMathProblem(candidate.canonicalSpec).valid

      if (!canReview) {
        throw new ProblemException({
          type: "invalid_candidate_transition",
          status: 409,
          title: "This candidate cannot make the requested review transition.",
        })
      }

      await tx.query(
        `UPDATE ai_generation_candidate SET status=$2, reviewer_subject=$3,
          reviewed_at=now(), updated_at=now(), validator_reports=(
            CASE WHEN validator_reports IS NULL THEN '{}'::jsonb
                 WHEN jsonb_typeof(validator_reports)='object' THEN validator_reports
                 ELSE jsonb_build_object('previousReports',validator_reports) END
          ) || jsonb_build_object('reviewReason',$4::text)
          WHERE id=$1`,
        [id, decision.decision, reviewerSubject, decision.reason ?? null],
      )
      await tx.query(
        `INSERT INTO admin_audit_log (admin_subject,action,resource_type,resource_id,metadata)
          VALUES ($1,'math_candidate_reviewed','math_candidate',$2,$3::jsonb)`,
        [reviewerSubject, id, JSON.stringify(decision)],
      )
      const updated = await loadCandidateDetail(tx, id)

      if (!updated) {
        throw missing()
      }

      return updated
    })
  }
}
