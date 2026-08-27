import type pg from "pg"
import { describe, expect, it } from "vitest"
import {
  claimPlay,
  isFilenameCapped,
} from "../src/repositories/media-play.repository.js"
import { withDatabase } from "./helpers/database.js"

const STUDENT_ID = "11111111-1111-1111-1111-111111111111"
const TEST_ID = "22222222-2222-2222-2222-222222222222"
const VERSION_ID = "a0000000-0000-0000-0000-000000000001"

const SECTION_SINGLE = "b0000000-0000-0000-0000-000000000001"
const SECTION_UNCAPPED = "b0000000-0000-0000-0000-000000000002"
const SECTION_INHERIT = "b0000000-0000-0000-0000-000000000003"
const SECTION_TIGHTEN = "b0000000-0000-0000-0000-000000000004"

const GROUP_SINGLE = "c0000000-0000-0000-0000-000000000001"
const GROUP_UNCAPPED = "c0000000-0000-0000-0000-000000000002"
const GROUP_INHERIT = "c0000000-0000-0000-0000-000000000003"
const GROUP_TIGHTEN = "c0000000-0000-0000-0000-000000000004"

const MEDIA_SINGLE = "90000000-0000-0000-0000-000000000001"
const MEDIA_UNCAPPED = "90000000-0000-0000-0000-000000000002"
const MEDIA_INHERIT = "90000000-0000-0000-0000-000000000003"
const MEDIA_TIGHTEN = "90000000-0000-0000-0000-000000000004"

const STIMULUS_SINGLE = "70000000-0000-0000-0000-000000000001"
const STIMULUS_UNCAPPED = "70000000-0000-0000-0000-000000000002"
const STIMULUS_INHERIT = "70000000-0000-0000-0000-000000000003"
const STIMULUS_TIGHTEN = "70000000-0000-0000-0000-000000000004"

const ATTEMPT_ID = "d0000000-0000-0000-0000-000000000001"

const NOW = new Date("2026-08-27T10:00:00.000Z")

/**
 * A self-contained, UNPUBLISHED fixture -- claimPlay and isFilenameCapped
 * read `stimulus`/`test_section`/`media_asset` directly and never consult
 * `published_at`, so there is nothing to gain from publishing here, and
 * publishing would trip the content-immutability triggers the moment a
 * second test tried to add its own stimulus to the same version.
 *
 * Four sections, one audio stimulus each, isolating exactly one variable
 * per test case:
 *   - SECTION_SINGLE:   default cap 1, stimulus OVERRIDE also 1.
 *   - SECTION_UNCAPPED: default cap null, stimulus override null.
 *   - SECTION_INHERIT:  default cap 2, stimulus override null (inherits).
 *   - SECTION_TIGHTEN:  default cap 3, stimulus override 1 (tightens).
 */
interface SectionSpec {
  sectionId: string
  groupId: string
  stimulusId: string
  mediaId: string
  filename: string
  ordinal: number
  title: string
  defaultMaxPlays: number | null
  defaultAllowPause: boolean
  defaultAllowSeek: boolean
  stimulusMaxPlays: number | null
  stimulusAllowPause: boolean
  stimulusAllowSeek: boolean
}

const SECTIONS: SectionSpec[] = [
  {
    sectionId: SECTION_SINGLE,
    groupId: GROUP_SINGLE,
    stimulusId: STIMULUS_SINGLE,
    mediaId: MEDIA_SINGLE,
    filename: "single.mp3",
    ordinal: 1,
    title: "Single-play",
    defaultMaxPlays: 1,
    defaultAllowPause: false,
    defaultAllowSeek: false,
    stimulusMaxPlays: 1,
    stimulusAllowPause: false,
    stimulusAllowSeek: false,
  },
  {
    sectionId: SECTION_UNCAPPED,
    groupId: GROUP_UNCAPPED,
    stimulusId: STIMULUS_UNCAPPED,
    mediaId: MEDIA_UNCAPPED,
    filename: "uncapped.mp3",
    ordinal: 2,
    title: "Uncapped",
    defaultMaxPlays: null,
    defaultAllowPause: true,
    defaultAllowSeek: true,
    stimulusMaxPlays: null,
    stimulusAllowPause: true,
    stimulusAllowSeek: true,
  },
  {
    sectionId: SECTION_INHERIT,
    groupId: GROUP_INHERIT,
    stimulusId: STIMULUS_INHERIT,
    mediaId: MEDIA_INHERIT,
    filename: "inherit.mp3",
    ordinal: 3,
    title: "Inherit",
    defaultMaxPlays: 2,
    defaultAllowPause: false,
    defaultAllowSeek: false,
    // Null: no override -- inherits the section's default of 2.
    stimulusMaxPlays: null,
    stimulusAllowPause: false,
    stimulusAllowSeek: false,
  },
  {
    sectionId: SECTION_TIGHTEN,
    groupId: GROUP_TIGHTEN,
    stimulusId: STIMULUS_TIGHTEN,
    mediaId: MEDIA_TIGHTEN,
    filename: "tighten.mp3",
    ordinal: 4,
    title: "Tighten",
    defaultMaxPlays: 3,
    defaultAllowPause: true,
    defaultAllowSeek: true,
    // 1 < the section's default of 3 -- an override that TIGHTENS.
    stimulusMaxPlays: 1,
    stimulusAllowPause: true,
    stimulusAllowSeek: true,
  },
]

