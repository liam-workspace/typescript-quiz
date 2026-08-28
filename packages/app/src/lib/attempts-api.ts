import { apiFetch } from "./api-client.js"
import type {
  AttemptHistoryPage,
  AttemptResult,
  FinishSectionRequest,
  FinishSectionResult,
  PlayGrant,
  ReviewPayload,
  RunnerEnvelope,
  SectionEntry,
  SubmitRequest,
  SubmitResult,
} from "./api-types.js"

const HISTORY_PAGE_SIZE = 20

export function listAttemptHistory(
  cursor: string | null = null,
): Promise<AttemptHistoryPage> {
  const query = new URLSearchParams({
    status: "finished",
    limit: String(HISTORY_PAGE_SIZE),
  })

  if (cursor !== null) {
    query.set("cursor", cursor)
  }

  return apiFetch<AttemptHistoryPage>(`/attempts?${query.toString()}`)
}

export function getAttemptResult(attemptId: string): Promise<AttemptResult> {
  return apiFetch<AttemptResult>(`/attempts/${attemptId}/result`)
}

export function getAttemptReview(attemptId: string): Promise<ReviewPayload> {
  return apiFetch<ReviewPayload>(`/attempts/${attemptId}/review`)
}

export function getRunnerEnvelope(attemptId: string): Promise<RunnerEnvelope> {
  return apiFetch<RunnerEnvelope>(`/attempts/${attemptId}`)
}

export function enterSection(
  attemptId: string,
  sectionId: string,
): Promise<SectionEntry> {
  return apiFetch<SectionEntry>(
    `/attempts/${attemptId}/sections/${sectionId}/enter`,
    { method: "POST" },
  )
}

export function finishSection(
  attemptId: string,
  sectionId: string,
  body: FinishSectionRequest,
): Promise<FinishSectionResult> {
  return apiFetch<FinishSectionResult>(
    `/attempts/${attemptId}/sections/${sectionId}/finish`,
    { method: "POST", body: JSON.stringify(body) },
  )
}

export function claimPlay(
  attemptId: string,
  stimulusId: string,
): Promise<PlayGrant> {
  return apiFetch<PlayGrant>(
    `/attempts/${attemptId}/stimuli/${stimulusId}/play`,
    { method: "POST" },
  )
}

export function setPosition(
  attemptId: string,
  sectionId: string,
  questionId: string,
): Promise<void> {
  return apiFetch<undefined>(`/attempts/${attemptId}/position`, {
    method: "PUT",
    body: JSON.stringify({ sectionId, questionId }),
  })
}

// Thin wrapper, matching every other function in this module: it carries
// whatever body the caller built, rather than building the remainder itself.
// The remainder comes from `buildSubmitRemainder` (lib/lifecycleFlush.ts,
// "Task 10's submit-remainder builder"), called by the hand-in screen
// immediately before this -- keeping this module free of any IndexedDB
// dependency, the same layering FlushController (Task 9) already uses
// (queue and http are both injected, never opened by the flush layer
// itself).
export function submitAttempt(
  attemptId: string,
  body: SubmitRequest,
): Promise<SubmitResult> {
  return apiFetch<SubmitResult>(`/attempts/${attemptId}/submit`, {
    method: "POST",
    body: JSON.stringify(body),
  })
}
