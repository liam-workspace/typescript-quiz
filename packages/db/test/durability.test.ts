import { describe, expect, it } from "vitest"
import { withDatabase } from "./helpers/database.js"
import { seedPublishedTest } from "./helpers/fixtures.js"

// Hoisted so `rows.map(ruleOf)` inside the fourth test does not add a
// fourth level of nested callback (oxlint max-nested-callbacks: 3).
function ruleOf(row: { rule: string }): string {
  return row.rule
}

interface SqlError {
  code?: string
  message: string
}

/**
 * The error a failing statement raised, so a test can assert its SQLSTATE and
 * its message without `expect.stringMatching` (which types as `any`).
 */
async function errorFrom(statement: Promise<unknown>): Promise<SqlError> {
  try {
    await statement
  } catch (raised) {
    return raised as SqlError
  }

  throw new Error("expected the statement to be rejected, but it succeeded")
}

describe("migration 1003 — durability and immutability", () => {
  it("stores a body that is not valid JSON", async () => {
    await withDatabase(async (pool) => {
      const notJson = '{"responses": [ this is not json'
      await pool.query(
        `INSERT INTO failed_write (attempt_id, route, reason, raw_body, byte_size)
         VALUES ('not-a-uuid', 'PATCH /api/attempts/x/responses', 'unparseable', $1, $2)`,
        [notJson, Buffer.byteLength(notJson)],
      )
      const { rows } = await pool.query<{ raw_body: string }>(
        `SELECT raw_body FROM failed_write`,
      )
      expect(rows[0].raw_body).toBe(notJson)
    })
  }, 120_000)

  it("refuses to edit a question on a published version", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      await expect(
        pool.query(`UPDATE question SET prompt='tampered' WHERE id=$1`, [
          f.questionIds[0],
        ]),
      ).rejects.toThrow(/published and immutable/)
    })
  }, 120_000)

  it("refuses to point current_version_id at an unpublished version", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      await pool.query(
        `INSERT INTO test_version (id, test_id, version, title, duration_seconds)
         VALUES ('a0000000-0000-0000-0000-0000000000bb', $1, 2, 'draft', 3000)`,
        [f.testId],
      )
      await expect(
        pool.query(
          `UPDATE test SET current_version_id='a0000000-0000-0000-0000-0000000000bb'
                     WHERE id=$1`,
          [f.testId],
        ),
      ).rejects.toThrow(/published version of this test/)
    })
  }, 120_000)

  it("reports every publication violation on a broken draft", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const draft = "a0000000-0000-0000-0000-0000000000cc"
      await pool.query(
        `INSERT INTO test_version (id, test_id, version, title, duration_seconds)
         VALUES ($1, $2, 2, 'broken draft', 9999)`,
        [draft, f.testId],
      )
      await pool.query(
        `INSERT INTO test_section (id, test_version_id, ordinal, title, type,
                                   duration_seconds, navigation, allow_answer_change)
         VALUES ('b000000c-0000-0000-0000-000000000001',$1,1,'L','listening',100,
                 'forward_only',false)`,
        [draft],
      )
      await pool.query(
        `INSERT INTO question_group (id, test_version_id, test_section_id, ordinal)
         VALUES ('c000000c-0000-0000-0000-000000000001',$1,
                 'b000000c-0000-0000-0000-000000000001',1)`,
        [draft],
      )
      await pool.query(
        `INSERT INTO question (id, test_version_id, question_group_id, question_key,
                               ordinal, prompt, type, points)
         VALUES ('d000000c-0000-0000-0000-000000000001',$1,
                 'c000000c-0000-0000-0000-000000000001','q1',1,'lonely','single_choice',1)`,
        [draft],
      )
      await pool.query(
        `INSERT INTO choice (question_id, ordinal, label, is_correct)
         VALUES ('d000000c-0000-0000-0000-000000000001',1,'only one',false)`,
      )

      const { rows } = await pool.query<{ rule: string }>(
        `SELECT rule FROM publication_violation WHERE test_version_id=$1 ORDER BY rule`,
        [draft],
      )
      expect(rows.map(ruleOf)).toEqual([
        "duration_mismatch",
        "too_few_choices",
        "wrong_correct_count",
      ])
    })
  }, 120_000)

  // A BEFORE ROW trigger that returns NULL cancels the row operation, so a
  // guard function ending in `RETURN NEW;` silently swallows every DELETE
  // (on DELETE, NEW is NULL). These three tests pin both halves of the
  // guard: a draft is deletable, a published version is not — on either
  // statement kind.
  it("deletes a DRAFT test_version", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const draft = "a0000000-0000-0000-0000-0000000000dd"
      await pool.query(
        `INSERT INTO test_version (id, test_id, version, title, duration_seconds)
         VALUES ($1, $2, 2, 'draft to delete', 3000)`,
        [draft, f.testId],
      )

      const deleted = await pool.query(`DELETE FROM test_version WHERE id=$1`, [
        draft,
      ])
      expect(deleted.rowCount).toBe(1)

      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM test_version WHERE id=$1`,
        [draft],
      )
      expect(rows).toHaveLength(0)
    })
  }, 120_000)

  it("refuses to UPDATE a published test_version", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const error = await errorFrom(
        pool.query(`UPDATE test_version SET title='tampered' WHERE id=$1`, [
          f.versionId,
        ]),
      )

      expect(error.code).toBe("23001")
      expect(error.message).toMatch(/published and immutable/)
    })
  }, 120_000)

  it("refuses to DELETE a published test_version", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const error = await errorFrom(
        pool.query(`DELETE FROM test_version WHERE id=$1`, [f.versionId]),
      )

      expect(error.code).toBe("23001")
      expect(error.message).toMatch(/published and immutable/)

      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM test_version WHERE id=$1`,
        [f.versionId],
      )
      expect(rows).toHaveLength(1)
    })
  }, 120_000)
})
