import { runner } from "node-pg-migrate"
import { fileURLToPath } from "node:url"
import type pg from "pg"
import { describe, expect, it } from "vitest"
import { migrateToLatest } from "../src/migrate.js"
import { withDatabase } from "./helpers/database.js"
import { seedPublishedTest } from "./helpers/fixtures.js"

const EXPECTED_ENUMS = {
  section_type: ["listening", "reading", "vocabulary", "grammar", "math"],
  nav_mode: ["free", "forward_only"],
  stimulus_type: ["audio", "passage", "image", "mixed"],
  question_type: ["single_choice", "multi_choice"],
  attempt_status: ["in_progress", "submitted", "expired"],
  media_kind: ["audio", "image"],
  student_level: ["primary-step-1", "primary-step-2"],
}

async function fetchEnumLabels(
  pool: pg.Pool,
  typeName: string,
): Promise<string[]> {
  const { rows } = await pool.query<{ label: string }>(
    `SELECT e.enumlabel AS label
       FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = $1
      ORDER BY e.enumsortorder`,
    [typeName],
  )
  const labels: string[] = []

  for (const row of rows) {
    labels.push(row.label)
  }

  return labels
}

describe("migration 1000", () => {
  it("creates every enum with exactly the documented members", async () => {
    await withDatabase(async (pool) => {
      const entries = Object.entries(EXPECTED_ENUMS)
      const pending: Array<Promise<string[]>> = []

      for (const [name] of entries) {
        pending.push(fetchEnumLabels(pool, name))
      }

      const labelSets = await Promise.all(pending)

      for (const [index, [name, members]] of entries.entries()) {
        expect(labelSets[index], name).toEqual(members)
      }
    })
  }, 120_000)

  it("rejects a student with a blank display name", async () => {
    await withDatabase(async (pool) => {
      await expect(
        pool.query(
          `INSERT INTO student (subject_claim, email, display_name)
           VALUES ('s1', 'a@b', '   ')`,
        ),
      ).rejects.toThrow(/student_name_not_blank/)
    })
  }, 120_000)
})

describe("migration 1008", () => {
  it("preserves published content and backfills only drafts", async () => {
    await withDatabase(async (pool, { databaseUrl }) => {
      await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public")
      await runner({
        databaseUrl,
        dir: fileURLToPath(new URL("../migrations", import.meta.url)),
        direction: "up",
        count: 8,
        migrationsTable: "pp_migrations",
      })
      const published = await seedPublishedTest(pool)
      const draft = await pool.query<{ id: string }>(
        `INSERT INTO test_version (test_id, version, title, duration_seconds)
         VALUES ($1, 2, 'Draft', 60) RETURNING id`,
        [published.testId],
      )
      const section = await pool.query<{ id: string }>(
        `INSERT INTO test_section (test_version_id, ordinal, title, type, duration_seconds, navigation, allow_answer_change)
         VALUES ($1, 1, 'Draft section', 'reading', 60, 'free', true) RETURNING id`,
        [draft.rows[0].id],
      )
      const group = await pool.query<{ id: string }>(
        `INSERT INTO question_group (test_version_id, test_section_id, ordinal)
         VALUES ($1, $2, 1) RETURNING id`,
        [draft.rows[0].id, section.rows[0].id],
      )
      const question = await pool.query<{ id: string }>(
        `INSERT INTO question (test_version_id, question_group_id, question_key, ordinal, prompt, type, points)
         VALUES ($1, $2, 'draft', 1, 'Draft prompt', 'single_choice', 1) RETURNING id`,
        [draft.rows[0].id, group.rows[0].id],
      )
      const choice = await pool.query<{ id: string }>(
        `INSERT INTO choice (question_id, ordinal, label, is_correct)
         VALUES ($1, 1, 'Draft choice', true) RETURNING id`,
        [question.rows[0].id],
      )

      await migrateToLatest(databaseUrl)

      const questions = await pool.query(
        `SELECT prompt, prompt_blocks FROM question WHERE id = ANY($1::uuid[]) ORDER BY prompt`,
        [[published.questionIds[0], question.rows[0].id]],
      )
      expect(questions.rows).toEqual([
        {
          prompt: "Draft prompt",
          prompt_blocks: [{ kind: "text", value: "Draft prompt" }],
        },
        { prompt: "What does the boy want to do?", prompt_blocks: null },
      ])
      const choices = await pool.query(
        `SELECT label, label_blocks FROM choice WHERE id = ANY($1::uuid[]) ORDER BY label`,
        [[published.choiceIds[0], choice.rows[0].id]],
      )
      expect(choices.rows).toEqual([
        {
          label: "Draft choice",
          label_blocks: [{ kind: "text", value: "Draft choice" }],
        },
        { label: "Read a book", label_blocks: null },
      ])
      await expect(
        pool.query("UPDATE question SET prompt = 'changed' WHERE id = $1", [
          published.questionIds[0],
        ]),
      ).rejects.toThrow(/immutable/)
      await expect(
        pool.query("UPDATE choice SET label = 'changed' WHERE id = $1", [
          published.choiceIds[0],
        ]),
      ).rejects.toThrow(/immutable/)
    })
  }, 120_000)
})
