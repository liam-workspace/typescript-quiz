import type { AttemptId, ChoiceId, QuestionId } from "./ids.js"
import type { SectionType } from "./test.js"

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

/**
 * `RecordedResponse` on the wire (openapi.yaml): what the runner envelope
 * reports back for a question already answered. Mirrors `ResponseWrite`'s
 * ordering fields but is a server-read shape, not a client write -- there is
 * no `timeSpentMs` here because the envelope never reports it back.
 */
export interface RecordedResponseWire {
  questionId: QuestionId
  selectedChoiceIds: ChoiceId[]
  clientInstanceId: string
  /** What the resume merge compares. */
  seq: number
  /** Display text. Never consulted for ordering or expiry. */
  answeredAt?: string
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
  type: SectionType
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
