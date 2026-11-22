import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"
import { claimPlay } from "../src/repositories/media-play.repository.js"
import {
  enterSection,
  setPosition,
} from "../src/repositories/attempt.repository.js"
import {
  advanceJournalCursor,
  createOfflineAttempt,
  getJournalCursor,
  loadJournalContext,
} from "../src/repositories/offline-journal.repository.js"
import { withDatabase } from "./helpers/database.js"
import { seedMixedStimulusTest, seedPublishedTest } from "./helpers/fixtures.js"

const NOW = new Date("2026-11-22T12:00:00.000Z")
const sectionId = (section: { id: string }): string => section.id

describe("migration 1016", () => {
  it("defaults attempt.origin to 'server' and refuses an unknown origin", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const { rows } = await pool.query<{ origin: string }>(
        `INSERT INTO attempt (student_id, test_version_id)
         VALUES ($1, $2) RETURNING origin`,
        [f.studentId, f.versionId],
      )

      expect(rows[0]?.origin).toBe("server")
      await expect(
        pool.query(`UPDATE attempt SET origin = 'bogus'`),
      ).rejects.toThrow(/attempt_origin_known/)
    })
  }, 120_000)

  it("refuses a negative cursor and drops the cursor with its attempt", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const attemptId = randomUUID()

      await createOfflineAttempt(pool, {
        attemptId,
        studentId: f.studentId,
        testVersionId: f.versionId,
        slug: f.slug,
        now: NOW,
      })

      await expect(advanceJournalCursor(pool, attemptId, -1)).rejects.toThrow(
        /journal_cursor_non_negative/,
      )

      await advanceJournalCursor(pool, attemptId, 4)
      // Attempt rows are normally never deleted; this only proves the FK
      // cascade the migration declares.
      await pool.query("DELETE FROM attempt WHERE id = $1", [attemptId])

      const { rows } = await pool.query(
        "SELECT 1 FROM offline_journal_cursor WHERE attempt_id = $1",
        [attemptId],
      )

      expect(rows).toHaveLength(0)
    })
  }, 120_000)
})

