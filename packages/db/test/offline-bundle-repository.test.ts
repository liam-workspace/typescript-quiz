import type { PgPool, PgQueryable } from "@liam-workspace/node-postgres"
import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"
import { loadOfflineBundle } from "../src/repositories/offline-bundle.repository.js"
import { withDatabase } from "./helpers/database.js"
import { seedPublishedTest } from "./helpers/fixtures.js"

function groupCount(section: { groups: readonly unknown[] }): number {
  return section.groups.length
}

function sectionId(section: { id: string }): string {
  return section.id
}

describe("loadOfflineBundle", () => {
  it("merges brief sections with runner groups and lists media", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const bundle = await loadOfflineBundle(pool, {
        slug: f.slug,
        studentId: f.studentId,
      })

      if (!bundle) {
        throw new Error("expected a bundle")
      }

      expect(bundle.version).toBe(1)
      expect(bundle.testVersionId).toBe(f.versionId)
      expect(bundle.sections.map(sectionId)).toEqual([
        f.listeningSectionId,
        f.readingSectionId,
      ])

      const [listening, reading] = bundle.sections

      expect(listening.playback).toEqual({
        maxPlays: 1,
        allowPause: false,
        allowSeek: false,
      })
      expect(listening.instructions).toEqual(["Put your headphones on now."])
      expect(listening.groups[0]?.questions).toHaveLength(1)
      expect(reading.groups[0]?.stimulus?.type).toBe("passage")
      expect(bundle.media).toEqual([
        {
          key: "l07.mp3",
          stimulusId: f.cappedStimulusId,
          kind: "audio",
          mimeType: "audio/mpeg",
          bytes: 123456,
          capped: true,
        },
      ])
      expect(bundle.totalBytes).toBe(123456)
    })
  })

  it("never carries an answer key", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const bundle = await loadOfflineBundle(pool, {
        slug: f.slug,
        studentId: f.studentId,
      })
      const json = JSON.stringify(bundle)

      expect(json).not.toContain("isCorrect")
      expect(json).not.toContain("is_correct")
    })
  })

  it("returns null for an unknown slug", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)

      await expect(
        loadOfflineBundle(pool, { slug: "nope", studentId: f.studentId }),
      ).resolves.toBeNull()
    })
  })

  /**
   * B2: a republish between the brief read and the version read. Simulated
   * by answering the version query (the only query naming
   * `current_version_id` that returns `id, version`) with a version whose
   * content does not match the brief's sections, `times` times.
   */
  function republishedMeanwhile(pool: PgPool, times: number): PgQueryable {
    let left = times
    const query = ((sql: string, params?: unknown[]) => {
      if (left > 0 && /SELECT tv\.id, tv\.version/u.test(sql)) {
        left -= 1

        return Promise.resolve({ rows: [{ id: randomUUID(), version: 2 }] })
      }

      return pool.query(sql, params)
    }) as unknown as PgQueryable["query"]

    return { query }
  }

  it("re-reads when the version changed between its reads, never saving a copy with empty sections", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const bundle = await loadOfflineBundle(republishedMeanwhile(pool, 1), {
        slug: f.slug,
        studentId: f.studentId,
      })

      expect(bundle?.testVersionId).toBe(f.versionId)
      expect(bundle?.sections.map(groupCount)).toEqual([1, 1])
    })
  })

  it("returns null rather than a mismatched copy when the version keeps changing", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)

      await expect(
        loadOfflineBundle(republishedMeanwhile(pool, 99), {
          slug: f.slug,
          studentId: f.studentId,
        }),
      ).resolves.toBeNull()
    })
  })
})
