# Server, Session, Catalog and Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the repository a runnable HTTP API — NestJS on Node, verifying real JWTs, serving the session, catalog and attempt-start endpoints plus the admin import/publish/export surface, with a real seeded test to exercise it.

**Architecture:** `packages/server` is a NestJS REST API. It verifies bearer tokens against `auth.icovn.me`'s JWKS (no user table, no password — identity is a verified `sub`, admin is a claim), gates boot on `waitForDatabase`, runs migrations at startup, and holds two pools: the request path (`pp:api`, 5s timeouts) and a longer-timeout pool (`pp:jobs`) for import, seed and export. Controllers stay thin; every database access goes through a repository in `@pp/db`.

**Tech Stack:** NestJS 11 · Node 24 · TypeScript 6 (ESM, `nodenext`) · PostgreSQL 16 · `@liam-workspace/node-auth-server` · `@liam-public/node-nest-common` · `@liam-public/node-postgres` · Vitest 4 · supertest · testcontainers

**Spec:** `docs/superpowers/specs/2026-08-25-toefl-primary-fork-design.md` (phase 2 of §8)

**Inherited debt this plan must clear first:** `docs/architecture/plan-2-preconditions.md` — six things plan 1 deferred on purpose. Items 1, 2, 3 and 4 are Tasks 1–2 and 5 of this plan; item 6 is Task 13. Read it before Task 1.

## Global Constraints

- **Node 24, TypeScript 6, ESM.** Every package is `"type": "module"`. `verbatimModuleSyntax` is on: type-only imports MUST use `import type`.
- **`moduleResolution: "nodenext"`** in `packages/server`, and in `common`/`db` after Task 1. Relative specifiers therefore carry a `.js` extension and TypeScript now checks them.
- **No `new Date()` and no `Date.now()`** anywhere in `packages/{common,db,server}/src`. Time comes from an injected `Clock` (`@liam-workspace/platform`, re-exported by `@pp/common`). Server-authoritative expiry is untestable without it. Verify with: `grep -rn "new Date()\|Date\.now()" packages/{common,db,server}/src`
- **Registries.** `@liam-public/*` from npmjs; `@liam-workspace/*` from npm.pkg.github.com via `NODE_AUTH_TOKEN` (already in `.npmrc`). Pin these EXACT published versions, verified against the registry on 2026-08-26 — do not guess and do not carry forward the adoption map's older numbers:
  - `@liam-workspace/node-auth-server` `^0.5.1` ← the adoption map says `^0.1.0`; that is stale
  - `@liam-public/node-nest-common` `^0.1.1`
  - `@liam-public/node-nest-observability` `^0.1.1`
  - `@liam-public/node-logger` `^0.1.0`
  - `@liam-public/node-config` `^0.1.0`
  - `@liam-public/node-postgres` `^0.3.1`
  - `@liam-workspace/platform` `^0.1.0`
- **Never add a dependency without checking `docs/architecture/library-adoption.md` first.** Six packages are declined there with reasons; `@liam-public/node-nest-cache` (Redis) and `@liam-public/node-drizzle-postgres` are both out of scope for v1.
- **All four gates pass before every commit:** `pnpm lint`, `pnpm format`, `pnpm typecheck`, `pnpm test`. `typecheck` is `pnpm build && pnpm -r exec tsc --noEmit` — the build is a PREREQUISITE, not a convenience: after Task 1 the packages typecheck against each other's `dist/*.d.ts`, which does not exist on a clean checkout until something builds it. Task 1 adds the script. Run `pnpm test` only from the repo root and never concurrently with another test process — the db suite shares one Testcontainers `globalSetup`.
- **`docs/api/openapi.yaml` is the contract.** A response shape that disagrees with it is a defect in the code, not in the spec, unless this plan says otherwise in so many words. `redocly lint docs/api/openapi.yaml` must stay clean if you touch it.
- **`docs/db/schema.sql` is the schema authority** and `packages/db/migrations/*.cjs` are its transcription; they are currently byte-identical over the ranges named in each migration's header. Change one, change the other, and preserve `schema.sql`'s line count or re-anchor every header pointer.
- **oxlint `no-duplicate-imports` fires per additional import/export STATEMENT naming a source, not per specifier.** Curating a module's exports has exactly one clean shape here: a single merged `import { … } from "src"`, then `export type { … }` / `export { … }` with NO trailing `from`.
- **Conventional commits.** Commit after each green step group, not once at the end.

## File Structure

| File                                                 | Responsibility                                                                          |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `packages/common/package.json`, `tsconfig.json`      | Task 1: gains a `build` script, `dist/` output, `exports`/`types` repointed, `nodenext` |
| `packages/db/package.json`, `tsconfig.json`          | Task 1: same, plus `migrate.ts`'s migrations-path resolution re-verified from `dist/`   |
| `packages/db/src/index.ts`                           | Task 5: student-safe entry point; scoring moves out                                     |
| `packages/db/src/scoring.ts`                         | Task 5: new, separate entry point exporting `loadForScoring` only                       |
| `packages/db/src/repositories/student.repository.ts` | Task 6: `upsertStudentBySubject`, `findStudentById`                                     |
| `packages/db/src/repositories/catalog.repository.ts` | Task 7–8: `listPublishedTests` (keyset), `loadTestBrief`                                |
| `packages/db/src/repositories/attempt.repository.ts` | Task 9: `startOrResumeAttempt`, `finalizeExpiredAttempt`                                |
| `packages/db/src/repositories/publish.repository.ts` | Task 10: `publishDraftVersion` + publication-time validation                            |
| `packages/db/src/repositories/media.repository.ts`   | Task 11: `recordMediaAsset`                                                             |
| `packages/server/src/main.ts`                        | Task 2: bootstrap — `waitForDatabase`, `runMigrations`, then listen                     |
| `packages/server/src/app.module.ts`                  | Task 2: root module                                                                     |
| `packages/server/src/config.ts`                      | Task 2: env parsing via `@liam-public/node-config`                                      |
| `packages/server/src/health/*`                       | Task 2: `GET /health`                                                                   |
| `packages/server/src/database/*`                     | Task 3: pool providers (`pp:api`, `pp:jobs`), `Clock` provider                          |
| `packages/server/src/auth/*`                         | Task 4: `JwksGuard`, `AdminGuard`, `@CurrentStudent()`                                  |
| `packages/server/src/session/*`                      | Task 6: `POST /session`, `GET /me`                                                      |
| `packages/server/src/catalog/*`                      | Task 7–8: `GET /tests`, `GET /tests/{slug}`                                             |
| `packages/server/src/attempts/*`                     | Task 9: `POST /attempts`                                                                |
| `packages/server/src/admin/*`                        | Task 10–11: import, publish, export, media                                              |
| `packages/server/test/**`                            | Every task: supertest e2e against a real container                                      |
| `scripts/seed-test.ts`                               | Task 12: seeds a real 40-question test                                                  |
| `Dockerfile`, `compose.yml`                          | Task 13: build the server image; `api` + `postgres` services                            |

---

## Decision: ESM throughout, settled here so no task re-opens it

`packages/server` is ESM, like `common` and `db`. Both library packages are already `"type": "module"`; `migrate.ts` uses `import.meta.url`, which CJS cannot express; and a CJS server would force a dual build of both libraries to consume them. NestJS 11 runs on ESM under `nodenext`. Where a Nest-ecosystem dependency ships CJS only, `esModuleInterop` handles the default import — that is not a reason to flip the whole server.

