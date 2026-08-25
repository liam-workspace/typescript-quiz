# Foundation: Database and Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `db` and `common` packages — migrations, repositories, domain types and the JSON interchange format — with every schema invariant proven against a real PostgreSQL, so later plans build the API on ground that is known solid.

**Architecture:** A pnpm workspace gains two new packages. `@pp/common` holds domain types and the Zod validators for the import/export document; it has no runtime dependencies beyond `zod`. `@pp/db` holds `node-pg-migrate` migrations transcribed from the reviewed `docs/db/schema.sql`, plus repositories that own every SQL statement — no SQL leaves this package. Tests run against a throwaway PostgreSQL 16 via testcontainers, so constraint tests exercise real triggers and real composite foreign keys rather than mocks.

**Tech Stack:** Node 24, pnpm 10.16, TypeScript 6, PostgreSQL 16, `@liam-public/node-postgres` (pooling, transactions, `runMigrations`), `node-pg-migrate`, Zod 4, Vitest 4, `@testcontainers/postgresql`, oxlint, prettier.

**Spec:** `docs/superpowers/specs/2026-08-25-toefl-primary-fork-design.md`

## Global Constraints

- Node **>= 24**, pnpm **>= 10.16** (existing repo floor; do not lower).
- The package scope is **`@pp/*`**. Do not add anything new under `@razzia/*` — the rename to exam vocabulary happens from the first commit, per spec §3.
- Relative imports in Node packages carry the **`.js` extension** (`"type": "module"`, `verbatimModuleSyntax: true`).
- **`docs/db/schema.sql` is the authority.** Migrations transcribe it. If a migration and the schema disagree, the schema is right and the migration is a bug.
- **No SQL outside `packages/db/src/`.** Services and routes call repositories.
- **A published `test_version` is immutable**, and **nothing may cross a version boundary** (spec §3). Every table carries `test_version_id` and every parent link is a composite FK including it.
- `failed_write.raw_body` is **`text`, never `jsonb`**, and the table has **no foreign keys**. Its job is holding bodies that failed to parse.
- Ordering is **`(client_instance_id, client_seq)`**, never `answered_at`. `answered_at` is display text with no authority.
- Commit after every task with a `feat:` / `test:` / `chore:` message.
- `pnpm lint` and `pnpm format` must pass before each commit.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/common/package.json` | renamed to `@pp/common`; drops `socket.io` |
| `packages/common/src/domain/test.ts` | Test / version / section / group / stimulus / question / choice types |
| `packages/common/src/domain/attempt.ts` | Attempt, response, score, write-result types |
| `packages/common/src/domain/ids.ts` | Branded id types so a `QuestionId` cannot be passed as an `AttemptId` |
| `packages/common/src/interchange/test-document.ts` | Zod schema for the import/export document |
| `packages/common/src/index.ts` | public surface |
| `packages/db/package.json` | new `@pp/db` |
| `packages/db/migrations/1000_enums_identity_media.cjs` | enums, `student`, `media_asset` |
| `packages/db/migrations/1001_content.cjs` | test → choice, `section_instruction`, `question_tag` |
| `packages/db/migrations/1002_attempts.cjs` | attempt, sections, responses, cursor, plays |
| `packages/db/migrations/1003_durability_and_triggers.cjs` | `failed_write`, immutability triggers, `publication_violation` |
| `packages/db/src/pool.ts` | `createRequestPool` / `createJobPool` with named `applicationName` |
| `packages/db/src/migrate.ts` | `migrateToLatest(databaseUrl)` |
| `packages/db/src/repositories/test-version.repository.ts` | `loadForRunner` / `loadForScoring` — the two deliberately separate projections |
| `packages/db/src/repositories/test-import.repository.ts` | import a `TestDocument`, export one back |
| `packages/db/src/index.ts` | public surface |
| `packages/db/test/helpers/database.ts` | testcontainers harness shared by every db test |
| `packages/db/test/constraints.test.ts` | proves each invariant rejects what it claims |
| `packages/db/test/enum-parity.test.ts` | SQL enums == OpenAPI enums |
| `packages/db/test/import-export.test.ts` | round trip deep-equal |
| `compose.yml` | gains a `postgres` service |
| `vitest.workspace.ts` | root test config |

---

### Task 1: Workspace scaffold and test runner

**Files:**
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/src/index.ts`
- Create: `vitest.workspace.ts`
- Modify: `package.json` (root — add `test` scripts), `tsconfig.json` (paths), `packages/common/package.json`

**Interfaces:**
- Produces: workspace packages `@pp/db` and `@pp/common`; root scripts `pnpm test`, `pnpm test:db`.

- [ ] **Step 1: Rename `common` and drop the dead socket dependency**

`packages/common/package.json`:

```json
{
  "name": "@pp/common",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@types/node": "^26.0.1",
    "typescript": "^6.0.3"
  }
}
```

- [ ] **Step 2: Create the `db` package**

`packages/db/package.json`:

```json
{
  "name": "@pp/db",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run"
  },
  "dependencies": {
    "@liam-public/node-postgres": "workspace:*",
    "@pp/common": "workspace:*",
    "node-pg-migrate": "^7.9.0",
    "pg": "^8.13.0"
  },
  "devDependencies": {
    "@testcontainers/postgresql": "^11.0.0",
    "@types/node": "^26.0.1",
    "@types/pg": "^8.11.0",
    "typescript": "^6.0.3",
    "vitest": "^4.1.0"
  }
}
```

> `@liam-public/node-postgres` is published from `~/projects/typescript-libraries`.
> If it is not on the registry yet, add it as a `file:` dependency pointing at
> `../../../typescript-libraries/packages/public/server/node-postgres` and note
> that in the commit message.

`packages/db/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "verbatimModuleSyntax": true
  }
}
```

`packages/db/src/index.ts`:

```ts
export {}
```

- [ ] **Step 3: Point the root tsconfig at the new packages**

Replace the `paths` block in `tsconfig.json`:

```json
"paths": {
  "@pp/common": ["./packages/common/src/index.ts"],
  "@pp/common/*": ["./packages/common/src/*"],
  "@pp/db": ["./packages/db/src/index.ts"],
  "@pp/db/*": ["./packages/db/src/*"]
}
```

- [ ] **Step 4: Add the workspace test config**

`vitest.workspace.ts`:

```ts
export default ["packages/*"]
```

Add to root `package.json` scripts:

```json
"test": "vitest run",
"test:db": "pnpm --filter @pp/db test"
```

- [ ] **Step 5: Install and verify the workspace resolves**

```bash
pnpm install
pnpm -r exec tsc --noEmit
```

Expected: install succeeds, no type errors.

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json vitest.workspace.ts packages/common/package.json packages/db pnpm-lock.yaml
git commit -m "chore: scaffold @pp/db and rename @razzia/common to @pp/common"
```

---

### Task 2: PostgreSQL test harness

**Files:**
- Create: `packages/db/test/helpers/database.ts`
- Create: `packages/db/test/harness.test.ts`
- Modify: `compose.yml`

**Interfaces:**
- Produces: `withDatabase(fn)` — starts a throwaway PostgreSQL 16, runs migrations, hands `fn` a `pg.Pool`, tears down. Every later db test uses it.

- [ ] **Step 1: Write the failing test**

`packages/db/test/harness.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { withDatabase } from "./helpers/database.js"

