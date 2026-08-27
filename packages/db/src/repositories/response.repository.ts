import {
  withTransaction,
  type PgPool,
  type PgQueryable,
} from "@liam-public/node-postgres"
import { canAcceptAnswerChange } from "@pp/common"

export type WriteOutcome =
  | { kind: "applied" }
  | { kind: "ignored_stale" }
  | {
      kind: "rejected"
      reason: "answer_change_not_allowed" | "invalid" | "unknown_question"
    }

function rejectionReasonFor(
  error: unknown,
): "invalid" | "unknown_question" | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null
  }

  const { code, constraint } = error as {
    code?: string
    constraint?: string
  }

  if (code === "23503") {
    if (constraint === "response_question_fk") {
      return "unknown_question"
    }

    if (constraint === "response_choice_choice_fk") {
      return "invalid"
    }
  }

  if (
    (code === "23505" && constraint === "response_choice_pkey") ||
    code === "22P02" ||
    code === "22003"
  ) {
    return "invalid"
  }

  return null
}

/**
 * The reorder guard. Ordering is by (clientInstanceId, seq), never
 * answeredAt: response_client_cursor holds THIS instance's high-water mark,
 * and a write is applied only when its seq exceeds that mark. A different
 * instance's write is judged by ITS OWN cursor row -- there is no shared
 * seq space across devices, only arrival order, which is what "last write
 * inside this transaction wins the `response` row" gives for free.
 *
 * allowAnswerChange is resolved by the caller (the section it belongs to),
 * not looked up here -- this repository is ordering/durability mechanics
 * only, not section business rules.
 */
export async function writeResponse(
  pool: PgPool,
  input: {
    attemptId: string
    questionId: string
    testVersionId: string
    clientInstanceId: string
    seq: number
    selectedChoiceIds: string[]
    answeredAt: Date | null
    timeSpentMs: number | null
    allowAnswerChange: boolean
    now: Date
  },
): Promise<WriteOutcome> {
  try {
    return await withTransaction(pool, async (tx) => {
      // Ensure the response row exists so response_client_cursor's FK can
      // reference it. A no-op if a prior write (from any instance) already
      // created it -- the row is never deleted, even on a clear. If
      // questionId/testVersionId don't name a real question, this throws a
      // foreign key violation (23503), caught below.
      await tx.query(
        `INSERT INTO response
           (attempt_id, question_id, test_version_id, client_instance_id, client_seq)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (attempt_id, question_id) DO NOTHING`,
        [
          input.attemptId,
          input.questionId,
          input.testVersionId,
          input.clientInstanceId,
          input.seq,
        ],
      )

      // The guard itself: advance THIS instance's cursor only if seq
      // increased. Atomic -- comparison and write in one statement, so two
      // concurrent writers racing for the same (attempt, question) cannot
      // both pass: Postgres row-locks the conflicting row for the second
      // writer's UPDATE, which then evaluates WHERE against what the first
      // writer already committed. Returns a row when accepted, zero rows
      // when stale.
      const cursor = await tx.query(
        `INSERT INTO response_client_cursor
           (attempt_id, question_id, client_instance_id, last_seq)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (attempt_id, question_id, client_instance_id) DO UPDATE
            SET last_seq = EXCLUDED.last_seq, updated_at = now()
          WHERE response_client_cursor.last_seq < EXCLUDED.last_seq
         RETURNING last_seq`,
        [input.attemptId, input.questionId, input.clientInstanceId, input.seq],
      )

      if (cursor.rows.length === 0) {
        return { kind: "ignored_stale" }
      }

      const existing = await tx.query<{ choice_id: string }>(
        `SELECT choice_id FROM response_choice WHERE attempt_id = $1 AND question_id = $2`,
        [input.attemptId, input.questionId],
      )
      const existingIds = existing.rows.map((row) => row.choice_id)
      const hasExistingAnswer = existingIds.length > 0

      if (
        !canAcceptAnswerChange(
          input.allowAnswerChange,
          hasExistingAnswer ? existingIds : null,
          input.selectedChoiceIds,
        )
      ) {
        return { kind: "rejected", reason: "answer_change_not_allowed" }
      }

      await tx.query(
        `UPDATE response
            SET client_instance_id = $3, client_seq = $4,
                answered_at = $5, time_spent_ms = $6, updated_at = now()
          WHERE attempt_id = $1 AND question_id = $2`,
        [
          input.attemptId,
          input.questionId,
          input.clientInstanceId,
          input.seq,
          input.answeredAt,
          input.timeSpentMs,
        ],
      )
      await tx.query(
        `DELETE FROM response_choice WHERE attempt_id = $1 AND question_id = $2`,
        [input.attemptId, input.questionId],
      )
      await Promise.all(
        input.selectedChoiceIds.map((choiceId) =>
          tx.query(
            `INSERT INTO response_choice (attempt_id, question_id, choice_id)
             VALUES ($1, $2, $3)`,
            [input.attemptId, input.questionId, choiceId],
          ),
        ),
      )

      return { kind: "applied" }
    })
  } catch (error) {
    const reason = rejectionReasonFor(error)

    if (reason) {
      return { kind: "rejected", reason }
    }

    throw error
  }
}

interface ResponseDbRow {
  client_instance_id: string
  // Node-postgres returns bigint as a string -- converted below.
  client_seq: string
}

export async function loadResponse(
  pool: PgQueryable,
  input: { attemptId: string; questionId: string },
): Promise<{
  selectedChoiceIds: string[]
  clientInstanceId: string
  seq: number
} | null> {
  const response = await pool.query<ResponseDbRow>(
    `SELECT client_instance_id, client_seq FROM response
      WHERE attempt_id = $1 AND question_id = $2`,
    [input.attemptId, input.questionId],
  )

  if (response.rows.length === 0) {
    return null
  }

  const choices = await pool.query<{ choice_id: string }>(
    `SELECT choice_id FROM response_choice
      WHERE attempt_id = $1 AND question_id = $2
      ORDER BY choice_id`,
    [input.attemptId, input.questionId],
  )

  const [row] = response.rows

  return {
    clientInstanceId: row.client_instance_id,
    // The client_seq column is `bigint`; node-postgres returns bigint as a
    // string to avoid silent precision loss, so this boundary converts.
    seq: Number(row.client_seq),
    selectedChoiceIds: choices.rows.map((r) => r.choice_id),
  }
}
