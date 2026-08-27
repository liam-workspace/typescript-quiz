import { apiFetch } from "./api-client.js"
import type { PlayGrant, RunnerEnvelope, SectionEntry } from "./api-types.js"

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
