import type { PgQueryable } from "@liam-workspace/node-postgres"
import type { RunnerSection } from "@pp/common"
import {
  loadTestBrief,
  type SectionBriefRow,
  type TestBriefRow,
} from "./catalog.repository.js"
import { loadForRunner } from "./test-version.repository.js"

export interface OfflineMediaRow {
  key: string
  stimulusId: string
  kind: "audio" | "image"
  mimeType: string
  bytes: number
  capped: boolean
}

export interface OfflineBundleSectionRow extends SectionBriefRow {
  groups: RunnerSection["groups"]
}

export interface OfflineBundleRow {
  slug: string
  testVersionId: string
  version: number
  title: string
  level: TestBriefRow["level"]
  durationSeconds: number
  sections: OfflineBundleSectionRow[]
  media: OfflineMediaRow[]
  totalBytes: number
}

interface VersionDbRow {
  id: string
  version: number
}

interface MediaDbRow {
  filename: string
  kind: "audio" | "image"
  mime_type: string
  // Node-postgres returns bigint as a string.
  byte_size: string
  stimulus_id: string
  effective_max_plays: number | null
}

const VERSION_QUERY = `
  SELECT tv.id, tv.version
    FROM test t
    JOIN test_version tv ON tv.id = t.current_version_id AND tv.published_at IS NOT NULL
   WHERE t.slug = $1
`

// DISTINCT ON (st.id): a stimulus can back more than one question group, and
// the manifest lists each stimulus's media exactly once. The effective cap is
// the same COALESCE `isFilenameCapped` and `claimPlay` use, so "capped" here
// can never disagree with what the media route will demand a signature for.
const MEDIA_QUERY = `
  SELECT DISTINCT ON (st.id)
         ma.filename, ma.kind::text AS kind, ma.mime_type, ma.byte_size,
         st.id AS stimulus_id,
         COALESCE(st.max_plays, ts.default_max_plays) AS effective_max_plays
    FROM stimulus st
    JOIN media_asset ma ON ma.id = st.media_asset_id
    JOIN question_group qg ON qg.stimulus_id = st.id
    JOIN test_section ts ON ts.id = qg.test_section_id
   WHERE st.test_version_id = $1
   ORDER BY st.id
`

/**
 * Everything needed to RUN a test with no network. Content comes from
 * `loadForRunner` (which omits `isCorrect` by construction and, for a capped
 * stimulus, any `mediaUrl`); section rules come from `loadTestBrief` so the
 * rules screen offline reads exactly what it reads online. Returns null for a
 * slug that does not exist or whose current version is unpublished -- the two
 * are deliberately indistinguishable (same rule as `loadTestBrief`).
 */
export async function loadOfflineBundle(
  db: PgQueryable,
  input: { slug: string; studentId: string },
): Promise<OfflineBundleRow | null> {
  // The brief and the content are two reads of "the current version". A
  // republish between them would pair the old sections with the new
  // version's (non-matching) groups -- a copy with empty sections saved under
  // a version id that never looks stale. Such a pair is detected (the
  // content's section ids differ from the brief's) and read again.
  for (let attempt = 0; attempt < MAX_READS; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const read = await readOnce(db, input)

    if (read !== "republished") {
      return read
    }
  }

  return null
}

const MAX_READS = 3

async function readOnce(
  db: PgQueryable,
  input: { slug: string; studentId: string },
): Promise<OfflineBundleRow | null | "republished"> {
  const brief = await loadTestBrief(db, input)

  if (!brief) {
    return null
  }

  const { rows: versionRows } = await db.query<VersionDbRow>(VERSION_QUERY, [
    input.slug,
  ])

  if (versionRows.length === 0) {
    return null
  }

  const [version] = versionRows
  const [content, mediaResult] = await Promise.all([
    loadForRunner(db, version.id, null),
    db.query<MediaDbRow>(MEDIA_QUERY, [version.id]),
  ])
  const groupsBySection = new Map<string, RunnerSection["groups"]>(
    content.map((section) => [section.id, section.groups]),
  )

  // (Content lists only sections with questions: `loadForRunner` inner-joins.)
  const briefIds = new Set(brief.sections.map((section) => section.id))

  if (
    content.some((section) => !briefIds.has(section.id)) ||
    brief.sections.some(
      (section) =>
        section.questionCount > 0 && !groupsBySection.has(section.id),
    )
  ) {
    return "republished"
  }

  const media: OfflineMediaRow[] = mediaResult.rows.map((row) => ({
    key: row.filename,
    stimulusId: row.stimulus_id,
    kind: row.kind,
    mimeType: row.mime_type,
    bytes: Number(row.byte_size),
    capped: row.effective_max_plays !== null,
  }))

  return {
    slug: brief.slug,
    testVersionId: version.id,
    version: version.version,
    title: brief.title,
    level: brief.level,
    durationSeconds: brief.durationSeconds,
    sections: brief.sections.map((section) => ({
      ...section,
      groups: groupsBySection.get(section.id) ?? [],
    })),
    media,
    totalBytes: media.reduce((sum, item) => sum + item.bytes, 0),
  }
}
