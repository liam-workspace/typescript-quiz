import type {
  AdminAttemptDetail,
  AdminLearnerPage,
  AdminLearnerSummary,
  AdminOverview,
  ContentBlock,
  SectionType,
  AdminPagination,
  AdminQuestion,
  AdminQuestionPage,
  AdminResultPage,
  AdminResultRollups,
  AdminResultSummary,
  AdminTestDetail,
  AdminTestFilter,
  AdminTestPage,
  AdminTestSummary,
  DraftQuestionPatch,
} from "@pp/common"

// Use the server's shared admin contracts, including authoritative answer data.
export type {
  AdminAttemptDetail,
  AdminLearnerPage,
  AdminLearnerSummary,
  AdminOverview,
  AdminQuestion,
  AdminQuestionPage,
  AdminResultPage,
  AdminResultRollups,
  AdminResultSummary,
  AdminTestDetail,
  AdminTestPage,
  AdminTestSummary,
  DraftQuestionPatch,
}

export type AdminPageQuery = Partial<AdminPagination>

export type AdminTestQuery = AdminPageQuery & AdminTestFilter

export type AdminQuestionQuery = AdminPageQuery &
  Pick<AdminTestFilter, "search"> & { testId?: string }

export type AdminResultQuery = AdminPageQuery & {
  testId?: string
  learnerId?: string
}

export interface AdminResultRollupQuery {
  testId?: string
  limit?: number
}

export type AdminLearnerQuery = AdminPageQuery & Pick<AdminTestFilter, "search">

export type { SectionType }

export type StudentLevel = "primary-step-1" | "primary-step-2"

export interface AttemptRef {
  attemptId: string
  submittedAt: string
  pointsEarned: number
  pointsPossible: number
  percentage: number
}

export interface TestCard {
  id: string
  slug: string
  title: string
  level: StudentLevel
  durationSeconds: number
  sections: Array<{
    type: SectionType
    questionCount: number
  }>
  inProgressAttemptId: string | null
  attemptCount: number
  bestAttempt: AttemptRef | null
  testVersionId: string
  mediaBytes: number
}

export interface StudentSummary {
  attemptCount: number
  averagePct: number
  bestPct: number
}

export interface TestCatalogPage {
  tests: TestCard[]
  nextCursor: string | null
  summary: StudentSummary
}

export interface TestBrief {
  id: string
  slug: string
  title: string
  level: StudentLevel
  durationSeconds: number
  attemptCount: number
  inProgressAttemptId: string | null
  sections: Array<{
    id: string
    type: SectionType
    title: string
    ordinal: number
    questionCount: number
    durationSeconds: number
    navigation: NavigationMode
    allowAnswerChange: boolean
    playback: PlaybackRules | null
    instructions: string[]
  }>
}

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

export interface AttemptStart {
  id: string
  attemptNumber: number
  status: "in_progress"
  createdAt: string
  startedAt: string | null
  expiresAt: string | null
  serverTime: string
  resumed: boolean
  currentSectionId?: string | null
  currentQuestionId?: string | null
  finalizedPriorAttempt: FinalizedAttempt | null
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
  labelBlocks?: ContentBlock[]
  imageSvg?: string
}

export interface RunnerQuestion {
  id: string
  ordinal: number
  type: QuestionType
  prompt: string
  promptBlocks?: ContentBlock[]
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
  // Present only for `type: "mixed"` -- "mixed" means text AND media, and
  // its own `type` never says which. See ReviewStimulus's mediaKind for the
  // same distinction on the review side.
  mediaKind?: "audio" | "image"
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
  // An `image` stimulus's alternative to mediaUrl -- inline <svg>, for the
  // same currentColor reason as RunnerChoice.imageSvg.
  imageSvg?: string
  allowPause?: boolean
  allowSeek?: boolean
  // Present only for `type: "mixed"` -- see CappedStimulusWire's mediaKind.
  mediaKind?: "audio" | "image"
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
  title: string
  questionCount: number
  durationSeconds: number
  instructions: string[]
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
  attemptNumber: number
  testTitle: string
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

export interface OfflineMedia {
  key: string
  stimulusId: string
  kind: "audio" | "image"
  mimeType: string
  bytes: number
  capped: boolean
  url: string
}

// A brief section plus its runner content. Everything that is per-attempt
// state on `RunnerSection` (status, completedAt, expiresAt) is absent: a bundle
// is content, an attempt is state.
export interface OfflineBundleSection
  extends Omit<RunnerSection, "status" | "completedAt" | "expiresAt"> {
  ordinal: number
  playback: PlaybackRules | null
}

// `GET /tests/:slug/offline-bundle`. Capped stimuli in `sections[].groups`
// carry no `mediaUrl`: match media to a stimulus through `media[].stimulusId`.
export interface OfflineBundle {
  slug: string
  testVersionId: string
  version: number
  title: string
  level: StudentLevel
  durationSeconds: number
  sections: OfflineBundleSection[]
  media: OfflineMedia[]
  totalBytes: number
  urlsExpireAt: string
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

export type FinishSectionRequest = SubmitRequest

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

export interface FinishSectionResult {
  sectionId: string
  status: "finished"
  nextSectionId: string | null
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

export interface AttemptHistoryRow {
  id: string
  test: {
    title: string
  }
  submittedAt: string
  status: "submitted" | "expired"
  pointsEarned: number
  pointsPossible: number
  percentage: number
  sections: AttemptSectionScore[]
}

export interface AttemptHistoryPage {
  attempts: AttemptHistoryRow[]
  nextCursor: string | null
}

export interface ReviewChoice {
  id: string
  label: string
  labelBlocks?: ContentBlock[]
  isCorrect: boolean
  selected: boolean
  imageSvg?: string
}

export type ReviewStimulus =
  | {
      id: string
      type: "audio"
      title?: string
      mediaUrl: string
      replayable: true
    }
  | {
      id: string
      type: "image"
      title?: string
      // Exactly one of these two is present, never neither.
      mediaUrl?: string
      imageSvg?: string
      replayable: true
    }
  | {
      id: string
      type: "passage"
      title: string
      bodyText: string
      replayable: true
    }
  | {
      id: string
      type: "mixed"
      title?: string
      bodyText: string
      mediaUrl: string
      // "mixed" says text-plus-media, never WHICH media. Without this the
      // client has to guess an audio player or a picture from the filename.
      mediaKind: "audio" | "image"
      replayable: true
    }

export interface ReviewItem {
  questionId: string
  ordinal: number
  sectionId: string
  sectionType: SectionType
  prompt: string
  promptBlocks?: ContentBlock[]
  solutionBlocks?: ContentBlock[]
  outcome: "correct" | "incorrect" | "unanswered"
  stimulus?: ReviewStimulus
  choices: ReviewChoice[]
}

export interface ReviewPayload {
  attemptId: string
  items: ReviewItem[]
}

/**
 * Openapi.yaml `Student` -- the response of `GET /me`. `isAdmin` gates the
 * admin area, which is a separate spec; no student screen renders it.
 */
export interface Student {
  id: string
  displayName: string
  email: string
  level: StudentLevel | null
  isAdmin: boolean
}

/**
 * Openapi.yaml `SessionResult` -- the response of `POST /session`
 * (`establishSession`, session.controller.ts). Same fields as `Student`
 * plus `created`, which distinguishes a `201` (this call provisioned the
 * row -- first sign-in) from a `200` (the student already existed); both
 * are success. A `403` is documented separately -- the email is not on the
 * allowlist -- and is not this shape at all, but an `ApiError` the caller
 * renders directly.
 */
export interface SessionResult extends Student {
  created: boolean
}
