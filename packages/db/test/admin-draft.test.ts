import { randomUUID } from "node:crypto"
import type pg from "pg"
import { describe, expect, it } from "vitest"
import {
  DraftQuestionNotFoundError,
  InvalidDraftChoicesError,
  PublishedVersionMutationError,
  importTestDocument,
  patchDraftQuestion,
} from "../src/admin.js"
import { withDatabase } from "./helpers/database.js"

async function insertDraft(pool: pg.Pool) {
  const { versionId } = await importTestDocument(pool, {
    title: "Draft editing",
    slug: `draft-edit-${randomUUID()}`,
    durationSeconds: 60,
    sections: [
      {
        title: "Reading",
        type: "reading",
        durationSeconds: 60,
        navigation: "free",
        allowAnswerChange: true,
        instructions: [],
        playback: null,
        groups: [
          {
            questions: [1, 2].map((n) => ({
              questionKey: `q${n}`,
              prompt: `Question ${n}?`,
              type: "single_choice" as const,
              points: 1,
              choices: [
                { label: "Yes", isCorrect: true },
                { label: "No", isCorrect: false },
              ],
            })),
          },
        ],
      },
    ],
  })
  const { rows: questions } = await pool.query<{ id: string }>(
    `SELECT id FROM question WHERE test_version_id = $1 ORDER BY ordinal`,
    [versionId],
  )
  const questionId = questions[0].id
  const { rows: choices } = await pool.query<{
    id: string
    label: string
    isCorrect: boolean
  }>(
    `SELECT id, label, is_correct AS "isCorrect" FROM choice WHERE question_id = $1 ORDER BY ordinal`,
    [questionId],
  )

  return { versionId, questionId, otherQuestionId: questions[1].id, choices }
}

async function readQuestion(pool: pg.Pool, questionId: string) {
  const { rows } = await pool.query<{
    prompt: string
    id: string
    ordinal: number
    label: string
    is_correct: boolean
    image_svg: string | null
  }>(
    `SELECT q.prompt, c.id, c.ordinal, c.label, c.is_correct, c.image_svg
       FROM question q JOIN choice c ON c.question_id = q.id
      WHERE q.id = $1 ORDER BY c.ordinal`,
    [questionId],
  )

  return rows
}

