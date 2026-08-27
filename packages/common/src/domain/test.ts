import type {
  ChoiceId,
  GroupId,
  QuestionId,
  SectionId,
  StimulusId,
} from "./ids.js"

export type SectionType = "listening" | "reading" | "vocabulary" | "grammar"

export type NavigationMode = "free" | "forward_only"

export type QuestionType = "single_choice" | "multi_choice"

export type StimulusType = "audio" | "passage" | "image" | "mixed"

export interface Playback {
  maxPlays: number | null
  allowPause: boolean
  allowSeek: boolean
}

/** What a student may see. `isCorrect` is absent BY CONSTRUCTION. */
export interface RunnerChoice {
  id: ChoiceId
  label: string
}

export interface RunnerQuestion {
  id: QuestionId
  ordinal: number
  type: QuestionType
  prompt: string
  choices: RunnerChoice[]
}

/** A capped stimulus carries no mediaUrl; the URL is issued only by /play. */
export interface RunnerStimulus {
  id: StimulusId
  type: StimulusType
  title?: string
  bodyText?: string
  maxPlays: number | null
  playsUsed: number
  allowPause: boolean
  allowSeek: boolean
  mediaUrl?: string
  // Present only for `type: "mixed"` -- "mixed" means text AND media, and
  // its own `type` never says which. media_asset.kind carries the answer;
  // see packages/db/src/repositories/test-version.repository.ts.
  mediaKind?: "audio" | "image"
}

export interface RunnerGroup {
  id: GroupId
  stimulus?: RunnerStimulus
  questions: RunnerQuestion[]
}

/**
 * Per-attempt progress (status, completedAt, expiresAt) is deliberately
 * absent: it lives in attempt_section, which nothing in plan 1 creates, so a
 * projection built from content alone cannot know it. A type that omits what
 * it cannot know beats one that fills it with constants.
 */
export interface RunnerSection {
  id: SectionId
  type: SectionType
  navigation: NavigationMode
  allowAnswerChange: boolean
  groups: RunnerGroup[]
}

/**
 * The per-attempt progress plan 1's RunnerSection deliberately omits (see
 * above). Plan 3 joins attempt_section and merges this in, turning content
 * plus progress into the one section shape the runner envelope's contract
 * (`RunnerSection` in openapi.yaml) actually requires.
 */
export interface RunnerSectionState {
  status: "pending" | "open" | "closed"
  completedAt: string | null
  expiresAt: string | null
}