/**
 * A self-contained, UNPUBLISHED fixture -- claimPlay and isFilenameCapped
 * read `stimulus`/`test_section`/`media_asset` directly and never consult
 * `published_at`, so there is nothing to gain from publishing here, and
 * publishing would trip the content-immutability triggers the moment a
 * second test tried to add its own stimulus to the same version.
 *
 * Four sections, one audio stimulus each, isolating exactly one variable
 * per test case: an explicit cap, an uncapped stimulus, a stimulus that
 * inherits its section's default cap, and a stimulus whose override
 * TIGHTENS a looser section default.
 */
async function seedFixture(pool: pg.Pool): Promise<void> {
  await pool.query(
    `INSERT INTO student (id, subject_claim, email, display_name)
     VALUES ($1, 'sub-tom', 'tom@example.test', 'Tom')`,
    [STUDENT_ID],
  )
  await pool.query(
    `INSERT INTO test (id, slug) VALUES ($1, 'media-play-test')`,
    [TEST_ID],
  )
  await pool.query(
    `INSERT INTO test_version (id, test_id, version, title, duration_seconds)
     VALUES ($1, $2, 1, 'Media Play Repository Test', 400)`,
    [VERSION_ID, TEST_ID],
  )

  // Each section's rows must exist before the next section's FKs can
  // reference the shared `VERSION_ID`, and the four sections' rows have no
  // ordering dependency on EACH OTHER worth parallelizing away this loop's
  // readability for.
  /* eslint-disable no-await-in-loop */
  for (const s of SECTIONS) {
    await pool.query(
      `INSERT INTO test_section
         (id, test_version_id, ordinal, title, type, duration_seconds,
          navigation, allow_answer_change,
          default_max_plays, default_allow_pause, default_allow_seek)
       VALUES ($1, $2, $3, $4, 'listening', 100, 'forward_only', false, $5, $6, $7)`,
      [
        s.sectionId,
        VERSION_ID,
        s.ordinal,
        s.title,
        s.defaultMaxPlays,
        s.defaultAllowPause,
        s.defaultAllowSeek,
      ],
    )
    await pool.query(
      `INSERT INTO media_asset (id, kind, filename, mime_type, byte_size, checksum)
       VALUES ($1, 'audio', $2, 'audio/mpeg', 1000, $3)`,
      [s.mediaId, s.filename, `checksum-${s.filename}`],
    )
    await pool.query(
      `INSERT INTO stimulus (id, test_version_id, type, media_asset_id, max_plays, allow_pause, allow_seek)
       VALUES ($1, $2, 'audio', $3, $4, $5, $6)`,
      [
        s.stimulusId,
        VERSION_ID,
        s.mediaId,
        s.stimulusMaxPlays,
        s.stimulusAllowPause,
        s.stimulusAllowSeek,
      ],
    )
    await pool.query(
      `INSERT INTO question_group (id, test_version_id, test_section_id, stimulus_id, ordinal)
       VALUES ($1, $2, $3, $4, 1)`,
      [s.groupId, VERSION_ID, s.sectionId, s.stimulusId],
    )
  }
  /* eslint-enable no-await-in-loop */

  await pool.query(
    `INSERT INTO attempt (id, student_id, test_version_id, status)
     VALUES ($1, $2, $3, 'in_progress')`,
    [ATTEMPT_ID, STUDENT_ID, VERSION_ID],
  )
}

