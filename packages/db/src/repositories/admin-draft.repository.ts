/* eslint-disable max-classes-per-file -- Draft mutation errors share this repository boundary. */
import { withTransaction } from "@liam-workspace/node-postgres"
import {
  draftQuestionPatchSchema,
  type AdminQuestion,
  type DraftQuestionPatch,
} from "@pp/common"
import type pg from "pg"

/** The version or question does not exist, or the question belongs elsewhere. */
export class DraftQuestionNotFoundError extends Error {}

export class PublishedVersionMutationError extends Error {}

/** A patch must retain exactly the question's existing choice IDs. */
export class InvalidDraftChoicesError extends Error {}

interface ChoiceRow {
  id: string
  label: string
  ordinal: number
  is_correct: boolean
}

export function patchDraftQuestion(
  pool: pg.Pool,
  input: { versionId: string; questionId: string; patch: DraftQuestionPatch },
): Promise<AdminQuestion> {
  const patch = draftQuestionPatchSchema.parse(input.patch)

  return withTransaction(pool, async (tx) => {
    // Publication takes this same lock before validating. Whichever operation
    // acquires it first completes before the other checks the version's state.
    const { rows: versions } = await tx.query<{ published_at: Date | null }>(
      `SELECT published_at FROM test_version WHERE id = $1 FOR UPDATE`,
      [input.versionId],
    )

    if (versions.length === 0) {
      throw new DraftQuestionNotFoundError(input.versionId)
    }

    if (versions[0].published_at !== null) {
      throw new PublishedVersionMutationError(input.versionId)
    }

    const { rows: questions } = await tx.query<{ prompt: string }>(
      `SELECT prompt FROM question
        WHERE id = $1 AND test_version_id = $2 FOR UPDATE`,
      [input.questionId, input.versionId],
    )

    if (questions.length === 0) {
      throw new DraftQuestionNotFoundError(input.questionId)
    }

    const { rows: choices } = await tx.query<ChoiceRow>(
      `SELECT id, label, ordinal, is_correct FROM choice
        WHERE question_id = $1 ORDER BY ordinal FOR UPDATE`,
      [input.questionId],
    )

    if (patch.choices !== undefined) {
      const existingIds = new Set(choices.map((choice) => choice.id))
      const submittedIds = new Set(patch.choices.map((choice) => choice.id))

      if (
        patch.choices.length !== choices.length ||
        submittedIds.size !== choices.length ||
        patch.choices.some((choice) => !existingIds.has(choice.id))
      ) {
        throw new InvalidDraftChoicesError(input.questionId)
      }
    }

    if (patch.prompt !== undefined) {
      await tx.query(`UPDATE question SET prompt = $2 WHERE id = $1`, [
        input.questionId,
        patch.prompt,
      ])
    }

    if (patch.choices !== undefined) {
      // The ordinal uniqueness constraint is immediate. Vacate the target
      // range first so swaps keep both stable IDs and any existing image_svg.
      const offset = Math.max(...choices.map((choice) => choice.ordinal))
      await tx.query(
        `UPDATE choice SET ordinal = ordinal + $2 WHERE question_id = $1`,
        [input.questionId, offset],
      )

      for (const [index, choice] of patch.choices.entries()) {
        // eslint-disable-next-line no-await-in-loop -- Ordered writes share one transaction connection.
        await tx.query(
          `UPDATE choice SET ordinal = $3, label = $4, is_correct = $5
            WHERE question_id = $1 AND id = $2`,
          [
            input.questionId,
            choice.id,
            index + 1,
            choice.label,
            choice.isCorrect,
          ],
        )
      }
    }

    return {
      id: input.questionId,
      prompt: patch.prompt ?? questions[0].prompt,
      choices:
        patch.choices ??
        choices.map((choice) => ({
          id: choice.id,
          label: choice.label,
          isCorrect: choice.is_correct,
        })),
    }
  })
}