describe("patchDraftQuestion", () => {
  it("holds the publication lock throughout prompt and choice writes", async () => {
    await withDatabase(async (pool) => {
      const f = await insertDraft(pool)
      const editor = await pool.connect()
      const publisher = await pool.connect()
      let checkedWrites = 0
      const interceptedEditor = {
        query: async (...args: Parameters<pg.PoolClient["query"]>) => {
          const [statement] = args

          if (
            typeof statement === "string" &&
            /^UPDATE (question|choice)\b/.test(statement)
          ) {
            await expect(
              publisher.query(
                "SELECT id FROM test_version WHERE id = $1 FOR UPDATE NOWAIT",
                [f.versionId],
              ),
            ).rejects.toMatchObject({ code: "55P03" })
            checkedWrites += 1
          }

          return Promise.resolve(editor.query(...args))
        },
        release: editor.release.bind(editor),
      } as pg.PoolClient

      try {
        const result = await patchDraftQuestion(
          {
            connect: () => Promise.resolve(interceptedEditor),
          } as pg.Pool,
          {
            ...f,
            patch: {
              prompt: "Locked question?",
              choices: [...f.choices].reverse(),
            },
          },
        )
        expect(result.prompt).toBe("Locked question?")
        expect(checkedWrites).toBe(4)
        await expect(
          publisher.query(
            "SELECT id FROM test_version WHERE id = $1 FOR UPDATE NOWAIT",
            [f.versionId],
          ),
        ).resolves.toMatchObject({ rowCount: 1 })
      } finally {
        publisher.release()
      }
    })
  }, 120_000)

  it("updates prompt, ordered labels, and correctness while preserving choice IDs and images", async () => {
    await withDatabase(async (pool) => {
      const f = await insertDraft(pool)
      const image =
        '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>'
      await pool.query(`UPDATE choice SET image_svg = $1 WHERE id = $2`, [
        image,
        f.choices[0].id,
      ])
      const patch = {
        prompt: "Updated question?",
        choices: [
          { id: f.choices[1].id, label: "Second first", isCorrect: true },
          { id: f.choices[0].id, label: "First second", isCorrect: false },
        ],
      }
      expect(await patchDraftQuestion(pool, { ...f, patch })).toEqual({
        id: f.questionId,
        prompt: "Updated question?",
        choices: patch.choices,
      })
      expect(await readQuestion(pool, f.questionId)).toEqual([
        {
          prompt: "Updated question?",
          id: f.choices[1].id,
          ordinal: 1,
          label: "Second first",
          is_correct: true,
          image_svg: null,
        },
        {
          prompt: "Updated question?",
          id: f.choices[0].id,
          ordinal: 2,
          label: "First second",
          is_correct: false,
          image_svg: image,
        },
      ])
    })
  }, 120_000)

  it("supports prompt-only and choices-only patches without changing omitted fields", async () => {
    await withDatabase(async (pool) => {
      const f = await insertDraft(pool)
      expect(
        await patchDraftQuestion(pool, {
          ...f,
          patch: { prompt: "Prompt only?" },
        }),
      ).toEqual({
        id: f.questionId,
        prompt: "Prompt only?",
        choices: f.choices,
      })
      const choices = [...f.choices].reverse()
      expect(
        await patchDraftQuestion(pool, { ...f, patch: { choices } }),
      ).toEqual({
        id: f.questionId,
        prompt: "Prompt only?",
        choices,
      })
    })
  }, 120_000)

  it("rejects a question belonging to a different version without changing it", async () => {
    await withDatabase(async (pool) => {
      const f = await insertDraft(pool)
      const other = await insertDraft(pool)
      const before = await readQuestion(pool, f.questionId)
      await expect(
        patchDraftQuestion(pool, {
          ...f,
          versionId: other.versionId,
          patch: { prompt: "Wrong version?" },
        }),
      ).rejects.toBeInstanceOf(DraftQuestionNotFoundError)
      expect(await readQuestion(pool, f.questionId)).toEqual(before)
    })
  }, 120_000)

  it("rejects an unknown version or question", async () => {
    await withDatabase(async (pool) => {
      const f = await insertDraft(pool)
      await expect(
        patchDraftQuestion(pool, {
          ...f,
          versionId: randomUUID(),
          patch: { prompt: "Unknown version?" },
        }),
      ).rejects.toBeInstanceOf(DraftQuestionNotFoundError)
      await expect(
        patchDraftQuestion(pool, {
          ...f,
          questionId: randomUUID(),
          patch: { prompt: "Unknown question?" },
        }),
      ).rejects.toBeInstanceOf(DraftQuestionNotFoundError)
    })
  }, 120_000)

  it("rejects all edits to a published version", async () => {
    await withDatabase(async (pool) => {
      const f = await insertDraft(pool)
      await pool.query(
        `UPDATE test_version SET published_at = now() WHERE id = $1`,
        [f.versionId],
      )
      const before = await readQuestion(pool, f.questionId)
      await expect(
        patchDraftQuestion(pool, {
          ...f,
          patch: {
            prompt: "Published edit?",
            choices: [...f.choices].reverse(),
          },
        }),
      ).rejects.toBeInstanceOf(PublishedVersionMutationError)
      expect(await readQuestion(pool, f.questionId)).toEqual(before)
    })
  }, 120_000)

  it("rejects foreign, duplicate, and omitted choice IDs atomically", async () => {
    await withDatabase(async (pool) => {
      const f = await insertDraft(pool)
      const extra = await pool.query<{ id: string }>(
        `INSERT INTO choice (question_id, ordinal, label, is_correct)
         VALUES ($1, 3, 'Maybe', false) RETURNING id`,
        [f.questionId],
      )
      const foreign = await pool.query<{ id: string }>(
        `SELECT id FROM choice WHERE question_id = $1 ORDER BY ordinal LIMIT 1`,
        [f.otherQuestionId],
      )
      const third = { id: extra.rows[0].id, label: "Maybe", isCorrect: false }
      const before = await readQuestion(pool, f.questionId)
      // Each rejection must finish before the next scenario reads the same rows.
      /* eslint-disable no-await-in-loop */
      for (const choices of [
        [...f.choices, { ...third, id: foreign.rows[0].id }],
        [...f.choices, f.choices[0]],
        f.choices,
      ]) {
        await expect(
          patchDraftQuestion(pool, {
            ...f,
            patch: { prompt: "Must roll back?", choices },
          }),
        ).rejects.toBeInstanceOf(InvalidDraftChoicesError)
        expect(await readQuestion(pool, f.questionId)).toEqual(before)
      }
      /* eslint-enable no-await-in-loop */
    })
  }, 120_000)

  it("rolls back the prompt and all ordered choices if a choice write fails", async () => {
    await withDatabase(async (pool) => {
      const f = await insertDraft(pool)
      const before = await readQuestion(pool, f.questionId)
      await pool.query(`
        CREATE FUNCTION reject_test_choice() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.label = 'Fail choice' THEN RAISE EXCEPTION 'choice write rejected'; END IF;
          RETURN NEW;
        END; $$;
        CREATE TRIGGER reject_test_choice BEFORE UPDATE ON choice
          FOR EACH ROW EXECUTE FUNCTION reject_test_choice();
      `)
      await expect(
        patchDraftQuestion(pool, {
          ...f,
          patch: {
            prompt: "Must roll back?",
            choices: [
              { ...f.choices[1], label: "Changed first", isCorrect: true },
              { ...f.choices[0], label: "Fail choice", isCorrect: false },
            ],
          },
        }),
      ).rejects.toThrow("choice write rejected")
      expect(await readQuestion(pool, f.questionId)).toEqual(before)
    })
  }, 120_000)
})
