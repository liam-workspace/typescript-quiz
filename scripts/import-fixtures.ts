/**
 * Imports the 5 TOEFL Primary practice tests from the self-contained
 * fixtures committed in `fixtures/toefl-primary-tests/*.json` (test
 * documents) and `fixtures/toefl-primary-media/*.mp3` (their recordings) --
 * the descendant of `import-toefl-primary.ts` that no longer depends on
 * `TOEFL_PRIMARY_SOURCE_DIR` or an `ffmpeg` transcode. `export-toefl-
 * primary.ts` already produced ready-to-import JSON (its output shape IS
 * `TestDocument`) and the media fixtures are already real mp3 bytes, so
 * this script only has to read, validate, and load -- no external source
 * directory required.
 *
 * Run with `pnpm import:fixtures`. Idempotent the same way `seed-test.ts`
 * and `import-toefl-primary.ts` are: a slug already published is left
 * alone; a leftover unpublished draft (an earlier run that imported but
 * never finished publishing) is published rather than re-imported.
 *
 * Uses the job pool, not the request pool -- same reasoning as both of
 * those scripts: `importTestDocument` is one round trip per row down the
 * whole FK chain (test, sections, stimuli, groups, questions, choices),
 * and a 40+ question document would be cancelled part-way by the request
 * path's 5s statement_timeout.
 */
import { createHash } from "node:crypto"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { waitForDatabase } from "@liam-workspace/node-postgres"
import { testDocumentSchema, type TestDocument } from "@pp/common"
import {
  importTestDocument,
  publishDraftVersion,
  recordMediaAsset,
} from "@pp/db/admin"
import { createJobPool, loadDbConfig, migrateToLatest } from "@pp/db"
import type pg from "pg"

const here = dirname(fileURLToPath(import.meta.url))
const TESTS_DIR = resolve(here, "fixtures/toefl-primary-tests")
const MEDIA_DIR = resolve(here, "fixtures/toefl-primary-media")

interface ExistingTestRow {
  test_id: string
  version_id: string | null
  version: number | null
}

interface ImportOutcome {
  slug: string
  version: number
  status: "already-published" | "published-leftover-draft" | "imported"
  mediaCount: number
}

async function findExistingTest(
  pool: pg.Pool,
  slug: string,
): Promise<ExistingTestRow | null> {
  const { rows } = await pool.query<ExistingTestRow>(
    `SELECT t.id AS test_id, tv.id AS version_id, tv.version
       FROM test t
       LEFT JOIN test_version tv ON tv.id = t.current_version_id
      WHERE t.slug = $1`,
    [slug],
  )

  return rows[0] ?? null
}

/**
 * Parsed through `testDocumentSchema` here, not left to `importTestDocument`
 * to discover -- a malformed fixture (section durations that do not sum to
 * the test duration, a bad correct-choice count, an unsafe inline SVG, ...)
 * should fail loudly at load time, naming the file, not once the insert is
 * already halfway into the database.
 */
async function loadFixtureDocument(path: string): Promise<TestDocument> {
  const raw = await readFile(path, "utf8")

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(
      `${path}: not valid JSON -- ${(err as Error).message}`,
    )
  }

  const result = testDocumentSchema.safeParse(parsed)

  if (!result.success) {
    throw new Error(
      `${path}: failed schema validation -- ${result.error.message}`,
    )
  }

  return result.data
}

/**
 * Every `mediaFilename` a document's stimuli reference, across every
 * section and group -- the set this test needs recorded (and staged into
 * MEDIA_ROOT) before `importTestDocument` can resolve them by FK.
 */
function collectMediaFilenames(doc: TestDocument): string[] {
  const filenames = new Set<string>()

  for (const section of doc.sections) {
    for (const group of section.groups) {
      if (group.stimulus?.mediaFilename) {
        filenames.add(group.stimulus.mediaFilename)
      }
    }
  }

  return [...filenames]
}

/**
 * Records one `media_asset` row and copies its bytes into MEDIA_ROOT, from
 * the committed fixture mp3 -- not a transcode, unlike
 * `import-toefl-primary.ts`'s `ensureMediaAssets`, since
 * `fixtures/toefl-primary-media/` already holds real mp3 bytes.
 *
 * No-op (beyond the existence check) when the filename is already recorded,
 * so re-running is safe even if an earlier run got partway through a
 * document's media before failing.
 */
