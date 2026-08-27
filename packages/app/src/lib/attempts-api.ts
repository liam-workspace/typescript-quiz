import { apiFetch } from "./api-client.js"
import type {
  PlayGrant,
  RunnerEnvelope,
  SectionEntry,
  SubmitRequest,
  SubmitResult,
} from "./api-types.js"

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
