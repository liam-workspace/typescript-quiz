import type { PlaybackRules, RunnerSection } from "../api-types.js"

export type JournalEventType =
  | "start"
  | "enter_section"
  | "play"
  | "position"
  | "answer"
  | "finish_section"

export interface JournalEventRecord {
  readonly attemptId: string
  readonly eventSeq: number
  readonly type: JournalEventType
  readonly clientAt: string
  readonly payload: Readonly<Record<string, unknown>>
}

export interface LocalAttemptState {
  attemptId: string
  slug: string | null
  testVersionId: string | null
  title: string
  attemptNumber: number
  /** JWT `sub` of the owning student; sync and Continue act only for them. */
  ownerSub: string | null
  origin: "offline" | "hydrated"
  /** The server holds (or adopted) this attempt id. */
  serverKnown: boolean
  /** ISO, on the LOCAL clock timeline. */
  createdAt: string
  versionDurationSeconds: number
  sections: RunnerSection[]
  playbackBySection: Record<string, PlaybackRules | null>
  mediaKeyByStimulus: Record<string, string>
  attemptStartedAt: string | null
  attemptExpiresAt: string | null
  currentSectionId: string | null
  currentQuestionId: string | null
  playsUsed: Record<string, number>
  nextEventSeq: number
  syncedThrough: number
  finalized: { status: "expired"; submittedAt: string } | null
  syncError: string | null
}
