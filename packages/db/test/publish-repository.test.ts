import { randomUUID } from "node:crypto"
import type pg from "pg"
import { describe, expect, it } from "vitest"
import {
  publishDraftVersion,
  type PublishViolation,
} from "../src/repositories/publish.repository.js"
import { withDatabase } from "./helpers/database.js"

interface DraftIds {
  testId: string
  versionId: string
  sectionId: string
  groupId: string
  questionId: string
}

/**
 * A minimal but fully VALID draft: one section whose duration equals the
 * version's, one single_choice question with exactly two choices and
 * exactly one correct -- the shape publishDraftVersion must accept without
 * complaint. Individual tests corrupt one piece of this to trigger exactly
 * one violation at a time.
 */
async function insertValidDraft(pool: pg.Pool): Promise<DraftIds> {
  const testId = randomUUID()
  const versionId = randomUUID()
  const sectionId = randomUUID()
  const groupId = randomUUID()
  const questionId = randomUUID()

  await pool.query(`INSERT INTO test (id, slug) VALUES ($1, $2)`, [
    testId,
    `draft-${testId}`,
  ])
  await pool.query(
    `INSERT INTO test_version (id, test_id, version, title, duration_seconds)
     VALUES ($1, $2, 1, 'Draft', 100)`,
    [versionId, testId],
  )
  await pool.query(
    `INSERT INTO test_section (id, test_version_id, ordinal, title, type,
                               duration_seconds, navigation, allow_answer_change)
     VALUES ($1, $2, 1, 'Section', 'listening', 100, 'forward_only', false)`,
    [sectionId, versionId],
  )
  await pool.query(
    `INSERT INTO question_group (id, test_version_id, test_section_id, ordinal)
     VALUES ($1, $2, $3, 1)`,
    [groupId, versionId, sectionId],
  )
  await pool.query(
    `INSERT INTO question (id, test_version_id, question_group_id, question_key,
                           ordinal, prompt, type, points)
     VALUES ($1, $2, $3, 'q1', 1, 'Prompt?', 'single_choice', 1)`,
    [questionId, versionId, groupId],
  )
  await pool.query(
    `INSERT INTO choice (question_id, ordinal, label, is_correct)
     VALUES ($1, 1, 'yes', true), ($1, 2, 'no', false)`,
    [questionId],
  )

  return { testId, versionId, sectionId, groupId, questionId }
}

function codesOf(violations: PublishViolation[]): string[] {
  return violations.map((v) => v.code).sort()
}

