export type SectionType = "listening" | "reading" | "vocabulary" | "grammar"

export type NavigationMode = "free" | "forward_only"

export type QuestionType = "single_choice" | "multi_choice"

export type StimulusType = "audio" | "passage" | "image" | "mixed"

export interface PlaybackRules {
  maxPlays: number | null
  allowPause: boolean
  allowSeek: boolean
}

// The attempt a request finalized by lazy expiry -- either the one it touched (a
// `410 attempt_expired` on `enterSection`) or a stale one cleared out of the way by a
// new `POST /attempts` (`finalizedPriorAttempt` on `AttemptStart`, openapi.yaml
// `FinalizedAttempt`). `status` is always `expired`: both uses are expiry-driven.
export interface FinalizedAttempt {
  id: string
  status: "expired"
  submittedAt: string
  resultUrl: string
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

// A stimulus with a play limit. Carries NO `mediaUrl` -- a cap is meaningless
// if the bytes are reachable without claiming a play, so the URL is issued
// only by `POST /play`, signed and short-lived (openapi.yaml:1318-1333,
// `additionalProperties: false`, no `mediaUrl` in its properties at all).
export interface CappedStimulusWire {
  id: string
  type: StimulusType
  title?: string
  bodyText?: string
  maxPlays: number
  playsUsed: number
  allowPause: boolean
  allowSeek: boolean
}

// A stimulus with no play limit -- an image, a passage, or audio a student
// may replay freely. Only these may carry a `mediaUrl` in the runner payload
// (openapi.yaml:1335-1351; `mediaUrl`/`allowPause`/`allowSeek` are all
// optional there, not required, since a passage-typed OpenStimulus has
// neither).
export interface OpenStimulusWire {
  id: string
  type: StimulusType
  title?: string
  bodyText?: string
  maxPlays: null
  mediaUrl?: string
  allowPause?: boolean
  allowSeek?: boolean
}

// Capped or uncapped. The distinction decides whether `mediaUrl` may appear
// at all -- keeping this a discriminated union (rather than one merged type
// with `mediaUrl?: string`) is what stops a component from accidentally
// rendering a `mediaUrl` for a capped stimulus. See api-types.test.ts.
export type StimulusWire = CappedStimulusWire | OpenStimulusWire

export interface QuestionGroup {
  id: string
  stimulus?: StimulusWire
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

// Mirrors openapi.yaml `ResponseSnapshotItem` -- the shape `AnswerQueue`'s
// records take once serialized for the wire, whether carried by a section
// flush's PATCH body or, here, by `SubmitRequest.responses`.
export interface ResponseSnapshotItem {
  questionId: string
  seq: number
  selectedChoiceIds: string[]
  answeredAt: string
  timeSpentMs?: number
}

// Openapi.yaml `SubmitRequest` (`POST /attempts/{id}/submit`). `responses`
// is optional there ("may be empty or absent") -- `buildSubmitRemainder`
// (lib/lifecycleFlush.ts) always supplies the array (possibly empty), which
// is structurally assignable here since a required array satisfies an
// optional one.
export interface SubmitRequest {
  clientInstanceId: string
  responses?: ResponseSnapshotItem[]
}

// Openapi.yaml `ItemResult` narrowed to the fields the client actually acts
// on (questionId, status) -- mirrors `ItemAckResult` in lib/flushController.ts,
// which reconciles the same shape for a section flush's `results`. Submit's
// `finalFlush` reconciles the queue the same way: "applied"/"ignored_stale"
// ack the item, "rejected" marks it a terminal rejection.
export interface SubmitFinalFlushItem {
  questionId: string
  status: "applied" | "ignored_stale" | "rejected"
}

// Openapi.yaml `SubmitResult`. Returned on both `200` (already submitted --
// the same row, not a regrade) and `201` (graded and finalized): the client
// treats both as success, since `apiFetch` only throws for a non-2xx status.
export interface SubmitResult {
  attemptId: string
  status: "submitted"
  submittedAt: string
  resultUrl: string
  finalFlush: SubmitFinalFlushItem[]
}

export interface AttemptSectionScore {
  title: string
  type: SectionType
  pointsEarned: number
  pointsPossible: number
}

export interface AttemptResult {
  attemptId: string
  test: {
    title: string
    version: number
  }
  status: "submitted" | "expired"
  submittedAt: string
  elapsedSeconds: number
  score: {
    pointsEarned: number
    pointsPossible: number
    percentage: number
    answered: number
    unanswered: number
    correct: number
    incorrect: number
    isPersonalBest: boolean
    sections: AttemptSectionScore[]
  }
}
