import { describe, expect, it } from "vitest"
import { testDocumentSchema, type TestDocument } from "@pp/common"
import { withDatabase } from "./helpers/database.js"
import {
  exportTestDocument,
  importTestDocument,
} from "../src/repositories/test-import.repository.js"

const doc: TestDocument = testDocumentSchema.parse({
  title: "TOEFL Primary — Practice Test 04",
  slug: "practice-test-04",
  level: "primary-step-1",
  durationSeconds: 3000,
  sections: [
    {
      title: "Listening — Part 1",
      type: "listening",
      durationSeconds: 1500,
      navigation: "forward_only",
      allowAnswerChange: false,
      playback: { maxPlays: 1, allowPause: false, allowSeek: false },
      instructions: ["Put your headphones on now.", "Stay quiet."],
      groups: [
        {
          questions: [
            {
              questionKey: "q1",
              prompt: "A?",
              type: "single_choice",
              points: 1,
              tags: ["gist", "detail"],
              choices: [
                { label: "yes", isCorrect: true },
                { label: "no", isCorrect: false },
              ],
            },
          ],
        },
      ],
    },
    {
      title: "Reading",
      type: "reading",
      durationSeconds: 1500,
      navigation: "free",
      allowAnswerChange: true,
      playback: null,
      instructions: [],
      groups: [
        {
          stimulus: {
            type: "passage",
            title: "The School Trip",
            bodyText: "On Friday…",
          },
          questions: [
            {
              questionKey: "q2",
              prompt: "B?",
              type: "single_choice",
              points: 1,
              choices: [
                { label: "rain", isCorrect: true },
                { label: "bus", isCorrect: false },
              ],
            },
          ],
        },
      ],
    },
  ],
})

// Every optional stimulus field present at its boundary. An empty-string
// title or an explicit `maxPlays: null` are deliberately NOT expressible:
// the schema rejects both so that "absent" has exactly one spelling on
// either side of the trip.
const edgeDoc: TestDocument = testDocumentSchema.parse({
  title: "E",
  slug: "edge-case-01",
  durationSeconds: 100,
  sections: [
    {
      title: "S",
      type: "listening",
      durationSeconds: 100,
      navigation: "free",
      allowAnswerChange: true,
      playback: { maxPlays: 1, allowPause: false, allowSeek: false },
      instructions: [],
      groups: [
        {
          stimulus: {
            type: "mixed",
            title: "T",
            bodyText: "B",
            mediaFilename: "edge.mp3",
            maxPlays: 1,
            allowPause: false,
            allowSeek: false,
          },
          questions: [
            {
              questionKey: "q1",
              prompt: "P?",
              type: "single_choice",
              points: 1,
              choices: [
                { label: "a", isCorrect: true },
                { label: "b", isCorrect: false },
              ],
            },
          ],
        },
      ],
    },
  ],
})

describe("import / export", () => {
  it("round-trips a document unchanged", async () => {
    await withDatabase(async (pool) => {
      const { versionId } = await importTestDocument(pool, doc)
      const out = await exportTestDocument(pool, versionId)

      expect(out).toEqual(doc)
    })
  }, 120_000)

  it("preserves instruction and tag ORDER", async () => {
    await withDatabase(async (pool) => {
      const { versionId } = await importTestDocument(pool, doc)
      const out = await exportTestDocument(pool, versionId)

      expect(out.sections[0].instructions).toEqual([
        "Put your headphones on now.",
        "Stay quiet.",
      ])
      expect(out.sections[0].groups[0].questions[0].tags).toEqual([
        "gist",
        "detail",
      ])
    })
  }, 120_000)

  // `toEqual` treats a key holding `undefined` and an absent key as equal,
  // so the round-trip test above cannot catch a group that comes back with a
  // `stimulus: undefined` property instead of no `stimulus` key at all.
  // This test inspects the key set directly instead.
  it("omits the stimulus key entirely for a group with no stimulus", async () => {
    await withDatabase(async (pool) => {
      const { versionId } = await importTestDocument(pool, doc)
      const out = await exportTestDocument(pool, versionId)
      const [section] = out.sections
      const [group] = section.groups

      expect(Object.keys(group)).toEqual(["questions"])
      expect("stimulus" in group).toBe(false)
    })
  }, 120_000)

  it("creates a DRAFT — importing does not publish", async () => {
    await withDatabase(async (pool) => {
      const { versionId } = await importTestDocument(pool, doc)
      const { rows } = await pool.query<{ published_at: string | null }>(
        `SELECT published_at FROM test_version WHERE id=$1`,
        [versionId],
      )

      expect(rows[0].published_at).toBeNull()
    })
  }, 120_000)

  // The `doc` fixture above leaves most stimulus fields absent, so it cannot
  // catch a field that is dropped on the way out. This one carries EVERY
  // optional stimulus field at its boundary: one-character strings (the
  // shortest the schema accepts), the smallest legal cap, and both playback
  // booleans false. A `mixed` stimulus is used because it is the one type the
  // database requires to carry body text AND a media asset at once.
  it("round-trips a stimulus with every optional field at its boundary", async () => {
    await withDatabase(async (pool) => {
      await pool.query(
        `INSERT INTO media_asset (kind, filename, mime_type, byte_size, checksum)
         VALUES ('audio','edge.mp3','audio/mpeg',1,'feed')`,
      )

      const { versionId } = await importTestDocument(pool, edgeDoc)
      const out = await exportTestDocument(pool, versionId)

      expect(out).toEqual(edgeDoc)

      // The other direction: re-importing what was exported must produce a
      // document that exports identically, so the trip is stable and not
      // merely equal once. The first draft has to go first -- a slug may
      // hold only one unpublished version (test_version_one_draft) -- which
      // is exactly the "import, spot a typo, import again" path.
      const removed = await pool.query(`DELETE FROM test_version WHERE id=$1`, [
        versionId,
      ])
      expect(removed.rowCount).toBe(1)

      const again = await importTestDocument(pool, out)
      expect(await exportTestDocument(pool, again.versionId)).toEqual(edgeDoc)
    })
  }, 120_000)

  it("keeps the boundary stimulus's key set exactly", async () => {
    await withDatabase(async (pool) => {
      await pool.query(
        `INSERT INTO media_asset (kind, filename, mime_type, byte_size, checksum)
         VALUES ('audio','edge.mp3','audio/mpeg',1,'feed')`,
      )

      const { versionId } = await importTestDocument(pool, edgeDoc)
      const out = await exportTestDocument(pool, versionId)
      const [section] = out.sections
      const [group] = section.groups
      const { stimulus } = group

      expect(stimulus).toBeDefined()
      expect(Object.keys(stimulus ?? {}).sort()).toEqual([
        "allowPause",
        "allowSeek",
        "bodyText",
        "maxPlays",
        "mediaFilename",
        "title",
        "type",
      ])
    })
  }, 120_000)
})
