export type SectionType = "listening" | "reading" | "vocabulary" | "grammar"

export type NavigationMode = "free" | "forward_only"

export type QuestionType = "single_choice" | "multi_choice"

export type StimulusType = "audio" | "passage" | "image" | "mixed"

export interface PlaybackRules {
  maxPlays: number | null
  allowPause: boolean
  allowSeek: boolean
}

export interface SectionEntry {
  sectionId: string
  title: string
  type: SectionType
  questionCount: number
  enteredAt: string
  expiresAt: string
  serverTime: string
  attemptStartedAt?: string
  attemptExpiresAt?: string
  navigation: NavigationMode
  allowAnswerChange: boolean
  playback: PlaybackRules | null
  instructions: string[]
}

export interface PlayGrant {
  stimulusId: string
  playsUsed: number
  playsRemaining: number | null
  mediaUrl: string
  urlExpiresAt: string
}

export interface RunnerChoice {
  id: string
  label: string
}

export interface RunnerQuestion {
  id: string
  ordinal: number
  type: QuestionType
  prompt: string
  choices: RunnerChoice[]
}

export interface CappedStimulus {
  id: string
  type: StimulusType
  title?: string
  bodyText?: string
  maxPlays: number
  playsUsed: number
  allowPause: boolean
  allowSeek: boolean
}

export interface OpenStimulus {
  id: string
  type: StimulusType
  title?: string
  bodyText?: string
  maxPlays: null
  mediaUrl?: string
  allowPause?: boolean
  allowSeek?: boolean
}

export interface QuestionGroup {
  id: string
  stimulus?: CappedStimulus | OpenStimulus
  questions: RunnerQuestion[]
}

export interface RunnerSection {
  id: string
  type: SectionType
  status: "pending" | "open" | "closed"
  completedAt: string | null
  navigation: NavigationMode
  allowAnswerChange: boolean
  expiresAt: string | null
  groups: QuestionGroup[]
}

export interface RecordedResponse {
  questionId: string
  selectedChoiceIds: string[]
  clientInstanceId: string
  seq: number
  answeredAt?: string
}

export interface RunnerEnvelope {
  id: string
  status: "in_progress"
  expiresAt: string | null
  serverTime: string
  questionCount: number
  answeredCount: number
  unansweredOrdinals: number[]
  currentSectionId: string | null
  currentQuestionId: string | null
  sections: RunnerSection[]
  responses: RecordedResponse[]
}
