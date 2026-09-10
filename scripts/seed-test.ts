/**
 * Seeds a genuine 40-question TOEFL Primary Step 1 practice test (20
 * listening, 20 reading) so the API can be driven end to end -- GET /tests
 * -> GET /tests/{slug} -> POST /attempts -- against real content instead of
 * the one-assertion fixtures the rest of the suite uses, and so plan 3 has
 * something real to render.
 *
 * Run with `pnpm seed`. Uses the job pool, not the request pool:
 * `importTestDocument` inserts one row per statement down the whole FK
 * chain (test, sections, stimuli, groups, questions, choices), and that
 * many round trips for a 40-question document would be cancelled part-way
 * by the request path's 5s statement_timeout.
 *
 * Idempotent: a second run finds `practice-test-01` already published and
 * reports it instead of calling `importTestDocument` again. That matters
 * because `test_version_one_draft` (migration 1001) is a partial unique
 * index allowing only one *unpublished* version per test -- importing the
 * same slug twice without this guard either piles up abandoned drafts or,
 * if an earlier run's publish step failed partway, collides with that
 * index and dies unrecoverably.
 */
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { waitForDatabase } from "@liam-workspace/node-postgres"
import { testDocumentSchema, type TestDocument } from "@pp/common"
import { importTestDocument, publishDraftVersion } from "@pp/db/admin"
import { createJobPool, loadDbConfig, migrateToLatest } from "@pp/db"
import type pg from "pg"

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = resolve(here, "fixtures/practice-test-01.json")
const MEDIA_PATH = resolve(here, "fixtures/media/silence.mp3")
const MEDIA_FILENAME = "silence.mp3"

export interface SeedResult {
  testId: string
  versionId: string
  version: number
  alreadySeeded: boolean
}

interface ExistingTestRow {
  test_id: string
  version_id: string | null
  version: number | null
}

/**
 * Parsed through `testDocumentSchema` here, not left to `importTestDocument`
 * to discover -- a malformed fixture (section durations that do not sum to
 * the test duration, a bad correct-choice count, ...) should fail loudly at
 * seed time, not once the insert is already halfway into the database.
 */
async function loadDocument(): Promise<TestDocument> {
  const raw = await readFile(FIXTURE_PATH, "utf8")

  return testDocumentSchema.parse(JSON.parse(raw))
}

/**
 * Ships one silent mp3 and one `media_asset` row for it; all twenty
 * listening stimuli cite this same asset by filename (see
 * fixtures/practice-test-01.json). Inserted directly here rather than
 * through `POST /admin/media` -- the seed is a script, not an HTTP client,
 * and routing it through the upload endpoint would make seeding depend on a
 * running server and an admin token.
 */
async function ensureMediaAsset(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM media_asset WHERE filename = $1`,
    [MEDIA_FILENAME],
  )

  if (rows.length > 0) {
    return
  }

  const bytes = await readFile(MEDIA_PATH)
  const checksum = createHash("sha256").update(bytes).digest("hex")

  // The row alone is not enough. `media_asset.filename` is the LOCATOR: the
  // runner emits `/media/<filename>` and the serving route resolves it under
  // MEDIA_ROOT, so a row without the bytes beside it is a stimulus whose
  // audio 404s -- the listening screen would render a player that cannot
  // play. Seeding the row and not the file left exactly that gap.
  const mediaRoot = resolve(process.env.MEDIA_ROOT ?? "/media")

  await mkdir(mediaRoot, { recursive: true })
  await writeFile(resolve(mediaRoot, MEDIA_FILENAME), bytes)

  await pool.query(
    `INSERT INTO media_asset (kind, filename, mime_type, byte_size, checksum)
     VALUES ('audio', $1, 'audio/mpeg', $2, $3)`,
    [MEDIA_FILENAME, bytes.length, checksum],
  )
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

  if (rows.length === 0) {
    return null
  }

  const [row] = rows

  return row
}

/**
 * Publishes whatever outstanding draft `testId` has. Used both for a fresh
 * import and, self-healingly, for a test row left behind by an earlier run
 * that imported but never finished publishing.
 */
async function publishOrThrow(
  pool: pg.Pool,
  testId: string,
): Promise<{ versionId: string; version: number }> {
  const result = await publishDraftVersion(pool, { testId, now: new Date() })

  if (!result.ok) {
    throw new Error(
      `publishing practice-test-01 failed: ${JSON.stringify(result.violations)}`,
    )
  }

  return { versionId: result.versionId, version: result.version }
}

/**
 * Imports and publishes `practice-test-01.json` against `pool`, unless the
 * slug is already there -- in which case it reports the existing test and
 * makes no writes (beyond self-healing a leftover unpublished draft), so a
 * second `pnpm seed` run is always safe.
 */
export async function seedPracticeTest(pool: pg.Pool): Promise<SeedResult> {
  const doc = await loadDocument()
  const existing = await findExistingTest(pool, doc.slug)

  if (existing) {
    if (existing.version_id && existing.version !== null) {
      return {
        testId: existing.test_id,
        versionId: existing.version_id,
        version: existing.version,
        alreadySeeded: true,
      }
    }

    const published = await publishOrThrow(pool, existing.test_id)

    return {
      testId: existing.test_id,
      versionId: published.versionId,
      version: published.version,
      alreadySeeded: true,
    }
  }

  await ensureMediaAsset(pool)

  const imported = await importTestDocument(pool, doc)
  const published = await publishOrThrow(pool, imported.testId)

  return {
    testId: imported.testId,
    versionId: published.versionId,
    version: published.version,
    alreadySeeded: false,
  }
}

async function main(): Promise<void> {
  const config = loadDbConfig()

  // Mirrors main.ts's own boot sequence, so `pnpm seed` works against a
  // just-started `docker compose up` database the same way the server does,
  // without requiring the server to have run first.
  await waitForDatabase(config.databaseUrl, { retries: 30, delayMs: 1000 })
  await migrateToLatest(config.databaseUrl)

  const pool = createJobPool(config)

  try {
    const result = await seedPracticeTest(pool)
    const verb = result.alreadySeeded ? "Already seeded" : "Seeded"

    console.log(
      `${verb} practice-test-01: testId=${result.testId} versionId=${result.versionId} version=${result.version}`,
    )
  } finally {
    await pool.end()
  }
}

const isMainModule = import.meta.url === pathToFileURL(process.argv[1]).href

if (isMainModule) {
  await main()
}