async function ensureMediaAsset(
  pool: pg.Pool,
  filename: string,
): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM media_asset WHERE filename = $1`,
    [filename],
  )

  if (rows.length > 0) {
    return
  }

  const sourcePath = join(MEDIA_DIR, filename)
  let bytes: Buffer

  try {
    bytes = await readFile(sourcePath)
  } catch (err) {
    throw new Error(
      `${filename}: referenced media not found at ${sourcePath} -- ${(err as Error).message}`,
    )
  }

  const checksum = createHash("sha256").update(bytes).digest("hex")
  const mediaRoot = resolve(process.env.MEDIA_ROOT ?? "/media")

  await mkdir(mediaRoot, { recursive: true })
  await writeFile(resolve(mediaRoot, filename), bytes)

  await recordMediaAsset(pool, {
    kind: "audio",
    filename,
    mimeType: "audio/mpeg",
    byteSize: bytes.length,
    checksum,
  })
}

/**
 * Publishes whatever outstanding draft `testId` has. Used both for a fresh
 * import and, self-healingly, for a test row left behind by an earlier run
 * that imported but never finished publishing.
 */
async function publishOrThrow(
  pool: pg.Pool,
  testId: string,
  slug: string,
): Promise<{ versionId: string; version: number }> {
  const result = await publishDraftVersion(pool, { testId, now: new Date() })

  if (!result.ok) {
    throw new Error(
      `${slug}: publishing failed -- ${JSON.stringify(result.violations)}`,
    )
  }

  return { versionId: result.versionId, version: result.version }
}

/**
 * Imports and publishes one fixture file against `pool`, unless the slug is
 * already published -- in which case it makes no writes (beyond
 * self-healing a leftover unpublished draft), so a second run over the
 * same fixture is always safe.
 *
 * Any failure below -- a missing referenced mp3, a media insert, the
 * import itself, or publishing -- is re-thrown naming `path`'s slug, so a
 * partial run never looks like a silent success.
 */
async function importOneFixture(
  pool: pg.Pool,
  path: string,
): Promise<ImportOutcome> {
  const doc = await loadFixtureDocument(path)
  const existing = await findExistingTest(pool, doc.slug)

  if (existing?.version_id && existing.version !== null) {
    return {
      slug: doc.slug,
      version: existing.version,
      status: "already-published",
      mediaCount: collectMediaFilenames(doc).length,
    }
  }

  try {
    const mediaFilenames = collectMediaFilenames(doc)

    // Sequential: each iteration is a small metadata insert plus a file
    // copy, and there is no benefit to concurrency for a handful of files
    // per document.
    /* eslint-disable no-await-in-loop */
    for (const filename of mediaFilenames) {
      await ensureMediaAsset(pool, filename)
    }
    /* eslint-enable no-await-in-loop */

    const testId =
      existing?.test_id ?? (await importTestDocument(pool, doc)).testId
    const published = await publishOrThrow(pool, testId, doc.slug)

    return {
      slug: doc.slug,
      version: published.version,
      status: existing ? "published-leftover-draft" : "imported",
      mediaCount: mediaFilenames.length,
    }
  } catch (err) {
    throw new Error(
      `${doc.slug} (${path}): import failed -- ${(err as Error).message}`,
      { cause: err },
    )
  }
}

async function main(): Promise<void> {
  const config = loadDbConfig()

  // Mirrors seed-test.ts's / import-toefl-primary.ts's boot sequence, so
  // this works against a just-started database the same way the server
  // does, without requiring the server to have run first.
  await waitForDatabase(config.databaseUrl, { retries: 30, delayMs: 1000 })
  await migrateToLatest(config.databaseUrl)

  const pool = createJobPool(config)

  try {
    const names = (await readdir(TESTS_DIR, { withFileTypes: true }))
      .filter((d) => d.isFile() && d.name.endsWith(".json"))
      .map((d) => d.name)
      .sort()

    if (names.length === 0) {
      throw new Error(`no fixture test documents found in ${TESTS_DIR}`)
    }

    // Sequential, not Promise.all: each import is one round trip per row
    // down the whole FK chain, and running all 5 concurrently would just
    // contend for the same 2-connection job pool for no real speedup.
    /* eslint-disable no-await-in-loop */
    for (const name of names) {
      const result = await importOneFixture(pool, join(TESTS_DIR, name))

      console.log(
        `${result.slug}: ${result.status} v${result.version} (${result.mediaCount} media files)`,
      )
    }
    /* eslint-enable no-await-in-loop */
  } finally {
    await pool.end()
  }
}

const isMainModule = import.meta.url === pathToFileURL(process.argv[1]).href

if (isMainModule) {
  await main()
}
