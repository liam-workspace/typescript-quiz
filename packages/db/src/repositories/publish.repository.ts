import { withTransaction, type PgQueryable } from "@liam-public/node-postgres"
import type pg from "pg"

export interface PublishViolation {
  code: string
  questionId?: string
  sectionId?: string
  detail: string
}

/** Thrown when `testId` names nothing, or names a test with no draft outstanding. */
export class DraftNotFoundError extends Error {}

interface DraftRow {
  id: string
  version: number
  test_id: string
}

interface ViolationRow {
  question_id: string | null
  section_id: string | null
  rule: string
  detail: string
}

interface MissingMediaRow {
  stimulus_id: string
  section_id: string | null
}

/**
 * `too_few_choices`, `wrong_correct_count`, `duration_mismatch` and
 * `capped_image_unviewable` are read from `publication_violation`
 * (migrations 1003 and 1004), not recomputed here: that view already
 * implements these checks and this repository's own test suite would
 * otherwise duplicate the view's coverage. `playback_loosened`, the view's
 * fifth rule, is filtered out -- it is not one of the `rule` values
 * `docs/api/openapi.yaml` declares for this endpoint, and Zod's
 * `sectionSchema` (interchange/test-document.ts) already refuses a
 * loosened stimulus at import time, so nothing reaches the database
 * without going through that check regardless.
 *
 * `capped_image_unviewable` (B6, external review) has no matching import-
 * time Zod check: the interchange document's `stimulus.type` alone cannot
 * tell a `mixed` stimulus's media kind (that is only known once a real
 * media asset is uploaded and joined in), so the view -- which CAN join
 * `media_asset` -- is the single source of truth for this rule, checked
 * here at the last gate before immutability, exactly like
 * `missing_media_asset` below.
 */
const VIEW_RULES = [
  "too_few_choices",
  "wrong_correct_count",
  "duration_mismatch",
  "capped_image_unviewable",
]

/**
 * `missing_media_asset` has no row in `publication_violation`: stimulus.media_asset_id
 * is a real foreign key (migration 1001), so an unresolvable asset cannot be stored by
 * any INSERT or UPDATE that goes through it. Checked again here anyway, alongside the
 * other three -- even though three of the four are already enforced by
 * `testDocumentSchema` at import time (interchange/test-document.ts) and this fourth
 * one by the foreign key itself -- because rows can reach the database by paths that
 * never go through either: the seed script, a manual psql session, a future admin
 * editor. Publication is the LAST gate before the immutability triggers in migration
 * 1003 make a draft's rows unrepairable, so deleting this as "redundant" would remove
 * the only check those other paths ever see.
 */
async function checkMissingMedia(
  tx: PgQueryable,
  versionId: string,
): Promise<PublishViolation[]> {
  const { rows } = await tx.query<MissingMediaRow>(
    `SELECT st.id AS stimulus_id, qg.test_section_id AS section_id
       FROM stimulus st
  LEFT JOIN question_group qg ON qg.stimulus_id = st.id
      WHERE st.test_version_id = $1
        AND st.media_asset_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM media_asset ma WHERE ma.id = st.media_asset_id)`,
    [versionId],
  )

  return rows.map((row) => ({
    code: "missing_media_asset",
    ...(row.section_id ? { sectionId: row.section_id } : {}),
    detail: `Stimulus ${row.stimulus_id} cites a media asset that does not exist`,
  }))
}

async function checkViewRules(
  tx: PgQueryable,
  versionId: string,
): Promise<PublishViolation[]> {
  const { rows } = await tx.query<ViolationRow>(
    `SELECT question_id, section_id, rule, detail
       FROM publication_violation
      WHERE test_version_id = $1 AND rule = ANY($2)`,
    [versionId, VIEW_RULES],
  )

  return rows.map((row) => ({
    code: row.rule,
    ...(row.question_id ? { questionId: row.question_id } : {}),
    ...(row.section_id ? { sectionId: row.section_id } : {}),
    detail: row.detail,
  }))
}

async function publishInTransaction(
  tx: PgQueryable,
  input: { testId: string; now: Date },
): Promise<
  | { ok: true; versionId: string; version: number; publishedAt: Date }
  | { ok: false; violations: PublishViolation[] }
> {
  const { rows: draftRows } = await tx.query<DraftRow>(
    `SELECT id, version, test_id FROM test_version
      WHERE test_id = $1 AND published_at IS NULL`,
    [input.testId],
  )

  if (draftRows.length === 0) {
    throw new DraftNotFoundError(input.testId)
  }

  const [draft] = draftRows

  const viewViolations = await checkViewRules(tx, draft.id)
  const mediaViolations = await checkMissingMedia(tx, draft.id)
  const violations = [...viewViolations, ...mediaViolations]

  if (violations.length > 0) {
    return { ok: false, violations }
  }

  const { rows: publishedRows } = await tx.query<{ published_at: Date }>(
    `UPDATE test_version SET published_at = $2 WHERE id = $1 RETURNING published_at`,
    [draft.id, input.now],
  )

  await tx.query(
    `UPDATE test SET current_version_id = $1, updated_at = $2 WHERE id = $3`,
    [draft.id, input.now, draft.test_id],
  )

  return {
    ok: true,
    versionId: draft.id,
    version: draft.version,
    publishedAt: publishedRows[0].published_at,
  }
}

/**
 * Marks a test's outstanding draft version published and immutable, after
 * re-verifying the cross-row checks column constraints cannot express.
 * Attempts pin versions, so once this returns `ok: true`, the version's
 * content can never change under a recorded score (migration 1003's
 * immutability triggers refuse every INSERT, UPDATE and DELETE beneath it).
 *
 * Throws `DraftNotFoundError` when `testId` names nothing, or a test with
 * no draft outstanding -- `test_version_one_draft` guarantees at most one,
 * so there is nothing ambiguous about "the" draft once one exists.
 */
export function publishDraftVersion(
  db: PgQueryable,
  input: { testId: string; now: Date },
): Promise<
  | { ok: true; versionId: string; version: number; publishedAt: Date }
  | { ok: false; violations: PublishViolation[] }
> {
  return withTransaction(db as pg.Pool, (tx) => publishInTransaction(tx, input))
}

/**
 * Resolves `testId` (+ optional version number) to a `test_version.id`, for
 * `GET /admin/tests/{testId}/export`. Omitting `version` resolves to the
 * test's current (published) version, per the contract's "Defaults to the
 * current version." An explicit version number resolves regardless of
 * publication state, so an admin can inspect any version, including a draft
 * that has not been published yet.
 */
export async function resolveVersionId(
  db: PgQueryable,
  input: { testId: string; version?: number },
): Promise<string | null> {
  const { rows } =
    input.version === undefined
      ? await db.query<{ id: string }>(
          `SELECT tv.id
             FROM test t
             JOIN test_version tv ON tv.id = t.current_version_id
            WHERE t.id = $1`,
          [input.testId],
        )
      : await db.query<{ id: string }>(
          `SELECT id FROM test_version WHERE test_id = $1 AND version = $2`,
          [input.testId, input.version],
        )

  if (rows.length === 0) {
    return null
  }

  const [row] = rows

  return row.id
}
