import { runner } from "node-pg-migrate"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import type pg from "pg"
import { migrateToLatest } from "../src/migrate.js"
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

  it("upgrades 1009 requests without requeueing finished work or trusting raw presentations", async () => {
    await withDatabase(async (pool, { databaseUrl }) => {
      await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public")
      await runner({
        databaseUrl,
        dir: fileURLToPath(new URL("../migrations", import.meta.url)),
        direction: "up",
        count: 10,
        migrationsTable: "pp_migrations",
      })
      const { rows: requests } = await pool.query<{ id: string }>(
        `INSERT INTO ai_generation_request (parameters, provider, model, prompt_template_version, seed)
         SELECT '{}', 'provider', 'model', 'v1', seed FROM unnest(ARRAY['queued', 'success', 'failure']) seed
         RETURNING id`,
      )
      const { rows: candidates } = await pool.query<{ id: string }>(
        `INSERT INTO ai_generation_candidate (request_id, canonical_spec, content_hash, raw_response)
         VALUES ($1, '{"family":"ratio"}', 'hash', '{"promptBlocks":["raw"]}'),
                ($2, 'null', 'failure:old', NULL) RETURNING id`,
        [requests[1].id, requests[2].id],
      )
      await pool.query(
        "UPDATE ai_generation_candidate SET status='in_review' WHERE id=$1",
        [candidates[0].id],
      )
      await pool.query(
        "UPDATE ai_generation_candidate SET status='rejected' WHERE id=$1",
        [candidates[1].id],
      )

      await migrateToLatest(databaseUrl)

      expect(
        (
          await pool.query(
            "SELECT seed, status, claim_token, lease_expires_at FROM ai_generation_request ORDER BY seed",
          )
        ).rows,
      ).toEqual([
        {
          seed: "failure",
          status: "completed",
          claim_token: null,
          lease_expires_at: null,
        },
        {
          seed: "queued",
          status: "queued",
          claim_token: null,
          lease_expires_at: null,
        },
        {
          seed: "success",
          status: "completed",
          claim_token: null,
          lease_expires_at: null,
        },
      ])
      expect(
        (
          await pool.query(
            "SELECT status, canonical_spec, raw_response, prompt_blocks, choices, solution_blocks FROM ai_generation_candidate WHERE id=$1",
            [candidates[0].id],
          )
        ).rows[0],
      ).toEqual({
        status: "in_review",
        canonical_spec: { family: "ratio" },
        raw_response: { promptBlocks: ["raw"] },
        prompt_blocks: null,
        choices: null,
        solution_blocks: null,
      })
    })
  }, 120_000)

  it("requires a token and expiration together for processing requests and accepts complete candidate presentations", async () => {
    await withDatabase(async (pool) => {
      const id = await candidate(pool)
      const {
        rows: [request],
      } = await pool.query<{ id: string }>(
        "SELECT request_id AS id FROM ai_generation_candidate WHERE id=$1",
        [id],
      )
      const updateRequest = (
        status: string,
        token: string | null,
        expires: Date | null,
      ) =>
        pool.query(
          "UPDATE ai_generation_request SET status=$2, claim_token=$3, lease_expires_at=$4 WHERE id=$1",
          [request.id, status, token, expires],
        )
      const token = "a3317a21-2222-4111-8111-111111111111"
      const expires = new Date()
      await expect(updateRequest("invalid", null, null)).rejects.toMatchObject({
        code: "23514",
      })
      await expect(
        updateRequest("processing", null, expires),
      ).rejects.toMatchObject({ code: "23514" })
      await expect(
        updateRequest("processing", token, null),
      ).rejects.toMatchObject({ code: "23514" })
      await expect(
        updateRequest("queued", token, expires),
      ).rejects.toMatchObject({ code: "23514" })
      await updateRequest("processing", token, expires)
      await expect(
        updateRequest("completed", token, expires),
      ).rejects.toMatchObject({ code: "23514" })
      await updateRequest("completed", null, null)

      const updatePresentation = (choices: unknown) =>
        pool.query<{ choices: unknown }>(
          `UPDATE ai_generation_candidate SET prompt_blocks='[{"kind":"text","value":"Choose two"}]',
           choices=$2, solution_blocks='[{"kind":"math","tex":"1+1=2","display":false}]' WHERE id=$1 RETURNING choices`,
          [id, JSON.stringify(choices)],
        )
      await expect(
        pool.query(
          "UPDATE ai_generation_candidate SET prompt_blocks='[]' WHERE id=$1",
          [id],
        ),
      ).rejects.toMatchObject({ code: "23514" })
      await expect(updatePresentation({})).rejects.toMatchObject({
        code: "23514",
      })
      const choices = [
        { labelBlocks: [{ kind: "text", value: "One" }], isCorrect: false },
        { labelBlocks: [{ kind: "text", value: "Two" }], isCorrect: true },
      ]
      expect((await updatePresentation(choices)).rows[0].choices).toEqual(
        choices,
      )
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

  it("upgrades the original 1008 trigger to wait for publication and reject the metadata update after commit", async () => {
    await withDatabase(async (pool, { databaseUrl }) => {
      await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public")
      await runner({
        databaseUrl,
        dir: fileURLToPath(new URL("../migrations", import.meta.url)),
        direction: "up",
        count: 9,
        migrationsTable: "pp_migrations",
      })
      // Earlier deployments recorded 1008 with this unlocked function.
      await pool.query(`
        CREATE OR REPLACE FUNCTION reject_published_math_change() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM question q JOIN test_version tv ON tv.id = q.test_version_id
                WHERE tv.published_at IS NOT NULL AND
                  (q.id = CASE WHEN TG_OP <> 'INSERT' THEN OLD.question_id END OR
                   q.id = CASE WHEN TG_OP <> 'DELETE' THEN NEW.question_id END)
            ) THEN
                RAISE EXCEPTION 'math content belongs to a published version and is immutable (% on %)', TG_OP, TG_TABLE_NAME
                    USING ERRCODE = 'restrict_violation';
            END IF;
            RETURN COALESCE(NEW, OLD);
        END;
        $$;
      `)

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

      await migrateToLatest(databaseUrl)

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