## Decision: tests run against `src`, the loadability test runs against `dist`

Once `exports` points at `dist/`, a stale build would silently make every cross-package test assert against old code. So `packages/*/vitest.config.ts` aliases `@pp/common` and `@pp/db` to their `src/index.ts` — fast feedback, no build step in the inner loop — and exactly one test (Task 1's) exercises the built `dist/` through Node's real resolver. That test is the only thing standing between us and shipping a package Node cannot load, which is precisely the defect plan 1 shipped.

---

### Task 1: Make `@pp/common` and `@pp/db` loadable by Node

Today both declare `"exports": { ".": "./src/index.ts" }` with no build. The `.ts` sources use `.js` relative specifiers that Node resolves literally against files that do not exist, so only Vite's resolver loads them. `runMigrations` must run at API startup from `@pp/db`, so the server cannot boot until this is fixed.

**Files:**

- Create: `packages/db/test/loadable.test.ts`
- Modify: `packages/common/package.json`, `packages/common/tsconfig.json`
- Modify: `packages/db/package.json`, `packages/db/tsconfig.json`
- Modify: `packages/common/vitest.config.ts`, `packages/db/vitest.config.ts`
- Modify: `package.json` (root `build` and `test` scripts), `tsconfig.json` (root `paths`)

**Interfaces:**

- Consumes: nothing from earlier tasks — this is the first.
- Produces: `@pp/common` and `@pp/db` importable by a plain Node ESM process; `pnpm build` emits `packages/*/dist/`. Every later task depends on this.

- [ ] **Step 1: Write the failing loadability test**

`packages/db/test/loadable.test.ts`:

```ts
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"

const run = promisify(execFile)

/**
 * Node's real resolver, not Vite's. Plan 1 shipped packages that every test
 * could import and no Node process could, because vitest resolved the `.js`
 * specifiers Node takes literally. This test is the only thing that notices.
 */
describe("built output", () => {
  it("loads @pp/db in a plain Node ESM process", async () => {
    const { stdout } = await run("node", [
      "--input-type=module",
      "-e",
      'const m = await import("@pp/db"); console.log(typeof m.migrateToLatest)',
    ])
    expect(stdout.trim()).toBe("function")
  })

  it("loads @pp/common in a plain Node ESM process", async () => {
    const { stdout } = await run("node", [
      "--input-type=module",
      "-e",
      'const m = await import("@pp/common"); console.log(typeof m.asStudentId)',
    ])
    expect(stdout.trim()).toBe("function")
  })
})
```

- [ ] **Step 2: Run it and record the failure**

Run: `pnpm --filter @pp/db test loadable`
Expected: FAIL, both cases, with `ERR_MODULE_NOT_FOUND … packages/common/src/domain/ids.js`.
Paste that exact error into your report — it is the defect this task exists to remove.

- [ ] **Step 3: Give each package a build**

`packages/common/tsconfig.json` and `packages/db/tsconfig.json` — replace the `compilerOptions` block with:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "target": "ESNext",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": false,
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "verbatimModuleSyntax": true
  },
  "include": ["src"]
}
```

Note `noEmit: false` — the root tsconfig sets `noEmit: true` and `extends` does not override it implicitly.

- [ ] **Step 4: Repoint `exports` and add the build script**

In BOTH `packages/common/package.json` and `packages/db/package.json`:

```json
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist", "migrations"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
```

`"files"` includes `migrations` for `@pp/db` only; `@pp/common` lists just `dist`.

- [ ] **Step 5: Keep the inner test loop on `src`**

Add to both `packages/common/vitest.config.ts` and `packages/db/vitest.config.ts`, inside `defineConfig({ … })`, preserving everything already there:

```ts
  resolve: {
    alias: {
      "@pp/common": new URL("../common/src/index.ts", import.meta.url).pathname,
      "@pp/db": new URL("../db/src/index.ts", import.meta.url).pathname,
    },
  },
```

- [ ] **Step 6: Wire the root scripts**

In the root `package.json`:

```json
    "build": "pnpm --filter @pp/common build && pnpm --filter @pp/db build",
    "typecheck": "pnpm build && pnpm -r exec tsc --noEmit",
    "test": "pnpm build && pnpm --filter @pp/common test && pnpm --filter @pp/db test",
```

`typecheck` builds first for the same reason `test` does. Once Step 7 removes the root `paths` mapping, `@pp/db` resolves `@pp/common` through its manifest to `dist/index.d.ts` — so a bare `tsc --noEmit` on a clean checkout fails with "Cannot find module '@pp/common'" before it checks a single line of your code.

The build is part of `test` because Task 1's loadability test asserts against `dist/`; without it the test would pass or fail on whatever was built last.

- [ ] **Step 7: Remove the root `paths` mapping**

In the root `tsconfig.json`, delete the `paths` block entirely. With `exports` and `nodenext`, TypeScript resolves the workspace packages through their manifests; leaving `paths` pointing at `src/index.ts` means `tsc` checks one thing and Node loads another — the exact split that hid this bug.

- [ ] **Step 8: Build and re-run the test**

Run: `pnpm build && pnpm --filter @pp/db test loadable`
Expected: PASS, both cases.

- [ ] **Step 9: Prove the migrations path survives the move**

`nodenext` will now flag any relative specifier missing a `.js` extension — fix each one it reports rather than loosening the setting.

`migrate.ts` resolves `resolve(here, "../migrations")`. From `src/` that is `packages/db/migrations`; from `dist/` it is the same directory, because both sit one level under the package root. Do not take that on trust — prove it:

Run: `node --input-type=module -e 'const {migrateToLatest} = await import("@pp/db"); console.log(migrateToLatest.toString().includes("migrations"))'`
Then add to `loadable.test.ts` a case that runs `migrateToLatest` against the test container and asserts the `pp_migrations` table exists afterwards, so the path is exercised rather than inspected.

- [ ] **Step 10: Gates and commit**

```bash
pnpm lint && pnpm format && pnpm typecheck && pnpm test
git add -A
git commit -m "build: emit dist so Node can load @pp/common and @pp/db"
```

---

### Task 2: Scaffold `packages/server` — NestJS, config, lint overrides, health

The lint configuration is part of this task, not a separate one: five oxlint rules fire on code every NestJS project writes, and settling them here means the first commit of server code is not also a lint negotiation.

**Files:**

- Create: `packages/server/package.json`, `packages/server/tsconfig.json`
- Create: `packages/server/vitest.config.ts` (no globalSetup — Task 3 adds the container, see Step 3b)
- Create: `packages/server/src/main.ts`, `src/app.module.ts`, `src/config.ts`
- Create: `packages/server/src/health/health.controller.ts`, `src/health/health.module.ts`
- Create: `packages/server/test/health.e2e.test.ts`
- Modify: `oxlint.config.ts` (a new entry in the existing `overrides` array)
- Modify: `pnpm-workspace.yaml` (add `packages/server`)
- Modify: root `package.json` (`build` and `test` include the server)

**Interfaces:**

- Consumes: `@pp/common`, `@pp/db` as loadable packages (Task 1).
- Produces: `ServerConfig` from `src/config.ts` — `{ port: number; databaseUrl: string; jwksUrl: string; mediaRoot: string; mediaMaxBytes: number; allowedEmails: string[] }`; `AppModule`; a listening Nest app. Tasks 3–13 all mount onto `AppModule`.

- [ ] **Step 1: Add the lint overrides FIRST, with a probe file that proves they were needed**

Append to the existing `overrides` array in `oxlint.config.ts`:

```ts
    {
      // NestJS is decorator- and class-driven; five of the repo's default
      // rules fire on idiomatic framework code rather than on defects.
      // `new-cap` is the widest: every `@Injectable()` is a call to an
      // uppercase-named function, so it lands on essentially every line of
      // boilerplate. `oxlint --fix` cannot help with any of these.
      files: ["packages/server/**/*.ts"],
      rules: {
        "typescript/no-extraneous-class": "off",
        "eslint/max-params": "off",
        "eslint/class-methods-use-this": "off",
        "eslint/max-classes-per-file": "off",
        "eslint/new-cap": "off",
      },
    },