describe("test harness", () => {
  it("gives a live PostgreSQL 16 connection", async () => {
    await withDatabase(async (pool) => {
      const { rows } = await pool.query<{ version: string }>("SELECT version()")
      expect(rows[0].version).toContain("PostgreSQL 16")
    })
  }, 120_000)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @pp/db test harness`
Expected: FAIL — cannot resolve `./helpers/database.js`.

- [ ] **Step 3: Implement the harness**

`packages/db/test/helpers/database.ts`:

```ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"

export interface DatabaseHandle {
  pool: pg.Pool
  databaseUrl: string
}

let container: StartedPostgreSqlContainer | undefined

/**
 * One container per worker, reused across tests; each call gets a freshly
 * migrated schema. Starting a container per test would triple the suite time
 * for no isolation benefit, because we drop and rebuild the schema anyway.
 */
export async function withDatabase(
  fn: (pool: pg.Pool, handle: DatabaseHandle) => Promise<void>,
): Promise<void> {
  container ??= await new PostgreSqlContainer("postgres:16-alpine").start()
  const databaseUrl = container.getConnectionUri()
  const pool = new pg.Pool({ connectionString: databaseUrl })

  try {
    await pool.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;")
    // migrateToLatest arrives in Task 3; until then the harness only proves
    // connectivity.
    await fn(pool, { pool, databaseUrl })
  } finally {
    await pool.end()
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @pp/db test harness`
Expected: PASS (first run pulls the image; allow up to two minutes).

- [ ] **Step 5: Add PostgreSQL to compose**

Append to `compose.yml`:

```yaml
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: pp
      POSTGRES_PASSWORD: pp
      POSTGRES_DB: pp
    ports:
      - "5432:5432"
    volumes:
      - pp-postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U pp -d pp"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  pp-postgres:
```

- [ ] **Step 6: Commit**

```bash
git add packages/db/test compose.yml
git commit -m "test(db): testcontainers harness against PostgreSQL 16"
```

---

### Task 3: Migration 1000 — enums, identity, media

**Files:**
- Create: `packages/db/migrations/1000_enums_identity_media.cjs`
- Create: `packages/db/src/migrate.ts`
- Create: `packages/db/test/migrate.test.ts`
- Modify: `packages/db/test/helpers/database.ts`

**Interfaces:**
- Produces: `migrateToLatest(databaseUrl: string): Promise<void>` — runs every migration in `packages/db/migrations` with `migrationsTable: 'pp_migrations'`.

- [ ] **Step 1: Write the failing test**

`packages/db/test/migrate.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { withDatabase } from "./helpers/database.js"

const EXPECTED_ENUMS = {
  section_type: ["listening", "reading", "vocabulary", "grammar"],
  nav_mode: ["free", "forward_only"],
  stimulus_type: ["audio", "passage", "image", "mixed"],
  question_type: ["single_choice", "multi_choice"],
  attempt_status: ["in_progress", "submitted", "expired"],
  media_kind: ["audio", "image"],
  student_level: ["primary-step-1", "primary-step-2"],
}

describe("migration 1000", () => {
  it("creates every enum with exactly the documented members", async () => {
    await withDatabase(async (pool) => {
      for (const [name, members] of Object.entries(EXPECTED_ENUMS)) {
        const { rows } = await pool.query<{ label: string }>(
          `SELECT e.enumlabel AS label
             FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
            WHERE t.typname = $1
            ORDER BY e.enumsortorder`,
          [name],
        )
        expect(rows.map((r) => r.label), name).toEqual(members)
      }
    })
  }, 120_000)

  it("rejects a student with a blank display name", async () => {
    await withDatabase(async (pool) => {
      await expect(
        pool.query(
          `INSERT INTO student (subject_claim, email, display_name)
           VALUES ('s1', 'a@b', '   ')`,
        ),
      ).rejects.toThrow(/student_name_not_blank/)
    })
  }, 120_000)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @pp/db test migrate`
Expected: FAIL — relation `student` does not exist.

- [ ] **Step 3: Write the migration**

`packages/db/migrations/1000_enums_identity_media.cjs`. Transcribe the enum,
`student` and `media_asset` blocks from `docs/db/schema.sql` verbatim:

```js
/* eslint-disable camelcase */
exports.shorthands = undefined

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE section_type   AS ENUM ('listening', 'reading', 'vocabulary', 'grammar');
    CREATE TYPE nav_mode       AS ENUM ('free', 'forward_only');
    CREATE TYPE stimulus_type  AS ENUM ('audio', 'passage', 'image', 'mixed');
    CREATE TYPE question_type  AS ENUM ('single_choice', 'multi_choice');
    CREATE TYPE attempt_status AS ENUM ('in_progress', 'submitted', 'expired');
    CREATE TYPE media_kind     AS ENUM ('audio', 'image');
    CREATE TYPE student_level  AS ENUM ('primary-step-1', 'primary-step-2');

    CREATE TABLE student (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      subject_claim text        NOT NULL UNIQUE,
      email         text        NOT NULL,
      display_name  text        NOT NULL,
      picture_url   text,
      level         student_level,
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT student_email_not_blank CHECK (length(btrim(email)) > 0),
      CONSTRAINT student_name_not_blank  CHECK (length(btrim(display_name)) > 0)
    );

    CREATE TABLE media_asset (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      kind       media_kind  NOT NULL,
      filename   text        NOT NULL UNIQUE,
      mime_type  text        NOT NULL,
      byte_size  bigint      NOT NULL,
      checksum   text        NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT media_size_positive CHECK (byte_size > 0)
    );
  `)
}

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE media_asset;
    DROP TABLE student;
    DROP TYPE student_level, media_kind, attempt_status,
              question_type, stimulus_type, nav_mode, section_type;
  `)
}
```

- [ ] **Step 4: Implement the migration runner**

`packages/db/src/migrate.ts`:

```ts
import { runMigrations } from "@liam-public/node-postgres"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Runs at API startup. `migrationsTable` is scoped so this service can share a
 * database with another without the two fighting over one migrations table.
 */
export async function migrateToLatest(databaseUrl: string): Promise<void> {
  await runMigrations(databaseUrl, resolve(here, "../migrations"), {
    migrationsTable: "pp_migrations",
  })
}
```

- [ ] **Step 5: Wire the harness to migrate**

In `packages/db/test/helpers/database.ts`, replace the placeholder comment with:

```ts
import { migrateToLatest } from "../../src/migrate.js"
// …
    await pool.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;")
    await migrateToLatest(databaseUrl)
    await fn(pool, { pool, databaseUrl })
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @pp/db test migrate`
Expected: PASS — both tests.

- [ ] **Step 7: Commit**

```bash
git add packages/db/migrations packages/db/src/migrate.ts packages/db/test
git commit -m "feat(db): migration 1000 — enums, student, media_asset"
```

---

### Task 4: Migration 1001 — authored content

**Files:**
- Create: `packages/db/migrations/1001_content.cjs`
- Create: `packages/db/test/content-constraints.test.ts`

**Interfaces:**
- Produces: tables `test`, `test_version`, `test_section`, `section_instruction`, `stimulus`, `question_group`, `question`, `choice`, `question_tag` with the composite-FK discriminators later tasks depend on: `test_version(id, test_id)`, `test_section(id, test_version_id)`, `stimulus(id, test_version_id)`, `question_group(id, test_version_id)`, `question(id, test_version_id)`, `choice(id, question_id)`.

- [ ] **Step 1: Write the failing tests**

`packages/db/test/content-constraints.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { withDatabase } from "./helpers/database.js"

async function seedTestWithOneDraft(pool: import("pg").Pool) {
  await pool.query(`INSERT INTO test (id, slug) VALUES ('22222222-2222-2222-2222-222222222222','t04')`)
  await pool.query(
    `INSERT INTO test_version (id, test_id, version, title, duration_seconds)
     VALUES ('a0000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222',1,'T04',3000)`,
  )
}

describe("migration 1001 — content", () => {
  it("permits only one unpublished draft per test", async () => {
    await withDatabase(async (pool) => {
      await seedTestWithOneDraft(pool)
      await expect(
        pool.query(
          `INSERT INTO test_version (test_id, version, title, duration_seconds)
           VALUES ('22222222-2222-2222-2222-222222222222',2,'T04',3000)`,
        ),
      ).rejects.toThrow(/test_version_one_draft/)
    })
  }, 120_000)

  it("refuses a question group whose section belongs to another version", async () => {
    await withDatabase(async (pool) => {
      await seedTestWithOneDraft(pool)
      await pool.query(
        `INSERT INTO test_section (id, test_version_id, ordinal, title, type,
                                   duration_seconds, navigation, allow_answer_change)
         VALUES ('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001',
                 1,'L','listening',3000,'forward_only',false)`,
      )
      // a group claiming a different version than its section
      await expect(
        pool.query(
          `INSERT INTO question_group (test_version_id, test_section_id, ordinal)
           VALUES ('a0000000-0000-0000-0000-0000000000ff','b0000000-0000-0000-0000-000000000001',1)`,
        ),
      ).rejects.toThrow(/group_section_fk/)
    })
  }, 120_000)

  it("keeps instruction order stable", async () => {
    await withDatabase(async (pool) => {
      await seedTestWithOneDraft(pool)
      await pool.query(
        `INSERT INTO test_section (id, test_version_id, ordinal, title, type,
                                   duration_seconds, navigation, allow_answer_change)
         VALUES ('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001',
                 1,'L','listening',3000,'forward_only',false)`,
      )
      await pool.query(
        `INSERT INTO section_instruction (test_section_id, ordinal, text) VALUES
           ('b0000000-0000-0000-0000-000000000001', 2, 'second'),
           ('b0000000-0000-0000-0000-000000000001', 1, 'first')`,
      )
      const { rows } = await pool.query<{ text: string }>(
        `SELECT text FROM section_instruction
          WHERE test_section_id='b0000000-0000-0000-0000-000000000001' ORDER BY ordinal`,
      )
      expect(rows.map((r) => r.text)).toEqual(["first", "second"])
    })
  }, 120_000)

  it("rejects a section whose playback booleans are half-set", async () => {
    await withDatabase(async (pool) => {
      await seedTestWithOneDraft(pool)
      await expect(
        pool.query(
          `INSERT INTO test_section (test_version_id, ordinal, title, type, duration_seconds,
                                     navigation, allow_answer_change, default_allow_pause)
           VALUES ('a0000000-0000-0000-0000-000000000001',1,'L','listening',3000,
                   'forward_only',false,false)`,
        ),
      ).rejects.toThrow(/section_playback_all_or_nothing/)
    })
  }, 120_000)
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @pp/db test content-constraints`
Expected: FAIL — relation `test` does not exist.

- [ ] **Step 3: Write the migration**

`packages/db/migrations/1001_content.cjs` — transcribe **`docs/db/schema.sql`
lines 83–284** (the `AUTHORED CONTENT` block) verbatim into the `pgm.sql()`
template literal. Extract it exactly:

```bash
sed -n '83,284p' docs/db/schema.sql > /tmp/content.sql
wc -l /tmp/content.sql   # expect 202
```

The SQL is not repeated here on purpose: `schema.sql` is the authority
(Global Constraints), and a second copy in this document would be a second
thing to keep in sync. Confirm the block contains:

- `test_version_one_draft` partial unique index
- the `ALTER TABLE test ADD CONSTRAINT test_current_version_fk` that closes the
  circular reference after `test_version` exists
- every `UNIQUE (id, <parent>)` discriminator — `test_version_id_self`,
  `section_id_version`, `stimulus_id_version`, `group_id_version`,
  `question_id_version`, `choice_id_question`
- `question_key_idx`

```js
exports.shorthands = undefined
exports.up = (pgm) => {
  pgm.sql(`
    -- docs/db/schema.sql lines 83-284, verbatim
    <paste /tmp/content.sql here>
  `)
}
exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE question_tag, choice, question, question_group,
               section_instruction, stimulus, test_section;
    ALTER TABLE test DROP CONSTRAINT test_current_version_fk;
    DROP TABLE test_version, test;
  `)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @pp/db test content-constraints`
Expected: PASS — all four.

- [ ] **Step 5: Commit**

```bash
git add packages/db/migrations/1001_content.cjs packages/db/test/content-constraints.test.ts
git commit -m "feat(db): migration 1001 — authored content with version-scoped composite keys"
```

---

### Task 5: Migration 1002 — attempts and responses

**Files:**
- Create: `packages/db/migrations/1002_attempts.cjs`
- Create: `packages/db/test/attempt-constraints.test.ts`
- Create: `packages/db/test/helpers/fixtures.ts`

**Interfaces:**
- Consumes: the content tables from Task 4.
- Produces: `seedPublishedTest(pool): Promise<Fixture>` where
  `Fixture = { testId, versionId, listeningSectionId, readingSectionId, questionIds: string[], choiceIds: string[], studentId }`.
  Later tasks and plans reuse this fixture rather than re-seeding by hand.

- [ ] **Step 1: Write the fixture helper**

`packages/db/test/helpers/fixtures.ts`:

```ts
import type pg from "pg"

export interface Fixture {
  studentId: string
  testId: string
  versionId: string
  listeningSectionId: string
  readingSectionId: string
  questionIds: string[]
  choiceIds: string[]
}

/**
 * Seeds one test with a listening and a reading section, two questions and
 * four choices, then PUBLISHES it. Content must be written before publication:
 * the immutability trigger refuses inserts once published_at is set.
 */
export async function seedPublishedTest(pool: pg.Pool): Promise<Fixture> {
  const studentId = "11111111-1111-1111-1111-111111111111"
  const testId = "22222222-2222-2222-2222-222222222222"
  const versionId = "a0000000-0000-0000-0000-000000000001"
  const listeningSectionId = "b0000000-0000-0000-0000-000000000001"
  const readingSectionId = "b0000000-0000-0000-0000-000000000002"
  const groupL = "c0000000-0000-0000-0000-000000000001"
  const groupR = "c0000000-0000-0000-0000-000000000002"
  const q1 = "d0000000-0000-0000-0000-000000000001"
  const q2 = "d0000000-0000-0000-0000-000000000002"
  const c1 = "e0000000-0000-0000-0000-000000000001"
  const c2 = "e0000000-0000-0000-0000-000000000002"
  const c3 = "e0000000-0000-0000-0000-000000000003"
  const c4 = "e0000000-0000-0000-0000-000000000004"

  await pool.query(
    `INSERT INTO student (id, subject_claim, email, display_name)
     VALUES ($1,'sub-tom','tom@example.test','Tom')`,
    [studentId],
  )
  await pool.query(`INSERT INTO test (id, slug) VALUES ($1,'practice-test-04')`, [testId])
  await pool.query(
    `INSERT INTO test_version (id, test_id, version, title, duration_seconds)
     VALUES ($1,$2,1,'TOEFL Primary — Practice Test 04',3000)`,
    [versionId, testId],
  )
  await pool.query(
    `INSERT INTO test_section (id, test_version_id, ordinal, title, type, duration_seconds,
                               navigation, allow_answer_change,
                               default_max_plays, default_allow_pause, default_allow_seek)
     VALUES ($1,$3,1,'Listening — Part 1','listening',1500,'forward_only',false,1,false,false),
            ($2,$3,2,'Reading','reading',1500,'free',true,NULL,NULL,NULL)`,
    [listeningSectionId, readingSectionId, versionId],
  )
  await pool.query(
    `INSERT INTO section_instruction (test_section_id, ordinal, text)
     VALUES ($1,1,'Put your headphones on now.')`,
    [listeningSectionId],
  )
  await pool.query(
    `INSERT INTO question_group (id, test_version_id, test_section_id, ordinal)
     VALUES ($1,$3,$4,1), ($2,$3,$5,1)`,
    [groupL, groupR, versionId, listeningSectionId, readingSectionId],
  )
  await pool.query(
    `INSERT INTO question (id, test_version_id, question_group_id, question_key,
                           ordinal, prompt, type, points)
     VALUES ($1,$3,$4,'q1',1,'What does the boy want to do?','single_choice',1),
            ($2,$3,$5,'q2',2,'Why did the class eat inside?','single_choice',1)`,
    [q1, q2, versionId, groupL, groupR],
  )
  await pool.query(
    `INSERT INTO choice (id, question_id, ordinal, label, is_correct)
     VALUES ($1,$5,1,'Read a book',true), ($2,$5,2,'Play football',false),
            ($3,$6,1,'It began to rain',true), ($4,$6,2,'The bus was late',false)`,
    [c1, c2, c3, c4, q1, q2],
  )
  await pool.query(`UPDATE test_version SET published_at = now() WHERE id = $1`, [versionId])
  await pool.query(`UPDATE test SET current_version_id = $1 WHERE id = $2`, [versionId, testId])

  return {
    studentId, testId, versionId, listeningSectionId, readingSectionId,
    questionIds: [q1, q2], choiceIds: [c1, c2, c3, c4],
  }
}
```

- [ ] **Step 2: Write the failing tests**

`packages/db/test/attempt-constraints.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { withDatabase } from "./helpers/database.js"
import { seedPublishedTest } from "./helpers/fixtures.js"

const newAttempt = (pool: import("pg").Pool, f: { studentId: string; versionId: string }, id: string) =>
  pool.query(`INSERT INTO attempt (id, student_id, test_version_id) VALUES ($1,$2,$3)`,
    [id, f.studentId, f.versionId])

describe("migration 1002 — attempts", () => {
  it("allows only one in-progress attempt per student per version", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      await newAttempt(pool, f, "f0000000-0000-0000-0000-000000000001")
      await expect(newAttempt(pool, f, "f0000000-0000-0000-0000-000000000002"))
        .rejects.toThrow(/attempt_one_active/)
    })
  }, 120_000)

  it("refuses a half-started clock", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      await newAttempt(pool, f, "f0000000-0000-0000-0000-000000000001")
      await expect(
        pool.query(`UPDATE attempt SET started_at = now()
                     WHERE id='f0000000-0000-0000-0000-000000000001'`),
      ).rejects.toThrow(/attempt_clock_paired/)
    })
  }, 120_000)

  it("refuses an expired attempt not pinned to its deadline", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      await newAttempt(pool, f, "f0000000-0000-0000-0000-000000000001")
      await pool.query(`UPDATE attempt SET started_at=now(), expires_at=now()+interval '50 min'
                         WHERE id='f0000000-0000-0000-0000-000000000001'`)
      await expect(
        pool.query(
          `UPDATE attempt SET status='expired', submitted_at=now()+interval '99 min',
             points_earned=1, points_possible=2, percentage=50, answered_count=1,
             unanswered_count=1, correct_count=1, incorrect_count=0, question_count=2
           WHERE id='f0000000-0000-0000-0000-000000000001'`,
        ),
      ).rejects.toThrow(/attempt_expired_pins_deadline/)
    })
  }, 120_000)

  it("refuses a response to a question from another version", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      await newAttempt(pool, f, "f0000000-0000-0000-0000-000000000001")
      await expect(
        pool.query(
          `INSERT INTO response (attempt_id, question_id, test_version_id,
                                 client_instance_id, client_seq)
           VALUES ('f0000000-0000-0000-0000-000000000001',
                   'd000000f-0000-0000-0000-0000000000ff', $1, 'ci', 1)`,
          [f.versionId],
        ),
      ).rejects.toThrow(/response_question_fk/)
    })
  }, 120_000)

  it("refuses a choice belonging to a different question", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      await newAttempt(pool, f, "f0000000-0000-0000-0000-000000000001")
      await pool.query(
        `INSERT INTO response (attempt_id, question_id, test_version_id,
                               client_instance_id, client_seq)
         VALUES ('f0000000-0000-0000-0000-000000000001', $1, $2, 'ci', 1)`,
        [f.questionIds[0], f.versionId],
      )
      await expect(
        pool.query(
          `INSERT INTO response_choice (attempt_id, question_id, choice_id)
           VALUES ('f0000000-0000-0000-0000-000000000001', $1, $2)`,
          [f.questionIds[0], f.choiceIds[2]], // a choice of question 2
        ),
      ).rejects.toThrow(/response_choice_choice_fk/)
    })
  }, 120_000)

  it("allows only one open section at a time", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      await newAttempt(pool, f, "f0000000-0000-0000-0000-000000000001")
      const enter = (sectionId: string) =>
        pool.query(
          `INSERT INTO attempt_section (attempt_id, test_section_id, test_version_id, expires_at)
           VALUES ('f0000000-0000-0000-0000-000000000001',$1,$2, now()+interval '25 min')`,
          [sectionId, f.versionId],
        )
      await enter(f.listeningSectionId)
      await expect(enter(f.readingSectionId)).rejects.toThrow(/attempt_section_one_open/)
    })
  }, 120_000)
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter @pp/db test attempt-constraints`
Expected: FAIL — relation `attempt` does not exist.

- [ ] **Step 4: Write the migration**

`packages/db/migrations/1002_attempts.cjs` — transcribe **`docs/db/schema.sql`
lines 286–507** (the `ATTEMPTS` block) verbatim:

```bash
sed -n '286,507p' docs/db/schema.sql > /tmp/attempts.sql
grep -c 'CREATE TABLE' /tmp/attempts.sql   # expect 6
grep -cE 'CREATE (UNIQUE )?INDEX' /tmp/attempts.sql # expect 4
```

```js
exports.shorthands = undefined
exports.up = (pgm) => {
  pgm.sql(`
    -- docs/db/schema.sql lines 286-507, verbatim
    <paste /tmp/attempts.sql here>
  `)
}
exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE stimulus_play, response_choice, response_client_cursor,
               response, attempt_section, attempt;
  `)
}
```

The block defines `attempt`, `attempt_one_active`, `attempt_history_idx`,
`attempt_standing_idx`, `attempt_section`, `attempt_section_one_open`,
`response`, `response_client_cursor`, `response_choice` and `stimulus_play`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @pp/db test attempt-constraints`
Expected: PASS — all six.

- [ ] **Step 6: Commit**

```bash
git add packages/db/migrations/1002_attempts.cjs packages/db/test
git commit -m "feat(db): migration 1002 — attempts, responses, plays"
```

---

### Task 6: Migration 1003 — durability, immutability, publication checks

**Files:**
- Create: `packages/db/migrations/1003_durability_and_triggers.cjs`
- Create: `packages/db/test/durability.test.ts`

**Interfaces:**
- Produces: `failed_write` table; immutability triggers on every content table; the `publication_violation` view returning `(test_version_id, question_id, section_id, rule, detail)`.

- [ ] **Step 1: Write the failing tests**

`packages/db/test/durability.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { withDatabase } from "./helpers/database.js"
import { seedPublishedTest } from "./helpers/fixtures.js"

describe("migration 1003 — durability and immutability", () => {
  it("stores a body that is not valid JSON", async () => {
    await withDatabase(async (pool) => {
      const notJson = '{"responses": [ this is not json'
      await pool.query(
        `INSERT INTO failed_write (attempt_id, route, reason, raw_body, byte_size)
         VALUES ('not-a-uuid', 'PATCH /api/attempts/x/responses', 'unparseable', $1, $2)`,
        [notJson, Buffer.byteLength(notJson)],
      )
      const { rows } = await pool.query<{ raw_body: string }>(`SELECT raw_body FROM failed_write`)
      expect(rows[0].raw_body).toBe(notJson)
    })
  }, 120_000)

  it("refuses to edit a question on a published version", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      await expect(
        pool.query(`UPDATE question SET prompt='tampered' WHERE id=$1`, [f.questionIds[0]]),
      ).rejects.toThrow(/published and immutable/)
    })
  }, 120_000)

  it("refuses to point current_version_id at an unpublished version", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      await pool.query(
        `INSERT INTO test_version (id, test_id, version, title, duration_seconds)
         VALUES ('a0000000-0000-0000-0000-0000000000bb', $1, 2, 'draft', 3000)`,
        [f.testId],
      )
      await expect(
        pool.query(`UPDATE test SET current_version_id='a0000000-0000-0000-0000-0000000000bb'
                     WHERE id=$1`, [f.testId]),
      ).rejects.toThrow(/published version of this test/)
    })
  }, 120_000)

  it("reports every publication violation on a broken draft", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const draft = "a0000000-0000-0000-0000-0000000000cc"
      await pool.query(
        `INSERT INTO test_version (id, test_id, version, title, duration_seconds)
         VALUES ($1, $2, 2, 'broken draft', 9999)`, [draft, f.testId])
      await pool.query(
        `INSERT INTO test_section (id, test_version_id, ordinal, title, type,
                                   duration_seconds, navigation, allow_answer_change)
         VALUES ('b000000c-0000-0000-0000-000000000001',$1,1,'L','listening',100,
                 'forward_only',false)`, [draft])
      await pool.query(
        `INSERT INTO question_group (id, test_version_id, test_section_id, ordinal)
         VALUES ('c000000c-0000-0000-0000-000000000001',$1,
                 'b000000c-0000-0000-0000-000000000001',1)`, [draft])
      await pool.query(
        `INSERT INTO question (id, test_version_id, question_group_id, question_key,
                               ordinal, prompt, type, points)
         VALUES ('d000000c-0000-0000-0000-000000000001',$1,
                 'c000000c-0000-0000-0000-000000000001','q1',1,'lonely','single_choice',1)`,
        [draft])
      await pool.query(
        `INSERT INTO choice (question_id, ordinal, label, is_correct)
         VALUES ('d000000c-0000-0000-0000-000000000001',1,'only one',false)`)

      const { rows } = await pool.query<{ rule: string }>(
        `SELECT rule FROM publication_violation WHERE test_version_id=$1 ORDER BY rule`, [draft])
      expect(rows.map((r) => r.rule)).toEqual([
        "duration_mismatch", "too_few_choices", "wrong_correct_count",
      ])
    })
  }, 120_000)
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @pp/db test durability`
Expected: FAIL — relation `failed_write` does not exist.

- [ ] **Step 3: Write the migration**

`packages/db/migrations/1003_durability_and_triggers.cjs` — transcribe
**`docs/db/schema.sql` lines 509–730** verbatim:

```bash
sed -n '509,730p' docs/db/schema.sql > /tmp/durability.sql
grep -c 'CREATE TRIGGER'  /tmp/durability.sql  # expect 9
grep -c 'CREATE OR REPLACE FUNCTION' /tmp/durability.sql  # expect 4
```

```js
exports.shorthands = undefined
exports.up = (pgm) => {
  pgm.sql(`
    -- docs/db/schema.sql lines 509-730, verbatim
    <paste /tmp/durability.sql here>
  `)
}
exports.down = (pgm) => {
  pgm.sql(`
    DROP VIEW publication_violation;
    DROP TRIGGER test_current_version_check ON test;
    DROP TRIGGER question_tag_immutable ON question_tag;
    DROP TRIGGER choice_immutable ON choice;
    DROP TRIGGER section_instruction_immutable ON section_instruction;
    DROP TRIGGER question_immutable ON question;
    DROP TRIGGER question_group_immutable ON question_group;
    DROP TRIGGER stimulus_immutable ON stimulus;
    DROP TRIGGER test_section_immutable ON test_section;
    DROP TRIGGER test_version_immutable ON test_version;
    DROP FUNCTION check_current_version, reject_published_descendant_change,
                  reject_published_version_change, reject_published_content_change;
    DROP TABLE failed_write;
  `)
}
```

It defines the `failed_write` table and its three indexes, the four trigger
functions, all nine triggers (eight immutability guards plus
`test_current_version_check`), and the `publication_violation` view.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @pp/db test durability`
Expected: PASS — all four.

- [ ] **Step 5: Verify the whole suite is green**

Run: `pnpm --filter @pp/db test`
Expected: PASS — every test from Tasks 2–6.

- [ ] **Step 6: Commit**

```bash
git add packages/db/migrations/1003_durability_and_triggers.cjs packages/db/test/durability.test.ts
git commit -m "feat(db): migration 1003 — failed_write, immutability triggers, publication checks"
```

---

### Task 7: Enum parity guard

**Files:**
- Create: `packages/db/test/enum-parity.test.ts`

**Interfaces:**
- Consumes: the migrated database; `docs/api/openapi.yaml`.

This task exists because the design has two sources of truth — Zod validators
for the interchange format and SQL for storage (spec §7). Nothing but a test
stops them drifting.

- [ ] **Step 1: Write the failing test**

`packages/db/test/enum-parity.test.ts`:

```ts
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { withDatabase } from "./helpers/database.js"

const OPENAPI = resolve(process.cwd(), "../../docs/api/openapi.yaml")

/** Members of a named enum as declared in openapi.yaml. */
function openApiEnum(spec: string, schemaName: string): string[] {
  const block = new RegExp(`    ${schemaName}:\\n      type: string\\n      enum: \\[([^\\]]*)\\]`)
  const m = spec.match(block)
  if (!m) throw new Error(`no enum block for ${schemaName} in openapi.yaml`)
  return m[1].split(",").map((s) => s.trim()).sort()
}

describe("enum parity", () => {
  it("SectionType matches section_type", async () => {
    const spec = readFileSync(OPENAPI, "utf8")
    await withDatabase(async (pool) => {
      const { rows } = await pool.query<{ label: string }>(
        `SELECT enumlabel AS label FROM pg_enum e
           JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname='section_type'`,
      )
      expect(rows.map((r) => r.label).sort()).toEqual(openApiEnum(spec, "SectionType"))
    })
  }, 120_000)

  it("NavigationMode matches nav_mode", async () => {
    const spec = readFileSync(OPENAPI, "utf8")
    await withDatabase(async (pool) => {
      const { rows } = await pool.query<{ label: string }>(
        `SELECT enumlabel AS label FROM pg_enum e
           JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname='nav_mode'`,
      )
      expect(rows.map((r) => r.label).sort()).toEqual(openApiEnum(spec, "NavigationMode"))
    })
  }, 120_000)
})
```

- [ ] **Step 2: Run it to verify it passes**

Run: `pnpm --filter @pp/db test enum-parity`
Expected: PASS. (If it fails, one of the two documents is wrong — fix that
document, not the test.)

- [ ] **Step 3: Prove the guard actually bites**

A guard nobody has watched fail is not known to guard anything.

```bash
# break it
sed -i.bak 's/enum: \[listening, reading, vocabulary, grammar\]/enum: [listening, reading, vocabulary]/' docs/api/openapi.yaml
pnpm --filter @pp/db test enum-parity      # expect FAIL
# put it back
mv docs/api/openapi.yaml.bak docs/api/openapi.yaml
pnpm --filter @pp/db test enum-parity      # expect PASS
```

- [ ] **Step 4: Commit**

```bash
git add packages/db/test/enum-parity.test.ts
git commit -m "test(db): guard SQL/OpenAPI enum parity"
```

---

### Task 8: Domain types and the interchange format

**Files:**
- Create: `packages/common/src/domain/ids.ts`, `packages/common/src/domain/test.ts`, `packages/common/src/domain/attempt.ts`
- Create: `packages/common/src/interchange/test-document.ts`
- Create: `packages/common/src/index.ts`
- Create: `packages/common/test/test-document.test.ts`
- Delete: `packages/common/src/types/`, `packages/common/src/validators/`, `packages/common/src/constants.ts`

**Interfaces:**
- Produces:
  - `type TestId, TestVersionId, SectionId, QuestionId, ChoiceId, AttemptId, StudentId` — branded strings.
  - `testDocumentSchema: z.ZodType<TestDocument>` and `type TestDocument`.
  - `type RunnerSection, RunnerQuestion, RunnerChoice` — the projection with **no** `isCorrect`.
  - `type ScoringQuestion, ScoringChoice` — the projection **with** `isCorrect`.

- [ ] **Step 1: Write the failing test**

`packages/common/test/test-document.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { testDocumentSchema } from "../src/interchange/test-document.js"

const valid = {
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
      instructions: ["Put your headphones on now."],
      groups: [
        {
          stimulus: { type: "audio", mediaFilename: "l07.mp3", maxPlays: 1 },
          questions: [
            {
              questionKey: "q1",
              prompt: "What does the boy want to do?",
              type: "single_choice",
              points: 1,
              choices: [
                { label: "Read a book", isCorrect: true },
                { label: "Play football", isCorrect: false },
              ],
            },
          ],
        },
      ],
    },
  ],
}

describe("testDocumentSchema", () => {
  it("accepts a well-formed document", () => {
    expect(testDocumentSchema.parse(valid).sections[0].instructions).toEqual([
      "Put your headphones on now.",
    ])
  })

  it("rejects a question with fewer than two choices", () => {
    const bad = structuredClone(valid)
    bad.sections[0].groups[0].questions[0].choices = [{ label: "only", isCorrect: true }]
    expect(() => testDocumentSchema.parse(bad)).toThrow(/at least 2/i)
  })

  it("rejects a single_choice question without exactly one correct choice", () => {
    const bad = structuredClone(valid)
    bad.sections[0].groups[0].questions[0].choices = [
      { label: "a", isCorrect: true },
      { label: "b", isCorrect: true },
    ]
    expect(() => testDocumentSchema.parse(bad)).toThrow(/exactly one correct/i)
  })

  it("rejects a stimulus playback that loosens the section default", () => {
    const bad = structuredClone(valid)
    bad.sections[0].groups[0].stimulus.maxPlays = 3 // section default is 1
    expect(() => testDocumentSchema.parse(bad)).toThrow(/tighten/i)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @pp/common exec vitest run`
Expected: FAIL — cannot resolve `test-document.js`.

- [ ] **Step 3: Write the branded ids**

`packages/common/src/domain/ids.ts`:

```ts
declare const brand: unique symbol

type Branded<T, B extends string> = T & { readonly [brand]: B }

export type StudentId = Branded<string, "StudentId">
export type TestId = Branded<string, "TestId">
export type TestVersionId = Branded<string, "TestVersionId">
export type SectionId = Branded<string, "SectionId">
export type StimulusId = Branded<string, "StimulusId">
export type QuestionId = Branded<string, "QuestionId">
export type ChoiceId = Branded<string, "ChoiceId">
export type AttemptId = Branded<string, "AttemptId">

export const asStudentId = (v: string) => v as StudentId
export const asTestId = (v: string) => v as TestId
export const asTestVersionId = (v: string) => v as TestVersionId
export const asSectionId = (v: string) => v as SectionId
export const asStimulusId = (v: string) => v as StimulusId
export const asQuestionId = (v: string) => v as QuestionId
export const asChoiceId = (v: string) => v as ChoiceId
export const asAttemptId = (v: string) => v as AttemptId
```

- [ ] **Step 4: Write the two projections**

`packages/common/src/domain/test.ts`:

```ts
import type { ChoiceId, QuestionId, SectionId, StimulusId } from "./ids.js"

export type SectionType = "listening" | "reading" | "vocabulary" | "grammar"
export type NavigationMode = "free" | "forward_only"
export type QuestionType = "single_choice" | "multi_choice"
export type StimulusType = "audio" | "passage" | "image" | "mixed"

export interface Playback {
  maxPlays: number | null
  allowPause: boolean
  allowSeek: boolean
}

/** What a student may see. `isCorrect` is absent BY CONSTRUCTION. */
export interface RunnerChoice {
  id: ChoiceId
  label: string
}

export interface RunnerQuestion {
  id: QuestionId
  ordinal: number
  type: QuestionType
  prompt: string
  choices: RunnerChoice[]
}

/** A capped stimulus carries no mediaUrl; the URL is issued only by /play. */
export interface RunnerStimulus {
  id: StimulusId
  type: StimulusType
  title?: string
  bodyText?: string
  maxPlays: number | null
  playsUsed: number
  allowPause: boolean
  allowSeek: boolean
  mediaUrl?: string
}

export interface RunnerGroup {
  id: string
  stimulus?: RunnerStimulus
  questions: RunnerQuestion[]
}

export interface RunnerSection {
  id: SectionId
  type: SectionType
  status: "pending" | "open" | "closed"
  completedAt: string | null
  navigation: NavigationMode
  allowAnswerChange: boolean
  expiresAt: string | null
  groups: RunnerGroup[]
}

/** Used only by the scoring service. Never serialized to a student. */
export interface ScoringChoice extends RunnerChoice {
  isCorrect: boolean
}

export interface ScoringQuestion extends Omit<RunnerQuestion, "choices"> {
  points: number
  choices: ScoringChoice[]
}
```

- [ ] **Step 5: Write the attempt types**

`packages/common/src/domain/attempt.ts`:

```ts
import type { AttemptId, QuestionId, ChoiceId } from "./ids.js"

export type AttemptStatus = "in_progress" | "submitted" | "expired"

export interface ResponseWrite {
  questionId: QuestionId
  /** Monotonic within one clientInstanceId. The ONLY ordering authority. */
  seq: number
  selectedChoiceIds: ChoiceId[]
  /** Display text. Never consulted for ordering or expiry. */
  answeredAt?: string
  timeSpentMs?: number
}

export type WriteStatus = "applied" | "ignored_stale" | "rejected"

export type RejectReason =
  | "answer_change_not_allowed"
  | "navigation_locked"
  | "unknown_question"
  | "invalid"

export type ItemResult =
  | { questionId: QuestionId; status: "applied" | "ignored_stale" }
  | {
      questionId: QuestionId
      status: "rejected"
      reason: RejectReason
      retryable: false
      /** The failed_write id. A rejection without one is data loss. */
      capturedAs: string
    }

export interface SectionScore {
  title: string
  type: string
  pointsEarned: number
  pointsPossible: number
}

export interface Score {
  pointsEarned: number
  pointsPossible: number
  percentage: number
  answered: number
  unanswered: number
  correct: number
  incorrect: number
  isPersonalBest: boolean
  sections: SectionScore[]
}

export interface AttemptSummary {
  id: AttemptId
  status: AttemptStatus
  startedAt: string | null
  expiresAt: string | null
  submittedAt: string | null
}
```

- [ ] **Step 6: Write the interchange schema**

`packages/common/src/interchange/test-document.ts`:

```ts
import { z } from "zod"

const playbackSchema = z
  .object({
    maxPlays: z.number().int().positive().nullable(),
    allowPause: z.boolean(),
    allowSeek: z.boolean(),
  })
  .nullable()

const choiceSchema = z.object({
  label: z.string().min(1),
  isCorrect: z.boolean(),
})

const questionSchema = z
  .object({
    questionKey: z.string().min(1),
    prompt: z.string().min(1),
    type: z.enum(["single_choice", "multi_choice"]),
    points: z.number().int().positive(),
    tags: z.array(z.string().min(1)).optional(),
    choices: z.array(choiceSchema).min(2, "a question needs at least 2 choices"),
  })
  .superRefine((q, ctx) => {
    const correct = q.choices.filter((c) => c.isCorrect).length
    if (q.type === "single_choice" && correct !== 1) {
      ctx.addIssue({
        code: "custom",
        message: `a single_choice question needs exactly one correct choice, found ${correct}`,
      })
    }
    if (q.type === "multi_choice" && correct < 1) {
      ctx.addIssue({ code: "custom", message: "a multi_choice question needs a correct choice" })
    }
  })

const stimulusSchema = z.object({
  type: z.enum(["audio", "passage", "image", "mixed"]),
  title: z.string().optional(),
  bodyText: z.string().optional(),
  mediaFilename: z.string().optional(),
  maxPlays: z.number().int().positive().nullable().optional(),
  allowPause: z.boolean().optional(),
  allowSeek: z.boolean().optional(),
})

const groupSchema = z.object({
  stimulus: stimulusSchema.optional(),
  questions: z.array(questionSchema).min(1),
})

const sectionSchema = z
  .object({
    title: z.string().min(1),
    type: z.enum(["listening", "reading", "vocabulary", "grammar"]),
    durationSeconds: z.number().int().positive(),
    navigation: z.enum(["free", "forward_only"]),
    allowAnswerChange: z.boolean(),
    playback: playbackSchema,
    instructions: z.array(z.string().min(1)).default([]),
    groups: z.array(groupSchema).min(1),
  })
  .superRefine((s, ctx) => {
    // A stimulus override may TIGHTEN the section default, never loosen it.
    for (const g of s.groups) {
      const st = g.stimulus
      if (!st || !s.playback) continue
      if (
        st.maxPlays != null &&
        s.playback.maxPlays != null &&
        st.maxPlays > s.playback.maxPlays
      ) {
        ctx.addIssue({
          code: "custom",
          message: `a stimulus may only tighten the section cap (${st.maxPlays} > ${s.playback.maxPlays})`,
        })
      }
      if (st.allowPause === true && s.playback.allowPause === false) {
        ctx.addIssue({ code: "custom", message: "a stimulus may only tighten allowPause" })
      }
      if (st.allowSeek === true && s.playback.allowSeek === false) {
        ctx.addIssue({ code: "custom", message: "a stimulus may only tighten allowSeek" })
      }
    }
  })

export const testDocumentSchema = z
  .object({
    title: z.string().min(1),
    slug: z.string().min(1),
    level: z.enum(["primary-step-1", "primary-step-2"]).optional(),
    durationSeconds: z.number().int().positive(),
    sections: z.array(sectionSchema).min(1),
  })
  .superRefine((doc, ctx) => {
    const total = doc.sections.reduce((n, s) => n + s.durationSeconds, 0)
    if (total !== doc.durationSeconds) {
      ctx.addIssue({
        code: "custom",
        message: `sections total ${total}s but the test declares ${doc.durationSeconds}s`,
      })
    }
  })

export type TestDocument = z.infer<typeof testDocumentSchema>
```

- [ ] **Step 7: Write the package surface and delete the old model**

`packages/common/src/index.ts`:

```ts
export * from "./domain/ids.js"
export * from "./domain/test.js"
export * from "./domain/attempt.js"
export * from "./interchange/test-document.js"
```

```bash
git rm -r packages/common/src/types packages/common/src/validators packages/common/src/constants.ts
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm --filter @pp/common exec vitest run`
Expected: PASS — all four.

- [ ] **Step 9: Commit**

```bash
git add packages/common
git commit -m "feat(common): exam domain types and the JSON interchange schema"
```

---

### Task 9: Import and export repository

**Files:**
- Create: `packages/db/src/repositories/test-import.repository.ts`
- Create: `packages/db/test/import-export.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Consumes: `TestDocument`, `testDocumentSchema` from Task 8; `withTransaction` from `@liam-public/node-postgres`.
- Produces:
  - `importTestDocument(pool, doc: TestDocument): Promise<{ testId: string; versionId: string; version: number }>`
  - `exportTestDocument(pool, versionId: string): Promise<TestDocument>`

- [ ] **Step 1: Write the failing round-trip test**

`packages/db/test/import-export.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { testDocumentSchema, type TestDocument } from "@pp/common"
import { withDatabase } from "./helpers/database.js"
import { exportTestDocument, importTestDocument } from "../src/repositories/test-import.repository.js"

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
              questionKey: "q1", prompt: "A?", type: "single_choice", points: 1,
              tags: ["gist", "detail"],
              choices: [{ label: "yes", isCorrect: true }, { label: "no", isCorrect: false }],
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
          stimulus: { type: "passage", title: "The School Trip", bodyText: "On Friday…" },
          questions: [
            {
              questionKey: "q2", prompt: "B?", type: "single_choice", points: 1,
              choices: [{ label: "rain", isCorrect: true }, { label: "bus", isCorrect: false }],
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
      expect(out.sections[0].instructions).toEqual(["Put your headphones on now.", "Stay quiet."])
      expect(out.sections[0].groups[0].questions[0].tags).toEqual(["gist", "detail"])
    })
  }, 120_000)

  it("creates a DRAFT — importing does not publish", async () => {
    await withDatabase(async (pool) => {
      const { versionId } = await importTestDocument(pool, doc)
      const { rows } = await pool.query<{ published_at: string | null }>(
        `SELECT published_at FROM test_version WHERE id=$1`, [versionId])
      expect(rows[0].published_at).toBeNull()
    })
  }, 120_000)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @pp/db test import-export`
Expected: FAIL — cannot resolve `test-import.repository.js`.

- [ ] **Step 3: Implement the repository**

`packages/db/src/repositories/test-import.repository.ts`:

```ts
import { withTransaction } from "@liam-public/node-postgres"
import type { TestDocument } from "@pp/common"
import type pg from "pg"

/**
 * Inserts a document as a DRAFT version. Content must be written before
 * publication: the immutability triggers refuse inserts once published_at is
 * set, so publish is a separate call.
 */
export async function importTestDocument(
  pool: pg.Pool,
  doc: TestDocument,
): Promise<{ testId: string; versionId: string; version: number }> {
  return withTransaction(pool, async (tx) => {
    const test = await tx.query<{ id: string }>(
      `INSERT INTO test (slug) VALUES ($1)
       ON CONFLICT (slug) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [doc.slug],
    )
    const testId = test.rows[0].id

    const next = await tx.query<{ n: number }>(
      `SELECT COALESCE(MAX(version), 0) + 1 AS n FROM test_version WHERE test_id = $1`,
      [testId],
    )
    const version = Number(next.rows[0].n)

    const tv = await tx.query<{ id: string }>(
      `INSERT INTO test_version (test_id, version, title, level, duration_seconds)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [testId, version, doc.title, doc.level ?? null, doc.durationSeconds],
    )
    const versionId = tv.rows[0].id

    for (const [sIdx, section] of doc.sections.entries()) {
      const sec = await tx.query<{ id: string }>(
        `INSERT INTO test_section (test_version_id, ordinal, title, type, duration_seconds,
                                   navigation, allow_answer_change,
                                   default_max_plays, default_allow_pause, default_allow_seek)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [
          versionId, sIdx + 1, section.title, section.type, section.durationSeconds,
          section.navigation, section.allowAnswerChange,
          section.playback?.maxPlays ?? null,
          section.playback ? section.playback.allowPause : null,
          section.playback ? section.playback.allowSeek : null,
        ],
      )
      const sectionId = sec.rows[0].id

      for (const [i, text] of section.instructions.entries()) {
        await tx.query(
          `INSERT INTO section_instruction (test_section_id, ordinal, text) VALUES ($1,$2,$3)`,
          [sectionId, i + 1, text],
        )
      }

      let questionOrdinal = 0
      for (const [gIdx, group] of section.groups.entries()) {
        let stimulusId: string | null = null
        if (group.stimulus) {
          const st = group.stimulus
          const asset = st.mediaFilename
            ? await tx.query<{ id: string }>(
                `SELECT id FROM media_asset WHERE filename = $1`, [st.mediaFilename])
            : null
          if (st.mediaFilename && asset!.rowCount === 0) {
            throw new Error(`media asset "${st.mediaFilename}" not found`)
          }
          const ins = await tx.query<{ id: string }>(
            `INSERT INTO stimulus (test_version_id, type, title, body_text, media_asset_id,
                                   max_plays, allow_pause, allow_seek)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
            [versionId, st.type, st.title ?? null, st.bodyText ?? null,
             asset?.rows[0]?.id ?? null, st.maxPlays ?? null,
             st.allowPause ?? null, st.allowSeek ?? null],
          )
          stimulusId = ins.rows[0].id
        }

        const grp = await tx.query<{ id: string }>(
          `INSERT INTO question_group (test_version_id, test_section_id, stimulus_id, ordinal)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [versionId, sectionId, stimulusId, gIdx + 1],
        )
        const groupId = grp.rows[0].id

        for (const q of group.questions) {
          questionOrdinal += 1
          const qi = await tx.query<{ id: string }>(
            `INSERT INTO question (test_version_id, question_group_id, question_key,
                                   ordinal, prompt, type, points)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
            [versionId, groupId, q.questionKey, questionOrdinal, q.prompt, q.type, q.points],
          )
          const questionId = qi.rows[0].id

          for (const [cIdx, c] of q.choices.entries()) {
            await tx.query(
              `INSERT INTO choice (question_id, ordinal, label, is_correct)
               VALUES ($1,$2,$3,$4)`,
              [questionId, cIdx + 1, c.label, c.isCorrect],
            )
          }
          for (const [tIdx, tag] of (q.tags ?? []).entries()) {
            await tx.query(
              `INSERT INTO question_tag (question_id, ordinal, tag) VALUES ($1,$2,$3)`,
              [questionId, tIdx + 1, tag],
            )
          }
        }
      }
    }

    return { testId, versionId, version }
  })
}

interface ExportRow {
  s_ordinal: number; s_title: string; s_type: string; s_duration: number
  s_navigation: string; s_allow_change: boolean
  s_max_plays: number | null; s_allow_pause: boolean | null; s_allow_seek: boolean | null
  g_ordinal: number
  st_type: string | null; st_title: string | null; st_body: string | null
  st_filename: string | null; st_max_plays: number | null
  st_allow_pause: boolean | null; st_allow_seek: boolean | null
  q_ordinal: number; q_key: string; q_prompt: string; q_type: string; q_points: number
  c_ordinal: number; c_label: string; c_correct: boolean
}

/** The inverse of importTestDocument. Round-trip equality is a tested contract. */
export async function exportTestDocument(
  pool: pg.Pool,
  versionId: string,
): Promise<TestDocument> {
  const head = await pool.query<{
    title: string; slug: string; level: string | null; duration_seconds: number
  }>(
    `SELECT tv.title, t.slug, tv.level, tv.duration_seconds
       FROM test_version tv JOIN test t ON t.id = tv.test_id
      WHERE tv.id = $1`,
    [versionId],
  )
  if (head.rowCount === 0) throw new Error(`test_version ${versionId} not found`)

  const { rows } = await pool.query<ExportRow>(
    `SELECT ts.ordinal s_ordinal, ts.title s_title, ts.type::text s_type,
            ts.duration_seconds s_duration, ts.navigation::text s_navigation,
            ts.allow_answer_change s_allow_change,
            ts.default_max_plays s_max_plays, ts.default_allow_pause s_allow_pause,
            ts.default_allow_seek s_allow_seek,
            g.ordinal g_ordinal,
            st.type::text st_type, st.title st_title, st.body_text st_body,
            ma.filename st_filename, st.max_plays st_max_plays,
            st.allow_pause st_allow_pause, st.allow_seek st_allow_seek,
            q.ordinal q_ordinal, q.question_key q_key, q.prompt q_prompt,
            q.type::text q_type, q.points q_points,
            c.ordinal c_ordinal, c.label c_label, c.is_correct c_correct
       FROM test_section ts
       JOIN question_group g ON g.test_section_id = ts.id
       JOIN question q       ON q.question_group_id = g.id
       JOIN choice c         ON c.question_id = q.id
  LEFT JOIN stimulus st      ON st.id = g.stimulus_id
  LEFT JOIN media_asset ma   ON ma.id = st.media_asset_id
      WHERE ts.test_version_id = $1
      ORDER BY ts.ordinal, g.ordinal, q.ordinal, c.ordinal`,
    [versionId],
  )

  const instructions = await pool.query<{ s_ordinal: number; text: string }>(
    `SELECT ts.ordinal s_ordinal, si.text
       FROM section_instruction si JOIN test_section ts ON ts.id = si.test_section_id
      WHERE ts.test_version_id = $1 ORDER BY ts.ordinal, si.ordinal`,
    [versionId],
  )

  const tags = await pool.query<{ q_key: string; tag: string }>(
    `SELECT q.question_key q_key, qt.tag
       FROM question_tag qt JOIN question q ON q.id = qt.question_id
      WHERE q.test_version_id = $1 ORDER BY q.ordinal, qt.ordinal`,
    [versionId],
  )

  const sections: TestDocument["sections"] = []
  for (const r of rows) {
    let section = sections[r.s_ordinal - 1]
    if (!section) {
      section = sections[r.s_ordinal - 1] = {
        title: r.s_title,
        type: r.s_type as never,
        durationSeconds: r.s_duration,
        navigation: r.s_navigation as never,
        allowAnswerChange: r.s_allow_change,
        playback:
          r.s_allow_pause === null
            ? null
            : { maxPlays: r.s_max_plays, allowPause: r.s_allow_pause, allowSeek: r.s_allow_seek! },
        instructions: instructions.rows.filter((i) => i.s_ordinal === r.s_ordinal).map((i) => i.text),
        groups: [],
      }
    }
    let group = section.groups[r.g_ordinal - 1]
    if (!group) {
      group = section.groups[r.g_ordinal - 1] = {
        ...(r.st_type
          ? {
              stimulus: {
                type: r.st_type as never,
                ...(r.st_title ? { title: r.st_title } : {}),
                ...(r.st_body ? { bodyText: r.st_body } : {}),
                ...(r.st_filename ? { mediaFilename: r.st_filename } : {}),
                ...(r.st_max_plays !== null ? { maxPlays: r.st_max_plays } : {}),
                ...(r.st_allow_pause !== null ? { allowPause: r.st_allow_pause } : {}),
                ...(r.st_allow_seek !== null ? { allowSeek: r.st_allow_seek } : {}),
              },
            }
          : {}),
        questions: [],
      }
    }
    let question = group.questions.find((q) => q.questionKey === r.q_key)
    if (!question) {
      const qTags = tags.rows.filter((t) => t.q_key === r.q_key).map((t) => t.tag)
      question = {
        questionKey: r.q_key,
        prompt: r.q_prompt,
        type: r.q_type as never,
        points: r.q_points,
        ...(qTags.length ? { tags: qTags } : {}),
        choices: [],
      }
      group.questions.push(question)
    }
    question.choices.push({ label: r.c_label, isCorrect: r.c_correct })
  }

  return {
    title: head.rows[0].title,
    slug: head.rows[0].slug,
    ...(head.rows[0].level ? { level: head.rows[0].level as never } : {}),
    durationSeconds: head.rows[0].duration_seconds,
    sections,
  }
}
```

- [ ] **Step 4: Export from the package surface**

`packages/db/src/index.ts`:

```ts
export { migrateToLatest } from "./migrate.js"
export {
  importTestDocument,
  exportTestDocument,
} from "./repositories/test-import.repository.js"
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @pp/db test import-export`
Expected: PASS — all three.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src packages/db/test/import-export.test.ts
git commit -m "feat(db): import/export a TestDocument with order-preserving round trip"
```

---

### Task 10: Runner and scoring projections

**Files:**
- Create: `packages/db/src/repositories/test-version.repository.ts`
- Create: `packages/db/test/projections.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Consumes: `RunnerSection`, `ScoringQuestion` from Task 8; `seedPublishedTest` from Task 5.
- Produces:
  - `loadForRunner(pool, versionId, attemptId): Promise<RunnerSection[]>` — **never** returns `isCorrect`, and returns no `mediaUrl` for a capped stimulus.
  - `loadForScoring(pool, versionId): Promise<ScoringQuestion[]>` — the answer key, for the scoring service only.

These are two deliberately separate reads. Normalizing choices put the answer
key in a column next to the label, one careless `SELECT *` from shipping it to
a browser. A single "load with a flag" function would make that one boolean
away; two functions make the runner router unable to reach the key at all.

- [ ] **Step 1: Write the failing tests**

`packages/db/test/projections.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { withDatabase } from "./helpers/database.js"
import { seedPublishedTest } from "./helpers/fixtures.js"
import { loadForRunner, loadForScoring } from "../src/repositories/test-version.repository.js"

describe("projections", () => {
  it("loadForRunner never returns isCorrect anywhere in the tree", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const sections = await loadForRunner(pool, f.versionId, null)
      expect(JSON.stringify(sections)).not.toContain("isCorrect")
      expect(JSON.stringify(sections)).not.toContain("is_correct")
    })
  }, 120_000)

  it("loadForRunner omits mediaUrl for a capped stimulus", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const sections = await loadForRunner(pool, f.versionId, null)
      const capped = sections
        .flatMap((s) => s.groups)
        .map((g) => g.stimulus)
        .filter((s) => s && s.maxPlays !== null)
      for (const s of capped) expect(s!.mediaUrl).toBeUndefined()
    })
  }, 120_000)

  it("loadForRunner returns sections and questions in ordinal order", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const sections = await loadForRunner(pool, f.versionId, null)
      expect(sections.map((s) => s.type)).toEqual(["listening", "reading"])
      const ordinals = sections.flatMap((s) => s.groups).flatMap((g) => g.questions).map((q) => q.ordinal)
      expect(ordinals).toEqual([...ordinals].sort((a, b) => a - b))
    })
  }, 120_000)

  it("loadForScoring returns the answer key", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const questions = await loadForScoring(pool, f.versionId)
      expect(questions).toHaveLength(2)
      expect(questions[0].choices.filter((c) => c.isCorrect)).toHaveLength(1)
      expect(questions[0].points).toBe(1)
    })
  }, 120_000)
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @pp/db test projections`
Expected: FAIL — cannot resolve `test-version.repository.js`.

- [ ] **Step 3: Implement the two projections**

`packages/db/src/repositories/test-version.repository.ts`:

```ts
import type { RunnerGroup, RunnerSection, ScoringQuestion } from "@pp/common"
import type pg from "pg"

/**
 * The STUDENT projection. Two things are absent by construction rather than by
 * filtering: choice.is_correct is never selected, and mediaUrl is emitted only
 * when max_plays is null. A capped stimulus's URL is issued by POST /play.
 *
 * `attemptId` is optional so a preview can load a version with no attempt; when
 * present it supplies playsUsed from stimulus_play.
 */
export async function loadForRunner(
  pool: pg.Pool,
  versionId: string,
  attemptId: string | null,
): Promise<RunnerSection[]> {
  const { rows } = await pool.query<{
    s_id: string; s_type: string; s_ordinal: number
    s_navigation: string; s_allow_change: boolean
    s_max_plays: number | null; s_allow_pause: boolean | null; s_allow_seek: boolean | null
    g_id: string; g_ordinal: number
    st_id: string | null; st_type: string | null; st_title: string | null
    st_body: string | null; st_filename: string | null
    st_max_plays: number | null; st_allow_pause: boolean | null; st_allow_seek: boolean | null
    plays_used: number | null
    q_id: string; q_ordinal: number; q_type: string; q_prompt: string
    c_id: string; c_ordinal: number; c_label: string
  }>(
    `SELECT ts.id s_id, ts.type::text s_type, ts.ordinal s_ordinal,
            ts.navigation::text s_navigation, ts.allow_answer_change s_allow_change,
            ts.default_max_plays s_max_plays, ts.default_allow_pause s_allow_pause,
            ts.default_allow_seek s_allow_seek,
            g.id g_id, g.ordinal g_ordinal,
            st.id st_id, st.type::text st_type, st.title st_title, st.body_text st_body,
            ma.filename st_filename, st.max_plays st_max_plays,
            st.allow_pause st_allow_pause, st.allow_seek st_allow_seek,
            sp.play_count plays_used,
            q.id q_id, q.ordinal q_ordinal, q.type::text q_type, q.prompt q_prompt,
            c.id c_id, c.ordinal c_ordinal, c.label c_label
       FROM test_section ts
       JOIN question_group g ON g.test_section_id = ts.id
       JOIN question q       ON q.question_group_id = g.id
       JOIN choice c         ON c.question_id = q.id
  LEFT JOIN stimulus st      ON st.id = g.stimulus_id
  LEFT JOIN media_asset ma   ON ma.id = st.media_asset_id
  LEFT JOIN stimulus_play sp ON sp.stimulus_id = st.id AND sp.attempt_id = $2
      WHERE ts.test_version_id = $1
      ORDER BY ts.ordinal, g.ordinal, q.ordinal, c.ordinal`,
    [versionId, attemptId],
  )

  const sections: RunnerSection[] = []
  for (const r of rows) {
    let section = sections[r.s_ordinal - 1]
    if (!section) {
      section = sections[r.s_ordinal - 1] = {
        id: r.s_id as never,
        type: r.s_type as never,
        status: "pending",
        completedAt: null,
        navigation: r.s_navigation as never,
        allowAnswerChange: r.s_allow_change,
        expiresAt: null,
        groups: [],
      }
    }

    let group: RunnerGroup | undefined = section.groups.find((g) => g.id === r.g_id)
    if (!group) {
      const effectiveMaxPlays = r.st_id
        ? (r.st_max_plays ?? r.s_max_plays ?? null)
        : null
      group = {
        id: r.g_id,
        ...(r.st_id
          ? {
              stimulus: {
                id: r.st_id as never,
                type: r.st_type as never,
                ...(r.st_title ? { title: r.st_title } : {}),
                ...(r.st_body ? { bodyText: r.st_body } : {}),
                maxPlays: effectiveMaxPlays,
                playsUsed: r.plays_used ?? 0,
                allowPause: r.st_allow_pause ?? r.s_allow_pause ?? true,
                allowSeek: r.st_allow_seek ?? r.s_allow_seek ?? true,
                // A capped stimulus gets NO url here. Uncapped media is safe to
                // hand over directly because there is no cap left to defeat.
                ...(effectiveMaxPlays === null && r.st_filename
                  ? { mediaUrl: `/media/${r.st_filename}` }
                  : {}),
              },
            }
          : {}),
        questions: [],
      }
      section.groups.push(group)
    }

    let question = group.questions.find((q) => q.id === (r.q_id as never))
    if (!question) {
      question = {
        id: r.q_id as never,
        ordinal: r.q_ordinal,
        type: r.q_type as never,
        prompt: r.q_prompt,
        choices: [],
      }
      group.questions.push(question)
    }
    question.choices.push({ id: r.c_id as never, label: r.c_label })
  }

  return sections
}

/**
 * The SCORING projection — the answer key. Reachable only from the scoring
 * service; no student-facing route may import it.
 */
export async function loadForScoring(
  pool: pg.Pool,
  versionId: string,
): Promise<ScoringQuestion[]> {
  const { rows } = await pool.query<{
    q_id: string; q_ordinal: number; q_type: string; q_prompt: string; q_points: number
    c_id: string; c_label: string; c_correct: boolean
  }>(
    `SELECT q.id q_id, q.ordinal q_ordinal, q.type::text q_type, q.prompt q_prompt,
            q.points q_points, c.id c_id, c.label c_label, c.is_correct c_correct
       FROM question q JOIN choice c ON c.question_id = q.id
      WHERE q.test_version_id = $1
      ORDER BY q.ordinal, c.ordinal`,
    [versionId],
  )

  const questions: ScoringQuestion[] = []
  for (const r of rows) {
    let q = questions.find((x) => x.id === (r.q_id as never))
    if (!q) {
      q = {
        id: r.q_id as never,
        ordinal: r.q_ordinal,
        type: r.q_type as never,
        prompt: r.q_prompt,
        points: r.q_points,
        choices: [],
      }
      questions.push(q)
    }
    q.choices.push({ id: r.c_id as never, label: r.c_label, isCorrect: r.c_correct })
  }
  return questions
}
```

- [ ] **Step 4: Export from the package surface**

Append to `packages/db/src/index.ts`:

```ts
export { loadForRunner, loadForScoring } from "./repositories/test-version.repository.js"
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @pp/db test projections`
Expected: PASS — all four.

- [ ] **Step 6: Run the whole suite and lint**

```bash
pnpm test
pnpm lint
pnpm format
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add packages/db
git commit -m "feat(db): separate runner and scoring projections"
```

---

## Definition of done

- [ ] `pnpm test` green: harness, migrations, content constraints, attempt constraints, durability, enum parity, interchange schema, import/export, projections.
- [ ] `pnpm lint` and `pnpm format` clean.
- [ ] `docker compose up -d postgres` brings up a database the migrations run against.
- [ ] Every invariant in `docs/db/invariants.test.sql` has an equivalent vitest test.
- [ ] No SQL outside `packages/db/src/`.
- [ ] No new code under `@razzia/*`.

## What this plan deliberately does not do

No HTTP server, no React, no auth.

**Deliberate deviation from spec §8 phase 0:** the spec folds "delete `socket`
and `web`" into phase 0. This plan does not. `packages/socket` and
`packages/web` stay present and building; they are deleted in plan 3, once
`packages/app` can replace them. Deleting them here would leave the repository
with no runnable application across two whole plans, and a fork nobody can run
is a fork nobody can sanity-check. The spec's intent — that they do not survive
to v1 — is unchanged.

Also deferred from phase 0: the `server` and `app` package scaffolds. They are
created by the plans that first put code in them, so no empty package sits in
the workspace waiting.

## Next plans

| Plan | Covers | Depends on |
|---|---|---|
| 2 — API skeleton and auth | `packages/server`, JWKS verification, session, catalog, attempt start, admin import/publish/media | this plan's repositories |
| 3 — Runner read path | runner payload, section entry, play + signed URLs, position; delete `socket` | plan 2 |
| 4 — Durable write path | queue, snapshot flush, reorder guard, `failed_write` capture, retry classification, submit and grading | plan 3 |
| 5 — App | harvest `packages/web` into `packages/app`, screens, navigator, menu, i18n, Docker | plan 4 |

Plans 2–5 are written as each predecessor lands. Writing them now would mean
inventing signatures for repositories that do not exist yet, and this plan's
own rule against placeholders applies to plans as much as to code.
