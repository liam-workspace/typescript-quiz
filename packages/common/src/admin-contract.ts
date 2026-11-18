import { z } from "zod"

export const adminPaginationSchema = z
  .object({
    limit: z.number().int().min(1).max(100),
    cursor: z.string().min(1).nullable(),
  })
  .strict()

export type AdminPagination = z.infer<typeof adminPaginationSchema>

export const adminTestFilterSchema = z
  .object({
    status: z.enum(["draft", "published", "archived"]).optional(),
    search: z.string().trim().max(200).optional(),
  })
  .strict()

export type AdminTestFilter = z.infer<typeof adminTestFilterSchema>

const choicePatchSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().trim().min(1).max(2_000),
    isCorrect: z.boolean(),
  })
  .strict()

export const draftQuestionPatchSchema = z
  .object({
    prompt: z.string().trim().min(1).max(20_000).optional(),
    choices: z.array(choicePatchSchema).min(2).max(100).optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "at least one editable field is required",
  })

export type DraftQuestionPatch = z.infer<typeof draftQuestionPatchSchema>

export interface AdminOverview {
  tests: { total: number; drafts: number; published: number }
  attempts: { total: number; inProgress: number; completed: number }
  learners: { total: number }
}

export interface AdminTestSummary {
  id: string
  title: string
  status: "draft" | "published" | "archived"
  currentVersionId: string | null
  updatedAt: string
}

export interface AdminTestPage {
  items: AdminTestSummary[]
  nextCursor: string | null
}

export interface AdminTestDetail extends AdminTestSummary {
  versionId: string
  description: string | null
  durationSeconds: number
  sections: Array<{ id: string; title: string; questionCount: number }>
}

export interface AdminQuestion {
  id: string
  prompt: string
  choices: Array<{ id: string; label: string; isCorrect: boolean }>
}

export interface AdminQuestionPage {
  items: AdminQuestion[]
  nextCursor: string | null
}

export interface AdminResultSummary {
  attemptId: string
  testId: string
  testTitle: string
  learnerId: string
  score: number
  maxScore: number
  completedAt: string
}

export interface AdminResultPage {
  items: AdminResultSummary[]
  nextCursor: string | null
}

export interface AdminAttemptDetail extends AdminResultSummary {
  learnerName: string
  answers: Array<{
    questionId: string
    response: unknown
    score: number
    maxScore: number
  }>
}

export interface AdminLearnerSummary {
  id: string
  displayName: string
  email: string
  attemptCount: number
  lastAttemptAt: string | null
}

export interface AdminLearnerPage {
  items: AdminLearnerSummary[]
  nextCursor: string | null
}

export type AdminAuditAction =
  | "test.created"
  | "test.updated"
  | "test.published"
  | "question.updated"
  | "math_candidate.reviewed"
  | "math_candidate.imported"
  | "attempt_detail_viewed"
  | "draft_question_updated"
