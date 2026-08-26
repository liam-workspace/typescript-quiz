import type { AttemptId, ChoiceId, QuestionId } from "./ids.js"

export type AttemptStatus = "in_progress" | "submitted" | "expired"

export interface ResponseWrite {
  questionId: QuestionId
  /** Monotonic within one clientInstanceId. The ONLY ordering authority. */
  seq: number
  selectedChoiceIds: ChoiceId[]
  /** Display text. Never consulted for ordering or expiry. */
  answeredAt?: string
  timeSpentMs?: number
}

export type WriteStatus = "applied" | "ignored_stale" | "rejected"

export type RejectReason =
  | "answer_change_not_allowed"
  | "navigation_locked"
  | "unknown_question"
  | "invalid"

export type ItemResult =
  | { questionId: QuestionId; status: "applied" | "ignored_stale" }
  | {
      questionId: QuestionId
      status: "rejected"
      reason: RejectReason
      retryable: false
      /** The failed_write id. A rejection without one is data loss. */
      capturedAs: string
    }

export interface SectionScore {
  title: string
  type: string
  pointsEarned: number
  pointsPossible: number
}

export interface Score {
  pointsEarned: number
  pointsPossible: number
  percentage: number
  answered: number
  unanswered: number
  correct: number
  incorrect: number
  isPersonalBest: boolean
  sections: SectionScore[]
}

export interface AttemptSummary {
  id: AttemptId
  status: AttemptStatus
  startedAt: string | null
  expiresAt: string | null
  submittedAt: string | null
}
