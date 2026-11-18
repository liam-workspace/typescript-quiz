import { describe, expect, it } from "vitest"
import type pg from "pg"
import { withDatabase } from "./helpers/database.js"
import { seedPublishedTest } from "./helpers/fixtures.js"

async function candidate(pool: pg.Pool, hash = "hash-1"): Promise<string> {
  const request = await pool.query<{ id: string }>(
    `INSERT INTO ai_generation_request (parameters, provider, model, prompt_template_version, seed)
     VALUES ('{}', 'provider', 'model', 'v1', 'seed') RETURNING id`,
  )
  const result = await pool.query<{ id: string }>(
    `INSERT INTO ai_generation_candidate (request_id, canonical_spec, content_hash)
     VALUES ($1, '{}', $2) RETURNING id`,
    [request.rows[0].id, hash],
  )

  return result.rows[0].id
}

async function seedDraftQuestion(pool: pg.Pool, testId: string) {
  const draft = await pool.query<{ id: string }>(
    `INSERT INTO test_version (test_id, version, title, duration_seconds) VALUES ($1, 2, 'Draft', 60) RETURNING id`,
    [testId],
  )
  const section = await pool.query<{ id: string }>(
    `INSERT INTO test_section (test_version_id, ordinal, title, type, duration_seconds, navigation, allow_answer_change) VALUES ($1, 1, 'Math', 'math', 60, 'free', true) RETURNING id`,
    [draft.rows[0].id],
  )
  const group = await pool.query<{ id: string }>(
    `INSERT INTO question_group (test_version_id, test_section_id, ordinal) VALUES ($1, $2, 1) RETURNING id`,
    [draft.rows[0].id, section.rows[0].id],
  )
  const question = await pool.query<{ id: string }>(
    `INSERT INTO question (test_version_id, question_group_id, question_key, ordinal, prompt, type, points) VALUES ($1, $2, 'math', 1, '1+1', 'single_choice', 1) RETURNING id`,
    [draft.rows[0].id, group.rows[0].id],
  )

  return { questionId: question.rows[0].id, versionId: draft.rows[0].id }
}

async function waitForPublisherToBlockWriter(
  publisher: pg.PoolClient,
  writerPid: number,
) {
  await expect
    .poll(
      async () => {
        const { rows } = await publisher.query<{ blocked: boolean }>(
          "SELECT pg_backend_pid() = ANY(pg_blocking_pids($1)) AS blocked",
          [writerPid],
        )

        return rows[0].blocked
      },
      { timeout: 5_000 },
    )
    .toBe(true)
}

describe("math candidate persistence", () => {
  it("enforces candidate lifecycle and provenance", async () => {
    await withDatabase(async (pool) => {
      const id = await candidate(pool)
      await expect(
        pool.query(
          `UPDATE ai_generation_candidate SET status='approved' WHERE id=$1`,
          [id],
        ),
      ).rejects.toThrow(/transition/)
      await pool.query(
        `UPDATE ai_generation_candidate SET status='in_review' WHERE id=$1`,
        [id],
      )
      await pool.query(
        `UPDATE ai_generation_candidate SET status='approved', reviewer_subject='admin', reviewed_at=now() WHERE id=$1`,
        [id],
      )
      await expect(
        pool.query(
          `UPDATE ai_generation_candidate SET status='in_review' WHERE id=$1`,
          [id],
        ),
      ).rejects.toThrow(/transition/)
      await expect(
        pool.query(
          `INSERT INTO ai_generation_candidate (request_id, canonical_spec, content_hash) VALUES (gen_random_uuid(), '{}', 'other')`,
        ),
      ).rejects.toMatchObject({ code: "23503" })
    })
  }, 120_000)

  it("rejects duplicate canonical hashes", async () => {
    await withDatabase(async (pool) => {
      await candidate(pool)
      await expect(candidate(pool)).rejects.toMatchObject({ code: "23505" })
    })
  }, 120_000)

  it("allows math metadata changes for drafts and rejects published mutations", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const { questionId: id, versionId } = await seedDraftQuestion(
        pool,
        fixture.testId,
      )
      const source = await candidate(pool)
      await pool.query(
        `INSERT INTO question_math (question_id, source_candidate_id, canonical_spec, answer_spec, solution_blocks, verification_version, content_hash) VALUES ($1, $2, '{}', '{}', '[]', 'v1', 'hash-1')`,
        [id, source],
      )
      await pool.query(
        `UPDATE question_math SET verification_version='v2' WHERE question_id=$1`,
        [id],
      )
      await expect(
        pool.query(
          "UPDATE question_math SET question_id=$1 WHERE question_id=$2",
          [fixture.questionIds[0], id],
        ),
      ).rejects.toThrow(/immutable/)
      await pool.query(
        `UPDATE test_version SET published_at=now() WHERE id=$1`,
        [versionId],
      )
      await expect(
        pool.query(
          `UPDATE question_math SET verification_version='v3' WHERE question_id=$1`,
          [id],
        ),
      ).rejects.toThrow(/immutable/)
      await expect(
        pool.query(`DELETE FROM question_math WHERE question_id=$1`, [id]),
      ).rejects.toThrow(/immutable/)
      await expect(
        pool.query(
          `INSERT INTO question_math (question_id, canonical_spec, answer_spec, solution_blocks, verification_version, content_hash) VALUES ($1, '{}', '{}', '[]', 'v1', 'another')`,
          [fixture.questionIds[0]],
        ),
      ).rejects.toThrow(/immutable/)
    })
  }, 120_000)

  it("waits for an in-flight publication and rejects the metadata update after commit", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const { questionId, versionId } = await seedDraftQuestion(
        pool,
        fixture.testId,
      )
      await pool.query(
        `INSERT INTO question_math (question_id, canonical_spec, answer_spec, solution_blocks, verification_version, content_hash)
         VALUES ($1, '{}', '{}', '[]', 'v1', 'hash-1')`,
        [questionId],
      )

      const publisher = await pool.connect()
      const writer = await pool.connect()

      try {
        const {
          rows: [writerSession],
        } = await writer.query<{ pid: number }>(
          "SELECT pg_backend_pid() AS pid",
        )
        await publisher.query("BEGIN")
        await publisher.query(
          "UPDATE test_version SET published_at=now() WHERE id=$1",
          [versionId],
        )
        const update = Promise.allSettled([
          writer.query(
            "UPDATE question_math SET verification_version='v2' WHERE question_id=$1",
            [questionId],
          ),
        ])

        await waitForPublisherToBlockWriter(publisher, writerSession.pid)
        await publisher.query("COMMIT")
        expect(await update).toMatchObject([
          { status: "rejected", reason: { code: "23001" } },
        ])

        const { rows } = await writer.query(
          "SELECT verification_version FROM question_math WHERE question_id=$1",
          [questionId],
        )
        expect(rows).toEqual([{ verification_version: "v1" }])
      } finally {
        publisher.release(true)
        writer.release(true)
      }
    })
  }, 120_000)
})
