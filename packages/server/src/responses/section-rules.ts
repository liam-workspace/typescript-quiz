import type { PgQueryable } from "@liam-public/node-postgres"
import { HttpStatus } from "@nestjs/common"
import { canSetPosition, isPastDeadline } from "@pp/common"
import type { AttemptRow } from "@pp/db"
import { ProblemException } from "../attempts/problem.exception.js"

export interface SectionRules {
  allowAnswerChange: boolean
  attemptExpiresAt: Date | null
  sectionExpiresAt: Date | null
  navigationLocked: boolean
}

interface SectionRulesDbRow {
  allow_answer_change: boolean
  navigation: "free" | "forward_only"
  question_ordinal: number
  current_ordinal: number | null
  section_expires_at: Date | null
}

export async function resolveSectionRules(
  pool: PgQueryable,
  input: { attempt: AttemptRow; questionId: string },
): Promise<SectionRules> {
  const { attempt, questionId } = input
  const { rows } = await pool.query<SectionRulesDbRow>(
    `SELECT ts.allow_answer_change,
            ts.navigation,
            target.ordinal AS question_ordinal,
            CASE
              WHEN current_group.test_section_id = ts.id
              THEN current.ordinal
              ELSE NULL
            END AS current_ordinal,
            attempt_section.expires_at AS section_expires_at
       FROM question target
       JOIN question_group target_group
         ON target_group.id = target.question_group_id
       JOIN test_section ts
         ON ts.id = target_group.test_section_id
        AND ts.test_version_id = target.test_version_id
       LEFT JOIN question current
         ON current.id = $3
        AND current.test_version_id = target.test_version_id
       LEFT JOIN question_group current_group
         ON current_group.id = current.question_group_id
       LEFT JOIN attempt_section
         ON attempt_section.attempt_id = $4
        AND attempt_section.test_section_id = ts.id
      WHERE target.id = $1 AND target.test_version_id = $2`,
    [questionId, attempt.testVersionId, attempt.currentQuestionId, attempt.id],
  )

  if (rows.length === 0) {
    return {
      allowAnswerChange: true,
      attemptExpiresAt: attempt.expiresAt,
      sectionExpiresAt: null,
      navigationLocked: false,
    }
  }

  const [row] = rows

  return {
    allowAnswerChange: row.allow_answer_change,
    attemptExpiresAt: attempt.expiresAt,
    sectionExpiresAt: row.section_expires_at,
    navigationLocked: !canSetPosition(
      row.navigation,
      row.current_ordinal,
      row.question_ordinal,
    ),
  }
}

export function mapWriteConflict(rules: SectionRules, now: Date): void {
  if (isPastDeadline(rules.sectionExpiresAt, now)) {
    throw new ProblemException({
      type: "section_expired",
      title: "The section's clock ran out.",
      status: HttpStatus.GONE,
      retryable: false,
    })
  }
}
