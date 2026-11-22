import type {
  RunnerEnvelope,
  RunnerSection,
  StimulusWire,
} from "../api-types.js"
import type { LocalAttemptState } from "./journal-types.js"

/** The saved file's object URL for a stimulus, or the URL it already had. */
export type MediaUrlResolver = (
  stimulusId: string,
  existingUrl: string | undefined,
) => Promise<string | undefined>

async function localStimulus(
  stimulus: StimulusWire,
  state: LocalAttemptState,
  resolveMediaUrl: MediaUrlResolver,
): Promise<StimulusWire> {
  if (stimulus.maxPlays !== null) {
    // Capped: never a URL in the payload (the play grant carries it).
    return { ...stimulus, playsUsed: state.playsUsed[stimulus.id] ?? 0 }
  }

  const mediaUrl = await resolveMediaUrl(stimulus.id, stimulus.mediaUrl)

  return mediaUrl === undefined ? stimulus : { ...stimulus, mediaUrl }
}

/**
 * The runner payload for a local attempt: the same shape `GET /attempts/:id`
 * returns, built from device state. `responses` are the answers this device
 * knows the attempt holds; the run screen merges the answer queue over them
 * on mount, and the queue stays the source of truth for unsent answers.
 */
export async function buildLocalEnvelope(
  state: LocalAttemptState,
  nowMs: number,
  resolveMediaUrl: MediaUrlResolver,
): Promise<RunnerEnvelope> {
  const sections: RunnerSection[] = await Promise.all(
    state.sections.map(async (section) => ({
      ...section,
      groups: await Promise.all(
        section.groups.map(async (group) =>
          group.stimulus
            ? {
                ...group,
                stimulus: await localStimulus(
                  group.stimulus,
                  state,
                  resolveMediaUrl,
                ),
              }
            : group,
        ),
      ),
    })),
  )
  const responses = state.responses ?? []
  const answered = new Set(
    responses
      .filter((response) => response.selectedChoiceIds.length > 0)
      .map((response) => response.questionId),
  )
  const questions = sections
    .flatMap((section) => section.groups)
    .flatMap((group) => group.questions)

  return {
    id: state.attemptId,
    status: "in_progress",
    attemptNumber: state.attemptNumber,
    testTitle: state.title,
    expiresAt: state.attemptExpiresAt,
    serverTime: new Date(nowMs).toISOString(),
    questionCount: questions.length,
    answeredCount: questions.filter((q) => answered.has(q.id)).length,
    unansweredOrdinals: questions
      .filter((q) => !answered.has(q.id))
      .map((q) => q.ordinal)
      .sort((a, b) => a - b),
    currentSectionId: state.currentSectionId,
    currentQuestionId: state.currentQuestionId,
    sections,
    responses,
    offlineJournalCursor: state.syncedThrough,
  }
}
