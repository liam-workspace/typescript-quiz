import type { OfflineBundleSection, RunnerSection } from "../api-types.js"

/** A bundle section as an untouched `RunnerSection`: content only, no attempt state yet. */
export function toPendingSection(section: OfflineBundleSection): RunnerSection {
  return {
    id: section.id,
    type: section.type,
    title: section.title,
    questionCount: section.questionCount,
    durationSeconds: section.durationSeconds,
    instructions: section.instructions,
    status: "pending",
    completedAt: null,
    navigation: section.navigation,
    allowAnswerChange: section.allowAnswerChange,
    expiresAt: null,
    groups: section.groups,
  }
}