```

- [ ] **Step 2: Create the package manifest**

`packages/server/package.json`:

```json
{
  "name": "@pp/server",
  "type": "module",
  "private": true,
  "main": "./dist/main.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@liam-public/node-config": "^0.1.0",
    "@liam-public/node-logger": "^0.1.0",
    "@liam-public/node-nest-common": "^0.1.1",
    "@liam-public/node-postgres": "^0.3.1",
    "@liam-workspace/node-auth-server": "^0.5.1",
    "@liam-workspace/platform": "^0.1.0",
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "@pp/common": "workspace:*",
    "@pp/db": "workspace:*",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@nestjs/testing": "^11.0.0",
    "@testcontainers/postgresql": "^11.0.0",
    "@types/node": "^26.0.1",
    "@types/supertest": "^6.0.2",
    "supertest": "^7.0.0",
    "typescript": "^6.0.3",
    "vitest": "^4.1.0"
  }
}
```

- [ ] **Step 3: TypeScript configuration**

`packages/server/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "target": "ESNext",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": false,
    "outDir": "./dist",
    "rootDir": "./src",
    "verbatimModuleSyntax": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  },
  "include": ["src"]
}
```

`experimentalDecorators` and `emitDecoratorMetadata` are what make Nest's constructor injection resolve at runtime. Without the second, every injected provider arrives `undefined` with no error at build time.

- [ ] **Step 3b: A vitest config with NO database container**

`packages/server/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@pp/common": new URL("../common/src/index.ts", import.meta.url).pathname,
      "@pp/db": new URL("../db/src/index.ts", import.meta.url).pathname,
    },
  },
})
```

No `globalSetup` here on purpose. This task's only test mounts `HealthModule` alone and never touches Postgres, so starting a container for it would make the task unverifiable anywhere Docker is unavailable — for no benefit. **Task 3 adds the container**, because Task 3 is where database access arrives.

The aliases keep the inner test loop resolving `@pp/common`/`@pp/db` from `src`, matching what Task 1 did for the other two packages.

- [ ] **Step 3c: Register the package in the workspace NOW, before any test step**

Add `- "packages/server"` to `pnpm-workspace.yaml`, then `pnpm install`.

This comes BEFORE the red-first step on purpose. `pnpm --filter @pp/server test` against a package that is not a workspace member does not fail — it prints "No projects matched the filters" and **exits 0**. A run-to-verify-it-fails step that cannot fail is worse than no step at all, because it manufactures confidence exactly where the safeguard was meant to be.

- [ ] **Step 4: Write the failing health test**

`packages/server/test/health.e2e.test.ts`:

```ts
import { Test } from "@nestjs/testing"
import type { INestApplication } from "@nestjs/common"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { HealthModule } from "../src/health/health.module.js"

describe("GET /health", () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [HealthModule],
    }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it("reports ok", async () => {
    const res = await request(app.getHttpServer()).get("/health").expect(200)
    expect(res.body).toEqual({ status: "ok" })
  })
})
```

- [ ] **Step 5: Run it to verify it fails**

Run: `pnpm --filter @pp/server test`
Expected: FAIL — `Cannot find module '../src/health/health.module.js'`.

- [ ] **Step 6: Config, health, module, bootstrap**

`packages/server/src/config.ts`:

```ts
import { parseCsvEnv, parseIntegerEnv } from "@liam-public/node-config"

export interface ServerConfig {
  port: number
  databaseUrl: string
  jwksUrl: string
  mediaRoot: string
  mediaMaxBytes: number
  allowedEmails: string[]
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]
  if (!value) {
    throw new Error(`${key} is required`)
  }
  return value
}

export function loadServerConfig(
  env: NodeJS.ProcessEnv = process.env,
): ServerConfig {
  return {
    port: parseIntegerEnv(env.PORT, 3000),
    databaseUrl: required(env, "DATABASE_URL"),
    jwksUrl: required(env, "JWKS_URL"),
    mediaRoot: env.MEDIA_ROOT ?? "/media",
    mediaMaxBytes: parseIntegerEnv(env.MEDIA_MAX_BYTES, 20 * 1024 * 1024),
    allowedEmails: parseCsvEnv(env.ALLOWED_EMAILS, []),
  }
}
```

Check `@liam-public/node-config`'s published signatures before writing this — if `parseIntegerEnv`/`parseCsvEnv` take `(env, key, fallback)` rather than `(value, fallback)`, follow the library, and say so in your report.

`packages/server/src/health/health.controller.ts`:

```ts
import { Controller, Get } from "@nestjs/common"

@Controller("health")
export class HealthController {
  @Get()
  check(): { status: string } {
    return { status: "ok" }
  }
}
```

`packages/server/src/health/health.module.ts`:

```ts
import { Module } from "@nestjs/common"
import { HealthController } from "./health.controller.js"

@Module({ controllers: [HealthController] })
export class HealthModule {}
```

`packages/server/src/app.module.ts`:

```ts
import { Module } from "@nestjs/common"
import { HealthModule } from "./health/health.module.js"

@Module({ imports: [HealthModule] })
export class AppModule {}
```

`packages/server/src/main.ts`:

```ts
import "reflect-metadata"
import { NestFactory } from "@nestjs/core"
import { AllExceptionsFilter } from "@liam-public/node-nest-common"
import { AppModule } from "./app.module.js"
import { loadServerConfig } from "./config.js"

async function bootstrap(): Promise<void> {
  const config = loadServerConfig()
  const app = await NestFactory.create(AppModule)
  app.useGlobalFilters(new AllExceptionsFilter())
  await app.listen(config.port)
}