describe("claimPlay / isFilenameCapped", () => {
  it("claims the first play and returns playsUsed 1, playsRemaining 0", () =>
    withDatabase(async (pool) => {
      await seedFixture(pool)

      const result = await claimPlay(pool, {
        attemptId: ATTEMPT_ID,
        stimulusId: STIMULUS_SINGLE,
        testVersionId: VERSION_ID,
        now: NOW,
      })

      expect(result).toEqual({
        ok: true,
        claim: { playsUsed: 1, playsRemaining: 0, filename: "single.mp3" },
      })
    }))

  it("refuses a second claim on a maxPlays: 1 stimulus with no_plays_remaining", () =>
    withDatabase(async (pool) => {
      await seedFixture(pool)

      await claimPlay(pool, {
        attemptId: ATTEMPT_ID,
        stimulusId: STIMULUS_SINGLE,
        testVersionId: VERSION_ID,
        now: NOW,
      })

      const second = await claimPlay(pool, {
        attemptId: ATTEMPT_ID,
        stimulusId: STIMULUS_SINGLE,
        testVersionId: VERSION_ID,
        now: NOW,
      })

      expect(second).toEqual({ ok: false, reason: "no_plays_remaining" })
    }))

  it("never refuses an uncapped stimulus, however many times claimed", () =>
    withDatabase(async (pool) => {
      await seedFixture(pool)

      // Five claims in a row, each depending on the play_count the
      // previous one left behind -- genuinely sequential, not five
      // independent queries a Promise.all could run at once.
      /* eslint-disable no-await-in-loop */
      for (const expectedPlaysUsed of [1, 2, 3, 4, 5]) {
        const result = await claimPlay(pool, {
          attemptId: ATTEMPT_ID,
          stimulusId: STIMULUS_UNCAPPED,
          testVersionId: VERSION_ID,
          now: NOW,
        })

        expect(result).toEqual({
          ok: true,
          claim: {
            playsUsed: expectedPlaysUsed,
            playsRemaining: null,
            filename: "uncapped.mp3",
          },
        })
      }
      /* eslint-enable no-await-in-loop */
    }))

  it("inherits the section default cap when the stimulus has no override", () =>
    withDatabase(async (pool) => {
      await seedFixture(pool)

      const first = await claimPlay(pool, {
        attemptId: ATTEMPT_ID,
        stimulusId: STIMULUS_INHERIT,
        testVersionId: VERSION_ID,
        now: NOW,
      })
      const second = await claimPlay(pool, {
        attemptId: ATTEMPT_ID,
        stimulusId: STIMULUS_INHERIT,
        testVersionId: VERSION_ID,
        now: NOW,
      })
      const third = await claimPlay(pool, {
        attemptId: ATTEMPT_ID,
        stimulusId: STIMULUS_INHERIT,
        testVersionId: VERSION_ID,
        now: NOW,
      })

      expect(first).toEqual({
        ok: true,
        claim: { playsUsed: 1, playsRemaining: 1, filename: "inherit.mp3" },
      })
      expect(second).toEqual({
        ok: true,
        claim: { playsUsed: 2, playsRemaining: 0, filename: "inherit.mp3" },
      })
      expect(third).toEqual({ ok: false, reason: "no_plays_remaining" })
    }))

  it("a stimulus override TIGHTENS the section default (3) to 1, and the query never needs to know that", () =>
    withDatabase(async (pool) => {
      await seedFixture(pool)

      const first = await claimPlay(pool, {
        attemptId: ATTEMPT_ID,
        stimulusId: STIMULUS_TIGHTEN,
        testVersionId: VERSION_ID,
        now: NOW,
      })
      const second = await claimPlay(pool, {
        attemptId: ATTEMPT_ID,
        stimulusId: STIMULUS_TIGHTEN,
        testVersionId: VERSION_ID,
        now: NOW,
      })

      expect(first).toEqual({
        ok: true,
        claim: { playsUsed: 1, playsRemaining: 0, filename: "tighten.mp3" },
      })
      expect(second).toEqual({ ok: false, reason: "no_plays_remaining" })
    }))

  it("reports a capped stimulus's filename as capped", () =>
    withDatabase(async (pool) => {
      await seedFixture(pool)

      expect(await isFilenameCapped(pool, "single.mp3")).toBe(true)
    }))

  it("reports an uncapped stimulus's filename as not capped", () =>
    withDatabase(async (pool) => {
      await seedFixture(pool)

      expect(await isFilenameCapped(pool, "uncapped.mp3")).toBe(false)
    }))

  it("reports an inherited-cap stimulus's filename as capped", () =>
    withDatabase(async (pool) => {
      await seedFixture(pool)

      expect(await isFilenameCapped(pool, "inherit.mp3")).toBe(true)
    }))

  it("reports an unknown filename as not capped", () =>
    withDatabase(async (pool) => {
      await seedFixture(pool)

      expect(await isFilenameCapped(pool, "does-not-exist.mp3")).toBe(false)
    }))
})
