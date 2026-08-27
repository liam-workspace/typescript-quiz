import {
  asChoiceId,
  asQuestionId,
  asSectionId,
  gradeAttempt,
  type GradableResponse,
  type GradableSection,
  type GradeResult,
} from "@pp/common"
import type { PgPool, PgQueryable } from "@liam-public/node-postgres"
import { loadForScoring } from "../scoring.js"

export type AttemptResultOutcome =
  | { kind: "not_found" }
  | { kind: "still_running" }
  | {
      kind: "ready"
      result: {
        attemptId: string
        testTitle: string
        testVersion: number
        status: "submitted" | "expired"
        submittedAt: Date
        elapsedSeconds: number
        score: GradeResult
        isPersonalBest: boolean
      }
    }

interface AttemptResultDbRow {
  attempt_id: string
  test_version_id: string
  test_title: string
  test_version: number
  status: "in_progress" | "submitted" | "expired"
  submitted_at: Date | null
  elapsed_seconds: number
  points_earned: number | null
  points_possible: number | null
  percentage: string | null
  answered_count: number | null
  unanswered_count: number | null
  correct_count: number | null
  incorrect_count: number | null
  is_personal_best: boolean
}

interface SectionDbRow {
  id: string
  title: string
  type: string
}

interface ResponseDbRow {
  question_id: string
  choice_ids: string[]
}

/**
 * Recomputes the uncached section breakdown from frozen content and frozen
 * responses. This helper never writes: only finalizeAttemptTx owns score
 * persistence. It stays internal to @pp/db so the answer-key projection it
 * consumes cannot cross into a student-facing server module.
 */
export async function gradeExistingAttempt(
  db: PgQueryable,
  input: { attemptId: string; testVersionId: string },
): Promise<GradeResult> {
  const [{ rows: sectionRows }, questions, { rows: responseRows }] =
    await Promise.all([
      db.query<SectionDbRow>(
        `SELECT id, title, type::text AS type
           FROM test_section
          WHERE test_version_id = $1
          ORDER BY ordinal`,
        [input.testVersionId],
      ),
      loadForScoring(db, input.testVersionId),
      db.query<ResponseDbRow>(
        `SELECT r.question_id,
                COALESCE(
                  array_agg(rc.choice_id) FILTER (WHERE rc.choice_id IS NOT NULL),
                  '{}'
                ) AS choice_ids
           FROM response r
           LEFT JOIN response_choice rc
             ON rc.attempt_id = r.attempt_id
            AND rc.question_id = r.question_id
          WHERE r.attempt_id = $1
          GROUP BY r.question_id`,
        [input.attemptId],
      ),
    ])

  const sections: GradableSection[] = sectionRows.map((row) => ({
    id: asSectionId(row.id),
    title: row.title,
    type: row.type as GradableSection["type"],
  }))
  const responses: GradableResponse[] = responseRows.map((row) => ({
    questionId: asQuestionId(row.question_id),
    selectedChoiceIds: row.choice_ids.map(asChoiceId),
  }))

  return gradeAttempt({ sections, questions, responses })
}

/**
 * Loads only an already-finished result. An in-progress row has no result,
 * even when its deadline is in the past; expiry/finalization remains owned by
 * the established attempt write paths and is never triggered by this read.
 */
export async function loadAttemptResult(
  pool: PgPool,
  input: { attemptId: string; now: Date },
): Promise<AttemptResultOutcome> {
  const { rows } = await pool.query<AttemptResultDbRow>(
    `SELECT a.id AS attempt_id,
            a.test_version_id,
            tv.title AS test_title,
            tv.version AS test_version,
            a.status,
            a.submitted_at,
            CASE
              WHEN a.started_at IS NULL OR a.submitted_at IS NULL THEN 0
              ELSE GREATEST(
                0,
                FLOOR(EXTRACT(EPOCH FROM (a.submitted_at - a.started_at)))
              )::integer
            END AS elapsed_seconds,
            a.points_earned,
            a.points_possible,
            a.percentage,
            a.answered_count,
            a.unanswered_count,
            a.correct_count,
            a.incorrect_count,
            NOT EXISTS (
              SELECT 1
                FROM attempt better
               WHERE better.student_id = a.student_id
                 AND better.test_version_id = a.test_version_id
                 AND better.status <> 'in_progress'
                 AND better.percentage > a.percentage
            ) AS is_personal_best
       FROM attempt a
       JOIN test_version tv ON tv.id = a.test_version_id
      WHERE a.id = $1`,
    [input.attemptId],
  )

  if (rows.length === 0) {
    return { kind: "not_found" }
  }

  const [row] = rows

  if (row.status === "in_progress") {
    return { kind: "still_running" }
  }

  if (
    row.submitted_at === null ||
    row.points_earned === null ||
    row.points_possible === null ||
    row.percentage === null ||
    row.answered_count === null ||
    row.unanswered_count === null ||
    row.correct_count === null ||
    row.incorrect_count === null
  ) {
    throw new Error(
      `attempt ${input.attemptId} is terminal but missing a graded column`,
    )
  }

  const fresh = await gradeExistingAttempt(pool, {
    attemptId: row.attempt_id,
    testVersionId: row.test_version_id,
  })

  return {
    kind: "ready",
    result: {
      attemptId: row.attempt_id,
      testTitle: row.test_title,
      testVersion: row.test_version,
      status: row.status,
      submittedAt: row.submitted_at,
      elapsedSeconds: row.elapsed_seconds,
      score: {
        pointsEarned: row.points_earned,
        pointsPossible: row.points_possible,
        percentage: Number(row.percentage),
        answered: row.answered_count,
        unanswered: row.unanswered_count,
        correct: row.correct_count,
        incorrect: row.incorrect_count,
        sections: fresh.sections,
      },
      isPersonalBest: row.is_personal_best,
    },
  }
}
