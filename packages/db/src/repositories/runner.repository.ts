import {
  asChoiceId,
  asQuestionId,
  type QuestionId,
  type RecordedResponseWire,
  type RunnerSection,
  type RunnerSectionState,
} from "@pp/common"
import type { PgQueryable } from "@liam-public/node-postgres"
import { loadForRunner } from "./test-version.repository.js"

/** Content merged with this attempt's per-section progress. */
type RunnerSectionView = RunnerSection & RunnerSectionState

/**
 * The four fields left out here (id, status, expiresAt,
 * currentSectionId/currentQuestionId) come straight off the AttemptRow the
 * controller already has from loadRunningOwnedAttempt -- re-selecting them
 * here would be a second, redundant read of the same row.
 */
export interface RunnerEnvelopeRow {
  id: string
  status: "in_progress"
  expiresAt: string | null
  questionCount: number
  answeredCount: number
  unansweredOrdinals: number[]
  currentSectionId: string | null
  currentQuestionId: string | null
  sections: RunnerSectionView[]
  responses: RecordedResponseWire[]
}

interface SectionStateRow {
  test_section_id: string
  entered_at: Date
  expires_at: Date
  completed_at: Date | null
}

interface ResponseRow {
  question_id: string
  client_instance_id: string
  client_seq: string
  answered_at: Date | null
  choice_ids: string[]
}

const SECTION_STATE_QUERY = `
  SELECT test_section_id, entered_at, expires_at, completed_at
    FROM attempt_section WHERE attempt_id = $1
`

const RESPONSES_QUERY = `
  SELECT r.question_id, r.client_instance_id, r.client_seq, r.answered_at,
         COALESCE(array_agg(rc.choice_id) FILTER (WHERE rc.choice_id IS NOT NULL), '{}') AS choice_ids
    FROM response r
    LEFT JOIN response_choice rc
      ON rc.attempt_id = r.attempt_id AND rc.question_id = r.question_id
   WHERE r.attempt_id = $1
   GROUP BY r.question_id, r.client_instance_id, r.client_seq, r.answered_at
`

/**
 * The runner projection: content (via loadForRunner, which already omits
 * isCorrect and a play-capped stimulus's mediaUrl) merged with this
 * attempt's per-section progress and recorded responses. Nothing here
 * imports @pp/db/scoring -- that entry point is fenced off precisely so a
 * student-facing read like this one cannot reach the answer key.
 */
export async function loadRunnerEnvelope(
  db: PgQueryable,
  input: { attemptId: string; testVersionId: string },
): Promise<
  Omit<
    RunnerEnvelopeRow,
    "id" | "status" | "expiresAt" | "currentSectionId" | "currentQuestionId"
  >
> {
  const [content, stateResult, responseResult] = await Promise.all([
    loadForRunner(db, input.testVersionId, input.attemptId),
    db.query<SectionStateRow>(SECTION_STATE_QUERY, [input.attemptId]),
    db.query<ResponseRow>(RESPONSES_QUERY, [input.attemptId]),
  ])

  const stateBySection = new Map(
    stateResult.rows.map((r) => [r.test_section_id, r]),
  )
  const sections = content.map((section) =>
    mergeSectionState(section, stateBySection.get(section.id)),
  )

  const questionCount = sections.reduce(
    (sum, s) =>
      sum + s.groups.reduce((groupSum, g) => groupSum + g.questions.length, 0),
    0,
  )
  const responses = responseResult.rows.map(toRecordedResponse)
  const answeredOrdinals = new Set(
    responses
      .filter((r) => r.selectedChoiceIds.length > 0)
      .map((r) => findOrdinal(sections, r.questionId)),
  )
  const unansweredOrdinals = sections
    .flatMap((s) => s.groups.flatMap((g) => g.questions))
    .map((q) => q.ordinal)
    .filter((ordinal) => !answeredOrdinals.has(ordinal))
    .sort((a, b) => a - b)

  return {
    questionCount,
    answeredCount: answeredOrdinals.size,
    unansweredOrdinals,
    sections,
    responses,
  }
}

function mergeSectionState(
  section: RunnerSection,
  state: SectionStateRow | undefined,
): RunnerSectionView {
  if (!state) {
    return { ...section, status: "pending", completedAt: null, expiresAt: null }
  }

  return {
    ...section,
    status: state.completed_at ? "closed" : "open",
    completedAt: state.completed_at ? state.completed_at.toISOString() : null,
    expiresAt: state.expires_at.toISOString(),
  }
}

function toRecordedResponse(r: ResponseRow): RecordedResponseWire {
  return {
    questionId: asQuestionId(r.question_id),
    selectedChoiceIds: r.choice_ids.map(asChoiceId),
    clientInstanceId: r.client_instance_id,
    // Node-postgres returns bigint as a string; the wire contract's seq
    // is an integer.
    seq: Number(r.client_seq),
    ...(r.answered_at ? { answeredAt: r.answered_at.toISOString() } : {}),
  }
}

/**
 * Throws rather than returning undefined: a response referencing a question
 * absent from this version's content would mean loadForRunner and the
 * response table disagree about which test_version_id an attempt belongs
 * to, which the schema's FK pair (response_question_fk) should already
 * make impossible.
 */
function findOrdinal(
  sections: RunnerSectionView[],
  questionId: QuestionId,
): number {
  for (const section of sections) {
    for (const group of section.groups) {
      const question = group.questions.find((q) => q.id === questionId)

      if (question) {
        return question.ordinal
      }
    }
  }

  throw new Error(`question ${questionId} not found in this version's content`)
}
