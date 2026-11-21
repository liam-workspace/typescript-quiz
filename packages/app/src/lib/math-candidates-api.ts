import type {
  ContentBlock,
  MathProblemSpec,
  ValidationResult,
} from "@pp/common"
import { apiFetch } from "./api-client.js"

export interface MathGenerationRequest {
  readonly id: string
  readonly templateId: string | null
  readonly parameters: { readonly templateCode?: string }
  readonly provider: string
  readonly model: string
  readonly promptTemplateVersion: string
  readonly seed: string
  readonly createdAt: string
  readonly status: "queued" | "processing" | "completed"
}

interface MathGenerationRequestPage {
  readonly items: MathGenerationRequest[]
  readonly nextCursor: string | null
}

interface MathCandidateValidation extends ValidationResult {
  readonly source: "provider" | "math" | "presentation" | "duplicate"
  readonly duplicateContentHash?: string
}

export interface MathCandidateSummary {
  readonly id: string
  readonly requestId: string
  readonly status:
    | "draft"
    | "in_review"
    | "approved"
    | "rejected"
    | "regeneration_requested"
  readonly promptBlocks: ContentBlock[] | null
  readonly choices: Array<{
    readonly label: string
    readonly labelBlocks: ContentBlock[]
    readonly isCorrect: boolean
  }> | null
  readonly solutionBlocks: ContentBlock[] | null
  readonly contentHash: string
  readonly validation: MathCandidateValidation | null
  readonly reviewReason: string | null
  readonly reviewerSubject: string | null
  readonly reviewedAt: string | null
  readonly testVersionId: string | null
  readonly createdAt: string
}

export interface MathCandidateDetail extends MathCandidateSummary {
  readonly canonicalSpec: MathProblemSpec | null
  readonly provenance: Pick<
    MathGenerationRequest,
    "templateId" | "provider" | "model" | "promptTemplateVersion" | "seed"
  >
}

interface MathCandidateAudit {
  readonly audit?: { readonly rawResponse: unknown }
}

export type MathReviewDecision = "approved" | "rejected"

const requestsPath = "/admin/math/generation-requests"

function candidatePath(candidateId: string): string {
  return `/admin/math/candidates/${encodeURIComponent(candidateId)}`
}

export function listMathGenerationRequests(
  cursor?: string,
  signal?: AbortSignal,
): Promise<MathGenerationRequestPage> {
  const query = new URLSearchParams({ limit: "10" })

  if (cursor) {
    query.set("cursor", cursor)
  }

  return apiFetch<MathGenerationRequestPage>(`${requestsPath}?${query}`, {
    signal,
  })
}

export function listMathCandidates(
  requestId: string,
  signal?: AbortSignal,
): Promise<MathCandidateSummary[]> {
  return apiFetch<MathCandidateSummary[]>(
    `${requestsPath}/${encodeURIComponent(requestId)}/candidates`,
    { signal },
  )
}

export function getMathCandidate(
  candidateId: string,
  signal?: AbortSignal,
): Promise<MathCandidateDetail> {
  return apiFetch<MathCandidateDetail>(candidatePath(candidateId), {
    cache: "no-store",
    signal,
  })
}

export async function getMathCandidateRawOutput(
  candidateId: string,
): Promise<unknown> {
  const { audit } = await apiFetch<MathCandidateAudit>(
    `${candidatePath(candidateId)}?includeAudit=true`,
    { cache: "no-store" },
  )

  return audit?.rawResponse ?? null
}

export function reviewMathCandidate(
  candidateId: string,
  decision: MathReviewDecision,
  reason?: string,
): Promise<MathCandidateDetail> {
  return apiFetch<MathCandidateDetail>(`${candidatePath(candidateId)}/review`, {
    method: "PATCH",
    body: JSON.stringify({ decision, reason }),
  })
}
