/**
 * Imports the 5 real TOEFL Primary practice tests (source: "Tom's English
 * grade 5/TOEFL-Primary/tests") into the database: transcodes each
 * referenced `.m4a` recording to mp3 (the server's EXTENSION_BY_MIME only
 * accepts audio/mpeg and audio/wav; AAC/m4a is not in that allowlist),
 * records a media_asset row + copies the bytes into MEDIA_ROOT for each,
 * then imports and publishes the document `toefl-primary-transform.ts`
 * builds.
 *
 * Run with `pnpm import:toefl-primary`. Idempotent the same way
 * `seed-test.ts` is: a slug already published is left alone; a leftover
 * unpublished draft is published rather than re-imported.
 *
 * Uses the job pool, not the request pool -- same reasoning as
 * `seed-test.ts`: `importTestDocument` is one round trip per row down the
 * whole FK chain, and 72 questions x 5 tests would be cancelled part-way by
 * the request path's 5s statement_timeout.
 */
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { waitForDatabase } from "@liam-workspace/node-postgres"
import {
  importTestDocument,
  publishDraftVersion,
  recordMediaAsset,
} from "@pp/db/admin"
import { createJobPool, loadDbConfig, migrateToLatest } from "@pp/db"
import type pg from "pg"
import { parseSourceTest, type SourceTest } from "./toefl-primary-transform.ts"

const execFileAsync = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))

// Overridable so this script is not hardwired to one machine's layout; the
// default is where the real fixture actually lives on this project's host.
const SOURCE_ROOT =
  process.env.TOEFL_PRIMARY_SOURCE_DIR ??
  "/Users/liam/projects/_personal-education/Tom's English grade 5/TOEFL-Primary/tests"

// Transcoded mp3s are NOT committed -- 126 real recordings is real binary
// weight a git repo should not carry, and they are trivially regenerable
// from the source .m4a files this script reads. Staged here, then copied
// into MEDIA_ROOT.
const STAGE_DIR = resolve(here, "fixtures/toefl-primary-media")

interface ExistingTestRow {
  test_id: string
  version_id: string | null
  version: number | null
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

async function transcode(
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true })
  // -qscale:a 4 is libmp3lame's VBR quality knob (0 best/largest -- 9
  // worst/smallest); 4 is a reasonable mid-quality default for short
  // spoken-word test-prep clips, not music.
  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    sourcePath,
    "-codec:a",
    "libmp3lame",
    "-qscale:a",
    "4",
    targetPath,
  ])
}

async function ensureMediaAssets(
  pool: pg.Pool,
  testDir: string,
  audioManifest: Map<string, string>,
): Promise<void> {
  const mediaRoot = resolve(process.env.MEDIA_ROOT ?? STAGE_DIR)

  await mkdir(mediaRoot, { recursive: true })

  // Sequential: each iteration spawns an ffmpeg process, and running all of
  // a test's ~20-30 at once would rather defeat the point of staying
  // predictable for a one-time import script.
  /* eslint-disable no-await-in-loop */
  for (const [stem, filename] of audioManifest) {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM media_asset WHERE filename = $1`,
      [filename],
    )

    if (rows.length > 0) {
      continue
    }

    const sourcePath = join(testDir, "audio", `${stem}.m4a`)
    const stagedPath = join(STAGE_DIR, filename)

    await transcode(sourcePath, stagedPath)

    const bytes = await readFile(stagedPath)
    const checksum = createHash("sha256").update(bytes).digest("hex")

    await writeFile(join(mediaRoot, filename), bytes)
    await recordMediaAsset(pool, {
      kind: "audio",
      filename,
      mimeType: "audio/mpeg",
      byteSize: bytes.length,
      checksum,
    })
  }
  /* eslint-enable no-await-in-loop */
}

async function importOneTest(pool: pg.Pool, testDir: string): Promise<void> {
  const raw = await readFile(join(testDir, "test.json"), "utf8")
  const source = JSON.parse(raw) as SourceTest
  const { document, audioManifest } = parseSourceTest(source)

  const existing = await findExistingTest(pool, document.slug)

  if (existing?.version_id && existing.version !== null) {
    console.log(`${document.slug}: already published (v${existing.version})`)

    return
  }

  await ensureMediaAssets(pool, testDir, audioManifest)

  const testId =
    existing?.test_id ?? (await importTestDocument(pool, document)).testId
  const published = await publishDraftVersion(pool, {
    testId,
    now: new Date(),
  })

  if (!published.ok) {
    throw new Error(
      `publishing ${document.slug} failed: ${JSON.stringify(published.violations)}`,
    )
  }

  console.log(
    `${document.slug}: imported and published v${published.version} ` +
      `(${audioManifest.size} audio files)`,
  )
}

async function main(): Promise<void> {
  const config = loadDbConfig()

  await waitForDatabase(config.databaseUrl, { retries: 30, delayMs: 1000 })
  await migrateToLatest(config.databaseUrl)

  const pool = createJobPool(config)

  try {
    const dirs = (await readdir(SOURCE_ROOT, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()

    // Sequential, not Promise.all: each test's import is one round trip per
    // row down the whole FK chain, and running all 5 concurrently would
    // just contend for the same job pool connections for no real speedup.
    /* eslint-disable no-await-in-loop */
    for (const dir of dirs) {
      await importOneTest(pool, join(SOURCE_ROOT, dir))
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