await bootstrap()
```

Database gating is deliberately absent here — Task 3 adds it, with a test.

- [ ] **Step 7: Wire the root scripts and re-run**

The package is already a workspace member (Step 3c). Extend the root `build` and `test` scripts to include `@pp/server`, keeping the order `common` → `db` → `server` — each builds against the previous one's `dist`. Then:

```bash
pnpm --filter @pp/server test
```

Expected: PASS.

- [ ] **Step 8: Gates and commit**

```bash
pnpm lint && pnpm format && pnpm typecheck && pnpm test
git add -A
git commit -m "feat(server): scaffold NestJS with config, health and lint overrides"
```

---

### Task 3: Database wiring — boot gate, migrations, two pools, injected clock

Spec §2 Deployment: `waitForDatabase` gates API boot so ordering is not a compose race, and `runMigrations` runs at startup with a scoped `migrationsTable`. Two pools, because a 40-question import would be cancelled part-way by the request path's 5s statement timeout.

**Files:**

- Create: `packages/server/src/database/database.module.ts`, `src/database/tokens.ts`
- Create: `packages/server/test/helpers/app.ts` (shared e2e harness — every later task uses it)
- Create: `packages/server/test/database.e2e.test.ts`
- Create: `packages/server/test/helpers/global-setup.ts` — one PostgreSQL 16 Testcontainer per `vitest run`, publishing its URI via `project.provide("postgresConnectionUri", …)`. Mirror `packages/db/test/helpers/global-setup.ts`; do not import across packages.
- Modify: `packages/server/vitest.config.ts` (created in Task 2 — do NOT create it again). Add `globalSetup: ["./test/helpers/global-setup.ts"]` and `fileParallelism: false`, keeping the existing `resolve.alias` block. Task 2 deliberately shipped it without a container because its health test needs no database; this task is where database access arrives, so this is where the container belongs. `fileParallelism: false` is load-bearing: files share the container's `public` schema and each resets it, so two at once race on `DROP SCHEMA` and the migrations lock.
- Modify: `packages/server/src/main.ts`, `src/app.module.ts`

**Interfaces:**

- Consumes: `loadServerConfig` (Task 2); `migrateToLatest`, `loadDbConfig`, `createRequestPool`, `createJobPool` from `@pp/db`; `systemClock`, `type Clock` from `@pp/common`.
- Produces: injection tokens `REQUEST_POOL`, `JOB_POOL`, `CLOCK` from `src/database/tokens.ts`, and `DatabaseModule` exporting all three. Every repository-backed task injects these by token.

- [ ] **Step 1: Injection tokens**

`packages/server/src/database/tokens.ts`:

```ts
/**
 * String tokens rather than class tokens: `PgPool` is an interface from a
 * third-party package, so there is no class to inject by.
 */
export const REQUEST_POOL = "REQUEST_POOL"
export const JOB_POOL = "JOB_POOL"
export const CLOCK = "CLOCK"
```

- [ ] **Step 2: Write the failing test — two pools, distinguishable at the database**

`packages/server/test/database.e2e.test.ts`:

```ts
import type { PgPool } from "@liam-public/node-postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createTestApp, type TestApp } from "./helpers/app.js"
import { JOB_POOL, REQUEST_POOL } from "../src/database/tokens.js"

