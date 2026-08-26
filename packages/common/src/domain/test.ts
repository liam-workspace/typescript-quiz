import type { ChoiceId, QuestionId, SectionId, StimulusId } from "./ids.js"

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
}

export interface RunnerGroup {
  id: string
  stimulus?: RunnerStimulus
  questions: RunnerQuestion[]
}

export interface RunnerSection {
  id: SectionId
  type: SectionType
  status: "pending" | "open" | "closed"
  completedAt: string | null
  navigation: NavigationMode
  allowAnswerChange: boolean
  expiresAt: string | null
  groups: RunnerGroup[]
}

/** Used only by the scoring service. Never serialized to a student. */
export interface ScoringChoice extends RunnerChoice {
  isCorrect: boolean
}

export interface ScoringQuestion extends Omit<RunnerQuestion, "choices"> {
  points: number
  choices: ScoringChoice[]
}
