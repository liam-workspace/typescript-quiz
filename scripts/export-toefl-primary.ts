/**
 * Exports the 5 published TOEFL Primary practice tests back out of Postgres
 * (the inverse of `import-toefl-primary.ts`) into standalone JSON fixtures
 * under `fixtures/toefl-primary-tests/`, so the test documents no longer
 * depend on the external source directory (`TOEFL_PRIMARY_SOURCE_DIR`) or a
 * running import to reproduce -- only this repo's committed fixtures plus
 * the mp3s in `fixtures/toefl-primary-media/`.
 *
 * Run with `pnpm export:toefl-primary`. Read-only against the database;
 * safe to re-run any time to refresh the fixtures after a re-import.
 *
 * `exportTestDocument` emits `isCorrect` on every choice (it is admin-fenced
 * for that reason -- see packages/db/src/admin.ts) which is intentional
 * here: these fixtures back `seed-test.ts`-style scripts, not
 * student-facing routes.
 */
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { exportTestDocument } from "@pp/db/admin"
import { createRequestPool, loadDbConfig, migrateToLatest } from "@pp/db"
import type pg from "pg"

const here = dirname(fileURLToPath(import.meta.url))
const OUTPUT_DIR = resolve(here, "fixtures/toefl-primary-tests")

// The 5 slugs `toefl-primary-transform.ts` derives from `source.meta.id` for
// the "Tom's English grade 5" corpus -- fixed rather than discovered, so a
// stray unrelated published test never ends up in this fixture set.
const SLUGS = [
  "step1-20260817-s1",
  "step1-20260817-s2",
  "step2-20260817-s1",
  "step2-20260817-s2",
  "step2-20260817-s3",
]

interface CurrentVersionRow {
  version_id: string | null
}

async function findCurrentVersionId(
  pool: pg.Pool,
  slug: string,
): Promise<string> {
  const { rows } = await pool.query<CurrentVersionRow>(
    `SELECT tv.id AS version_id
       FROM test t
       LEFT JOIN test_version tv ON tv.id = t.current_version_id
      WHERE t.slug = $1`,
    [slug],
  )

  const versionId = rows[0]?.version_id

  if (!versionId) {
    throw new Error(`${slug}: no published version -- run pnpm import:toefl-primary first`)
  }

  return versionId
}

async function exportOne(pool: pg.Pool, slug: string): Promise<void> {
  const versionId = await findCurrentVersionId(pool, slug)
  const document = await exportTestDocument(pool, versionId)

  await mkdir(OUTPUT_DIR, { recursive: true })
  await writeFile(
    resolve(OUTPUT_DIR, `${slug}.json`),
    `${JSON.stringify(document, null, 2)}\n`,
  )

  console.log(`${slug}: exported`)
}

async function main(): Promise<void> {
  const config = loadDbConfig()

  await migrateToLatest(config.databaseUrl)

  const pool = createRequestPool(config)

  try {
    // Sequential: 5 tests, one export query each -- no benefit to
    // concurrency, and it keeps output order predictable.
    /* eslint-disable no-await-in-loop */
    for (const slug of SLUGS) {
      await exportOne(pool, slug)
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