describe("database wiring", () => {
  let app: TestApp

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  it("names the two pools distinctly in pg_stat_activity", async () => {
    const request = app.get<PgPool>(REQUEST_POOL)
    const jobs = app.get<PgPool>(JOB_POOL)

    const names = new Set<string>()
    for (const pool of [request, jobs]) {
      const { rows } = await pool.query<{ name: string }>(
        "SELECT current_setting('application_name') AS name",
      )
      names.add(rows[0].name)
    }

    expect(names).toEqual(new Set(["pp:api", "pp:jobs"]))
  })

  it("has already migrated the database by the time the app is up", async () => {
    const request = app.get<PgPool>(REQUEST_POOL)
    const { rows } = await request.query<{ count: string }>(
      "SELECT count(*) AS count FROM pp_migrations",
    )
    expect(Number(rows[0].count)).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @pp/server test database`
Expected: FAIL — `./helpers/app.js` does not exist yet.

- [ ] **Step 4: The shared e2e harness**

`packages/server/test/helpers/app.ts`. Every later task's test builds on this, so give it the seams they will need — an overridable clock above all, because expiry is server-authoritative and no test may sleep.

```ts
import { Test } from "@nestjs/testing"
import type { INestApplication } from "@nestjs/common"
import { createFixedClock, type Clock } from "@pp/common"
import { inject } from "vitest"
import { AppModule } from "../../src/app.module.js"
import { CLOCK } from "../../src/database/tokens.js"

export interface TestApp {
  readonly http: INestApplication
  get<T>(token: string): T
  close(): Promise<void>
}

export async function createTestApp(
  options: { now?: Date } = {},
): Promise<TestApp> {
  process.env.DATABASE_URL = inject("postgresConnectionUri")
  process.env.JWKS_URL = "http://127.0.0.1:0/.well-known/jwks.json"

  const builder = Test.createTestingModule({ imports: [AppModule] })
  if (options.now) {
    builder.overrideProvider(CLOCK).useValue(createFixedClock(options.now))
  }

  const moduleRef = await builder.compile()
  const http = moduleRef.createNestApplication()
  await http.init()

  return {
    http,
    get: <T>(token: string) => moduleRef.get<T>(token),
    close: () => http.close(),
  }
}
```

- [ ] **Step 5: The database module**

`packages/server/src/database/database.module.ts`:

```ts
import { Global, Module } from "@nestjs/common"
import { systemClock } from "@pp/common"
import { createJobPool, createRequestPool, loadDbConfig } from "@pp/db"
import { CLOCK, JOB_POOL, REQUEST_POOL } from "./tokens.js"

/**
 * Global: every feature module needs a pool, and re-importing this in each
 * one would create a second set of pools per import.
 */
@Global()
@Module({
  providers: [
    {
      provide: REQUEST_POOL,
      useFactory: () => createRequestPool(loadDbConfig()),
    },
    { provide: JOB_POOL, useFactory: () => createJobPool(loadDbConfig()) },
    { provide: CLOCK, useValue: systemClock },
  ],
  exports: [REQUEST_POOL, JOB_POOL, CLOCK],
})
export class DatabaseModule {}
```

Import it in `AppModule`.

- [ ] **Step 6: Gate boot on the database**

In `packages/server/src/main.ts`, before `NestFactory.create`:

```ts
import { waitForDatabase } from "@liam-public/node-postgres"
import { migrateToLatest } from "@pp/db"

await waitForDatabase(config.databaseUrl, { retries: 30, delayMs: 1000 })
await migrateToLatest(config.databaseUrl)
```

The e2e harness does not go through `main.ts`, so the test module must migrate too — do it in `createTestApp` before `compile()`, using the same `migrateToLatest`. Two call sites, one function; do NOT duplicate the migration logic.

- [ ] **Step 7: Run and commit**

Run: `pnpm --filter @pp/server test`
Expected: PASS — both pool names present, `pp_migrations` populated.

```bash
pnpm lint && pnpm format && pnpm typecheck && pnpm test
git add -A && git commit -m "feat(server): gate boot on the database and provide both pools"
```

---

### Task 4: JWKS verification, the current student, and the admin guard

There is no user table and no password. Identity is a verified JWT `sub`; admin is the `isAdmin` claim, which is why revoking admin at the identity provider takes effect immediately.

**Files:**

- Create: `packages/server/src/auth/jwks.guard.ts`, `src/auth/admin.guard.ts`, `src/auth/current-student.decorator.ts`, `src/auth/auth.module.ts`, `src/auth/tokens.ts`
- Create: `packages/server/test/helpers/token.ts` (mint real signed tokens against a local JWKS)
- Create: `packages/server/test/auth.e2e.test.ts`
- Modify: `packages/server/src/app.module.ts`

**Interfaces:**

- Consumes: `createJwksVerifier` from `@liam-workspace/node-auth-server` — signature verified against the published 0.5.1 typings:
  `createJwksVerifier({ jwksUrl, fetchFn?, cacheTtlMs? }) => { verify(authHeader: string | undefined): Promise<JwtClaims> }`
  and `JwtClaims = { sub: string | null; email: string | null; roles: string[]; rolesByApp: Record<string, string[]>; scopes: string[]; clientId: string | null; tenant: string | null; isAdmin: boolean; isServiceAccount: boolean }`.
  **`verify` takes the whole `Authorization` header, not the bare token.**
- Produces: `JwksGuard` (rejects `401` without valid bearer), `AdminGuard` (`403` unless `claims.isAdmin`), `@CurrentStudent()` param decorator yielding `JwtClaims`, and token `JWKS_VERIFIER`.

- [ ] **Step 1: Test tokens without a network**

`createJwksVerifier` accepts an injectable `fetchFn`, which is what makes this testable — serve a JWKS generated in-process and sign tokens with the matching key. Use `jose` (add `"jose": "^6.0.0"` to `@pp/server` devDependencies) for both halves.

`packages/server/test/helpers/token.ts`:

```ts
import { SignJWT, exportJWK, generateKeyPair } from "jose"

export interface TokenFactory {
  readonly fetchFn: typeof fetch
  mint(claims: {
    sub: string
    email: string
    isAdmin?: boolean
  }): Promise<string>
}

export async function createTokenFactory(): Promise<TokenFactory> {
  const { publicKey, privateKey } = await generateKeyPair("RS256", {
    extractable: true,
  })
  const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256" }

  const fetchFn = (async () =>
    new Response(JSON.stringify({ keys: [jwk] }), {
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch

  return {
    fetchFn,
    async mint({ sub, email, isAdmin = false }) {
      return new SignJWT({ email, roles: isAdmin ? ["admin"] : [] })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setSubject(sub)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey)
    },
  }
}
```

Confirm how 0.5.1 derives `isAdmin` from a token before trusting `roles: ["admin"]` — read its `dist/index.js`. If it reads `rolesByApp` or a differently-named claim, mint that instead and record what you found in your report. Do not assert `isAdmin` works without having seen the code that sets it.

- [ ] **Step 2: Write the failing auth test**

`packages/server/test/auth.e2e.test.ts` — four cases, each of which must be able to fail:

```ts
it("rejects a request with no Authorization header", …)      // 401
it("rejects a token signed by a different key", …)           // 401
it("admits a valid token and exposes its sub", …)            // 200, body.sub matches
it("refuses a non-admin on an admin route", …)               // 403
```

Mount two probe controllers inside the test module — one behind `JwksGuard`, one behind both guards — rather than depending on a feature route that does not exist yet.

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @pp/server test auth`
Expected: FAIL — the guards do not exist.

- [ ] **Step 4: Implement the guards**

`packages/server/src/auth/jwks.guard.ts`:

```ts
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common"
import type { JwtClaims } from "@liam-workspace/node-auth-server"
import { JWKS_VERIFIER } from "./tokens.js"
import type { JwksVerifier } from "@liam-workspace/node-auth-server"

@Injectable()
export class JwksGuard implements CanActivate {
  constructor(@Inject(JWKS_VERIFIER) private readonly verifier: JwksVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>
      claims?: JwtClaims
    }>()

    let claims: JwtClaims
    try {
      claims = await this.verifier.verify(req.headers.authorization)
    } catch {
      throw new UnauthorizedException("invalid_token")
    }
    if (!claims.sub) {
      throw new UnauthorizedException("invalid_token")
    }

    req.claims = claims
    return true
  }
}
```

`AdminGuard` reads `req.claims.isAdmin` and throws `ForbiddenException("admin_required")`. It runs AFTER `JwksGuard`, so it must not re-verify.

`@CurrentStudent()` is `createParamDecorator((_, ctx) => ctx.switchToHttp().getRequest().claims)`.

- [ ] **Step 5: Run, then gates and commit**

Run: `pnpm --filter @pp/server test auth` → PASS, all four.

```bash
pnpm lint && pnpm format && pnpm typecheck && pnpm test
git add -A && git commit -m "feat(server): verify bearer tokens against JWKS and guard admin routes"
```

---

### Task 5: Draw the module boundary the answer key needs

`packages/db/src/index.ts` currently `export *`s `loadForScoring` — the query that selects `is_correct` — from the same entry point as `loadForRunner`. The runner payload omits the answer key by construction, which is the property that matters and is tested. But nothing stops a future student-facing route from importing the scoring projection: there is a convention and a docstring, no boundary. This plan introduces the service layer, so it draws the line.

**Files:**

- Create: `packages/db/src/scoring.ts`
- Modify: `packages/db/src/index.ts`, `packages/db/package.json` (a second export path)
- Modify: `packages/common/src/index.ts` (move `ScoringChoice`/`ScoringQuestion` out of the default barrel)
- Create: `packages/common/src/scoring.ts`
- Create: `packages/db/test/boundary.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces: `@pp/db/scoring` and `@pp/common/scoring` subpath exports. `loadForScoring`, `ScoringChoice` and `ScoringQuestion` are reachable ONLY through them. Task 10's export route and plan 5's grading import from there; nothing else may.

- [ ] **Step 1: Write the failing boundary test**

```ts
it("does not expose the scoring projection from the default entry point", async () => {
  const surface = await import("@pp/db")
  expect(Object.keys(surface)).not.toContain("loadForScoring")
})

it("exposes it from the scoring entry point", async () => {
  const scoring = await import("@pp/db/scoring")
  expect(typeof scoring.loadForScoring).toBe("function")
})
```

Assert on the runtime key set, not on types — a type-only check would pass against a barrel that still re-exports the value at runtime, which is exactly the failure being prevented.

- [ ] **Step 2: Run it to verify the first case fails**

Run: `pnpm --filter @pp/db test boundary`
Expected: FAIL on case 1 — `loadForScoring` IS currently in the default surface.

- [ ] **Step 3: Move it**

`packages/db/src/scoring.ts` re-exports `loadForScoring` from the repository. Remove it from `src/index.ts` — note the repository file exports both `loadForRunner` and `loadForScoring`, so `index.ts` can no longer `export *` from it; list the runner exports explicitly, in the one clean shape this repo allows (single merged `import`, then `export` with no trailing `from`).

Add to `packages/db/package.json`:

```json
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./scoring": { "types": "./dist/scoring.d.ts", "default": "./dist/scoring.js" }
  },
```

Same shape for `@pp/common`.

- [ ] **Step 4: Run, gates, commit**

```bash
pnpm lint && pnpm format && pnpm typecheck && pnpm test
git add -A && git commit -m "refactor: put the answer key behind its own entry point"
```

---

### Task 6: `POST /session` and `GET /me`

There are no `users`, `sessions` or `password` tables. `POST /session` provisions a `student` row from verified claims on first sign-in and is idempotent thereafter; `GET /me` reads it back. The two responses differ by exactly one field and the contract explains why: `SessionResult` carries `created`, `Student` does not, because `created` is a fact about a call, not about a student.

**Files:**

- Create: `packages/db/src/repositories/student.repository.ts`
- Create: `packages/server/src/session/session.controller.ts`, `session.service.ts`, `session.module.ts`
- Create: `packages/db/test/student-repository.test.ts`, `packages/server/test/session.e2e.test.ts`
- Modify: `packages/db/src/index.ts`, `packages/server/src/app.module.ts`

**Interfaces:**

- Consumes: `JwksGuard`, `@CurrentStudent()` (Task 4); `REQUEST_POOL`, `CLOCK` (Task 3).
- Produces:

  ```ts
  export interface StudentRow {
    id: string
    subjectClaim: string
    email: string
    displayName: string
    pictureUrl: string | null
    level: "primary-step-1" | "primary-step-2" | null
  }
  export async function upsertStudentBySubject(
    db: PgQueryable,
    input: {
      subjectClaim: string
      email: string
      displayName: string
      pictureUrl?: string | null
    },
  ): Promise<{ student: StudentRow; created: boolean }>
  export async function findStudentBySubject(
    db: PgQueryable,
    subjectClaim: string,
  ): Promise<StudentRow | null>
  ```

  Tasks 7 and 9 resolve the caller's `student.id` through `findStudentBySubject`.

- [ ] **Step 1: Write the failing repository test**

`packages/db/test/student-repository.test.ts` — three cases:

```ts
it("creates a student on first sight and reports created: true", …)
it("is idempotent on the same subject_claim and reports created: false", …)
it("updates email and displayName when the identity provider changes them", …)
```

The third matters: `subject_claim` is the stable identity and `UNIQUE`, but a person can change their display name at Google. An upsert that ignores the update would pin the profile to whatever it was at first sign-in.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @pp/db test student-repository` → FAIL, module not found.

- [ ] **Step 3: Implement the repository**

```ts
const UPSERT = `
  INSERT INTO student (subject_claim, email, display_name, picture_url)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (subject_claim) DO UPDATE
     SET email        = EXCLUDED.email,
         display_name = EXCLUDED.display_name,
         picture_url  = EXCLUDED.picture_url,
         updated_at   = now()
  RETURNING id, subject_claim, email, display_name, picture_url, level,
            (xmax = 0) AS created
`
```

`xmax = 0` is how PostgreSQL distinguishes an INSERT from an UPDATE inside `ON CONFLICT DO UPDATE` in one round trip. Explain that in a comment — it is not obvious, and the alternative is a SELECT-then-INSERT race.

- [ ] **Step 4: Run the repository test** → PASS.

- [ ] **Step 5: Write the failing e2e test**

`packages/server/test/session.e2e.test.ts`:

```ts
it("POST /session provisions on first call with created: true", …)
it("POST /session is idempotent and returns created: false", …)
it("GET /me returns the profile and no `created` key", …)
it("GET /me without a token is 401", …)
```

The third case must assert `expect(res.body).not.toHaveProperty("created")` — `toEqual` against a subset would not catch an extra field, and the contract declares `Student` with `additionalProperties: false`.

- [ ] **Step 6: Implement the controller and service**

`POST /session` → `201` with `SessionResult`; `GET /me` → `200` with `Student`, `404 student_not_provisioned` when the subject has no row (a valid token whose owner never called `POST /session`).

`isAdmin` comes from the claims on every response, never from the database — there is no admin column, and the contract's `isAdmin` must reflect the token presented on THIS request so a revoked role takes effect immediately.

- [ ] **Step 7: Run, gates, commit**

```bash
pnpm lint && pnpm format && pnpm typecheck && pnpm test
git add -A && git commit -m "feat(server): provision the student profile from verified claims"
```

---

### Task 7: `GET /tests` — published tests, keyset-paginated, with this student's standing

The catalog is the screen that most shapes the API: it needs per-test attempt state, not just test metadata. `inProgressAttemptId` decides whether the card reads Start or Continue; `attemptCount` and `bestAttempt` decide whether Try again and See result appear. A finished attempt never blocks a new one.

**Files:**

- Create: `packages/db/src/repositories/catalog.repository.ts`
- Create: `packages/server/src/catalog/catalog.controller.ts`, `catalog.service.ts`, `catalog.module.ts`
- Create: `packages/db/test/catalog-repository.test.ts`, `packages/server/test/catalog.e2e.test.ts`

**Interfaces:**

- Consumes: `findStudentBySubject` (Task 6); `REQUEST_POOL`.
- Produces:

  ```ts
  export interface TestCardRow {
    /* mirrors the TestCard schema */
  }
  export async function listPublishedTests(
    db: PgQueryable,
    input: { studentId: string; limit: number; cursor: string | null },
  ): Promise<{ tests: TestCardRow[]; nextCursor: string | null }>
  ```

- [ ] **Step 1: Query design, decided here so no implementer invents one**

Only versions with `published_at IS NOT NULL` and referenced by `test.current_version_id` are visible. Per test, the student's standing needs: the in-progress attempt id (at most one, guaranteed by the `attempt_one_active` partial unique index), the count of finished attempts, and the best finished attempt by `percentage DESC, submitted_at DESC`. The `attempt_standing_idx` index exists for exactly this — `(student_id, test_version_id, status, percentage DESC, submitted_at DESC)`.

Use `LATERAL` subqueries per test rather than three separate round trips or a `GROUP BY` that cannot express "the whole best row". Keyset pagination on `(title, id)`, not `OFFSET`: the cursor is opaque base64 of that pair, `default 20, max 50` per the contract.

- [ ] **Step 2: Write the failing repository test — five cases**

```ts
it("lists only published tests", …)                                  // a draft version is invisible
it("reports inProgressAttemptId when one is running", …)
it("reports attemptCount and bestAttempt for finished attempts", …)
it("does not let a finished attempt set inProgressAttemptId", …)
it("paginates by keyset and the cursor round-trips", …)              // page 1 + page 2 == all, no overlap
```

The fourth is the one that would silently regress: a `LEFT JOIN` without a `status = 'in_progress'` filter makes every finished attempt look like a resumable one, and the card would read Continue forever.

- [ ] **Step 3: Run to verify it fails**, then implement, then run to verify it passes.

- [ ] **Step 4: Controller**

`GET /tests?limit=&cursor=` behind `JwksGuard`. `limit` is validated `1..50`, defaulting to 20; an out-of-range limit is `400`, not a silent clamp — a silently clamped limit makes a client's pagination arithmetic wrong with no signal.

- [ ] **Step 5: e2e test, gates, commit**

```bash
git commit -m "feat(server): serve the paginated catalog with per-student standing"
```

---

### Task 8: `GET /tests/{slug}` — the brief

Section structure, rules and instructions. **No questions** — this is the screen shown before the clock starts, and shipping questions here would hand the test to anyone who can read a network tab.

**Files:**

- Modify: `packages/db/src/repositories/catalog.repository.ts` (add `loadTestBrief`)
- Modify: `packages/server/src/catalog/*`
- Create: tests alongside

**Interfaces:**

- Produces: `loadTestBrief(db, slug): Promise<TestBriefRow | null>` matching the `TestBrief` schema.

- [ ] **Step 1: Write the failing test, including the negative that matters**

```ts
it("returns sections, rules and instructions for a published test", …)
it("carries NO question or choice text anywhere in the payload", …)
it("404s for an unpublished slug", …)
```

The second case must serialize the whole response and assert no question prompt from the fixture appears in it — `JSON.stringify(res.body)` and `expect(...).not.toContain(fixture.firstQuestionPrompt)`. Asserting the absence of a `questions` KEY is weaker: it passes against a payload that leaks prompts under some other name.

- [ ] **Step 2–4:** run-fail, implement, run-pass, gates, commit.

```bash
git commit -m "feat(server): serve the untimed test brief without questions"
```

---

### Task 9: `POST /attempts` — start, resume and re-attempt

One endpoint, three behaviours, argued and settled in spec §4. A partial unique index constrains only `status = 'in_progress'`, so a submitted attempt never blocks a new one and a double-tapped Start races into a constraint rather than creating two attempts. A stale expired attempt is finalized and the new one created **in the same transaction**, reported via `finalizedPriorAttempt` — no 410, no retry, and the news of an auto-submit is not swallowed.

**Files:**

- Create: `packages/db/src/repositories/attempt.repository.ts`
- Create: `packages/server/src/attempts/attempts.controller.ts`, `attempts.service.ts`, `attempts.module.ts`
- Create: `packages/db/test/attempt-repository.test.ts`, `packages/server/test/attempts.e2e.test.ts`

**Interfaces:**

- Consumes: `REQUEST_POOL`, `CLOCK`, `findStudentBySubject`.
- Produces:

  ```ts
  export interface StartResult {
    attempt: {
      id: string
      attemptNumber: number
      createdAt: Date
      startedAt: Date | null
      expiresAt: Date | null
      currentSectionId: string | null
      currentQuestionId: string | null
    }
    resumed: boolean
    finalizedPriorAttempt: { id: string; submittedAt: Date } | null
  }
  export async function startOrResumeAttempt(
    db: PgQueryable,
    input: { studentId: string; slug: string; now: Date },
  ): Promise<StartResult>
  ```

  Plan 3's section-entry endpoint sets `started_at`/`expires_at`; this task leaves both null.

- [ ] **Step 1: The rules, stated so the implementer does not have to infer them**

1. Resolve the slug to the test's `current_version_id`; `404` if unpublished.
2. If an `in_progress` attempt exists for this student and version AND it has not expired (`expires_at IS NULL OR expires_at > now`), return it with `resumed: true`. **`expires_at IS NULL` means untimed, not expired** — an attempt created but never entered has no deadline yet and must resume, not be finalized. Getting this backwards would expire every attempt the moment the student read the brief.
3. If an `in_progress` attempt exists and HAS expired, finalize it (status `expired`, `submitted_at` pinned to `expires_at`, **never to arrival**) and create a new one in the SAME transaction, returning `finalizedPriorAttempt`.
4. Otherwise create a new attempt with `resumed: false`.
5. `attemptNumber` is the count of this student's attempts on this version, including the new one.
6. `started_at` and `expires_at` stay NULL — the clock starts at first section entry. `attempt_clock_paired` enforces all-or-nothing, so setting one without the other is a constraint violation.

Wrap 2–4 in `withTransaction`. Rule 3 in two transactions would leave a window with no in-progress attempt, and a concurrent Start would create a third.

- [ ] **Step 2: Write the failing tests — six cases, each independently failable**

```ts
it("creates the first attempt with resumed: false and a null clock", …)
it("resumes an existing in-progress attempt rather than creating a second", …)
it("resumes an UNSTARTED attempt rather than treating a null expiry as expired", …)
it("finalizes an expired attempt and starts a new one in one call", …)
it("pins the finalized attempt's submittedAt to its deadline, not to now", …)
it("lets a finished attempt be re-attempted", …)
```

Case 5 uses `createFixedClock` set well past the deadline and asserts `submittedAt === expiresAt` — with a real clock the two are milliseconds apart and the assertion passes vacuously.

- [ ] **Step 3–5:** run-fail (record output), implement, run-pass.

- [ ] **Step 6: Controller and the race**

`POST /attempts` with `{ slug }` behind `JwksGuard`, returning `201` + `AttemptStart`. Catch the unique-violation SQLSTATE `23505` on `attempt_one_active` and re-read the winning row instead of surfacing a 500 — a double-tapped Start is a user doing something reasonable, and the correct response is the attempt that won.

- [ ] **Step 7: Gates and commit**

```bash
git commit -m "feat(server): start, resume and re-attempt through one endpoint"
```

---

### Task 10: Admin — import, publish, export

`importTestDocument` and `exportTestDocument` already exist in `@pp/db` from plan 1; this task puts routes in front of them and adds the one piece that is missing — publication.

Publication runs the cross-row checks column constraints cannot express, then marks the version published and immutable. Attempts pin versions, so after this point the content can never change under a recorded score.

**Files:**

- Create: `packages/db/src/repositories/publish.repository.ts`
- Create: `packages/server/src/admin/admin.controller.ts`, `admin.service.ts`, `admin.module.ts`
- Create: `packages/db/test/publish-repository.test.ts`, `packages/server/test/admin.e2e.test.ts`

**Interfaces:**

- Consumes: `importTestDocument`, `exportTestDocument` (plan 1); `loadForScoring` via `@pp/db/scoring` (Task 5) for the export's answer key; `JOB_POOL`; `AdminGuard`.
- Produces:

  ```ts
  export interface PublishViolation {
    code: string
    questionId?: string
    sectionId?: string
    detail: string
  }
  export async function publishDraftVersion(
    db: PgQueryable,
    input: { testId: string; now: Date },
  ): Promise<
    | { ok: true; versionId: string; version: number; publishedAt: Date }
    | { ok: false; violations: PublishViolation[] }
  >
  ```

- [ ] **Step 1: The validation set, enumerated**

Four checks, each a single SQL query returning offending rows:

1. `question_needs_two_choices` — every question has ≥ 2 choices.
2. `single_choice_needs_exactly_one_correct` — a `single_choice` question has exactly one `is_correct`.
3. `multi_choice_needs_a_correct` — a `multi_choice` question has ≥ 1.
4. `stimulus_media_must_exist` — every stimulus citing a `media_asset_id` resolves to a row.

Return ALL violations, not the first. An author fixing a 40-question import one error per round trip is the difference between a usable tool and an unusable one.

The Zod `testDocumentSchema` already enforces 1–3 at import time. They are re-checked here anyway because rows can reach the database by other paths — the seed script, a manual `psql`, a future admin editor — and publication is the last gate before content becomes immutable. Say so in a comment; otherwise the next reader deletes them as redundant.

- [ ] **Step 2: Write the failing tests — six cases**

```ts
it("publishes a valid draft and stamps published_at", …)
it("refuses a question with one choice and names it", …)
it("refuses a single_choice question with two correct choices", …)
it("refuses a stimulus citing a missing media asset", …)
it("returns EVERY violation, not just the first", …)
it("leaves the version a draft when validation fails", …)
```

Case 6 is the one that protects the invariant: a failed publish that stamped `published_at` anyway would freeze invalid content forever, because the immutability trigger then refuses every repair.

- [ ] **Step 3–4:** run-fail, implement, run-pass.

- [ ] **Step 5: Routes**

All three behind `JwksGuard` + `AdminGuard`, all three on `JOB_POOL` — a 40-question import cancelled part-way by the request path's 5s statement timeout is precisely why the second pool exists.

- `POST /admin/tests/import` — body validated by `testDocumentSchema`; `422` with the Zod issues on failure.
- `POST /admin/tests/{testId}/publish` — `200` on success, `422` with `violations` on failure.
- `GET /admin/tests/{testId}/export` — returns the document **including `isCorrect`**, guarded by the role claim rather than by absence. That is deliberate and stated in spec §4; do not strip it.

- [ ] **Step 6: The round trip, end to end**

Add one e2e test that imports a document, publishes it, exports it, and asserts the exported document deep-equals the imported one. Plan 1 has a round-trip test at the repository level; this one proves the HTTP layer does not reshape the payload on the way through.

- [ ] **Step 7: Gates and commit**

```bash
git commit -m "feat(server): admin import, publication validation and export"
```

---

### Task 11: `POST /admin/media`

**Files:**

- Create: `packages/db/src/repositories/media.repository.ts`
- Modify: `packages/server/src/admin/*`
- Create: tests alongside

**Interfaces:**

- Produces: `recordMediaAsset(db, { kind, filename, mimeType, byteSize, checksum }): Promise<MediaAssetRow>`

- [ ] **Step 1: Rules**

Multipart upload to `config.mediaRoot`, capped at `config.mediaMaxBytes` (`413` past it). `filename` is `UNIQUE` in the schema, so a re-upload of the same name is `409`, not a silent overwrite — overwriting would mutate content a published version cites, defeating immutability from outside the trigger's reach.

Compute a SHA-256 checksum server-side; never trust a client-supplied one. Accepted kinds come from the `media_kind` enum — reuse it rather than restating the values, so the enum-parity guard keeps covering them.

Write the file only after the row commits. A file on disk with no row is invisible garbage; a row with no file is a broken reference the export would happily emit.

- [ ] **Step 2: Tests** — accepts an mp3 and returns its id; rejects an oversized file with 413; rejects a duplicate filename with 409; rejects a non-admin with 403.

- [ ] **Step 3–4:** implement, run, gates, commit.

```bash
git commit -m "feat(server): accept media uploads with a server-computed checksum"
```

---

### Task 12: Seed a real test

Everything above is exercised against fixtures built for one assertion each. This task produces a genuine 40-question TOEFL Primary Step 1 test — 20 listening, 20 reading — so the API can be driven end to end and plan 3 has something real to render.

**Files:**

- Create: `scripts/seed-test.ts`, `scripts/fixtures/practice-test-01.json`
- Create: `packages/server/test/seed.e2e.test.ts`
- Modify: root `package.json` (a `seed` script)

- [ ] **Step 1: The document**

`practice-test-01.json` conforms to `testDocumentSchema`. Two sections: listening (20 questions, `forward_only`, `allowAnswerChange: false`, capped audio stimuli) and reading (20 questions, `free`, `allowAnswerChange: true`, passage stimuli). Section durations must sum to the test duration — plan 1's Task 8 tripped on exactly this, where a fixture violated a refinement stated in its own brief. Check the sum before writing the file.

Content is placeholder-quality English appropriate to ages 8–11; it does not need to be pedagogically real, but it must be _coherent_ — a passage its questions actually answer — because plan 3 renders it and nonsense makes screen bugs hard to see.

- [ ] **Step 2: The script**

`pnpm seed` imports the document via `importTestDocument`, publishes it via `publishDraftVersion`, and prints the resulting `testId`/`versionId`. Idempotent: re-running finds the existing slug and reports it rather than dying on `test_version_one_draft`. That partial index is exactly what made a re-import unrecoverable before the trigger fix — do not reintroduce the trap.

Media: the audio stimuli cite filenames that need `media_asset` rows. Either ship 20 tiny silent mp3s under `scripts/fixtures/media/` and upload them, or make the listening stimuli uncapped passages for the seed. **Decide and say which in your report** — a seed whose publish fails `stimulus_media_must_exist` is worse than one with no audio.

- [ ] **Step 3: The proof**

An e2e test that runs the seed against a clean container, then drives `GET /tests` → `GET /tests/{slug}` → `POST /attempts` and asserts a real attempt comes back for the seeded test. That is the first end-to-end exercise of this plan's whole surface.

- [ ] **Step 4: Gates and commit**

```bash
git commit -m "feat: seed a real 40-question practice test"
```

---

### Task 13: Make the repository runnable again — Dockerfile and compose

Plan 1 accepted a broken `Dockerfile` and `pnpm build` as a recorded ruling, because repairing them meant deciding `socket`/`web`'s fate. This plan gives the repository a runnable application, which is the condition that ruling named for fixing it.

**Files:**

- Modify: `Dockerfile`, `compose.yml`, `.dockerignore`
- Create: `packages/server/test/…` nothing new; verification is a real image build

- [ ] **Step 1: The Dockerfile**

Multi-stage: install with `--frozen-lockfile`, `pnpm build` (now `common` → `db` → `server`), then a runtime stage carrying `dist/` for all three plus `packages/db/migrations` and production `node_modules`. Copy `packages/{common,db,server}/package.json` — the current file copies `web` and `socket` and omits `db`, which is why it fails today.

`@liam-workspace/*` resolves from GitHub Packages, so the build needs `NODE_AUTH_TOKEN`. Use a BuildKit secret mount (`--mount=type=secret`), never an `ARG` — an `ARG` token is recoverable from the image history.

- [ ] **Step 2: compose**

Two services per spec §2: `api` (serves the API and `/media`) and `postgres`, a named volume each. `api` depends on `postgres`; boot ordering is handled by `waitForDatabase` in the application, not by `depends_on` alone, which only waits for the container rather than for the database.

Keep the existing `razzia` service or delete it — it runs `ralex91/razzia:latest`, the upstream image of the app this repository was forked FROM, and it is not this application. **Deleting it is the recommendation**; say what you did.

- [ ] **Step 3: Verify by building, not by reading**

```bash
docker compose build api
docker compose up -d
curl -fsS http://127.0.0.1:3000/health
docker compose down -v
```

A Dockerfile that has not been built is a Dockerfile that does not work. Paste the `/health` response into your report.

- [ ] **Step 4: Gates and commit**

```bash
git commit -m "build: ship the server image and give compose a runnable api service"
```

---

## Definition of Done

- [ ] `pnpm lint`, `pnpm format`, `pnpm typecheck`, `pnpm test` all exit 0
- [ ] `redocly lint docs/api/openapi.yaml` clean
- [ ] `docker compose build api` succeeds and `GET /health` answers from the running container
- [ ] `grep -rn "new Date()\|Date\.now()" packages/{common,db,server}/src` reports only comments, never a call
- [ ] Eight of the contract's twenty operations are implemented: `POST /session`, `GET /me`, `GET /tests`, `GET /tests/{slug}`, `POST /attempts`, `POST /admin/tests/import`, `POST /admin/tests/{testId}/publish`, `GET /admin/tests/{testId}/export`, plus `POST /admin/media`
- [ ] `pnpm seed` produces a published 40-question test, and re-running it is a no-op rather than an error
- [ ] `loadForScoring` is unreachable from `@pp/db`'s default entry point
- [ ] `docs/architecture/plan-2-preconditions.md` items 1–4 and 6 are closed; item 5 is closed only when plan 3 builds the runner endpoint
