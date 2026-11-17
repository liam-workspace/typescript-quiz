import { apiFetch } from "./api-client.js"
import type {
  AdminAttemptDetail,
  AdminLearnerPage,
  AdminLearnerQuery,
  AdminOverview,
  AdminPageQuery,
  AdminQuestion,
  AdminQuestionPage,
  AdminQuestionQuery,
  AdminResultPage,
  AdminResultQuery,
  AdminTestDetail,
  AdminTestPage,
  AdminTestQuery,
  DraftQuestionPatch,
} from "./api-types.js"

function listPath(path: string, query: AdminPageQuery): string {
  const params = new URLSearchParams()

  for (const [key, value] of Object.entries<string | number | null | undefined>(
    query,
  )) {
    if (value !== undefined && value !== null) {
      params.set(key, String(value))
    }
  }

  const search = params.toString()

  return search ? `${path}?${search}` : path
}

export function getAdminOverview(): Promise<AdminOverview> {
  return apiFetch<AdminOverview>("/admin/overview")
}

export function listAdminTests(
  query: AdminTestQuery = {},
): Promise<AdminTestPage> {
  return apiFetch<AdminTestPage>(listPath("/admin/tests", query))
}

export function getAdminTest(testId: string): Promise<AdminTestDetail> {
  return apiFetch<AdminTestDetail>(`/admin/tests/${encodeURIComponent(testId)}`)
}

export function listAdminQuestions(
  query: AdminQuestionQuery = {},
): Promise<AdminQuestionPage> {
  return apiFetch<AdminQuestionPage>(listPath("/admin/questions", query))
}

export function patchDraftQuestion(
  versionId: string,
  questionId: string,
  patch: DraftQuestionPatch,
): Promise<AdminQuestion> {
  return apiFetch<AdminQuestion>(
    `/admin/drafts/${encodeURIComponent(versionId)}/questions/${encodeURIComponent(questionId)}`,
    { method: "PATCH", body: JSON.stringify(patch) },
  )
}

export function listAdminResults(
  query: AdminResultQuery = {},
): Promise<AdminResultPage> {
  return apiFetch<AdminResultPage>(listPath("/admin/results", query))
}

export function getAdminAttempt(
  attemptId: string,
): Promise<AdminAttemptDetail> {
  return apiFetch<AdminAttemptDetail>(
    `/admin/results/attempts/${encodeURIComponent(attemptId)}`,
  )
}

export function listAdminLearners(
  query: AdminLearnerQuery = {},
): Promise<AdminLearnerPage> {
  return apiFetch<AdminLearnerPage>(listPath("/admin/learners", query))
}