describe("publishDraftVersion", () => {
  it("publishes a valid draft and stamps published_at", async () => {
    await withDatabase(async (pool) => {
      const draft = await insertValidDraft(pool)
      const now = new Date("2026-08-26T12:00:00Z")

      const result = await publishDraftVersion(pool, {
        testId: draft.testId,
        now,
      })

      expect(result).toEqual({
        ok: true,
        versionId: draft.versionId,
        version: 1,
        publishedAt: now,
      })

      const { rows } = await pool.query<{
        published_at: Date
        current_version_id: string
      }>(
        `SELECT tv.published_at, t.current_version_id
           FROM test_version tv JOIN test t ON t.id = tv.test_id
          WHERE tv.id = $1`,
        [draft.versionId],
      )

      expect(rows[0].published_at).toEqual(now)
      expect(rows[0].current_version_id).toBe(draft.versionId)
    })
  }, 120_000)

  it("refuses a question with one choice and names it", async () => {
    await withDatabase(async (pool) => {
      const draft = await insertValidDraft(pool)

      await pool.query(
        `DELETE FROM choice WHERE question_id = $1 AND ordinal = 2`,
        [draft.questionId],
      )

      const result = await publishDraftVersion(pool, {
        testId: draft.testId,
        now: new Date(),
      })

      expect(result.ok).toBe(false)

      if (result.ok) {
        throw new Error("expected publication to fail")
      }

      expect(codesOf(result.violations)).toEqual(["too_few_choices"])
      expect(result.violations[0].questionId).toBe(draft.questionId)
    })
  }, 120_000)

  it("refuses a single_choice question with two correct choices", async () => {
    await withDatabase(async (pool) => {
      const draft = await insertValidDraft(pool)

      await pool.query(
        `UPDATE choice SET is_correct = true WHERE question_id = $1`,
        [draft.questionId],
      )

      const result = await publishDraftVersion(pool, {
        testId: draft.testId,
        now: new Date(),
      })

      expect(result.ok).toBe(false)

      if (result.ok) {
        throw new Error("expected publication to fail")
      }

      expect(codesOf(result.violations)).toEqual(["wrong_correct_count"])
      expect(result.violations[0].questionId).toBe(draft.questionId)
    })
  }, 120_000)

  it("refuses a stimulus citing a missing media asset", async () => {
    await withDatabase(async (pool) => {
      const draft = await insertValidDraft(pool)
      const mediaAssetId = randomUUID()
      const stimulusId = randomUUID()

      await pool.query(
        `INSERT INTO media_asset (id, kind, filename, mime_type, byte_size, checksum)
         VALUES ($1, 'audio', $2, 'audio/mpeg', 10, 'checksum')`,
        [mediaAssetId, `${stimulusId}.mp3`],
      )
      await pool.query(
        `INSERT INTO stimulus (id, test_version_id, type, media_asset_id)
         VALUES ($1, $2, 'audio', $3)`,
        [stimulusId, draft.versionId, mediaAssetId],
      )
      await pool.query(
        `UPDATE question_group SET stimulus_id = $1 WHERE id = $2`,
        [stimulusId, draft.groupId],
      )

      // No normal write path can leave a stimulus pointing at a media asset
      // that does not exist -- media_asset_id is a real foreign key. The
      // publish check exists anyway for rows that reach the table by a path
      // that bypasses it (a manual psql session, a future admin editor), so
      // the test has to bypass the FK too: find its name and drop it for
      // this one corrupting write.
      const { rows: fk } = await pool.query<{ conname: string }>(
        `SELECT conname FROM pg_constraint
          WHERE conrelid = 'stimulus'::regclass AND confrelid = 'media_asset'::regclass`,
      )

      await pool.query(`ALTER TABLE stimulus DROP CONSTRAINT ${fk[0].conname}`)
      await pool.query(
        `UPDATE stimulus SET media_asset_id = $1 WHERE id = $2`,
        [randomUUID(), stimulusId],
      )

      const result = await publishDraftVersion(pool, {
        testId: draft.testId,
        now: new Date(),
      })

      expect(result.ok).toBe(false)

      if (result.ok) {
        throw new Error("expected publication to fail")
      }

      expect(codesOf(result.violations)).toEqual(["missing_media_asset"])
      expect(result.violations[0].sectionId).toBe(draft.sectionId)
    })
  }, 120_000)

  // B6 (external review): a capped image cannot be viewed -- QuestionMedia
  // only ever renders a plain image when its cap is null, and a capped
  // mixed image renders text with no image and no claim control. Rather
  // than shipping content the runner cannot present, publication refuses it
  // outright, mirroring `missing_media_asset`'s own last-gate reasoning.
  it("refuses a plain image stimulus with a play cap (image, not audio)", async () => {
    await withDatabase(async (pool) => {
      const draft = await insertValidDraft(pool)
      const mediaAssetId = randomUUID()
      const stimulusId = randomUUID()

      await pool.query(
        `INSERT INTO media_asset (id, kind, filename, mime_type, byte_size, checksum)
         VALUES ($1, 'image', $2, 'image/png', 10, 'checksum')`,
        [mediaAssetId, `${stimulusId}.png`],
      )
      await pool.query(
        `INSERT INTO stimulus (id, test_version_id, type, media_asset_id, max_plays)
         VALUES ($1, $2, 'image', $3, 2)`,
        [stimulusId, draft.versionId, mediaAssetId],
      )
      await pool.query(
        `UPDATE question_group SET stimulus_id = $1 WHERE id = $2`,
        [stimulusId, draft.groupId],
      )

      const result = await publishDraftVersion(pool, {
        testId: draft.testId,
        now: new Date(),
      })

      expect(result.ok).toBe(false)

      if (result.ok) {
        throw new Error("expected publication to fail")
      }

      expect(codesOf(result.violations)).toEqual(["capped_image_unviewable"])
      expect(result.violations[0].sectionId).toBe(draft.sectionId)
    })
  }, 120_000)

  it("refuses a mixed stimulus whose media resolves to a capped image", async () => {
    await withDatabase(async (pool) => {
      const draft = await insertValidDraft(pool)
      const mediaAssetId = randomUUID()
      const stimulusId = randomUUID()

      await pool.query(
        `INSERT INTO media_asset (id, kind, filename, mime_type, byte_size, checksum)
         VALUES ($1, 'image', $2, 'image/png', 10, 'checksum')`,
        [mediaAssetId, `${stimulusId}.png`],
      )
      await pool.query(
        `INSERT INTO stimulus (id, test_version_id, type, body_text, media_asset_id, max_plays)
         VALUES ($1, $2, 'mixed', 'Look at the picture.', $3, 1)`,
        [stimulusId, draft.versionId, mediaAssetId],
      )
      await pool.query(
        `UPDATE question_group SET stimulus_id = $1 WHERE id = $2`,
        [stimulusId, draft.groupId],
      )

      const result = await publishDraftVersion(pool, {
        testId: draft.testId,
        now: new Date(),
      })

      expect(result.ok).toBe(false)

      if (result.ok) {
        throw new Error("expected publication to fail")
      }

      expect(codesOf(result.violations)).toEqual(["capped_image_unviewable"])
    })
  }, 120_000)

  it("still accepts a capped AUDIO stimulus -- the cap makes sense there, this rule is image-only", async () => {
    await withDatabase(async (pool) => {
      const draft = await insertValidDraft(pool)
      const mediaAssetId = randomUUID()
      const stimulusId = randomUUID()

      await pool.query(
        `INSERT INTO media_asset (id, kind, filename, mime_type, byte_size, checksum)
         VALUES ($1, 'audio', $2, 'audio/mpeg', 10, 'checksum')`,
        [mediaAssetId, `${stimulusId}.mp3`],
      )
      await pool.query(
        `INSERT INTO stimulus (id, test_version_id, type, media_asset_id, max_plays)
         VALUES ($1, $2, 'audio', $3, 2)`,
        [stimulusId, draft.versionId, mediaAssetId],
      )
      await pool.query(
        `UPDATE question_group SET stimulus_id = $1 WHERE id = $2`,
        [stimulusId, draft.groupId],
      )

      const result = await publishDraftVersion(pool, {
        testId: draft.testId,
        now: new Date(),
      })

      expect(result.ok).toBe(true)
    })
  }, 120_000)

  it("still accepts an UNCAPPED plain image", async () => {
    await withDatabase(async (pool) => {
      const draft = await insertValidDraft(pool)
      const mediaAssetId = randomUUID()
      const stimulusId = randomUUID()

      await pool.query(
        `INSERT INTO media_asset (id, kind, filename, mime_type, byte_size, checksum)
         VALUES ($1, 'image', $2, 'image/png', 10, 'checksum')`,
        [mediaAssetId, `${stimulusId}.png`],
      )
      await pool.query(
        `INSERT INTO stimulus (id, test_version_id, type, media_asset_id)
         VALUES ($1, $2, 'image', $3)`,
        [stimulusId, draft.versionId, mediaAssetId],
      )
      await pool.query(
        `UPDATE question_group SET stimulus_id = $1 WHERE id = $2`,
        [stimulusId, draft.groupId],
      )

      const result = await publishDraftVersion(pool, {
        testId: draft.testId,
        now: new Date(),
      })

      expect(result.ok).toBe(true)
    })
  }, 120_000)

  it("refuses a plain image capped only via the SECTION's default (no stimulus-level override)", async () => {
    await withDatabase(async (pool) => {
      const draft = await insertValidDraft(pool)
      const mediaAssetId = randomUUID()
      const stimulusId = randomUUID()

      await pool.query(
        `UPDATE test_section SET default_max_plays = 3 WHERE id = $1`,
        [draft.sectionId],
      )
      await pool.query(
        `INSERT INTO media_asset (id, kind, filename, mime_type, byte_size, checksum)
         VALUES ($1, 'image', $2, 'image/png', 10, 'checksum')`,
        [mediaAssetId, `${stimulusId}.png`],
      )
      await pool.query(
        `INSERT INTO stimulus (id, test_version_id, type, media_asset_id)
         VALUES ($1, $2, 'image', $3)`,
        [stimulusId, draft.versionId, mediaAssetId],
      )
      await pool.query(
        `UPDATE question_group SET stimulus_id = $1 WHERE id = $2`,
        [stimulusId, draft.groupId],
      )

      const result = await publishDraftVersion(pool, {
        testId: draft.testId,
        now: new Date(),
      })

      expect(result.ok).toBe(false)

      if (result.ok) {
        throw new Error("expected publication to fail")
      }

      expect(codesOf(result.violations)).toEqual(["capped_image_unviewable"])
    })
  }, 120_000)

  it("returns EVERY violation, not just the first", async () => {
    await withDatabase(async (pool) => {
      const draft = await insertValidDraft(pool)

      await pool.query(
        `DELETE FROM choice WHERE question_id = $1 AND ordinal = 2`,
        [draft.questionId],
      )
      await pool.query(
        `UPDATE choice SET is_correct = false WHERE question_id = $1`,
        [draft.questionId],
      )
      await pool.query(
        `UPDATE test_version SET duration_seconds = 9999 WHERE id = $1`,
        [draft.versionId],
      )

      const result = await publishDraftVersion(pool, {
        testId: draft.testId,
        now: new Date(),
      })

      expect(result.ok).toBe(false)

      if (result.ok) {
        throw new Error("expected publication to fail")
      }

      expect(codesOf(result.violations)).toEqual([
        "duration_mismatch",
        "too_few_choices",
        "wrong_correct_count",
      ])
    })
  }, 120_000)

  it("leaves the version a draft when validation fails", async () => {
    await withDatabase(async (pool) => {
      const draft = await insertValidDraft(pool)

      await pool.query(
        `DELETE FROM choice WHERE question_id = $1 AND ordinal = 2`,
        [draft.questionId],
      )

      const result = await publishDraftVersion(pool, {
        testId: draft.testId,
        now: new Date(),
      })

      expect(result.ok).toBe(false)

      const { rows } = await pool.query<{ published_at: Date | null }>(
        `SELECT published_at FROM test_version WHERE id = $1`,
        [draft.versionId],
      )

      expect(rows[0].published_at).toBeNull()
    })
  }, 120_000)
})
