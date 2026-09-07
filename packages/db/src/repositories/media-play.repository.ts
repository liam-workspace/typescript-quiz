import type { PgQueryable } from "@liam-public/node-postgres"
import { remainingPlays } from "@pp/common"

export interface PlayClaimResult {
  playsUsed: number
  playsRemaining: number | null
  filename: string
}

interface EffectiveCapRow {
  stimulus_max_plays: number | null
  section_max_plays: number | null
  filename: string
}

interface ClaimRow {
  play_count: number
}

/**
 * True when `filename` names a media asset backing a stimulus whose
 * EFFECTIVE cap (stimulus override, else section default) is non-null.
 * Used by the static media controller to decide whether a request needs a
 * signature at all -- an asset with no capped stimulus (or no stimulus
 * reference whatsoever) is safe to serve unconditionally.
 */
export async function isFilenameCapped(
  db: PgQueryable,
  filename: string,
): Promise<boolean> {
  const { rows } = await db.query<{ effective_max_plays: number | null }>(
    `SELECT COALESCE(st.max_plays, ts.default_max_plays) AS effective_max_plays
       FROM media_asset ma
       JOIN stimulus st       ON st.media_asset_id = ma.id
       JOIN question_group qg ON qg.stimulus_id = st.id
       JOIN test_section ts   ON ts.id = qg.test_section_id
      WHERE ma.filename = $1
      LIMIT 1`,
    [filename],
  )

  if (rows.length === 0) {
    return false
  }

  const [row] = rows

  return row.effective_max_plays !== null
}

/**
 * Claims one play against a (possibly) capped stimulus and, on success,
 * hands back the filename the caller needs to sign a URL for -- so the
 * service layer never has to make a second read to learn what to sign.
 *
 * The increment-and-check is ONE statement (`INSERT ... ON CONFLICT DO
 * UPDATE ... WHERE`), not a read-then-write: two concurrent taps on Play
 * both reading `plays_used = 2` under a cap of 3 and both writing 3 would
 * spend four plays on a three-play cap. The `WHERE` clause on the UPDATE
 * arm is what makes the whole claim atomic -- Postgres evaluates it as
 * part of the same row-locking statement, so the second of two concurrent
 * callers necessarily sees the first one's write before its own `WHERE`
 * is evaluated, and loses.
 *
 * `effectiveMaxPlays === null` means unlimited: the `$5::int IS NULL`
 * branch of the `WHERE` clause makes the UPDATE succeed unconditionally,
 * however high `play_count` climbs. The INSERT arm always succeeds on a
 * genuinely first claim (no cap is ever 0 -- `stimulus_max_plays_positive`
 * / `section_max_plays_positive` both require `> 0`), so an empty result
 * set can only ever come from the UPDATE arm's `WHERE` failing, i.e. the
 * cap was already spent.
 */
export async function claimPlay(
  db: PgQueryable,
  input: {
    attemptId: string
    stimulusId: string
    testVersionId: string
    now: Date
  },
): Promise<
  | { ok: true; claim: PlayClaimResult }
  | { ok: false; reason: "no_plays_remaining" }
> {
  const { rows: capRows } = await db.query<EffectiveCapRow>(
    `SELECT st.max_plays stimulus_max_plays, ts.default_max_plays section_max_plays, ma.filename
       FROM stimulus st
       JOIN question_group qg ON qg.stimulus_id = st.id
       JOIN test_section ts   ON ts.id = qg.test_section_id
       JOIN media_asset ma    ON ma.id = st.media_asset_id
      WHERE st.id = $1 AND st.test_version_id = $2`,
    [input.stimulusId, input.testVersionId],
  )

  if (capRows.length === 0) {
    // Unreachable for a legitimate caller: the controller only ever passes
    // a stimulusId drawn from this attempt's own runner content, and every
    // such stimulus has exactly one question_group, one test_section and
    // (being audio) one media_asset by construction.
    throw new Error(
      `stimulus ${input.stimulusId} has no playable media in version ${input.testVersionId}`,
    )
  }

  const [cap] = capRows
  const effectiveMaxPlays = cap.stimulus_max_plays ?? cap.section_max_plays

  const { rows: claimRows } = await db.query<ClaimRow>(
    `INSERT INTO stimulus_play (attempt_id, stimulus_id, test_version_id, play_count, last_played_at)
     VALUES ($1, $2, $3, 1, $4)
     ON CONFLICT (attempt_id, stimulus_id) DO UPDATE
        SET play_count = stimulus_play.play_count + 1, last_played_at = EXCLUDED.last_played_at
      WHERE $5::int IS NULL OR stimulus_play.play_count < $5
     RETURNING play_count`,
    [
      input.attemptId,
      input.stimulusId,
      input.testVersionId,
      input.now,
      effectiveMaxPlays,
    ],
  )

  if (claimRows.length === 0) {
    return { ok: false, reason: "no_plays_remaining" }
  }

  const [claimed] = claimRows
  const playsUsed = claimed.play_count

  return {
    ok: true,
    claim: {
      playsUsed,
      playsRemaining: remainingPlays(effectiveMaxPlays, playsUsed),
      filename: cap.filename,
    },
  }
}