describe("createOfflineAttempt", () => {
  it("adopts the client uuid, marks origin offline and uses the claimed time", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const attemptId = randomUUID()
      const outcome = await createOfflineAttempt(pool, {
        attemptId,
        studentId: f.studentId,
        testVersionId: f.versionId,
        slug: f.slug,
        now: NOW,
      })
      const { rows } = await pool.query<{
        origin: string
        status: string
        created_at: Date
        started_at: Date | null
      }>(
        "SELECT origin, status, created_at, started_at FROM attempt WHERE id = $1",
        [attemptId],
      )

      expect(outcome).toEqual({ kind: "created" })
      expect(rows[0]).toMatchObject({
        origin: "offline",
        status: "in_progress",
        started_at: null,
      })
      expect(rows[0]?.created_at.toISOString()).toBe(NOW.toISOString())
    })
  }, 120_000)

  it("is idempotent for the same attempt id", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const input = {
        attemptId: randomUUID(),
        studentId: f.studentId,
        testVersionId: f.versionId,
        slug: f.slug,
        now: NOW,
      }

      await createOfflineAttempt(pool, input)

      await expect(createOfflineAttempt(pool, input)).resolves.toEqual({
        kind: "exists",
      })
    })
  }, 120_000)

  it("reports an existing id owned by another student as a conflict, never as exists", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const attemptId = randomUUID()
      const { rows: other } = await pool.query<{ id: string }>(
        `INSERT INTO student (subject_claim, email, display_name)
         VALUES ('sub-eve', 'eve@example.test', 'Eve') RETURNING id`,
      )

      await createOfflineAttempt(pool, {
        attemptId,
        studentId: f.studentId,
        testVersionId: f.versionId,
        slug: f.slug,
        now: NOW,
      })

      await expect(
        createOfflineAttempt(pool, {
          attemptId,
          studentId: other[0]?.id ?? "",
          testVersionId: f.versionId,
          slug: f.slug,
          now: NOW,
        }),
      ).resolves.toEqual({ kind: "conflict" })
    })
  }, 120_000)

  it("reports an existing id on a different version as a conflict", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const m = await seedMixedStimulusTest(pool)
      const attemptId = randomUUID()

      await pool.query(
        `INSERT INTO attempt (id, student_id, test_version_id) VALUES ($1, $2, $3)`,
        [attemptId, f.studentId, m.versionId],
      )

      await expect(
        createOfflineAttempt(pool, {
          attemptId,
          studentId: f.studentId,
          testVersionId: f.versionId,
          slug: f.slug,
          now: NOW,
        }),
      ).resolves.toEqual({ kind: "conflict" })
    })
  }, 120_000)

  it("conflicts with a live timed attempt for the same student and version", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)

      await pool.query(
        `INSERT INTO attempt (student_id, test_version_id, status, started_at, expires_at)
         VALUES ($1, $2, 'in_progress', $3, $4)`,
        [
          f.studentId,
          f.versionId,
          new Date(NOW.getTime() - 60_000),
          new Date(NOW.getTime() + 600_000),
        ],
      )

      await expect(
        createOfflineAttempt(pool, {
          attemptId: randomUUID(),
          studentId: f.studentId,
          testVersionId: f.versionId,
          slug: f.slug,
          now: NOW,
        }),
      ).resolves.toEqual({ kind: "conflict" })
    })
  }, 120_000)

  it("finalizes an expired active attempt and then creates the offline one", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO attempt (student_id, test_version_id, status, started_at, expires_at)
         VALUES ($1, $2, 'in_progress', $3, $4) RETURNING id`,
        [
          f.studentId,
          f.versionId,
          new Date("2026-11-22T10:00:00Z"),
          new Date("2026-11-22T10:50:00Z"),
        ],
      )
      const outcome = await createOfflineAttempt(pool, {
        attemptId: randomUUID(),
        studentId: f.studentId,
        testVersionId: f.versionId,
        slug: f.slug,
        now: NOW,
      })
      const old = await pool.query<{ status: string }>(
        "SELECT status FROM attempt WHERE id = $1",
        [rows[0]?.id],
      )

      expect(outcome).toEqual({ kind: "created" })
      expect(old.rows[0]?.status).toBe("expired")
    })
  }, 120_000)

  it("refuses a version that does not match the slug", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)

      await expect(
        createOfflineAttempt(pool, {
          attemptId: randomUUID(),
          studentId: f.studentId,
          testVersionId: f.versionId,
          slug: "some-other-test",
          now: NOW,
        }),
      ).resolves.toEqual({ kind: "version_unavailable" })
    })
  }, 120_000)

  it("refuses an unpublished version", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const draftId = randomUUID()

      await pool.query(
        `INSERT INTO test_version (id, test_id, version, title, duration_seconds)
         VALUES ($1, $2, 2, 'Draft', 600)`,
        [draftId, f.testId],
      )

      await expect(
        createOfflineAttempt(pool, {
          attemptId: randomUUID(),
          studentId: f.studentId,
          testVersionId: draftId,
          slug: f.slug,
          now: NOW,
        }),
      ).resolves.toEqual({ kind: "version_unavailable" })
    })
  }, 120_000)
})

describe("journal cursor", () => {
  it("starts at 0, advances, and never goes backwards", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const attemptId = randomUUID()

      await createOfflineAttempt(pool, {
        attemptId,
        studentId: f.studentId,
        testVersionId: f.versionId,
        slug: f.slug,
        now: NOW,
      })

      expect(await getJournalCursor(pool, attemptId)).toBe(0)

      await advanceJournalCursor(pool, attemptId, 3)
      await advanceJournalCursor(pool, attemptId, 2)

      expect(await getJournalCursor(pool, attemptId)).toBe(3)

      await advanceJournalCursor(pool, attemptId, 7)

      expect(await getJournalCursor(pool, attemptId)).toBe(7)
    })
  }, 120_000)
})

describe("loadJournalContext", () => {
  it("returns the version's sections, media stimuli, questions and an untouched attempt", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const attemptId = randomUUID()

      await createOfflineAttempt(pool, {
        attemptId,
        studentId: f.studentId,
        testVersionId: f.versionId,
        slug: f.slug,
        now: NOW,
      })

      const fresh = await loadJournalContext(pool, {
        attempt: null,
        testVersionId: f.versionId,
      })
      const withAttempt = await loadJournalContext(pool, {
        attempt: { attemptId, studentId: f.studentId },
        testVersionId: f.versionId,
      })

      expect(fresh.versionDurationSeconds).toBe(3000)
      expect(fresh.sections.map(sectionId)).toEqual([
        f.listeningSectionId,
        f.readingSectionId,
      ])
      expect(fresh.sections[0]).toMatchObject({
        ordinal: 1,
        navigation: "forward_only",
        allowAnswerChange: false,
        durationSeconds: 1500,
      })
      // Only the media-backed stimulus: a passage cannot be "played".
      expect(fresh.stimuli).toEqual([
        {
          id: f.cappedStimulusId,
          sectionId: f.listeningSectionId,
          maxPlays: 1,
        },
      ])
      expect(fresh.questions).toEqual([
        { id: f.questionIds[0], sectionId: f.listeningSectionId, ordinal: 1 },
        { id: f.questionIds[1], sectionId: f.readingSectionId, ordinal: 2 },
      ])
      expect(fresh.playsUsed).toEqual([])
      expect(fresh.attemptStatus).toBeNull()
      expect(withAttempt.attemptStatus).toBe("in_progress")
      expect(withAttempt.attemptStartedAt).toBeNull()
      expect(withAttempt.attemptExpiresAt).toBeNull()
      expect(withAttempt.currentSectionId).toBeNull()
      expect(withAttempt.currentQuestionId).toBeNull()
      expect(withAttempt.sectionStates).toEqual([])
    })
  }, 120_000)

  it("returns the attempt's recorded clocks, plays and position", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const attemptId = randomUUID()

      await createOfflineAttempt(pool, {
        attemptId,
        studentId: f.studentId,
        testVersionId: f.versionId,
        slug: f.slug,
        now: NOW,
      })
      await enterSection(pool, {
        attemptId,
        sectionId: f.listeningSectionId,
        now: NOW,
      })
      await claimPlay(pool, {
        attemptId,
        stimulusId: f.cappedStimulusId,
        testVersionId: f.versionId,
        now: NOW,
      })
      await setPosition(pool, {
        attemptId,
        sectionId: f.listeningSectionId,
        questionId: f.questionIds[0] ?? "",
        now: NOW,
      })

      const ctx = await loadJournalContext(pool, {
        attempt: { attemptId, studentId: f.studentId },
        testVersionId: f.versionId,
      })

      expect(ctx.attemptStartedAt?.toISOString()).toBe(NOW.toISOString())
      expect(ctx.attemptExpiresAt?.toISOString()).toBe(
        new Date(NOW.getTime() + 3000 * 1000).toISOString(),
      )
      expect(ctx.sectionStates).toEqual([
        {
          sectionId: f.listeningSectionId,
          enteredAt: NOW,
          expiresAt: new Date(NOW.getTime() + 1500 * 1000),
          completedAt: null,
        },
      ])
      expect(ctx.playsUsed).toEqual([
        { stimulusId: f.cappedStimulusId, playCount: 1 },
      ])
      expect(ctx.currentSectionId).toBe(f.listeningSectionId)
      expect(ctx.currentQuestionId).toBe(f.questionIds[0])
    })
  }, 120_000)

  it("refuses to read another student's attempt", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const attemptId = randomUUID()

      await createOfflineAttempt(pool, {
        attemptId,
        studentId: f.studentId,
        testVersionId: f.versionId,
        slug: f.slug,
        now: NOW,
      })

      await expect(
        loadJournalContext(pool, {
          attempt: { attemptId, studentId: randomUUID() },
          testVersionId: f.versionId,
        }),
      ).rejects.toThrow(/not an attempt of student/)
    })
  }, 120_000)

  it("refuses an unknown test version", async () => {
    await withDatabase(async (pool) => {
      await expect(
        loadJournalContext(pool, {
          attempt: null,
          testVersionId: randomUUID(),
        }),
      ).rejects.toThrow(/does not exist/)
    })
  }, 120_000)
})
