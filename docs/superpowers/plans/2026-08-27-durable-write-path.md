# Durable Write Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it structurally impossible for a tapped answer to vanish — durable client queue, a reorder guard keyed by `(clientInstanceId, seq)`, a snapshot flush that never rolls back a sibling item, and a server that persists verbatim anything it refuses, before the error ever leaves the process.

**Architecture:** Server: `packages/server` gains a raw-body-capturing middleware, a Zod-backed global `ValidationPipe` and its paired `FailedWriteCaptureFilter` (registered in the same commit, per spec §7), a `response`/`response_client_cursor` repository implementing the reorder guard, and the two write routes — `PUT /attempts/{id}/responses/{questionId}` and `PATCH /attempts/{id}/responses`. Client: `packages/app` gains an IndexedDB-backed answer queue (durable before send), a retry classifier (pure, no network), a flush controller that reconciles per-item results, and a `pagehide` handler.

**Tech Stack:** NestJS 11 · PostgreSQL 16 · Zod 4 (already a `@pp/server` dependency; this plan does **not** add `class-validator` — see Task 3) · Vitest 4 · `fake-indexeddb` (new devDependency, `packages/app` only — see Task 8) · React 19 + Vite (`packages/app`, scaffolded by plan 3)

**Spec:** `docs/superpowers/specs/2026-08-25-toefl-primary-fork-design.md` §5 ("Never lose an answer" and its "Ordering" subsection), §6 (Durability testing row), §7 (the `ValidationPipe` risk) — phase 4 of §8. Contract: `docs/api/openapi.yaml` (the six rules and Ordering are quoted verbatim in its `info.description`; the write operations are `saveResponse`, `flushResponses`). Schema: `docs/db/schema.sql` (`response`, `response_client_cursor`, `failed_write`).

## Assumptions this plan makes about work done elsewhere

Plans are written in build order (spec §8), but only plan 2 has been executed so far (`packages/server` currently has `HealthModule`, `AuthModule`, `DatabaseModule`, `CatalogModule`, `SessionModule` — no `AttemptsModule` yet). This plan's tasks are self-contained against the schema and do not require plan 3's code to exist for their own tests to pass, **except** for one thing named explicitly where it matters (Task 6, attempt-level 410): the shared "finalize an attempt whose deadline has passed" mechanism that `POST .../enter`, `POST .../play` and `PUT .../position` also need. That mechanism requires grading, which is phase 5's scope, not this plan's. Do not implement grading here to route around the gap — flag it as this plan does and move on.

`packages/app` is assumed to exist (Vite + React 19, TypeScript ESM, Vitest, a `src/` and `test/` split, `jsdom` or `happy-dom` as the Vitest test environment) per plan 3. If its actual layout differs from the paths this plan uses (`packages/app/src/lib/*`, `packages/app/test/*`), adjust the paths and say so in your report — do not invent a second convention.

## Global Constraints

- **Node 24, TypeScript 6, ESM, `nodenext`.** Relative specifiers carry `.js`. Type-only imports use `import type` (`verbatimModuleSyntax`).
- **No `new Date()` and no `Date.now()`** in `packages/{common,db,server,app}/src`. Every timestamp comes from an injected `Clock` (`@liam-workspace/platform`, re-exported by `@pp/common` as `Clock`/`systemClock`/`createFixedClock`). On the client, the equivalent discipline applies to the retry scheduler and the queue's `seq`/timestamp bookkeeping: no bare `setTimeout` in test-observable code and no test may sleep — every delay is through an injectable scheduler function. Verify server-side with: `grep -rn "new Date()\|Date\.now()" packages/{common,db,server}/src`
- **`docs/api/openapi.yaml` is the contract.** Quote it; do not paraphrase. A response shape that disagrees with it is a defect in the code.
- **`docs/db/schema.sql` is the schema authority.** No migration is added by this plan — `response`, `response_client_cursor` and `failed_write` already exist (`packages/db/migrations/1002_attempts.cjs`, `1003_durability_and_triggers.cjs`). If a task seems to need a schema change, stop and say so rather than improvising a migration.
- **Reuse the wire types that already exist.** `packages/common/src/domain/attempt.ts` already exports `ResponseWrite`, `WriteStatus`, `RejectReason` and `ItemResult` — these are the `SingleResponseWrite`/`ItemAccepted`/`ItemRejected` shapes from `openapi.yaml`, already modelled. Import them; do not redeclare parallel types.
- **Never add a dependency without checking `docs/architecture/library-adoption.md` first.** This plan adds exactly one new dependency, `fake-indexeddb` (Task 8, `packages/app` devDependency only) — a standard, widely-used IndexedDB polyfill for tests, not a `~/projects/typescript-libraries` package, so it is not in the adoption map; say so in your report rather than treating its absence there as a blocker.
- **This plan does not add `class-validator`/`class-transformer`.** They are not installed and not in the adoption map. `zod` already is (`@pp/server`'s dependency, used for `testDocumentSchema` in plan 2). Task 3 builds a small Zod-backed `PipeTransform` registered globally instead of NestJS's built-in `ValidationPipe` class — it reproduces the exact hazard spec §7 names (a global pipe that runs before any controller handler and throws on rejection) using the validation library this repository already chose.
- **All four gates pass before every commit:** `pnpm lint`, `pnpm format`, `pnpm typecheck`, `pnpm test`.
- **Never write `git add -A` or a commit command into a step.** Every task ends with running the gates; staging and committing is the reviewer's job, not a step in this document.
- **Conventional commits are the reviewer's concern, not yours** — do not write commit messages into steps either; end each task at the gates.

## File Structure

| File                                                            | Responsibility                                                                          |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `packages/db/src/repositories/failed-write.repository.ts`       | Task 1: `insertFailedWrite` — the capture primitive                                     |
| `packages/server/src/http/raw-body-json.middleware.ts`          | Task 2: captures raw bytes before JSON parsing; the source of `req.rawBody`             |
| `packages/server/src/config.ts`                                 | Task 2: gains `requestBodyMaxBytes`                                                     |
| `packages/server/src/validation/zod-body-validation.pipe.ts`    | Task 3: `ZodBodyValidationPipe`, `CapturableBadRequestException`                        |
| `packages/server/src/durability/failed-write-capture.filter.ts` | Task 3: `FailedWriteCaptureFilter` — registered with the pipe, same commit              |
| `packages/server/src/main.ts`                                   | Task 2–3: `bodyParser: false`, the raw-body middleware, both global registrations       |
| `packages/db/src/repositories/response.repository.ts`           | Task 4: `writeResponse` — the reorder guard                                             |
| `packages/db/src/repositories/section-lookup.repository.ts`     | Task 6: `loadQuestionSectionInfo` — section/navigation context for a batch of questions |
| `packages/server/src/responses/single-response.controller.ts`   | Task 5: `PUT /attempts/{id}/responses/{questionId}`                                     |
| `packages/server/src/responses/response-write.service.ts`       | Task 5–6: shared ownership check + business rules                                       |
| `packages/server/src/responses/response-snapshot.controller.ts` | Task 6: `PATCH /attempts/{id}/responses`                                                |
| `packages/server/src/responses/responses.module.ts`             | Task 5: wires both controllers into `AppModule`                                         |
| `packages/app/src/lib/retryClassifier.ts`                       | Task 7: rule 5, pure                                                                    |
| `packages/app/src/lib/answerQueue.ts`                           | Task 8: rule 1 + Ordering (`clientInstanceId`/`seq`)                                    |
| `packages/app/src/lib/flushController.ts`                       | Task 9: rule 2 (client half) + rule 3 (client half) + retry integration                 |
| `packages/app/src/lib/lifecycleFlush.ts`                        | Task 10: rule 6 — `pagehide` keepalive + submit remainder                               |

---

### Task 1: `failed_write` repository — the capture primitive

Every later task in this plan writes to this table before returning an error. Building it first, alone, with its own test, means Tasks 2–6 consume a proven primitive instead of inventing one under pressure.

**Files:**

- Create: `packages/db/src/repositories/failed-write.repository.ts`
- Create: `packages/db/test/failed-write-repository.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks in this plan.
- Produces:

  ```ts
  export interface FailedWriteRow {
    id: string
    attemptId: string | null
    route: string
    reason: string
    rawBody: string
    byteSize: number | null
    clientVersion: string | null
    clientInstanceId: string | null
    receivedAt: Date
    replayedAt: Date | null
  }

  export async function insertFailedWrite(
    db: PgQueryable,
    input: {
      attemptId: string | null
      route: string
      reason: string
      rawBody: string
      byteSize: number | null
      clientVersion: string | null
      clientInstanceId: string | null
      now: Date
    },
  ): Promise<FailedWriteRow>
  ```

  Tasks 3, 5 and 6 all call this. `received_at` is written from `input.now` (the injected `Clock`), never from the column's `now()` default — a filter under test must produce a deterministic timestamp.

- [ ] **Step 1: Write the failing repository test**

  `packages/db/test/failed-write-repository.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest"
  import { insertFailedWrite } from "../src/repositories/failed-write.repository.js"
  import { withDatabase } from "./helpers/database.js"

  const NOW = new Date("2026-08-27T09:00:00.000Z")

  describe("failed_write repository", () => {
    it("stores a captured write and round-trips every field", async () => {
      await withDatabase(async (pool) => {
        const row = await insertFailedWrite(pool, {
          attemptId: "11111111-1111-1111-1111-111111111111",
          route: "PATCH /attempts/x/responses",
          reason: "mixed_sections",
          rawBody: '{"clientInstanceId":"c1","responses":[]}',
          byteSize: 42,
          clientVersion: "1.0.0",
          clientInstanceId: "c1",
          now: NOW,
        })

        expect(row.id).toMatch(/^[0-9a-f-]{36}$/)
        expect(row.attemptId).toBe("11111111-1111-1111-1111-111111111111")
        expect(row.route).toBe("PATCH /attempts/x/responses")
        expect(row.reason).toBe("mixed_sections")
        expect(row.rawBody).toBe('{"clientInstanceId":"c1","responses":[]}')
        expect(row.byteSize).toBe(42)
        expect(row.clientVersion).toBe("1.0.0")
        expect(row.clientInstanceId).toBe("c1")
        expect(row.receivedAt).toEqual(NOW)
        expect(row.replayedAt).toBeNull()
      })
    }, 120_000)

    it("accepts a null attemptId for a body malformed before any id could be read", async () => {
      await withDatabase(async (pool) => {
        const row = await insertFailedWrite(pool, {
          attemptId: null,
          route: "PATCH /attempts/x/responses",
          reason: "unparseable_body",
          rawBody: "{not json",
          byteSize: 9,
          clientVersion: null,
          clientInstanceId: null,
          now: NOW,
        })

        expect(row.attemptId).toBeNull()
      })
    }, 120_000)
  })
  ```

- [ ] **Step 2: Run it to verify it fails**

  Run: `pnpm --filter @pp/db test failed-write-repository`
  Expected: FAIL — `Cannot find module '../src/repositories/failed-write.repository.js'`.

- [ ] **Step 3: Implement the repository**

  `packages/db/src/repositories/failed-write.repository.ts`:

  ```ts
  import type { PgQueryable } from "@liam-public/node-postgres"

  export interface FailedWriteRow {
    id: string
    attemptId: string | null
    route: string
    reason: string
    rawBody: string
    byteSize: number | null
    clientVersion: string | null
    clientInstanceId: string | null
    receivedAt: Date
    replayedAt: Date | null
  }

  interface FailedWriteDbRow {
    id: string
    attempt_id: string | null
    route: string
    reason: string
    raw_body: string
    byte_size: number | null
    client_version: string | null
    client_instance_id: string | null
    received_at: Date
    replayed_at: Date | null
  }

  function toFailedWrite(row: FailedWriteDbRow): FailedWriteRow {
    return {
      id: row.id,
      attemptId: row.attempt_id,
      route: row.route,
      reason: row.reason,
      rawBody: row.raw_body,
      byteSize: row.byte_size,
      clientVersion: row.client_version,
      clientInstanceId: row.client_instance_id,
      receivedAt: row.received_at,
      replayedAt: row.replayed_at,
    }
  }

  /**
   * This table's whole job is accepting garbage: no foreign key on
   * attempt_id, nothing validated. `received_at` is written from the caller's
   * Clock, never the column's `now()` default, so capture time is
   * deterministic under test.
   */
  export async function insertFailedWrite(
    db: PgQueryable,
    input: {
      attemptId: string | null
      route: string
      reason: string
      rawBody: string
      byteSize: number | null
      clientVersion: string | null
      clientInstanceId: string | null
      now: Date
    },
  ): Promise<FailedWriteRow> {
    const { rows } = await db.query<FailedWriteDbRow>(
      `INSERT INTO failed_write
         (attempt_id, route, reason, raw_body, byte_size, client_version,
          client_instance_id, received_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, attempt_id, route, reason, raw_body, byte_size,
                 client_version, client_instance_id, received_at, replayed_at`,
      [
        input.attemptId,
        input.route,
        input.reason,
        input.rawBody,
        input.byteSize,
        input.clientVersion,
        input.clientInstanceId,
        input.now,
      ],
    )

    return toFailedWrite(rows[0])
  }
  ```

- [ ] **Step 4: Export it and run**

  Add to `packages/db/src/index.ts`, alongside the existing named exports (single merged import, then `export`, no trailing `from` — the shape `oxlint`'s `no-duplicate-imports` requires here):

  ```ts
  import {
    insertFailedWrite,
    type FailedWriteRow,
  } from "./repositories/failed-write.repository.js"
  ```

  and add `insertFailedWrite` to the `export { ... }` block and `FailedWriteRow` to the `export type { ... }` block.

  Run: `pnpm --filter @pp/db test failed-write-repository`
  Expected: PASS, both cases.

- [ ] **Step 5: Gates**

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

  Do NOT run `git add` and do NOT commit. Leave the work uncommitted; the reviewer stages by explicit path.

---

### Task 2: Raw-body capture middleware — the bytes must exist before any pipe or filter can save them

This is the load-bearing fix for the 413 case spec §5 rule 4 calls out as mattering most: "the capture falls back to raw bytes when no parsed body exists." NestJS's own `rawBody: true` option calls its `verify` hook only after a **successful, in-limit** body read — `body-parser` aborts an oversized read without ever calling it, so `req.rawBody` stays `undefined` in exactly the case this rule is about. This middleware replaces Nest's default body parser for the whole app and captures bytes as they stream in, before any size check can reject them.

**Files:**

- Create: `packages/server/src/http/raw-body-json.middleware.ts`
- Create: `packages/server/test/raw-body-json.middleware.e2e.test.ts`
- Modify: `packages/server/src/config.ts` (add `requestBodyMaxBytes`)
- Modify: `packages/server/src/main.ts`
- Modify: `packages/server/test/helpers/app.ts`

**Interfaces:**

- Consumes: nothing from earlier server tasks.
- Produces: `createRawBodyJsonMiddleware(maxBytes)`, `PayloadTooLargeSignal`, `UnparseableBodySignal`, `type CapturedRequest`. Task 3's filter catches the two signal classes and reads `req.rawBody`/`req.rawBodyByteCount`.

- [ ] **Step 1: Write the failing test against a throwaway probe route**

  `packages/server/test/raw-body-json.middleware.e2e.test.ts`. This test mounts its own tiny probe controller rather than depending on a feature route that does not exist yet — the same pattern plan 2's Task 4 used for the auth guards.

  ```ts
  import { Controller, Module, Post, Req } from "@nestjs/common"
  import { Test } from "@nestjs/testing"
  import type { INestApplication } from "@nestjs/common"
  import { NestFactory } from "@nestjs/core"
  import { afterAll, beforeAll, describe, expect, it } from "vitest"
  import {
    createRawBodyJsonMiddleware,
    type CapturedRequest,
  } from "../src/http/raw-body-json.middleware.js"

  const MAX_BYTES = 64

  @Controller("probe")
  class ProbeController {
    @Post()
    echo(@Req() req: CapturedRequest): {
      body: unknown
      rawBody: string
      byteCount: number | undefined
    } {
      return {
        body: req.body,
        rawBody: (req.rawBody ?? Buffer.alloc(0)).toString("utf8"),
        byteCount: req.rawBodyByteCount,
      }
    }
  }

  @Module({ controllers: [ProbeController] })
  class ProbeModule {}

  describe("raw-body JSON middleware", () => {
    let app: INestApplication
    let url: string

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [ProbeModule],
      }).compile()
      app = moduleRef.createNestApplication(undefined, { bodyParser: false })
      app.use(createRawBodyJsonMiddleware(MAX_BYTES))
      await app.listen(0)
      const address = app.getHttpServer().address()
      url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : ""}`
    })

    afterAll(async () => {
      await app.close()
    })

    it("parses a small valid JSON body and captures its raw bytes", async () => {
      const body = JSON.stringify({ a: 1 })
      const res = await fetch(`${url}/probe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      })

      expect(res.status).toBe(201)
      const parsed = (await res.json()) as {
        body: unknown
        rawBody: string
        byteCount: number
      }
      expect(parsed.body).toEqual({ a: 1 })
      expect(parsed.rawBody).toBe(body)
      expect(parsed.byteCount).toBe(Buffer.byteLength(body))
    })

    it("captures raw bytes even when JSON parsing fails", async () => {
      // Cannot use the probe's normal response path -- express never reaches
      // the handler once next(err) fires. This is proven properly in Task 3's
      // filter test, which reads the resulting failed_write row. Here we only
      // prove the middleware ends the request rather than hanging, and that
      // it does not silently succeed.
      const res = await fetch(`${url}/probe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      })

      expect(res.status).not.toBe(201)
    })

    it("stops accumulating once the body exceeds maxBytes and does not hang", async () => {
      const oversized = JSON.stringify({ a: "x".repeat(MAX_BYTES * 4) })
      const res = await fetch(`${url}/probe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: oversized,
      })

      expect(res.status).not.toBe(201)
    })
  })
  ```

- [ ] **Step 2: Run it to verify it fails**

  Run: `pnpm --filter @pp/server test raw-body-json`
  Expected: FAIL — `Cannot find module '../src/http/raw-body-json.middleware.js'`.

- [ ] **Step 3: Implement the middleware**

  `packages/server/src/http/raw-body-json.middleware.ts`:

  ```ts
  import type { NextFunction, Request, Response } from "express"

  export interface CapturedRequest extends Request {
    rawBody?: Buffer
    rawBodyByteCount?: number
  }

  /** Thrown when the streamed body exceeds `maxBytes`. `req.rawBody` holds a
   * truncated prefix (up to `maxBytes`) captured before the connection was
   * dropped; `req.rawBodyByteCount` holds the true count observed, which may
   * exceed the prefix's length. */
  export class PayloadTooLargeSignal extends Error {
    constructor() {
      super("payload_too_large")
    }
  }

  /** Thrown when the body was within the size limit but is not valid JSON.
   * `req.rawBody` holds the complete body. */
  export class UnparseableBodySignal extends Error {
    constructor() {
      super("unparseable_body")
    }
  }

  /**
   * Replaces Nest's default body parser for the whole app (main.ts creates
   * the app with `bodyParser: false`). Captures every request's raw bytes
   * onto `req.rawBody` BEFORE attempting to parse them, so
   * FailedWriteCaptureFilter always has something to persist -- including the
   * oversized case, which Nest's own `rawBody: true` option cannot cover
   * (body-parser aborts before its `verify` hook runs).
   *
   * Assumes every request this app accepts declares `application/json`. A
   * request that does not is passed through unread -- there is no other
   * content type any route in this API accepts.
   */
  export function createRawBodyJsonMiddleware(
    maxBytes: number,
  ): (req: CapturedRequest, res: Response, next: NextFunction) => void {
    return function rawBodyJsonMiddleware(
      req: CapturedRequest,
      _res: Response,
      next: NextFunction,
    ): void {
      if (!req.is("application/json")) {
        next()
        return
      }

      const chunks: Buffer[] = []
      let total = 0

      const onData = (chunk: Buffer): void => {
        total += chunk.length

        if (total > maxBytes) {
          req.rawBody = Buffer.concat(chunks)
          req.rawBodyByteCount = total
          req.off("data", onData)
          req.off("end", onEnd)
          req.destroy()
          next(new PayloadTooLargeSignal())
          return
        }

        chunks.push(chunk)
      }

      const onEnd = (): void => {
        const raw = Buffer.concat(chunks)
        req.rawBody = raw
        req.rawBodyByteCount = raw.length

        if (raw.length === 0) {
          req.body = {}
          next()
          return
        }

        try {
          req.body = JSON.parse(raw.toString("utf8")) as unknown
          next()
        } catch {
          next(new UnparseableBodySignal())
        }
      }

      req.on("data", onData)
      req.on("end", onEnd)
      req.on("error", next)
    }
  }
  ```

  Note the probe test's route responds `201` for the success case via Nest's default `@Post()` status; `res.status(201)` is Nest's own default for a `POST` with no explicit `@HttpCode`, so the assertion is exercising the real default, not a decision this task made.

- [ ] **Step 4: Add the config field**

  In `packages/server/src/config.ts`, add to `ServerConfig`:

  ```ts
  requestBodyMaxBytes: number
  ```

  and to `loadServerConfig`'s return:

  ```ts
    requestBodyMaxBytes: parseIntegerEnv(env, "REQUEST_BODY_MAX_BYTES", 262_144),
  ```

  256 KiB default — generous for a section snapshot of dozens of answers, small enough that a runaway client cannot hold a connection open indefinitely.

- [ ] **Step 5: Wire it into `main.ts` and the test harness**

  `packages/server/src/main.ts` — replace `NestFactory.create(AppModule)` and add the middleware before any global pipe/filter registration (Task 3 adds those two lines):

  ```ts
  const app = await NestFactory.create(AppModule, { bodyParser: false })
  app.use(createRawBodyJsonMiddleware(config.requestBodyMaxBytes))
  app.useGlobalFilters(new AllExceptionsFilter())
  ```

  `packages/server/test/helpers/app.ts` — mirror the same two lines so e2e tests exercise the real pipeline, not a different one:

  ```ts
  const http = moduleRef.createNestApplication(undefined, { bodyParser: false })
  http.use(createRawBodyJsonMiddleware(262_144))
  http.useGlobalFilters(new AllExceptionsFilter())
  ```

  Run the FULL server suite now, not just this task's own test — every existing e2e test (`session.e2e.test.ts`, `catalog.e2e.test.ts`, `auth.e2e.test.ts`) posts or reads JSON through the app, and this task just replaced the thing that parses it app-wide.

  Run: `pnpm --filter @pp/server test`
  Expected: ALL existing suites still PASS, plus this task's three new cases.

- [ ] **Step 6: Gates**

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

  Do NOT run `git add` and do NOT commit.

---

### Task 3: The global validation pipe and `FailedWriteCaptureFilter` — registered together, in this one task

**This is the non-negotiable ordering spec §7 names.** The predecessor app lost answers because a global validation gate threw before any controller ran, with nothing catching what it discarded. This repository's version of that gate is `ZodBodyValidationPipe`, built here; the moment it exists, `FailedWriteCaptureFilter` must exist and be registered in the same commit, or this task recreates exactly the failure mode spec §7 documents. Do not split this into two tasks.

**Files:**

- Create: `packages/server/src/validation/zod-body-validation.pipe.ts`
- Create: `packages/server/src/durability/failed-write-capture.filter.ts`
- Create: `packages/server/test/failed-write-capture.e2e.test.ts`
- Modify: `packages/server/src/main.ts`
- Modify: `packages/server/test/helpers/app.ts`

**Interfaces:**

- Consumes: `PayloadTooLargeSignal`, `UnparseableBodySignal`, `CapturedRequest` (Task 2); `insertFailedWrite` (Task 1); `REQUEST_POOL`, `CLOCK` (plan 2's `database/tokens.ts`).
- Produces: `ZodBodyValidationPipe`, `CapturableBadRequestException`, `FailedWriteCaptureFilter`. Tasks 5 and 6 build their DTOs against `CapturableBadRequestException` and rely on this filter being globally registered.

- [ ] **Step 1: Verify Nest's multi-filter selection order before writing the filter**

  This is the one piece of framework behaviour this task depends on that is not obvious from the types, so it was verified against the installed package rather than assumed. `@nestjs/core`'s `ExceptionsHandler.invokeCustomFilters` picks a filter via `@nestjs/common`'s `selectExceptionFilterMetadata`:

  ```js
  const selectExceptionFilterMetadata = (filters, exception) =>
    filters.find(
      ({ exceptionMetatypes }) =>
        !exceptionMetatypes.length ||
        exceptionMetatypes.some(
          (ExceptionMetaType) => exception instanceof ExceptionMetaType,
        ),
    )
  ```

  (`node_modules/@nestjs/common/utils/select-exception-filter-metadata.util.js` under the installed `@nestjs+common@11.2.1` package.) It is `Array.prototype.find` over the filters **in the order passed to `useGlobalFilters`**, and a filter with `@Catch()` (no arguments) has an empty `exceptionMetatypes` array, which matches **unconditionally**. `AllExceptionsFilter` from `@liam-public/node-nest-common` is declared `@Catch()`. So if `AllExceptionsFilter` is registered before `FailedWriteCaptureFilter`, it wins every exception, including the ones this task's filter exists to catch — `FailedWriteCaptureFilter` must be registered **first** in the array.

- [ ] **Step 2: Write the failing pipe/filter test against a probe route**

  `packages/server/test/failed-write-capture.e2e.test.ts`:

  ```ts
  import { Body, Controller, Module, Post } from "@nestjs/common"
  import { Test } from "@nestjs/testing"
  import type { INestApplication } from "@nestjs/common"
  import { AllExceptionsFilter } from "@liam-public/node-nest-common"
  import { z } from "zod"
  import { afterAll, beforeAll, describe, expect, it } from "vitest"
  import { createFixedClock } from "@pp/common"
  import { createRawBodyJsonMiddleware } from "../src/http/raw-body-json.middleware.js"
  import { FailedWriteCaptureFilter } from "../src/durability/failed-write-capture.filter.js"
  import { ZodBodyValidationPipe } from "../src/validation/zod-body-validation.pipe.js"
  import { REQUEST_POOL, CLOCK } from "../src/database/tokens.js"
  import { DatabaseModule } from "../src/database/database.module.js"
  import { inject } from "vitest"
  import { migrateToLatest } from "@pp/db"
  import type { PgPool } from "@liam-public/node-postgres"

  const NOW = new Date("2026-08-27T10:00:00.000Z")
  const MAX_BYTES = 64

  const ProbeSchema = z.strictObject({ clientInstanceId: z.string().min(1) })

  class ProbeDto implements z.infer<typeof ProbeSchema> {
    static readonly schema = ProbeSchema
    declare clientInstanceId: string
  }

  @Controller("probe")
  class ProbeController {
    @Post()
    accept(@Body() body: ProbeDto): { received: string } {
      return { received: body.clientInstanceId }
    }
  }

  @Module({ controllers: [ProbeController] })
  class ProbeModule {}

  describe("FailedWriteCaptureFilter + ZodBodyValidationPipe", () => {
    let app: INestApplication
    let url: string
    let pool: PgPool

    beforeAll(async () => {
      process.env.DATABASE_URL = inject("postgresConnectionUri")
      await migrateToLatest(process.env.DATABASE_URL)

      const moduleRef = await Test.createTestingModule({
        imports: [DatabaseModule, ProbeModule],
      })
        .overrideProvider(CLOCK)
        .useValue(createFixedClock(NOW))
        .compile()

      app = moduleRef.createNestApplication(undefined, { bodyParser: false })
      app.use(createRawBodyJsonMiddleware(MAX_BYTES))
      app.useGlobalPipes(new ZodBodyValidationPipe())
      app.useGlobalFilters(
        new FailedWriteCaptureFilter(
          moduleRef.get(REQUEST_POOL),
          moduleRef.get(CLOCK),
        ),
        new AllExceptionsFilter(),
      )
      pool = moduleRef.get(REQUEST_POOL)
      await app.listen(0)
      const address = app.getHttpServer().address()
      url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : ""}`
    })

    afterAll(async () => {
      await app.close()
    })

    it("admits a body the schema accepts", async () => {
      const res = await fetch(`${url}/probe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientInstanceId: "c1" }),
      })
      expect(res.status).toBe(201)
    })

    it("captures a schema-rejected body verbatim BEFORE the 400 returns, and names the capture", async () => {
      const badBody = JSON.stringify({})
      const res = await fetch(`${url}/probe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: badBody,
      })

      expect(res.status).toBe(400)
      const problem = (await res.json()) as {
        capturedAs: string
        retryable: boolean
      }
      expect(problem.retryable).toBe(false)
      expect(typeof problem.capturedAs).toBe("string")

      const { rows } = await pool.query<{
        raw_body: string
        received_at: Date
        route: string
      }>(
        "SELECT raw_body, received_at, route FROM failed_write WHERE id = $1",
        [problem.capturedAs],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].raw_body).toBe(badBody)
      expect(rows[0].received_at).toEqual(NOW)
      expect(rows[0].route).toContain("/probe")
    })

    it("falls back to raw bytes for an oversized body that was never parsed", async () => {
      const oversized = "x".repeat(MAX_BYTES * 4)
      const res = await fetch(`${url}/probe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: oversized,
      })

      expect(res.status).toBe(413)
      const problem = (await res.json()) as { capturedAs: string }

      const { rows } = await pool.query<{ raw_body: string; reason: string }>(
        "SELECT raw_body, reason FROM failed_write WHERE id = $1",
        [problem.capturedAs],
      )
      expect(rows).toHaveLength(1)
      // Truncated to the capture cap, but non-empty -- proof the fallback
      // used the streamed bytes, not `req.body` (which never existed).
      expect(rows[0].raw_body.length).toBeGreaterThan(0)
      expect(rows[0].raw_body.length).toBeLessThanOrEqual(MAX_BYTES)
      expect(rows[0].reason).toBe("payload_too_large")
    })
  })
  ```

- [ ] **Step 3: Run it to verify it fails**

  Run: `pnpm --filter @pp/server test failed-write-capture`
  Expected: FAIL — neither module exists yet.

- [ ] **Step 4: The Zod DTO pattern and the pipe**

  `packages/server/src/validation/zod-body-validation.pipe.ts`:

  ```ts
  import type { ArgumentMetadata, PipeTransform } from "@nestjs/common"
  import { Injectable } from "@nestjs/common"
  import type { ZodType } from "zod"

  /**
   * Thrown by anything on the write path that rejects a whole request body --
   * this pipe on schema failure, and Task 6's flush service on `mixed_sections`
   * / `empty_batch`. One type so FailedWriteCaptureFilter has one thing to
   * catch rather than a growing union.
   */
  export class CapturableBadRequestException extends Error {
    constructor(
      public readonly reason: string,
      public readonly detail: string,
    ) {
      super(reason)
    }
  }

  interface ZodDtoMetatype {
    schema?: ZodType
  }

  /**
   * This repository's validation library is Zod (already `@pp/server`'s
   * dependency), not class-validator. A DTO class exposes a static `schema`
   * so Nest's constructor-parameter reflection (`design:paramtypes`) still
   * tells this pipe WHICH schema applies to a given @Body() parameter --
   * the same mechanism the built-in ValidationPipe uses, aimed at Zod
   * instead. Registered globally via app.useGlobalPipes, so it runs before
   * every controller handler, which is the hazard spec S7 names.
   */
  @Injectable()
  export class ZodBodyValidationPipe implements PipeTransform {
    transform(value: unknown, metadata: ArgumentMetadata): unknown {
      if (metadata.type !== "body") {
        return value
      }

      const metatype = metadata.metatype as ZodDtoMetatype | undefined
      const schema = metatype?.schema

      if (!schema) {
        return value
      }

      const result = schema.safeParse(value)

      if (!result.success) {
        const issues = result.error.issues
        const reason =
          issues.length === 1 && issues[0].message === "empty_batch"
            ? "empty_batch"
            : "invalid_body"
        throw new CapturableBadRequestException(reason, JSON.stringify(issues))
      }

      return result.data
    }
  }
  ```

  A DTO class following this pattern (used by the probe test above, and by Tasks 5–6):

  ```ts
  export class ProbeDto implements z.infer<typeof ProbeSchema> {
    static readonly schema = ProbeSchema
    declare clientInstanceId: string
  }
  ```

  The `declare` fields carry no runtime code — they exist only so the class's TYPE matches what the schema infers, while the class VALUE carries the `schema` static the pipe reads via reflection. Tasks 5 and 6 follow this exact shape for their own DTOs.

- [ ] **Step 5: The filter**

  `packages/server/src/durability/failed-write-capture.filter.ts`:

  ```ts
  import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common"
  import { Catch, Inject } from "@nestjs/common"
  import type { PgPool } from "@liam-public/node-postgres"
  import type { Clock } from "@pp/common"
  import { insertFailedWrite } from "@pp/db"
  import type { Response } from "express"
  import { REQUEST_POOL, CLOCK } from "../database/tokens.js"
  import {
    PayloadTooLargeSignal,
    UnparseableBodySignal,
    type CapturedRequest,
  } from "../http/raw-body-json.middleware.js"
  import { CapturableBadRequestException } from "../validation/zod-body-validation.pipe.js"

  type CaughtException =
    | PayloadTooLargeSignal
    | UnparseableBodySignal
    | CapturableBadRequestException

  /**
   * Registered BEFORE AllExceptionsFilter in main.ts's useGlobalFilters call
   * -- Nest picks the first filter in that array whose @Catch() list matches
   * (or is empty), and AllExceptionsFilter's is empty, so it would win every
   * exception if it came first. See Task 3 Step 1 for the verified source.
   *
   * Persists the request's raw bytes as a failed_write BEFORE the error
   * response is written -- the mechanism spec S5 rule 4 requires, and the one
   * missing from the predecessor app that lost the answers.
   */
  @Catch(
    PayloadTooLargeSignal,
    UnparseableBodySignal,
    CapturableBadRequestException,
  )
  export class FailedWriteCaptureFilter implements ExceptionFilter {
    constructor(
      @Inject(REQUEST_POOL) private readonly pool: PgPool,
      @Inject(CLOCK) private readonly clock: Clock,
    ) {}

    async catch(
      exception: CaughtException,
      host: ArgumentsHost,
    ): Promise<void> {
      const ctx = host.switchToHttp()
      const req = ctx.getRequest<
        CapturedRequest & { params: Record<string, string> }
      >()
      const res = ctx.getResponse<Response>()

      const isOversized = exception instanceof PayloadTooLargeSignal
      const isUnparseable = exception instanceof UnparseableBodySignal

      // The parsed body never existed for either failure mode below -- fall
      // back to the raw bytes the middleware captured on the request. Only a
      // schema-rejection (body parsed fine, Zod refused its shape) has a
      // meaningful req.body to fall back on, and even then req.rawBody is the
      // exact bytes the client sent, so prefer it whenever it is present.
      const rawBody =
        req.rawBody !== undefined
          ? req.rawBody.toString("utf8")
          : JSON.stringify(req.body ?? {})

      const reason = isOversized
        ? "payload_too_large"
        : isUnparseable
          ? "unparseable_body"
          : exception.reason

      const captured = await insertFailedWrite(this.pool, {
        attemptId: typeof req.params.id === "string" ? req.params.id : null,
        route: `${req.method} ${req.originalUrl}`,
        reason,
        rawBody,
        byteSize: req.rawBodyByteCount ?? null,
        clientVersion:
          typeof req.headers["x-client-version"] === "string"
            ? req.headers["x-client-version"]
            : null,
        clientInstanceId: null,
        now: this.clock.now(),
      })

      const status = isOversized ? 413 : 400

      res.status(status).json({
        type: isOversized ? "payload_too_large" : reason,
        title: isOversized
          ? "Payload too large"
          : "The request body could not be applied",
        status,
        retryable: false,
        capturedAs: captured.id,
      })
    }
  }
  ```

  `REQUEST_POOL`, not `JOB_POOL`: this runs on the interactive request path (a failed HTTP request, right now), which is exactly what the request pool's short timeouts exist for — `JOB_POOL` is for import/seed/rescore, unrelated work this filter has no reason to share deadlines with.

- [ ] **Step 6: Wire both globally, in the SAME commit, filter first**

  `packages/server/src/main.ts`:

  ```ts
  app.useGlobalPipes(new ZodBodyValidationPipe())
  app.useGlobalFilters(
    new FailedWriteCaptureFilter(app.get(REQUEST_POOL), app.get(CLOCK)),
    new AllExceptionsFilter(),
  )
  ```

  placed after `app.use(createRawBodyJsonMiddleware(...))` and before `app.listen(...)`. `packages/server/test/helpers/app.ts` gets the identical three lines (pipe, then the two filters in that order) so the harness's pipeline matches production.

  Run: `pnpm --filter @pp/server test`
  Expected: ALL suites PASS, including this task's three new cases and the full pre-existing suite (the global pipe now runs on every route — nothing else in the app currently declares a Zod DTO, so `metatype?.schema` is `undefined` everywhere else and the pipe is a no-op for them; if any existing test fails here, that route's body shape does not match what its own tests assumed, which the plan-authoring guide's rule 4 exists to catch — read the failure, do not silence it).

- [ ] **Step 7: Gates**

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

  Do NOT run `git add` and do NOT commit.

---

### Task 4: The reorder guard — `response` and `response_client_cursor`

Spec §5 Ordering: writes ordered by `(clientInstanceId, seq)`, never `answeredAt`; the server applies a write when `seq` exceeds the stored `seq` for the SAME instance, falling back to arrival order across instances. `response_client_cursor` holds every device's high-water mark. This task is the mechanical realization of that rule, isolated from any HTTP concern so it can be tested directly against Postgres.

**Files:**

- Create: `packages/db/src/repositories/response.repository.ts`
- Create: `packages/db/test/response-repository.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**

- Consumes: `withTransaction` (`@liam-public/node-postgres`); the `Fixture` returned by `packages/db/test/helpers/fixtures.ts`'s `seedPublishedTest` (`q1` in the listening section, `allowAnswerChange: false`; `q2` in reading, `allowAnswerChange: true`; `choiceIds = [c1(q1,correct), c2(q1), c3(q2,correct), c4(q2)]`).
- Produces:

  ```ts
  export type WriteOutcome =
    | { kind: "applied" }
    | { kind: "ignored_stale" }
    | {
        kind: "rejected"
        reason: "answer_change_not_allowed" | "unknown_question"
      }

  export async function writeResponse(
    pool: PgPool,
    input: {
      attemptId: string
      questionId: string
      testVersionId: string
      clientInstanceId: string
      seq: number
      selectedChoiceIds: string[]
      answeredAt: Date | null
      timeSpentMs: number | null
      allowAnswerChange: boolean
      now: Date
    },
  ): Promise<WriteOutcome>

  export async function loadResponse(
    pool: PgQueryable,
    input: { attemptId: string; questionId: string },
  ): Promise<{
    selectedChoiceIds: string[]
    clientInstanceId: string
    seq: number
  } | null>
  ```

  Tasks 5 and 6 call `writeResponse` per item; `loadResponse` is a test/verification helper and is also usable by the runner payload (out of this plan's scope).

- [ ] **Step 1: Write the failing tests — the reorder guard is the point, test it directly**

  `packages/db/test/response-repository.test.ts`:

  ```ts
  import { randomUUID } from "node:crypto"
  import type pg from "pg"
  import { describe, expect, it } from "vitest"
  import {
    loadResponse,
    writeResponse,
  } from "../src/repositories/response.repository.js"
  import { withDatabase } from "./helpers/database.js"
  import { seedPublishedTest, type Fixture } from "./helpers/fixtures.js"

  const NOW = new Date("2026-08-27T09:00:00.000Z")

  async function insertAttempt(
    pool: pg.Pool,
    fixture: Fixture,
  ): Promise<string> {
    const attemptId = randomUUID()
    await pool.query(
      `INSERT INTO attempt (id, student_id, test_version_id, status)
       VALUES ($1, $2, $3, 'in_progress')`,
      [attemptId, fixture.studentId, fixture.versionId],
    )
    return attemptId
  }

  function baseInput(
    fixture: Fixture,
    attemptId: string,
    questionIndex: 0 | 1,
  ) {
    return {
      attemptId,
      questionId: fixture.questionIds[questionIndex],
      testVersionId: fixture.versionId,
      answeredAt: NOW,
      timeSpentMs: 500,
      now: NOW,
    }
  }

  describe("response repository -- reorder guard", () => {
    it("applies the first write from an instance regardless of its seq value", async () => {
      await withDatabase(async (pool) => {
        const fixture = await seedPublishedTest(pool)
        const attemptId = await insertAttempt(pool, fixture)

        const outcome = await writeResponse(pool, {
          ...baseInput(fixture, attemptId, 1),
          clientInstanceId: "device-a",
          seq: 5,
          selectedChoiceIds: [fixture.choiceIds[2]],
          allowAnswerChange: true,
        })

        expect(outcome).toEqual({ kind: "applied" })
        const recorded = await loadResponse(pool, {
          attemptId,
          questionId: fixture.questionIds[1],
        })
        expect(recorded?.selectedChoiceIds).toEqual([fixture.choiceIds[2]])
        expect(recorded?.seq).toBe(5)
      })
    }, 120_000)

    it("DISCARDS a real lower seq from the same instance as stale", async () => {
      await withDatabase(async (pool) => {
        const fixture = await seedPublishedTest(pool)
        const attemptId = await insertAttempt(pool, fixture)
        const input = baseInput(fixture, attemptId, 1)

        await writeResponse(pool, {
          ...input,
          clientInstanceId: "device-a",
          seq: 10,
          selectedChoiceIds: [fixture.choiceIds[2]],
          allowAnswerChange: true,
        })

        const stale = await writeResponse(pool, {
          ...input,
          clientInstanceId: "device-a",
          seq: 3,
          selectedChoiceIds: [fixture.choiceIds[3]],
          allowAnswerChange: true,
        })

        expect(stale).toEqual({ kind: "ignored_stale" })
        const recorded = await loadResponse(pool, {
          attemptId,
          questionId: fixture.questionIds[1],
        })
        // The stale write's content never landed -- seq 10's selection stands.
        expect(recorded?.selectedChoiceIds).toEqual([fixture.choiceIds[2]])
        expect(recorded?.seq).toBe(10)
      })
    }, 120_000)

    it("applies a higher seq from the same instance after an earlier one", async () => {
      await withDatabase(async (pool) => {
        const fixture = await seedPublishedTest(pool)
        const attemptId = await insertAttempt(pool, fixture)
        const input = baseInput(fixture, attemptId, 1)

        await writeResponse(pool, {
          ...input,
          clientInstanceId: "device-a",
          seq: 1,
          selectedChoiceIds: [fixture.choiceIds[2]],
          allowAnswerChange: true,
        })
        const outcome = await writeResponse(pool, {
          ...input,
          clientInstanceId: "device-a",
          seq: 2,
          selectedChoiceIds: [fixture.choiceIds[3]],
          allowAnswerChange: true,
        })

        expect(outcome).toEqual({ kind: "applied" })
        const recorded = await loadResponse(pool, {
          attemptId,
          questionId: fixture.questionIds[1],
        })
        expect(recorded?.selectedChoiceIds).toEqual([fixture.choiceIds[3]])
      })
    }, 120_000)

    it("judges a different clientInstanceId by its OWN cursor, independent of another instance's seq", async () => {
      await withDatabase(async (pool) => {
        const fixture = await seedPublishedTest(pool)
        const attemptId = await insertAttempt(pool, fixture)
        const input = baseInput(fixture, attemptId, 1)

        // device-a races ahead to a high seq.
        await writeResponse(pool, {
          ...input,
          clientInstanceId: "device-a",
          seq: 900,
          selectedChoiceIds: [fixture.choiceIds[2]],
          allowAnswerChange: true,
        })

        // device-b's first write ever, seq 1 -- numerically far below
        // device-a's 900, but device-b has no cursor of its own yet, so this
        // is accepted: arrival order across instances, not a shared seq space.
        const outcome = await writeResponse(pool, {
          ...input,
          clientInstanceId: "device-b",
          seq: 1,
          selectedChoiceIds: [fixture.choiceIds[3]],
          allowAnswerChange: true,
        })

        expect(outcome).toEqual({ kind: "applied" })
        const recorded = await loadResponse(pool, {
          attemptId,
          questionId: fixture.questionIds[1],
        })
        // Last writer wins across instances -- device-b's write is now the
        // winning row, even though its seq is lower than device-a's.
        expect(recorded?.clientInstanceId).toBe("device-b")
        expect(recorded?.selectedChoiceIds).toEqual([fixture.choiceIds[3]])

        // But device-a's OWN cursor remembers 900: a queued retry of
        // device-a's seq 900 write, arriving late, is still judged stale for
        // device-a's instance even though device-b has since taken over.
        const staleRetry = await writeResponse(pool, {
          ...input,
          clientInstanceId: "device-a",
          seq: 900,
          selectedChoiceIds: [fixture.choiceIds[2]],
          allowAnswerChange: true,
        })
        expect(staleRetry).toEqual({ kind: "ignored_stale" })
      })
    }, 120_000)

    it("treats an identical re-send under allowAnswerChange:false as an idempotent no-op", async () => {
      await withDatabase(async (pool) => {
        const fixture = await seedPublishedTest(pool)
        const attemptId = await insertAttempt(pool, fixture)
        // q1 is the LISTENING question -- allowAnswerChange: false in the fixture.
        const input = baseInput(fixture, attemptId, 0)

        await writeResponse(pool, {
          ...input,
          clientInstanceId: "device-a",
          seq: 1,
          selectedChoiceIds: [fixture.choiceIds[0]],
          allowAnswerChange: false,
        })

        // A network retry re-sends the SAME content at a higher seq (the
        // client's own retry logic incremented seq before resending).
        const retry = await writeResponse(pool, {
          ...input,
          clientInstanceId: "device-a",
          seq: 2,
          selectedChoiceIds: [fixture.choiceIds[0]],
          allowAnswerChange: false,
        })

        expect(retry).toEqual({ kind: "applied" })
      })
    }, 120_000)

    it("rejects a content-CHANGING re-send under allowAnswerChange:false", async () => {
      await withDatabase(async (pool) => {
        const fixture = await seedPublishedTest(pool)
        const attemptId = await insertAttempt(pool, fixture)
        const input = baseInput(fixture, attemptId, 0)

        await writeResponse(pool, {
          ...input,
          clientInstanceId: "device-a",
          seq: 1,
          selectedChoiceIds: [fixture.choiceIds[0]],
          allowAnswerChange: false,
        })

        const changed = await writeResponse(pool, {
          ...input,
          clientInstanceId: "device-a",
          seq: 2,
          selectedChoiceIds: [fixture.choiceIds[1]],
          allowAnswerChange: false,
        })

        expect(changed).toEqual({
          kind: "rejected",
          reason: "answer_change_not_allowed",
        })
        // The rejected content never landed -- the original selection stands.
        const recorded = await loadResponse(pool, {
          attemptId,
          questionId: fixture.questionIds[0],
        })
        expect(recorded?.selectedChoiceIds).toEqual([fixture.choiceIds[0]])
      })
    }, 120_000)

    it("rejects an unknown question without throwing", async () => {
      await withDatabase(async (pool) => {
        const fixture = await seedPublishedTest(pool)
        const attemptId = await insertAttempt(pool, fixture)

        const outcome = await writeResponse(pool, {
          attemptId,
          questionId: randomUUID(),
          testVersionId: fixture.versionId,
          clientInstanceId: "device-a",
          seq: 1,
          selectedChoiceIds: [],
          answeredAt: NOW,
          timeSpentMs: null,
          allowAnswerChange: true,
          now: NOW,
        })

        expect(outcome).toEqual({
          kind: "rejected",
          reason: "unknown_question",
        })
      })
    }, 120_000)

    it("an empty selectedChoiceIds clears the answer rather than being rejected as malformed", async () => {
      await withDatabase(async (pool) => {
        const fixture = await seedPublishedTest(pool)
        const attemptId = await insertAttempt(pool, fixture)
        const input = baseInput(fixture, attemptId, 1)

        await writeResponse(pool, {
          ...input,
          clientInstanceId: "device-a",
          seq: 1,
          selectedChoiceIds: [fixture.choiceIds[2]],
          allowAnswerChange: true,
        })
        const cleared = await writeResponse(pool, {
          ...input,
          clientInstanceId: "device-a",
          seq: 2,
          selectedChoiceIds: [],
          allowAnswerChange: true,
        })

        expect(cleared).toEqual({ kind: "applied" })
        const recorded = await loadResponse(pool, {
          attemptId,
          questionId: fixture.questionIds[1],
        })
        expect(recorded?.selectedChoiceIds).toEqual([])
      })
    }, 120_000)
  })
  ```

- [ ] **Step 2: Run to verify it fails**

  Run: `pnpm --filter @pp/db test response-repository`
  Expected: FAIL — module not found.

- [ ] **Step 3: Implement the repository**

  `packages/db/src/repositories/response.repository.ts`:

  ```ts
  import { withTransaction } from "@liam-public/node-postgres"
  import type { PgPool, PgQueryable } from "@liam-public/node-postgres"

  export type WriteOutcome =
    | { kind: "applied" }
    | { kind: "ignored_stale" }
    | {
        kind: "rejected"
        reason: "answer_change_not_allowed" | "unknown_question"
      }

  function isForeignKeyViolation(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "23503"
    )
  }

  function sameSelection(a: string[], b: string[]): boolean {
    if (a.length !== b.length) {
      return false
    }
    const sortedA = [...a].sort()
    const sortedB = [...b].sort()
    return sortedA.every((id, index) => id === sortedB[index])
  }

  /**
   * The reorder guard. Ordering is by (clientInstanceId, seq), never
   * answeredAt: response_client_cursor holds THIS instance's high-water mark,
   * and a write is applied only when its seq exceeds that mark. A different
   * instance's write is judged by ITS OWN cursor row -- there is no shared
   * seq space across devices, only arrival order, which is what "last write
   * inside this transaction wins the `response` row" gives for free.
   *
   * allowAnswerChange is resolved by the caller (the section it belongs to),
   * not looked up here -- this repository is ordering/durability mechanics
   * only, not section business rules.
   */
  export async function writeResponse(
    pool: PgPool,
    input: {
      attemptId: string
      questionId: string
      testVersionId: string
      clientInstanceId: string
      seq: number
      selectedChoiceIds: string[]
      answeredAt: Date | null
      timeSpentMs: number | null
      allowAnswerChange: boolean
      now: Date
    },
  ): Promise<WriteOutcome> {
    try {
      return await withTransaction(pool, async (tx) => {
        // Ensure the response row exists so response_client_cursor's FK can
        // reference it. A no-op if a prior write (from any instance) already
        // created it -- the row is never deleted, even on a clear.
        await tx.query(
          `INSERT INTO response
             (attempt_id, question_id, test_version_id, client_instance_id, client_seq)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (attempt_id, question_id) DO NOTHING`,
          [
            input.attemptId,
            input.questionId,
            input.testVersionId,
            input.clientInstanceId,
            input.seq,
          ],
        )

        // The guard itself: advance THIS instance's cursor only if seq
        // increased. Returns a row when accepted, zero rows when stale.
        const cursor = await tx.query(
          `INSERT INTO response_client_cursor
             (attempt_id, question_id, client_instance_id, last_seq)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (attempt_id, question_id, client_instance_id) DO UPDATE
              SET last_seq = EXCLUDED.last_seq, updated_at = now()
            WHERE response_client_cursor.last_seq < EXCLUDED.last_seq
           RETURNING last_seq`,
          [
            input.attemptId,
            input.questionId,
            input.clientInstanceId,
            input.seq,
          ],
        )

        if (cursor.rows.length === 0) {
          return { kind: "ignored_stale" }
        }

        const existing = await tx.query<{ choice_id: string }>(
          `SELECT choice_id FROM response_choice WHERE attempt_id = $1 AND question_id = $2`,
          [input.attemptId, input.questionId],
        )
        const existingIds = existing.rows.map((row) => row.choice_id)
        const hasExistingAnswer = existingIds.length > 0
        const identical = sameSelection(existingIds, input.selectedChoiceIds)

        if (!input.allowAnswerChange && hasExistingAnswer && !identical) {
          return { kind: "rejected", reason: "answer_change_not_allowed" }
        }

        await tx.query(
          `UPDATE response
              SET client_instance_id = $3, client_seq = $4,
                  answered_at = $5, time_spent_ms = $6, updated_at = now()
            WHERE attempt_id = $1 AND question_id = $2`,
          [
            input.attemptId,
            input.questionId,
            input.clientInstanceId,
            input.seq,
            input.answeredAt,
            input.timeSpentMs,
          ],
        )
        await tx.query(
          `DELETE FROM response_choice WHERE attempt_id = $1 AND question_id = $2`,
          [input.attemptId, input.questionId],
        )
        for (const choiceId of input.selectedChoiceIds) {
          await tx.query(
            `INSERT INTO response_choice (attempt_id, question_id, choice_id)
             VALUES ($1, $2, $3)`,
            [input.attemptId, input.questionId, choiceId],
          )
        }

        return { kind: "applied" }
      })
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        return { kind: "rejected", reason: "unknown_question" }
      }
      throw error
    }
  }

  export async function loadResponse(
    pool: PgQueryable,
    input: { attemptId: string; questionId: string },
  ): Promise<{
    selectedChoiceIds: string[]
    clientInstanceId: string
    seq: number
  } | null> {
    const response = await pool.query<{
      client_instance_id: string
      client_seq: number
    }>(
      `SELECT client_instance_id, client_seq FROM response
        WHERE attempt_id = $1 AND question_id = $2`,
      [input.attemptId, input.questionId],
    )

    if (response.rows.length === 0) {
      return null
    }

    const choices = await pool.query<{ choice_id: string }>(
      `SELECT choice_id FROM response_choice
        WHERE attempt_id = $1 AND question_id = $2
        ORDER BY choice_id`,
      [input.attemptId, input.questionId],
    )

    return {
      clientInstanceId: response.rows[0].client_instance_id,
      seq: response.rows[0].client_seq,
      selectedChoiceIds: choices.rows.map((row) => row.choice_id),
    }
  }
  ```

- [ ] **Step 4: Run to verify it passes**

  Run: `pnpm --filter @pp/db test response-repository`
  Expected: PASS, all eight cases.

- [ ] **Step 5: Export and re-run the full db suite**

  Add `writeResponse`, `loadResponse` and `type WriteOutcome` to `packages/db/src/index.ts` (same merged-import shape as Task 1).

  Run: `pnpm --filter @pp/db test`

- [ ] **Step 6: Gates**

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

  Do NOT run `git add` and do NOT commit.

---

### Task 5: `PUT /attempts/{id}/responses/{questionId}` — the single-item write

Full replacement of one question's answer. Written to the client's device queue before the request is attempted (Task 8) and cleared only on this response's per-item ack — this endpoint is that ack's source.

Note on paths: `packages/server/src/main.ts` and `test/helpers/app.ts` now call `app.setGlobalPrefix("api", { exclude: ["health"] })` (added while this plan was being written — `openapi.yaml`'s `servers: [{ url: /api }]` is real, not aspirational). Controllers below declare their routes WITHOUT the prefix (`@Controller("attempts/:id/responses")`) — Nest applies it automatically — but every e2e test in this plan that goes through `createTestApp()` sends requests to `/api/attempts/...`, not `/attempts/...`. This task's and Task 6's test bodies already reflect that; Task 2's and Task 3's probe-route tests do not, because those build a standalone Nest app that never imports `AppModule` and so never gets the prefix.

**Files:**

- Create: `packages/server/src/responses/single-response.controller.ts`
- Create: `packages/server/src/responses/response-write.service.ts`
- Create: `packages/server/src/responses/responses.module.ts`
- Create: `packages/server/src/responses/dto.ts`
- Create: `packages/server/test/single-response.e2e.test.ts`
- Modify: `packages/server/src/app.module.ts`

**Interfaces:**

- Consumes: `writeResponse` (Task 4); `JwksGuard`, `CurrentStudent` (plan 2's `auth/*`); `REQUEST_POOL`, `CLOCK` (plan 2's `database/tokens.ts`); `ZodBodyValidationPipe`'s DTO pattern (Task 3); `findStudentBySubject` (plan 2, `@pp/db`).
- Produces: `ResponseWriteService.assertOwnsAttempt(pool, attemptId, studentId): Promise<{ testVersionId: string }>` — Task 6 reuses this same check rather than writing a second one; `SingleResponseWriteDto`.

- [ ] **Step 1: The DTO**

  `packages/server/src/responses/dto.ts`:

  ```ts
  import { z } from "zod"

  export const SingleResponseWriteSchema = z.strictObject({
    clientInstanceId: z.string().min(1),
    seq: z.number().int().nonnegative(),
    selectedChoiceIds: z.array(z.string()),
    answeredAt: z.string().datetime().optional(),
    timeSpentMs: z.number().int().nonnegative().optional(),
  })

  export class SingleResponseWriteDto implements z.infer<
    typeof SingleResponseWriteSchema
  > {
    static readonly schema = SingleResponseWriteSchema
    declare clientInstanceId: string
    declare seq: number
    declare selectedChoiceIds: string[]
    declare answeredAt?: string
    declare timeSpentMs?: number
  }

  export const ResponseSnapshotItemSchema = z.strictObject({
    questionId: z.string().min(1),
    seq: z.number().int().nonnegative(),
    selectedChoiceIds: z.array(z.string()),
    answeredAt: z.string().datetime().optional(),
    timeSpentMs: z.number().int().nonnegative().optional(),
  })

  export const ResponseSnapshotSchema = z.strictObject({
    clientInstanceId: z.string().min(1),
    responses: z.array(ResponseSnapshotItemSchema).min(1, "empty_batch"),
  })

  export class ResponseSnapshotDto implements z.infer<
    typeof ResponseSnapshotSchema
  > {
    static readonly schema = ResponseSnapshotSchema
    declare clientInstanceId: string
    declare responses: z.infer<typeof ResponseSnapshotItemSchema>[]
  }
  ```

  `.min(1, "empty_batch")` is what lets `ZodBodyValidationPipe` (Task 3) recognise an empty `responses` array and surface `reason: "empty_batch"` rather than the generic `invalid_body` — it is the pipe's `issues[0].message === "empty_batch"` check reading this exact string back.

- [ ] **Step 2: The shared ownership/service groundwork**

  `packages/server/src/responses/response-write.service.ts`:

  ```ts
  import type { PgPool } from "@liam-public/node-postgres"
  import {
    ForbiddenException,
    Inject,
    Injectable,
    NotFoundException,
  } from "@nestjs/common"
  import { findStudentBySubject } from "@pp/db"
  import { REQUEST_POOL } from "../database/tokens.js"

  export interface AttemptOwnership {
    testVersionId: string
  }

  @Injectable()
  export class ResponseWriteService {
    constructor(@Inject(REQUEST_POOL) private readonly pool: PgPool) {}

    /**
     * Resolves the caller's student row and confirms the attempt belongs to
     * them, in one place -- both write routes (Tasks 5 and 6) need this
     * identical check and must not diverge on it.
     */
    async assertOwnsAttempt(
      subjectClaim: string,
      attemptId: string,
    ): Promise<AttemptOwnership> {
      const student = await findStudentBySubject(this.pool, subjectClaim)
      if (!student) {
        throw new NotFoundException("student_not_provisioned")
      }

      const { rows } = await this.pool.query<{
        student_id: string
        test_version_id: string
      }>(`SELECT student_id, test_version_id FROM attempt WHERE id = $1`, [
        attemptId,
      ])

      if (rows.length === 0) {
        throw new NotFoundException("attempt_not_found")
      }
      if (rows[0].student_id !== student.id) {
        throw new ForbiddenException("not_your_attempt")
      }

      return { testVersionId: rows[0].test_version_id }
    }
  }
  ```

- [ ] **Step 3: Write the failing e2e test**

  `packages/server/test/single-response.e2e.test.ts`. Seeds its own fixture directly against the request pool (the same pattern `packages/db/test/helpers/fixtures.ts` uses, reused here because the server package cannot import a `@pp/db` test helper — it is not part of `@pp/db`'s published surface).

  ```ts
  import { randomUUID } from "node:crypto"
  import type { PgPool } from "@liam-public/node-postgres"
  import { afterAll, beforeAll, describe, expect, it } from "vitest"
  import { createTestApp, type TestApp } from "./helpers/app.js"
  import { REQUEST_POOL } from "../src/database/tokens.js"

  interface Fixture {
    studentId: string
    attemptId: string
    listeningQuestionId: string
    readingQuestionId: string
    choiceIds: string[]
  }

  async function seedAttempt(
    pool: PgPool,
    subjectClaim: string,
  ): Promise<Fixture> {
    const studentId = randomUUID()
    const testId = randomUUID()
    const versionId = randomUUID()
    const listeningSectionId = randomUUID()
    const readingSectionId = randomUUID()
    const groupL = randomUUID()
    const groupR = randomUUID()
    const q1 = randomUUID()
    const q2 = randomUUID()
    const c1 = randomUUID()
    const c2 = randomUUID()
    const c3 = randomUUID()
    const c4 = randomUUID()
    const attemptId = randomUUID()

    await pool.query(
      `INSERT INTO student (id, subject_claim, email, display_name) VALUES ($1,$2,'s@example.com','S')`,
      [studentId, subjectClaim],
    )
    await pool.query(
      `INSERT INTO test (id, slug) VALUES ($1,'t-single-response')`,
      [testId],
    )
    await pool.query(
      `INSERT INTO test_version (id, test_id, version, title, duration_seconds) VALUES ($1,$2,1,'T',3000)`,
      [versionId, testId],
    )
    await pool.query(
      `INSERT INTO test_section (id, test_version_id, ordinal, title, type, duration_seconds, navigation, allow_answer_change)
       VALUES ($1,$3,1,'Listening','listening',1500,'forward_only',false),
              ($2,$3,2,'Reading','reading',1500,'free',true)`,
      [listeningSectionId, readingSectionId, versionId],
    )
    await pool.query(
      `INSERT INTO question_group (id, test_version_id, test_section_id, ordinal) VALUES ($1,$3,$4,1), ($2,$3,$5,1)`,
      [groupL, groupR, versionId, listeningSectionId, readingSectionId],
    )
    await pool.query(
      `INSERT INTO question (id, test_version_id, question_group_id, question_key, ordinal, prompt, type, points)
       VALUES ($1,$3,$4,'q1',1,'p1','single_choice',1), ($2,$3,$5,'q2',2,'p2','single_choice',1)`,
      [q1, q2, versionId, groupL, groupR],
    )
    await pool.query(
      `INSERT INTO choice (id, question_id, ordinal, label, is_correct)
       VALUES ($1,$5,1,'A',true), ($2,$5,2,'B',false), ($3,$6,1,'C',true), ($4,$6,2,'D',false)`,
      [c1, c2, c3, c4, q1, q2],
    )
    await pool.query(
      `UPDATE test_version SET published_at = now() WHERE id = $1`,
      [versionId],
    )
    await pool.query(`UPDATE test SET current_version_id = $1 WHERE id = $2`, [
      versionId,
      testId,
    ])
    await pool.query(
      `INSERT INTO attempt (id, student_id, test_version_id, status) VALUES ($1,$2,$3,'in_progress')`,
      [attemptId, studentId, versionId],
    )

    return {
      studentId,
      attemptId,
      listeningQuestionId: q1,
      readingQuestionId: q2,
      choiceIds: [c1, c2, c3, c4],
    }
  }

  describe("PUT /attempts/:id/responses/:questionId", () => {
    let app: TestApp
    let pool: PgPool
    let fixture: Fixture
    let token: string

    beforeAll(async () => {
      app = await createTestApp()
      pool = app.get(REQUEST_POOL)
      fixture = await seedAttempt(pool, "sub-single-response")
      token = await app.mint({
        sub: "sub-single-response",
        email: "s@example.com",
      })
    })

    afterAll(async () => {
      await app.close()
    })

    it("applies a valid write and returns the item's ack", async () => {
      const response = await request(app.http.getHttpServer())
        .put(
          `/api/attempts/${fixture.attemptId}/responses/${fixture.readingQuestionId}`,
        )
        .set("Authorization", `Bearer ${token}`)
        .send({
          clientInstanceId: "device-a",
          seq: 1,
          selectedChoiceIds: [fixture.choiceIds[2]],
        })

      expect(response.status).toBe(200)
      expect(response.body.questionId).toBe(fixture.readingQuestionId)
      expect(response.body.status).toBe("applied")
      expect(response.body.attempt.serverTime).toBeTruthy()
    })

    it("discards a stale seq as ignored_stale rather than an error", async () => {
      await request(app.http.getHttpServer())
        .put(
          `/api/attempts/${fixture.attemptId}/responses/${fixture.readingQuestionId}`,
        )
        .set("Authorization", `Bearer ${token}`)
        .send({
          clientInstanceId: "device-b",
          seq: 50,
          selectedChoiceIds: [fixture.choiceIds[2]],
        })

      const response = await request(app.http.getHttpServer())
        .put(
          `/api/attempts/${fixture.attemptId}/responses/${fixture.readingQuestionId}`,
        )
        .set("Authorization", `Bearer ${token}`)
        .send({
          clientInstanceId: "device-b",
          seq: 1,
          selectedChoiceIds: [fixture.choiceIds[3]],
        })

      expect(response.status).toBe(200)
      expect(response.body.status).toBe("ignored_stale")
    })

    it("refuses an answer-change on a forward_only, allowAnswerChange:false section and captures it", async () => {
      await request(app.http.getHttpServer())
        .put(
          `/api/attempts/${fixture.attemptId}/responses/${fixture.listeningQuestionId}`,
        )
        .set("Authorization", `Bearer ${token}`)
        .send({
          clientInstanceId: "device-a",
          seq: 1,
          selectedChoiceIds: [fixture.choiceIds[0]],
        })

      const response = await request(app.http.getHttpServer())
        .put(
          `/api/attempts/${fixture.attemptId}/responses/${fixture.listeningQuestionId}`,
        )
        .set("Authorization", `Bearer ${token}`)
        .send({
          clientInstanceId: "device-a",
          seq: 2,
          selectedChoiceIds: [fixture.choiceIds[1]],
        })

      expect(response.status).toBe(409)
      expect(response.body.type).toBe("answer_change_not_allowed")
      expect(response.body.retryable).toBe(false)
      expect(typeof response.body.capturedAs).toBe("string")

      const { rows } = await pool.query(
        "SELECT reason FROM failed_write WHERE id = $1",
        [response.body.capturedAs],
      )
      expect(rows[0].reason).toBe("answer_change_not_allowed")
    })

    it("401s with no token", async () => {
      const response = await request(app.http.getHttpServer()).put(
        `/api/attempts/${fixture.attemptId}/responses/${fixture.readingQuestionId}`,
      )
      expect(response.status).toBe(401)
    })

    it("403s for another student's attempt", async () => {
      const otherToken = await app.mint({
        sub: "sub-someone-else",
        email: "other@example.com",
      })
      const response = await request(app.http.getHttpServer())
        .put(
          `/api/attempts/${fixture.attemptId}/responses/${fixture.readingQuestionId}`,
        )
        .set("Authorization", `Bearer ${otherToken}`)
        .send({ clientInstanceId: "device-c", seq: 1, selectedChoiceIds: [] })
      expect(response.status).toBe(403)
    })
  })
  ```

  Add `import request from "supertest"` to this file's top-level imports (alongside `randomUUID`, `PgPool`, the vitest helpers) — matching `auth.e2e.test.ts`'s own convention — rather than the ad hoc dynamic imports an earlier draft of this test used.

- [ ] **Step 4: Run to verify it fails**

  Run: `pnpm --filter @pp/server test single-response`
  Expected: FAIL — none of the controller/service/module exist.

- [ ] **Step 5: The controller**

  `packages/server/src/responses/single-response.controller.ts`:

  ```ts
  import type { JwtClaims } from "@liam-workspace/node-auth-server"
  import type { PgPool } from "@liam-public/node-postgres"
  import type { Clock } from "@pp/common"
  import {
    Body,
    Controller,
    Inject,
    Param,
    Put,
    UnauthorizedException,
    UseGuards,
  } from "@nestjs/common"
  import { CurrentStudent } from "../auth/current-student.decorator.js"
  import { JwksGuard } from "../auth/jwks.guard.js"
  import { CLOCK, REQUEST_POOL } from "../database/tokens.js"
  import { writeResponse } from "@pp/db"
  import { SingleResponseWriteDto } from "./dto.js"
  import { ResponseWriteService } from "./response-write.service.js"
  import { resolveSectionRules, mapWriteConflict } from "./section-rules.js"

  interface SingleResponseResult {
    questionId: string
    status: "applied" | "ignored_stale"
    attempt: {
      expiresAt: string | null
      sectionExpiresAt: string | null
      serverTime: string
    }
  }

  @Controller("attempts/:id/responses")
  @UseGuards(JwksGuard)
  export class SingleResponseController {
    constructor(
      private readonly ownership: ResponseWriteService,
      @Inject(REQUEST_POOL) private readonly pool: PgPool,
      @Inject(CLOCK) private readonly clock: Clock,
    ) {}

    @Put(":questionId")
    async save(
      @CurrentStudent() claims: JwtClaims,
      @Param("id") attemptId: string,
      @Param("questionId") questionId: string,
      @Body() body: SingleResponseWriteDto,
    ): Promise<SingleResponseResult> {
      const subjectClaim = subjectOf(claims)
      const { testVersionId } = await this.ownership.assertOwnsAttempt(
        subjectClaim,
        attemptId,
      )
      const now = this.clock.now()
      const rules = await resolveSectionRules(this.pool, {
        testVersionId,
        questionId,
      })

      mapWriteConflict(rules, now) // throws 409/410 per Task 6's shared helper

      const outcome = await writeResponse(this.pool, {
        attemptId,
        questionId,
        testVersionId,
        clientInstanceId: body.clientInstanceId,
        seq: body.seq,
        selectedChoiceIds: body.selectedChoiceIds,
        answeredAt: body.answeredAt ? new Date(body.answeredAt) : null,
        timeSpentMs: body.timeSpentMs ?? null,
        allowAnswerChange: rules.allowAnswerChange,
        now,
      })

      if (outcome.kind === "rejected") {
        throw await captureRejection(this.pool, this.clock, {
          attemptId,
          route: `PUT /attempts/${attemptId}/responses/${questionId}`,
          reason: outcome.reason,
          body,
        })
      }

      return {
        questionId,
        status: outcome.kind,
        attempt: {
          expiresAt: rules.attemptExpiresAt?.toISOString() ?? null,
          sectionExpiresAt: rules.sectionExpiresAt?.toISOString() ?? null,
          serverTime: now.toISOString(),
        },
      }
    }
  }

  function subjectOf(claims: JwtClaims): string {
    if (!claims.sub) {
      throw new UnauthorizedException("invalid_token")
    }
    return claims.sub
  }
  ```

  `resolveSectionRules`, `mapWriteConflict` and `captureRejection` are built in Task 6 alongside the snapshot endpoint's identical needs — Task 6 Step 2 creates `packages/server/src/responses/section-rules.js` before this controller compiles. **Do this task's Step 5 and Task 6's Step 2 together**, or leave this controller uncompiled with a note, since the single-item route genuinely needs section rules and per-item capture, and duplicating that logic here would immediately diverge from the snapshot endpoint's copy.

- [ ] **Step 6: The module and wiring**

  `packages/server/src/responses/responses.module.ts`:

  ```ts
  import { Module } from "@nestjs/common"
  import { SingleResponseController } from "./single-response.controller.js"
  import { ResponseSnapshotController } from "./response-snapshot.controller.js"
  import { ResponseWriteService } from "./response-write.service.js"

  @Module({
    controllers: [SingleResponseController, ResponseSnapshotController],
    providers: [ResponseWriteService],
  })
  export class ResponsesModule {}
  ```

  Import `ResponsesModule` in `packages/server/src/app.module.ts`'s `imports` array. (`ResponseSnapshotController` is Task 6's; this module file is written once, here, and Task 6 does not recreate it.)

- [ ] **Step 7: Run, gates**

  This task cannot go fully green in isolation — `resolveSectionRules`/`mapWriteConflict`/`captureRejection` and `ResponseSnapshotController` are Task 6's. Implement Task 6 Step 2 (the shared `section-rules.ts` and `capture.ts` helpers) now if not already present, then:

  Run: `pnpm --filter @pp/server test single-response`
  Expected: PASS, all five cases.

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

  Do NOT run `git add` and do NOT commit.

---

### Task 6: `PATCH /attempts/{id}/responses` — the snapshot flush, and the shared section-rules helpers Task 5 depends on

This task builds the helpers Task 5's controller already imports (`section-rules.ts`, `capture.ts`), then the snapshot endpoint itself. It is the home for rule 2 (snapshot, not delta), rule 3 (per-item, never all-or-nothing — the rule this whole plan is named for), and the `mixed_sections`/`empty_batch` envelope-level 400s.

**Files:**

- Create: `packages/db/src/repositories/section-lookup.repository.ts`
- Create: `packages/server/src/responses/section-rules.ts`
- Create: `packages/server/src/responses/capture.ts`
- Create: `packages/server/src/responses/response-snapshot.controller.ts`
- Create: `packages/server/test/response-snapshot.e2e.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**

- Consumes: `writeResponse` (Task 4); `ResponseWriteService.assertOwnsAttempt` (Task 5); `CapturableBadRequestException` (Task 3); `insertFailedWrite` (Task 1).
- Produces:

  ```ts
  export interface QuestionSectionInfo {
    sectionId: string
    allowAnswerChange: boolean
    navigation: "free" | "forward_only"
  }
  export async function loadQuestionSectionInfo(
    db: PgQueryable,
    input: { testVersionId: string; questionIds: string[] },
  ): Promise<Map<string, QuestionSectionInfo>>
  ```

  and, in `packages/server/src/responses/section-rules.ts`:

  ```ts
  export interface SectionRules {
    allowAnswerChange: boolean
    attemptExpiresAt: Date | null
    sectionExpiresAt: Date | null
  }
  export async function resolveSectionRules(
    pool: PgPool,
    input: { testVersionId: string; questionId: string },
  ): Promise<SectionRules>
  export function mapWriteConflict(rules: SectionRules, now: Date): void
  ```

- [ ] **Step 1: `loadQuestionSectionInfo` — write its failing test first**

  `packages/db/test/section-lookup-repository.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest"
  import { loadQuestionSectionInfo } from "../src/repositories/section-lookup.repository.js"
  import { withDatabase } from "./helpers/database.js"
  import { seedPublishedTest } from "./helpers/fixtures.js"

  describe("section-lookup repository", () => {
    it("maps each question to its section and section rules", async () => {
      await withDatabase(async (pool) => {
        const fixture = await seedPublishedTest(pool)

        const map = await loadQuestionSectionInfo(pool, {
          testVersionId: fixture.versionId,
          questionIds: fixture.questionIds,
        })

        expect(map.size).toBe(2)
        expect(map.get(fixture.questionIds[0])).toEqual({
          sectionId: fixture.listeningSectionId,
          allowAnswerChange: false,
          navigation: "forward_only",
        })
        expect(map.get(fixture.questionIds[1])).toEqual({
          sectionId: fixture.readingSectionId,
          allowAnswerChange: true,
          navigation: "free",
        })
      })
    }, 120_000)

    it("omits an id that does not resolve to a question in this version", async () => {
      await withDatabase(async (pool) => {
        const fixture = await seedPublishedTest(pool)

        const map = await loadQuestionSectionInfo(pool, {
          testVersionId: fixture.versionId,
          questionIds: [
            fixture.questionIds[0],
            "00000000-0000-0000-0000-000000000000",
          ],
        })

        expect(map.size).toBe(1)
        expect(map.has("00000000-0000-0000-0000-000000000000")).toBe(false)
      })
    }, 120_000)
  })
  ```

  Run: `pnpm --filter @pp/db test section-lookup-repository` → FAIL, module not found.

  Implement `packages/db/src/repositories/section-lookup.repository.ts`:

  ```ts
  import type { PgQueryable } from "@liam-public/node-postgres"

  export interface QuestionSectionInfo {
    sectionId: string
    allowAnswerChange: boolean
    navigation: "free" | "forward_only"
  }

  export async function loadQuestionSectionInfo(
    db: PgQueryable,
    input: { testVersionId: string; questionIds: string[] },
  ): Promise<Map<string, QuestionSectionInfo>> {
    if (input.questionIds.length === 0) {
      return new Map()
    }

    const { rows } = await db.query<{
      question_id: string
      section_id: string
      allow_answer_change: boolean
      navigation: "free" | "forward_only"
    }>(
      `SELECT q.id AS question_id, ts.id AS section_id,
              ts.allow_answer_change, ts.navigation::text AS navigation
         FROM question q
         JOIN question_group qg ON qg.id = q.question_group_id
         JOIN test_section ts ON ts.id = qg.test_section_id
        WHERE q.test_version_id = $1 AND q.id = ANY($2::uuid[])`,
      [input.testVersionId, input.questionIds],
    )

    const map = new Map<string, QuestionSectionInfo>()
    for (const row of rows) {
      map.set(row.question_id, {
        sectionId: row.section_id,
        allowAnswerChange: row.allow_answer_change,
        navigation: row.navigation,
      })
    }
    return map
  }
  ```

  Export `loadQuestionSectionInfo` and `type QuestionSectionInfo` from `packages/db/src/index.ts`. Run: `pnpm --filter @pp/db test section-lookup-repository` → PASS.

- [ ] **Step 2: `section-rules.ts` and `capture.ts` — the helpers both controllers share**

  `packages/server/src/responses/section-rules.ts`:

  ```ts
  import type { PgPool } from "@liam-public/node-postgres"
  import { GoneException } from "@nestjs/common"
  import { loadQuestionSectionInfo } from "@pp/db"

  export interface SectionRules {
    allowAnswerChange: boolean
    attemptExpiresAt: Date | null
    sectionExpiresAt: Date | null
  }

  /**
   * Resolves the one piece of section context a single-item write needs.
   * Attempt-level expiry finalization (grading, FinalizedAttempt) is out of
   * this plan's scope -- see the plan header. What IS in scope: refusing a
   * write once the clock has passed, which needs no grading to do correctly.
   */
  export async function resolveSectionRules(
    pool: PgPool,
    input: { testVersionId: string; questionId: string },
  ): Promise<SectionRules> {
    const map = await loadQuestionSectionInfo(pool, {
      testVersionId: input.testVersionId,
      questionIds: [input.questionId],
    })
    const info = map.get(input.questionId)
    if (!info) {
      // Unknown question: let writeResponse's own FK-violation path produce
      // the per-item rejection: this function's job is timing, not identity.
      return {
        allowAnswerChange: true,
        attemptExpiresAt: null,
        sectionExpiresAt: null,
      }
    }

    const { rows } = await pool.query<{
      attempt_expires_at: Date | null
      section_expires_at: Date | null
    }>(
      `SELECT a.expires_at AS attempt_expires_at, asec.expires_at AS section_expires_at
         FROM question q
         JOIN question_group qg ON qg.id = q.question_group_id
         JOIN attempt a ON a.test_version_id = q.test_version_id
         LEFT JOIN attempt_section asec
           ON asec.attempt_id = a.id AND asec.test_section_id = qg.test_section_id
        WHERE q.id = $1
        LIMIT 1`,
      [input.questionId],
    )

    return {
      allowAnswerChange: info.allowAnswerChange,
      attemptExpiresAt: rows[0]?.attempt_expires_at ?? null,
      sectionExpiresAt: rows[0]?.section_expires_at ?? null,
    }
  }

  /**
   * Section-level: read-only detection, no finalization -- "closed
   * deliberately" per openapi's SectionExpiredProblem, which asserts no
   * finalization happened. Attempt-level expiry needs full finalization
   * (grading), which this plan does not implement -- see the header. A test
   * that reaches this branch is out of this plan's scope until that
   * dependency exists; do not fake a FinalizedAttempt here.
   */
  export function mapWriteConflict(rules: SectionRules, now: Date): void {
    if (rules.sectionExpiresAt && now >= rules.sectionExpiresAt) {
      throw new GoneException({
        type: "section_expired",
        title: "This section's time is up",
        status: 410,
        retryable: false,
      })
    }
    if (rules.attemptExpiresAt && now >= rules.attemptExpiresAt) {
      throw new Error(
        "attempt-level expiry finalization is not implemented by this plan -- " +
          "see 'Assumptions this plan makes about work done elsewhere' in the plan header",
      )
    }
  }
  ```

  `packages/server/src/responses/capture.ts`:

  ```ts
  import type { PgPool } from "@liam-public/node-postgres"
  import { ConflictException } from "@nestjs/common"
  import type { Clock } from "@pp/common"
  import { insertFailedWrite } from "@pp/db"

  /**
   * The single-item route's 409 does not require `capturedAs` in openapi's
   * schema for that response (Problem is open, not additionalProperties:
   * false, unlike Student/SessionResult) -- but spec S5 rule 4's governing
   * sentence ("Anything unapplied ... rejected ... is persisted verbatim")
   * is stated once, for the whole write surface, not only for the snapshot
   * endpoint's ItemRejected. This helper makes both routes honour it the
   * same way.
   */
  export async function captureRejection(
    pool: PgPool,
    clock: Clock,
    input: {
      attemptId: string
      route: string
      reason: string
      body: unknown
    },
  ): Promise<ConflictException> {
    const captured = await insertFailedWrite(pool, {
      attemptId: input.attemptId,
      route: input.route,
      reason: input.reason,
      rawBody: JSON.stringify(input.body),
      byteSize: null,
      clientVersion: null,
      clientInstanceId: null,
      now: clock.now(),
    })

    return new ConflictException({
      type: input.reason,
      title: "This write was refused",
      status: 409,
      retryable: false,
      capturedAs: captured.id,
    })
  }
  ```

- [ ] **Step 3: Write the failing snapshot e2e tests — rule 3 is the point, test it directly**

  `packages/server/test/response-snapshot.e2e.test.ts`. Reuses the same `seedAttempt` helper style as Task 5's test (copy it, or factor it into `test/helpers/write-fixture.ts` and import from both — factoring it is the better choice since both files need an identical fixture; do that and delete the duplicate from `single-response.e2e.test.ts`).

  ```ts
  import type { PgPool } from "@liam-public/node-postgres"
  import request from "supertest"
  import { afterAll, beforeAll, describe, expect, it } from "vitest"
  import { createTestApp, type TestApp } from "./helpers/app.js"
  import { REQUEST_POOL } from "../src/database/tokens.js"
  import {
    seedWriteFixture,
    type WriteFixture,
  } from "./helpers/write-fixture.js"

  describe("PATCH /attempts/:id/responses", () => {
    let app: TestApp
    let pool: PgPool
    let fixture: WriteFixture
    let token: string

    beforeAll(async () => {
      app = await createTestApp()
      pool = app.get(REQUEST_POOL)
      fixture = await seedWriteFixture(pool, "sub-snapshot")
      token = await app.mint({ sub: "sub-snapshot", email: "s@example.com" })
    })

    afterAll(async () => {
      await app.close()
    })

    it("applies every item in a valid snapshot -- a full section, not a delta", async () => {
      const response = await request(app.http.getHttpServer())
        .patch(`/api/attempts/${fixture.attemptId}/responses`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          clientInstanceId: "device-a",
          responses: [
            {
              questionId: fixture.readingQuestionId,
              seq: 1,
              selectedChoiceIds: [fixture.choiceIds[2]],
            },
          ],
        })

      expect(response.status).toBe(200)
      expect(response.body.results).toEqual([
        { questionId: fixture.readingQuestionId, status: "applied" },
      ])
    })

    it("ONE rejected item does not roll back its siblings -- rule 3, tested directly", async () => {
      const unknownQuestionId = "00000000-0000-0000-0000-000000000000"

      const response = await request(app.http.getHttpServer())
        .patch(`/api/attempts/${fixture.attemptId}/responses`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          clientInstanceId: "device-b",
          responses: [
            {
              questionId: fixture.readingQuestionId,
              seq: 10,
              selectedChoiceIds: [fixture.choiceIds[3]],
            },
            { questionId: unknownQuestionId, seq: 1, selectedChoiceIds: [] },
          ],
        })

      expect(response.status).toBe(200)
      const byQuestion = new Map(
        response.body.results.map((r: { questionId: string }) => [
          r.questionId,
          r,
        ]),
      )
      expect(byQuestion.get(fixture.readingQuestionId)).toEqual({
        questionId: fixture.readingQuestionId,
        status: "applied",
      })
      const rejected = byQuestion.get(unknownQuestionId) as {
        status: string
        reason: string
        retryable: boolean
        capturedAs: string
      }
      expect(rejected.status).toBe("rejected")
      expect(rejected.reason).toBe("unknown_question")
      expect(rejected.retryable).toBe(false)
      expect(typeof rejected.capturedAs).toBe("string")

      // Proof, not inference: re-query the database directly for the
      // sibling's actual persisted state.
      const { rows } = await pool.query(
        `SELECT c.id FROM response_choice rc JOIN choice c ON c.id = rc.choice_id
          WHERE rc.attempt_id = $1 AND rc.question_id = $2`,
        [fixture.attemptId, fixture.readingQuestionId],
      )
      expect(rows).toEqual([{ id: fixture.choiceIds[3] }])
    })

    it("refuses a body spanning two sections as mixed_sections, captured before the error returns", async () => {
      const response = await request(app.http.getHttpServer())
        .patch(`/api/attempts/${fixture.attemptId}/responses`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          clientInstanceId: "device-c",
          responses: [
            {
              questionId: fixture.listeningQuestionId,
              seq: 1,
              selectedChoiceIds: [fixture.choiceIds[0]],
            },
            {
              questionId: fixture.readingQuestionId,
              seq: 1,
              selectedChoiceIds: [fixture.choiceIds[2]],
            },
          ],
        })

      expect(response.status).toBe(400)
      expect(response.body.type).toBe("mixed_sections")
      expect(typeof response.body.capturedAs).toBe("string")
    })

    it("refuses an empty responses array as empty_batch, captured before the error returns", async () => {
      const response = await request(app.http.getHttpServer())
        .patch(`/api/attempts/${fixture.attemptId}/responses`)
        .set("Authorization", `Bearer ${token}`)
        .send({ clientInstanceId: "device-d", responses: [] })

      expect(response.status).toBe(400)
      expect(response.body.type).toBe("empty_batch")
      expect(typeof response.body.capturedAs).toBe("string")
    })
  })
  ```

  Factor `packages/server/test/helpers/write-fixture.ts` out of Task 5's inline `seedAttempt` (same body, renamed `seedWriteFixture`, returning `listeningQuestionId`/`readingQuestionId`/`choiceIds`/`attemptId`/`studentId`), and update `single-response.e2e.test.ts` to import it instead of declaring its own copy.

- [ ] **Step 4: Run to verify it fails**

  Run: `pnpm --filter @pp/server test response-snapshot`
  Expected: FAIL — `ResponseSnapshotController` does not exist.

- [ ] **Step 5: The snapshot controller — per-item isolation is the whole point**

  `packages/server/src/responses/response-snapshot.controller.ts`:

  ```ts
  import type { JwtClaims } from "@liam-workspace/node-auth-server"
  import type { PgPool } from "@liam-public/node-postgres"
  import type { Clock } from "@pp/common"
  import {
    Body,
    Controller,
    Inject,
    Param,
    Patch,
    UnauthorizedException,
    UseGuards,
  } from "@nestjs/common"
  import { CurrentStudent } from "../auth/current-student.decorator.js"
  import { JwksGuard } from "../auth/jwks.guard.js"
  import { CLOCK, REQUEST_POOL } from "../database/tokens.js"
  import { loadQuestionSectionInfo, writeResponse } from "@pp/db"
  import { CapturableBadRequestException } from "../validation/zod-body-validation.pipe.js"
  import { ResponseSnapshotDto } from "./dto.js"
  import { ResponseWriteService } from "./response-write.service.js"
  import { mapWriteConflict } from "./section-rules.js"

  interface ItemResult {
    questionId: string
    status: "applied" | "ignored_stale" | "rejected"
    reason?: string
    retryable?: false
    capturedAs?: string
  }

  interface FlushResult {
    results: ItemResult[]
    attempt: {
      expiresAt: string | null
      sectionExpiresAt: string | null
      serverTime: string
    }
  }

  @Controller("attempts/:id/responses")
  @UseGuards(JwksGuard)
  export class ResponseSnapshotController {
    constructor(
      private readonly ownership: ResponseWriteService,
      @Inject(REQUEST_POOL) private readonly pool: PgPool,
      @Inject(CLOCK) private readonly clock: Clock,
    ) {}

    @Patch()
    async flush(
      @CurrentStudent() claims: JwtClaims,
      @Param("id") attemptId: string,
      @Body() body: ResponseSnapshotDto,
    ): Promise<FlushResult> {
      const subjectClaim = subjectOf(claims)
      const { testVersionId } = await this.ownership.assertOwnsAttempt(
        subjectClaim,
        attemptId,
      )

      const sectionInfo = await loadQuestionSectionInfo(this.pool, {
        testVersionId,
        questionIds: body.responses.map((item) => item.questionId),
      })

      // mixed_sections: resolved sections must all agree. An id this query
      // could not resolve contributes no section and is excluded from the
      // uniformity check -- it becomes a per-item unknown_question rejection
      // below instead, which is the correct per-item failure for it.
      const sectionIds = new Set(
        [...sectionInfo.values()].map((info) => info.sectionId),
      )
      if (sectionIds.size > 1) {
        throw await this.captureEnvelopeRejection(
          attemptId,
          "mixed_sections",
          body,
        )
      }

      const now = this.clock.now()
      const oneSection = [...sectionInfo.values()][0]
      if (oneSection) {
        // Envelope-level 410 uses the SAME section-timing rule the single
        // route uses, evaluated once for the whole snapshot's shared section.
        const rules = {
          allowAnswerChange: oneSection.allowAnswerChange,
          attemptExpiresAt: null,
          sectionExpiresAt: await this.loadSectionExpiry(
            attemptId,
            oneSection.sectionId,
          ),
        }
        mapWriteConflict(rules, now)
      }

      const results: ItemResult[] = []
      for (const item of body.responses) {
        const info = sectionInfo.get(item.questionId)
        const outcome = await writeResponse(this.pool, {
          attemptId,
          questionId: item.questionId,
          testVersionId,
          clientInstanceId: body.clientInstanceId,
          seq: item.seq,
          selectedChoiceIds: item.selectedChoiceIds,
          answeredAt: item.answeredAt ? new Date(item.answeredAt) : null,
          timeSpentMs: item.timeSpentMs ?? null,
          allowAnswerChange: info?.allowAnswerChange ?? true,
          now,
        })

        if (outcome.kind === "rejected") {
          const captured = await this.captureItemRejection(
            attemptId,
            outcome.reason,
            item,
          )
          results.push({
            questionId: item.questionId,
            status: "rejected",
            reason: outcome.reason,
            retryable: false,
            capturedAs: captured,
          })
        } else {
          results.push({ questionId: item.questionId, status: outcome.kind })
        }
      }

      return {
        results,
        attempt: {
          expiresAt: null,
          sectionExpiresAt: oneSection
            ? ((
                await this.loadSectionExpiry(attemptId, oneSection.sectionId)
              )?.toISOString() ?? null)
            : null,
          serverTime: now.toISOString(),
        },
      }
    }

    private async loadSectionExpiry(
      attemptId: string,
      sectionId: string,
    ): Promise<Date | null> {
      const { rows } = await this.pool.query<{ expires_at: Date | null }>(
        `SELECT expires_at FROM attempt_section WHERE attempt_id = $1 AND test_section_id = $2`,
        [attemptId, sectionId],
      )
      return rows[0]?.expires_at ?? null
    }

    private async captureEnvelopeRejection(
      attemptId: string,
      reason: string,
      body: unknown,
    ): Promise<CapturableBadRequestException> {
      // FailedWriteCaptureFilter (Task 3) is what actually performs the
      // capture -- throwing this exception is how this controller hands the
      // rejection to it, matching every other CapturableBadRequestException
      // site in this app.
      return new CapturableBadRequestException(reason, JSON.stringify(body))
    }

    private async captureItemRejection(
      attemptId: string,
      reason: string,
      item: unknown,
    ): Promise<string> {
      const { insertFailedWrite } = await import("@pp/db")
      const captured = await insertFailedWrite(this.pool, {
        attemptId,
        route: `PATCH /attempts/${attemptId}/responses (item)`,
        reason,
        rawBody: JSON.stringify(item),
        byteSize: null,
        clientVersion: null,
        clientInstanceId: null,
        now: this.clock.now(),
      })
      return captured.id
    }
  }

  function subjectOf(claims: JwtClaims): string {
    if (!claims.sub) {
      throw new UnauthorizedException("invalid_token")
    }
    return claims.sub
  }
  ```

  Move the `import { insertFailedWrite } from "@pp/db"` in `captureItemRejection` to the file's top-level import list instead of the dynamic `await import(...)` shown above — it was written that way here only to keep this step's diff visually scoped to one function; a dynamic import inside a hot per-item loop is not the right shape for the real file. Use the same top-level import Task 5's controller already uses.

  Note the design that makes rule 3 real: **each item's call to `writeResponse` is its own `withTransaction` call** (Task 4), not one shared transaction wrapping the whole loop. A Postgres error inside one item's transaction cannot poison a sibling's, because they are different transactions on different pooled connections.

- [ ] **Step 6: Run, then the full server suite**

  Run: `pnpm --filter @pp/server test`
  Expected: PASS — this task's four cases, Task 5's five cases (now that `section-rules.ts`/`capture.ts` exist), and every pre-existing suite.

- [ ] **Step 7: Gates**

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

  Do NOT run `git add` and do NOT commit.

---

### Task 7: Retry classification — rule 5, pure and client-side

No network, no server, no sleeping. A table-driven pure function the flush controller (Task 9) calls after every failed request.

**Files:**

- Create: `packages/app/src/lib/retryClassifier.ts`
- Create: `packages/app/test/retryClassifier.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:

  ```ts
  export type RetryOutcome =
    | { retry: false }
    | { retry: true; backoffMs: number }

  export function classifyForRetry(
    result: { kind: "network-error" } | { kind: "http-status"; status: number },
    attempt: number,
  ): RetryOutcome
  ```

  Task 9 calls this after each flush attempt with the attempt number it is about to make (1-indexed), using `backoffMs` to schedule the next try through its injected scheduler.

- [ ] **Step 1: Write the failing test — every branch spec §5 rule 5 names**

  `packages/app/test/retryClassifier.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest"
  import { classifyForRetry } from "../src/lib/retryClassifier.js"

  describe("classifyForRetry", () => {
    it("retries a network error with backoff", () => {
      const outcome = classifyForRetry({ kind: "network-error" }, 1)
      expect(outcome.retry).toBe(true)
    })

    it.each([500, 502, 503, 504])(
      "retries a 5xx (%d) with backoff",
      (status) => {
        const outcome = classifyForRetry({ kind: "http-status", status }, 1)
        expect(outcome.retry).toBe(true)
      },
    )

    it("retries 429 with backoff", () => {
      const outcome = classifyForRetry({ kind: "http-status", status: 429 }, 1)
      expect(outcome.retry).toBe(true)
    })

    it.each([400, 401, 403, 404, 410, 413, 422])(
      "stops dead on 4xx other than 429 (%d) and surfaces it",
      (status) => {
        const outcome = classifyForRetry({ kind: "http-status", status }, 1)
        expect(outcome).toEqual({ retry: false })
      },
    )

    it("a retried 409 is a storm, not a recovery -- never retries", () => {
      const outcome = classifyForRetry({ kind: "http-status", status: 409 }, 1)
      expect(outcome).toEqual({ retry: false })
    })

    it("backoff grows with the attempt number rather than staying constant", () => {
      const first = classifyForRetry({ kind: "network-error" }, 1)
      const second = classifyForRetry({ kind: "network-error" }, 2)
      if (!first.retry || !second.retry) {
        throw new Error("expected both to be retryable")
      }
      expect(second.backoffMs).toBeGreaterThan(first.backoffMs)
    })
  })
  ```

- [ ] **Step 2: Run to verify it fails**

  Run: `pnpm --filter @pp/app test retryClassifier`
  Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

  `packages/app/src/lib/retryClassifier.ts`:

  ```ts
  export type RetryOutcome =
    | { retry: false }
    | { retry: true; backoffMs: number }

  const BASE_BACKOFF_MS = 500
  const MAX_BACKOFF_MS = 30_000

  /**
   * Network and 5xx back off; 4xx other than 429 stop dead and surface. A
   * retried 409 is a storm, not a recovery -- spec S5 rule 5, quoted from
   * docs/api/openapi.yaml's own description. Pure: the caller (Task 9)
   * schedules the returned backoffMs through its own injectable timer: this
   * function never calls setTimeout itself, so it needs no fake clock to test.
   */
  export function classifyForRetry(
    result: { kind: "network-error" } | { kind: "http-status"; status: number },
    attempt: number,
  ): RetryOutcome {
    const retryable =
      result.kind === "network-error" ||
      result.status === 429 ||
      result.status >= 500

    if (!retryable) {
      return { retry: false }
    }

    const backoffMs = Math.min(
      BASE_BACKOFF_MS * 2 ** Math.max(0, attempt - 1),
      MAX_BACKOFF_MS,
    )
    return { retry: true, backoffMs }
  }
  ```

- [ ] **Step 4: Run, gates**

  Run: `pnpm --filter @pp/app test retryClassifier`
  Expected: PASS, all cases.

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

  Do NOT run `git add` and do NOT commit.

---

### Task 8: The client durable answer queue — rule 1, and Ordering's `clientInstanceId`/`seq`

IndexedDB, because it survives a tab crash or reload — the property `localStorage` also has but a structured, queryable store fits a per-question, per-attempt record shape better. Every answer is written here **before** any network call is attempted, and cleared only on a per-item ack — never on request completion.

**Files:**

- Create: `packages/app/src/lib/answerQueue.ts`
- Create: `packages/app/test/answerQueue.test.ts`
- Modify: `packages/app/package.json` (add `fake-indexeddb` devDependency)
- Modify: `packages/app/test/setup.ts` (or wherever plan 3's Vitest setup file lives — import `fake-indexeddb/auto` there if a global polyfill is preferable to per-test import; if plan 3 has no setup file, import `fake-indexeddb/auto` at the top of this task's own test file instead and say which you did)

**Interfaces:**

- Consumes: nothing from earlier tasks in this plan (the client queue is independent of the server routes; Task 9 wires them together).
- Produces:

  ```ts
  export interface QueuedAnswer {
    attemptId: string
    sectionId: string
    questionId: string
    clientInstanceId: string
    seq: number
    selectedChoiceIds: string[]
    answeredAt: string
    timeSpentMs: number | null
    terminalRejection: boolean
  }

  export class AnswerQueue {
    static async open(dbName?: string): Promise<AnswerQueue>
    clientInstanceId(): string
    async recordAnswer(
      input: {
        attemptId: string
        sectionId: string
        questionId: string
        selectedChoiceIds: string[]
        timeSpentMs: number | null
      },
      now: Date,
    ): Promise<QueuedAnswer>
    async snapshotForSection(
      attemptId: string,
      sectionId: string,
    ): Promise<QueuedAnswer[]>
    async snapshotForAttempt(attemptId: string): Promise<QueuedAnswer[]>
    async ackItem(
      attemptId: string,
      questionId: string,
      ackedSeq: number,
    ): Promise<void>
    async markTerminalRejection(
      attemptId: string,
      questionId: string,
    ): Promise<void>
    async close(): Promise<void>
  }
  ```

  `snapshotForAttempt` is added in Task 10 Step 3a (it has no caller until then, so its test is written there, against this same file); it is listed on the interface here so a reader of this task alone knows the class's full eventual shape. Task 9's flush controller calls `snapshotForSection`, `ackItem` and `markTerminalRejection`. Task 10's `pagehide` handler calls `snapshotForSection` and `clientInstanceId`; its submit-remainder builder calls `snapshotForAttempt` and `clientInstanceId`.

- [ ] **Step 1: Add the test-only dependency**

  `packages/app/package.json`, `devDependencies`: add `"fake-indexeddb": "^6.0.0"`. Not a `~/projects/typescript-libraries` package — a standard IndexedDB polyfill for Node test environments, needed because `jsdom`/`happy-dom` do not implement `indexedDB`. Say this in your report; it is not in `docs/architecture/library-adoption.md` because that map covers a different set of packages.

  Run `pnpm install` after editing.

- [ ] **Step 2: Write the failing tests**

  `packages/app/test/answerQueue.test.ts`:

  ```ts
  import "fake-indexeddb/auto"
  import { beforeEach, describe, expect, it } from "vitest"
  import { AnswerQueue } from "../src/lib/answerQueue.js"

  const NOW = new Date("2026-08-27T09:00:00.000Z")

  beforeEach(() => {
    indexedDB.deleteDatabase("pp-answer-queue-test")
  })

  describe("AnswerQueue", () => {
    it("durable before sent: a recorded answer survives closing and reopening the queue", async () => {
      const queue = await AnswerQueue.open("pp-answer-queue-test")
      await queue.recordAnswer(
        {
          attemptId: "a1",
          sectionId: "s1",
          questionId: "q1",
          selectedChoiceIds: ["c1"],
          timeSpentMs: 1000,
        },
        NOW,
      )
      await queue.close()

      // Simulates a crash before any network call ever completed -- nothing
      // in this test ever touched a network. The record must still be there
      // on the next open, because it was written to IndexedDB on tap, never
      // held only in memory pending a request.
      const reopened = await AnswerQueue.open("pp-answer-queue-test")
      const snapshot = await reopened.snapshotForSection("a1", "s1")
      expect(snapshot).toHaveLength(1)
      expect(snapshot[0].questionId).toBe("q1")
      expect(snapshot[0].selectedChoiceIds).toEqual(["c1"])
    })

    it("mints clientInstanceId once and it survives a reopen", async () => {
      const queue = await AnswerQueue.open("pp-answer-queue-test")
      const id = queue.clientInstanceId()
      await queue.close()

      const reopened = await AnswerQueue.open("pp-answer-queue-test")
      expect(reopened.clientInstanceId()).toBe(id)
    })

    it("seq increases across attempts, not just within one -- Ordering, verbatim", async () => {
      const queue = await AnswerQueue.open("pp-answer-queue-test")
      const first = await queue.recordAnswer(
        {
          attemptId: "a1",
          sectionId: "s1",
          questionId: "q1",
          selectedChoiceIds: ["c1"],
          timeSpentMs: null,
        },
        NOW,
      )
      const second = await queue.recordAnswer(
        {
          attemptId: "a2",
          sectionId: "s2",
          questionId: "q9",
          selectedChoiceIds: ["c9"],
          timeSpentMs: null,
        },
        NOW,
      )

      expect(second.seq).toBeGreaterThan(first.seq)
    })

    it("snapshotForSection carries every answer held for that section, not a delta", async () => {
      const queue = await AnswerQueue.open("pp-answer-queue-test")
      await queue.recordAnswer(
        {
          attemptId: "a1",
          sectionId: "s1",
          questionId: "q1",
          selectedChoiceIds: ["c1"],
          timeSpentMs: null,
        },
        NOW,
      )
      await queue.recordAnswer(
        {
          attemptId: "a1",
          sectionId: "s1",
          questionId: "q2",
          selectedChoiceIds: ["c2"],
          timeSpentMs: null,
        },
        NOW,
      )
      // A different section must not appear in this section's snapshot.
      await queue.recordAnswer(
        {
          attemptId: "a1",
          sectionId: "s2",
          questionId: "q3",
          selectedChoiceIds: ["c3"],
          timeSpentMs: null,
        },
        NOW,
      )

      const snapshot = await queue.snapshotForSection("a1", "s1")
      expect(snapshot.map((item) => item.questionId).sort()).toEqual([
        "q1",
        "q2",
      ])
    })

    it("ackItem clears an item only when the ack is not older than the current local edit", async () => {
      const queue = await AnswerQueue.open("pp-answer-queue-test")
      const first = await queue.recordAnswer(
        {
          attemptId: "a1",
          sectionId: "s1",
          questionId: "q1",
          selectedChoiceIds: ["c1"],
          timeSpentMs: null,
        },
        NOW,
      )
      // A newer local edit happens before the ack for the OLDER write arrives
      // -- e.g. a slow in-flight request's response lands after the child
      // already changed their answer again.
      const second = await queue.recordAnswer(
        {
          attemptId: "a1",
          sectionId: "s1",
          questionId: "q1",
          selectedChoiceIds: ["c2"],
          timeSpentMs: null,
        },
        NOW,
      )
      expect(second.seq).toBeGreaterThan(first.seq)

      // Never cleared on request completion -- only on a per-item ack, and
      // only when that ack is not stale relative to what is queued NOW.
      await queue.ackItem("a1", "q1", first.seq)

      const snapshot = await queue.snapshotForSection("a1", "s1")
      expect(snapshot).toHaveLength(1)
      expect(snapshot[0].selectedChoiceIds).toEqual(["c2"])

      // The correct ack, at the current seq, DOES clear it.
      await queue.ackItem("a1", "q1", second.seq)
      const afterRealAck = await queue.snapshotForSection("a1", "s1")
      expect(afterRealAck).toHaveLength(0)
    })

    it("markTerminalRejection excludes the item from future snapshots without deleting the queue's record of it", async () => {
      const queue = await AnswerQueue.open("pp-answer-queue-test")
      await queue.recordAnswer(
        {
          attemptId: "a1",
          sectionId: "s1",
          questionId: "q1",
          selectedChoiceIds: ["c1"],
          timeSpentMs: null,
        },
        NOW,
      )
      await queue.markTerminalRejection("a1", "q1")

      const snapshot = await queue.snapshotForSection("a1", "s1")
      expect(snapshot).toHaveLength(0)
    })
  })
  ```

- [ ] **Step 3: Run to verify it fails**

  Run: `pnpm --filter @pp/app test answerQueue`
  Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

  `packages/app/src/lib/answerQueue.ts`:

  ```ts
  const QUEUE_STORE = "answers"
  const META_STORE = "meta"
  const CLIENT_INSTANCE_KEY = "clientInstanceId"
  const SEQ_COUNTER_KEY = "seqCounter"

  export interface QueuedAnswer {
    attemptId: string
    sectionId: string
    questionId: string
    clientInstanceId: string
    seq: number
    selectedChoiceIds: string[]
    answeredAt: string
    timeSpentMs: number | null
    terminalRejection: boolean
  }

  function keyFor(attemptId: string, questionId: string): string {
    return `${attemptId}:${questionId}`
  }

  function mintClientInstanceId(): string {
    return crypto.randomUUID()
  }

  function openDb(dbName: string): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(QUEUE_STORE)) {
          db.createObjectStore(QUEUE_STORE, { keyPath: "key" })
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: "key" })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  function promisify<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Rule 1 (durable before sent) and Ordering's clientInstanceId/seq minting.
   * clientInstanceId is minted once and stored in the SAME database's meta
   * store, beside the queue, per spec S5 Ordering. seq is a single counter
   * that increases across attempts as well as within one -- it is never
   * reset per attempt.
   */
  export class AnswerQueue {
    private constructor(
      private readonly db: IDBDatabase,
      private readonly instanceId: string,
    ) {}

    static async open(dbName = "pp-answer-queue"): Promise<AnswerQueue> {
      const db = await openDb(dbName)
      const instanceId = await AnswerQueue.loadOrMintInstanceId(db)
      return new AnswerQueue(db, instanceId)
    }

    private static async loadOrMintInstanceId(
      db: IDBDatabase,
    ): Promise<string> {
      const tx = db.transaction(META_STORE, "readwrite")
      const store = tx.objectStore(META_STORE)
      const existing = await promisify<
        { key: string; value: string } | undefined
      >(store.get(CLIENT_INSTANCE_KEY))
      if (existing) {
        return existing.value
      }
      const minted = mintClientInstanceId()
      store.put({ key: CLIENT_INSTANCE_KEY, value: minted })
      return minted
    }

    clientInstanceId(): string {
      return this.instanceId
    }

    private async nextSeq(): Promise<number> {
      const tx = this.db.transaction(META_STORE, "readwrite")
      const store = tx.objectStore(META_STORE)
      const existing = await promisify<
        { key: string; value: number } | undefined
      >(store.get(SEQ_COUNTER_KEY))
      const next = (existing?.value ?? 0) + 1
      store.put({ key: SEQ_COUNTER_KEY, value: next })
      return next
    }

    async recordAnswer(
      input: {
        attemptId: string
        sectionId: string
        questionId: string
        selectedChoiceIds: string[]
        timeSpentMs: number | null
      },
      now: Date,
    ): Promise<QueuedAnswer> {
      const seq = await this.nextSeq()
      const record: QueuedAnswer & { key: string } = {
        key: keyFor(input.attemptId, input.questionId),
        attemptId: input.attemptId,
        sectionId: input.sectionId,
        questionId: input.questionId,
        clientInstanceId: this.instanceId,
        seq,
        selectedChoiceIds: input.selectedChoiceIds,
        answeredAt: now.toISOString(),
        timeSpentMs: input.timeSpentMs,
        terminalRejection: false,
      }

      const tx = this.db.transaction(QUEUE_STORE, "readwrite")
      tx.objectStore(QUEUE_STORE).put(record)
      await promisify(tx.objectStore(QUEUE_STORE).get(record.key))

      return record
    }

    async snapshotForSection(
      attemptId: string,
      sectionId: string,
    ): Promise<QueuedAnswer[]> {
      const tx = this.db.transaction(QUEUE_STORE, "readonly")
      const all = await promisify<QueuedAnswer[]>(
        tx.objectStore(QUEUE_STORE).getAll(),
      )
      return all.filter(
        (record) =>
          record.attemptId === attemptId &&
          record.sectionId === sectionId &&
          !record.terminalRejection,
      )
    }

    /**
     * Cleared only on a per-item ack, never on request completion, and only
     * when the ack is not stale relative to what is queued right now -- a
     * newer local edit made while the ack was in flight must survive it.
     */
    async ackItem(
      attemptId: string,
      questionId: string,
      ackedSeq: number,
    ): Promise<void> {
      const key = keyFor(attemptId, questionId)
      const tx = this.db.transaction(QUEUE_STORE, "readwrite")
      const store = tx.objectStore(QUEUE_STORE)
      const current = await promisify<
        (QueuedAnswer & { key: string }) | undefined
      >(store.get(key))
      if (current && current.seq <= ackedSeq) {
        store.delete(key)
      }
    }

    async markTerminalRejection(
      attemptId: string,
      questionId: string,
    ): Promise<void> {
      const key = keyFor(attemptId, questionId)
      const tx = this.db.transaction(QUEUE_STORE, "readwrite")
      const store = tx.objectStore(QUEUE_STORE)
      const current = await promisify<
        (QueuedAnswer & { key: string }) | undefined
      >(store.get(key))
      if (current) {
        store.put({ ...current, terminalRejection: true })
      }
    }

    async close(): Promise<void> {
      this.db.close()
    }
  }
  ```

- [ ] **Step 5: Run, gates**

  Run: `pnpm --filter @pp/app test answerQueue`
  Expected: PASS, all six cases.

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

  Do NOT run `git add` and do NOT commit.

---

### Task 9: The client flush controller — rule 2 (client half), rule 3 (client half), retry integration

Builds a `ResponseSnapshot` body from whatever the queue holds for one section, sends it, and reconciles the server's per-item results against the local queue — acking what applied, marking terminal what was rejected non-retryably, and retrying what failed transiently, using Task 7's classifier and an **injectable** scheduler so no test sleeps.

**Files:**

- Create: `packages/app/src/lib/flushController.ts`
- Create: `packages/app/test/flushController.test.ts`

**Interfaces:**

- Consumes: `AnswerQueue` (Task 8); `classifyForRetry` (Task 7).
- Produces:

  ```ts
  export type Scheduler = (delayMs: number) => Promise<void>

  export interface FlushHttp {
    patch(
      url: string,
      body: unknown,
    ): Promise<
      | { kind: "network-error" }
      | { kind: "ok"; status: number; body: { results: ItemAckResult[] } }
      | { kind: "http-error"; status: number; body: unknown }
    >
  }

  export interface ItemAckResult {
    questionId: string
    status: "applied" | "ignored_stale" | "rejected"
  }

  export class FlushController {
    constructor(queue: AnswerQueue, http: FlushHttp, scheduler: Scheduler)
    async flushSection(
      attemptId: string,
      sectionId: string,
      url: string,
      maxAttempts?: number,
    ): Promise<{ flushed: boolean }>
  }
  ```

  Task 10's `pagehide` handler and submit-remainder builder both call `queue.snapshotForSection` directly rather than through `FlushController` — a `keepalive` fetch cannot await a retry loop, so it is a one-shot send, not a use of this controller.

- [ ] **Step 1: Write the failing tests — no real network, no real sleep**

  `packages/app/test/flushController.test.ts`:

  ```ts
  import "fake-indexeddb/auto"
  import { beforeEach, describe, expect, it, vi } from "vitest"
  import { AnswerQueue } from "../src/lib/answerQueue.js"
  import {
    FlushController,
    type FlushHttp,
  } from "../src/lib/flushController.js"

  const NOW = new Date("2026-08-27T09:00:00.000Z")

  beforeEach(() => {
    indexedDB.deleteDatabase("pp-flush-test")
  })

  function fakeScheduler(): {
    schedule: (delayMs: number) => Promise<void>
    delays: number[]
  } {
    const delays: number[] = []
    return {
      delays,
      schedule: async (delayMs: number) => {
        delays.push(delayMs)
        // No real timer: the point of injecting the scheduler is that this
        // test never actually waits.
      },
    }
  }

  describe("FlushController", () => {
    it("sends every queued answer for the section as one snapshot and acks applied items", async () => {
      const queue = await AnswerQueue.open("pp-flush-test")
      const recorded = await queue.recordAnswer(
        {
          attemptId: "a1",
          sectionId: "s1",
          questionId: "q1",
          selectedChoiceIds: ["c1"],
          timeSpentMs: null,
        },
        NOW,
      )

      const http: FlushHttp = {
        patch: vi.fn().mockResolvedValue({
          kind: "ok",
          status: 200,
          body: { results: [{ questionId: "q1", status: "applied" }] },
        }),
      }
      const scheduler = fakeScheduler()
      const controller = new FlushController(queue, http, scheduler.schedule)

      const result = await controller.flushSection(
        "a1",
        "s1",
        "/attempts/a1/responses",
      )

      expect(result.flushed).toBe(true)
      expect(http.patch).toHaveBeenCalledWith(
        "/attempts/a1/responses",
        expect.objectContaining({
          responses: [
            expect.objectContaining({ questionId: "q1", seq: recorded.seq }),
          ],
        }),
      )
      const remaining = await queue.snapshotForSection("a1", "s1")
      expect(remaining).toHaveLength(0)
    })

    it("marks a rejected item terminal and excludes it from the next flush, without retrying it", async () => {
      const queue = await AnswerQueue.open("pp-flush-test")
      await queue.recordAnswer(
        {
          attemptId: "a1",
          sectionId: "s1",
          questionId: "q1",
          selectedChoiceIds: ["c1"],
          timeSpentMs: null,
        },
        NOW,
      )

      const http: FlushHttp = {
        patch: vi.fn().mockResolvedValue({
          kind: "ok",
          status: 200,
          body: { results: [{ questionId: "q1", status: "rejected" }] },
        }),
      }
      const scheduler = fakeScheduler()
      const controller = new FlushController(queue, http, scheduler.schedule)

      await controller.flushSection("a1", "s1", "/attempts/a1/responses")

      const remaining = await queue.snapshotForSection("a1", "s1")
      expect(remaining).toHaveLength(0)
      expect(http.patch).toHaveBeenCalledTimes(1)
    })

    it("retries a network error with backoff via the injected scheduler, then succeeds -- no real sleep", async () => {
      const queue = await AnswerQueue.open("pp-flush-test")
      await queue.recordAnswer(
        {
          attemptId: "a1",
          sectionId: "s1",
          questionId: "q1",
          selectedChoiceIds: ["c1"],
          timeSpentMs: null,
        },
        NOW,
      )

      const patch = vi
        .fn()
        .mockResolvedValueOnce({ kind: "network-error" })
        .mockResolvedValueOnce({
          kind: "ok",
          status: 200,
          body: { results: [{ questionId: "q1", status: "applied" }] },
        })
      const http: FlushHttp = { patch }
      const scheduler = fakeScheduler()
      const controller = new FlushController(queue, http, scheduler.schedule)

      const result = await controller.flushSection(
        "a1",
        "s1",
        "/attempts/a1/responses",
      )

      expect(result.flushed).toBe(true)
      expect(patch).toHaveBeenCalledTimes(2)
      expect(scheduler.delays).toHaveLength(1)
      expect(scheduler.delays[0]).toBeGreaterThan(0)
    })

    it("stops dead on a non-retryable 4xx without calling the scheduler", async () => {
      const queue = await AnswerQueue.open("pp-flush-test")
      await queue.recordAnswer(
        {
          attemptId: "a1",
          sectionId: "s1",
          questionId: "q1",
          selectedChoiceIds: ["c1"],
          timeSpentMs: null,
        },
        NOW,
      )

      const http: FlushHttp = {
        patch: vi
          .fn()
          .mockResolvedValue({ kind: "http-error", status: 400, body: {} }),
      }
      const scheduler = fakeScheduler()
      const controller = new FlushController(queue, http, scheduler.schedule)

      const result = await controller.flushSection(
        "a1",
        "s1",
        "/attempts/a1/responses",
      )

      expect(result.flushed).toBe(false)
      expect(http.patch).toHaveBeenCalledTimes(1)
      expect(scheduler.delays).toHaveLength(0)
    })
  })
  ```

- [ ] **Step 2: Run to verify it fails**

  Run: `pnpm --filter @pp/app test flushController`
  Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

  `packages/app/src/lib/flushController.ts`:

  ```ts
  import type { AnswerQueue } from "./answerQueue.js"
  import { classifyForRetry } from "./retryClassifier.js"

  export type Scheduler = (delayMs: number) => Promise<void>

  export interface ItemAckResult {
    questionId: string
    status: "applied" | "ignored_stale" | "rejected"
  }

  export interface FlushHttp {
    patch(
      url: string,
      body: unknown,
    ): Promise<
      | { kind: "network-error" }
      | { kind: "ok"; status: number; body: { results: ItemAckResult[] } }
      | { kind: "http-error"; status: number; body: unknown }
    >
  }

  const DEFAULT_MAX_ATTEMPTS = 5

  /**
   * Rule 2's client half (snapshot, not delta -- every item currently queued
   * for the section, every attempt) and rule 3's client half (one rejected
   * item's ack does not stop the others from being acked). Rule 5 governs
   * whether a FAILED request is retried at all; classifyForRetry (Task 7) is
   * the single source of truth for that, never re-decided here.
   */
  export class FlushController {
    constructor(
      private readonly queue: AnswerQueue,
      private readonly http: FlushHttp,
      private readonly scheduler: Scheduler,
    ) {}

    async flushSection(
      attemptId: string,
      sectionId: string,
      url: string,
      maxAttempts = DEFAULT_MAX_ATTEMPTS,
    ): Promise<{ flushed: boolean }> {
      const items = await this.queue.snapshotForSection(attemptId, sectionId)
      if (items.length === 0) {
        return { flushed: true }
      }

      const body = {
        clientInstanceId: this.queue.clientInstanceId(),
        responses: items.map((item) => ({
          questionId: item.questionId,
          seq: item.seq,
          selectedChoiceIds: item.selectedChoiceIds,
          answeredAt: item.answeredAt,
          timeSpentMs: item.timeSpentMs ?? undefined,
        })),
      }

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const response = await this.http.patch(url, body)

        if (response.kind === "ok") {
          await this.reconcile(attemptId, items, response.body.results)
          return { flushed: true }
        }

        const classification = classifyForRetry(
          response.kind === "network-error"
            ? { kind: "network-error" }
            : { kind: "http-status", status: response.status },
          attempt,
        )

        if (!classification.retry) {
          return { flushed: false }
        }

        await this.scheduler(classification.backoffMs)
      }

      return { flushed: false }
    }

    private async reconcile(
      attemptId: string,
      items: { questionId: string; seq: number }[],
      results: ItemAckResult[],
    ): Promise<void> {
      const seqByQuestion = new Map(
        items.map((item) => [item.questionId, item.seq]),
      )

      for (const result of results) {
        const seq = seqByQuestion.get(result.questionId)
        if (seq === undefined) {
          continue
        }

        if (result.status === "applied" || result.status === "ignored_stale") {
          await this.queue.ackItem(attemptId, result.questionId, seq)
        } else {
          // Rejected: non-retryable per rule 5. The server has already
          // captured it durably (spec S5 rule 4); the client stops asking
          // and stops resending it on every future flush.
          await this.queue.markTerminalRejection(attemptId, result.questionId)
        }
      }
    }
  }
  ```

- [ ] **Step 4: Run, gates**

  Run: `pnpm --filter @pp/app test flushController`
  Expected: PASS, all four cases — the retry case in particular must complete without the test file ever calling a real timer.

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

  Do NOT run `git add` and do NOT commit.

---

### Task 10: `pagehide` keepalive flush and the submit remainder — rule 6

Two related, narrow pieces: a `pagehide` listener that fires a one-shot `keepalive` `fetch` (a retry loop cannot run during page teardown, so this does not go through `FlushController`), and a function that assembles whatever the queue **still** holds at the moment it is called — proving it reads live state, not a snapshot taken earlier, which is the exact race spec §5 rule 6 names.

**Files:**

- Create: `packages/app/src/lib/lifecycleFlush.ts`
- Create: `packages/app/test/lifecycleFlush.test.ts`

**Interfaces:**

- Consumes: `AnswerQueue` (Task 8).
- Produces:

  ```ts
  export function registerPagehideFlush(
    queue: AnswerQueue,
    getOpenSection: () => { attemptId: string; sectionId: string } | null,
    urlFor: (attemptId: string) => string,
    fetchImpl?: typeof fetch,
  ): () => void // returns an unregister function

  export async function buildSubmitRemainder(
    queue: AnswerQueue,
    attemptId: string,
  ): Promise<{
    clientInstanceId: string
    responses: {
      questionId: string
      seq: number
      selectedChoiceIds: string[]
      answeredAt: string
      timeSpentMs?: number
    }[]
  }>
  ```

- [ ] **Step 1: Write the failing tests**

  `packages/app/test/lifecycleFlush.test.ts`. Assumes `jsdom` or `happy-dom` as the Vitest environment (per plan 3) so `window`/`PageTransitionEvent` exist; if plan 3's environment differs, add a `// @vitest-environment jsdom` comment at the top of this file rather than changing the project-wide config.

  ```ts
  import "fake-indexeddb/auto"
  import { beforeEach, describe, expect, it, vi } from "vitest"
  import { AnswerQueue } from "../src/lib/answerQueue.js"
  import {
    buildSubmitRemainder,
    registerPagehideFlush,
  } from "../src/lib/lifecycleFlush.js"

  const NOW = new Date("2026-08-27T09:00:00.000Z")

  beforeEach(() => {
    indexedDB.deleteDatabase("pp-lifecycle-test")
  })

  describe("registerPagehideFlush", () => {
    it("sends a keepalive PATCH with the open section's queued snapshot on pagehide", async () => {
      const queue = await AnswerQueue.open("pp-lifecycle-test")
      await queue.recordAnswer(
        {
          attemptId: "a1",
          sectionId: "s1",
          questionId: "q1",
          selectedChoiceIds: ["c1"],
          timeSpentMs: null,
        },
        NOW,
      )

      const fetchSpy = vi
        .fn()
        .mockResolvedValue(new Response(null, { status: 200 }))
      const unregister = registerPagehideFlush(
        queue,
        () => ({ attemptId: "a1", sectionId: "s1" }),
        (attemptId) => `/attempts/${attemptId}/responses`,
        fetchSpy,
      )

      window.dispatchEvent(new Event("pagehide"))
      // pagehide handlers that call fetch cannot be awaited by the browser
      // and this handler does not await internally either -- give the
      // microtask queue one tick to let the fire-and-forget call happen.
      await Promise.resolve()

      expect(fetchSpy).toHaveBeenCalledWith(
        "/attempts/a1/responses",
        expect.objectContaining({
          method: "PATCH",
          keepalive: true,
          body: expect.stringContaining("q1"),
        }),
      )

      unregister()
    })

    it("does nothing when no section is open", async () => {
      const queue = await AnswerQueue.open("pp-lifecycle-test")
      const fetchSpy = vi.fn()
      const unregister = registerPagehideFlush(
        queue,
        () => null,
        (attemptId) => `/attempts/${attemptId}/responses`,
        fetchSpy,
      )

      window.dispatchEvent(new Event("pagehide"))
      await Promise.resolve()

      expect(fetchSpy).not.toHaveBeenCalled()
      unregister()
    })
  })

  describe("buildSubmitRemainder", () => {
    it("reads the queue live at call time -- the narrower race spec S5 rule 6 names", async () => {
      const queue = await AnswerQueue.open("pp-lifecycle-test")

      // Simulates: the client's own pre-submit check found the queue empty
      // for this attempt...
      const emptyCheck = await queue.snapshotForSection("a1", "s1")
      expect(emptyCheck).toHaveLength(0)

      // ...but an answer lands in the queue AFTER that check and BEFORE
      // buildSubmitRemainder is actually called -- the race window the
      // client cannot close by checking earlier.
      await queue.recordAnswer(
        {
          attemptId: "a1",
          sectionId: "s1",
          questionId: "q1",
          selectedChoiceIds: ["c1"],
          timeSpentMs: null,
        },
        NOW,
      )

      const remainder = await buildSubmitRemainder(queue, "a1")

      expect(remainder.responses).toHaveLength(1)
      expect(remainder.responses[0].questionId).toBe("q1")
    })

    it("carries every section's remainder for the attempt, not just one", async () => {
      const queue = await AnswerQueue.open("pp-lifecycle-test")
      await queue.recordAnswer(
        {
          attemptId: "a1",
          sectionId: "s1",
          questionId: "q1",
          selectedChoiceIds: ["c1"],
          timeSpentMs: null,
        },
        NOW,
      )
      await queue.recordAnswer(
        {
          attemptId: "a1",
          sectionId: "s2",
          questionId: "q2",
          selectedChoiceIds: ["c2"],
          timeSpentMs: null,
        },
        NOW,
      )

      const remainder = await buildSubmitRemainder(queue, "a1")

      expect(remainder.responses.map((item) => item.questionId).sort()).toEqual(
        ["q1", "q2"],
      )
    })
  })
  ```

- [ ] **Step 2: Run to verify it fails**

  Run: `pnpm --filter @pp/app test lifecycleFlush`
  Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

  `packages/app/src/lib/lifecycleFlush.ts`:

  ```ts
  import type { AnswerQueue } from "./answerQueue.js"

  /**
   * pagehide, not beforeunload: pagehide fires reliably on mobile Safari's
   * tab-close and app-switch paths, which is where a real attempt is most
   * likely to end abruptly. keepalive:true is what lets the request outlive
   * the page -- no retry loop can run during teardown, so this is a one-shot
   * send, never routed through FlushController.
   */
  export function registerPagehideFlush(
    queue: AnswerQueue,
    getOpenSection: () => { attemptId: string; sectionId: string } | null,
    urlFor: (attemptId: string) => string,
    fetchImpl: typeof fetch = fetch,
  ): () => void {
    const handler = (): void => {
      const open = getOpenSection()
      if (!open) {
        return
      }

      void queue
        .snapshotForSection(open.attemptId, open.sectionId)
        .then((items) => {
          if (items.length === 0) {
            return
          }
          const body = {
            clientInstanceId: queue.clientInstanceId(),
            responses: items.map((item) => ({
              questionId: item.questionId,
              seq: item.seq,
              selectedChoiceIds: item.selectedChoiceIds,
              answeredAt: item.answeredAt,
              timeSpentMs: item.timeSpentMs ?? undefined,
            })),
          }
          void fetchImpl(urlFor(open.attemptId), {
            method: "PATCH",
            keepalive: true,
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          })
        })
    }

    window.addEventListener("pagehide", handler)
    return () => window.removeEventListener("pagehide", handler)
  }

  /**
   * Called by the submit flow right before POST /submit. Reads the queue
   * LIVE, not a snapshot captured by an earlier "is the queue empty" check --
   * that earlier check exists so the client can decide whether it is even
   * safe to offer Hand in, but an answer landing between that check and this
   * call is exactly the race spec S5 rule 6 exists to close, and only a
   * fresh read here closes it.
   */
  export async function buildSubmitRemainder(
    queue: AnswerQueue,
    attemptId: string,
  ): Promise<{
    clientInstanceId: string
    responses: {
      questionId: string
      seq: number
      selectedChoiceIds: string[]
      answeredAt: string
      timeSpentMs?: number
    }[]
  }> {
    // buildSubmitRemainder does not know the attempt's section ids up front,
    // so it cannot call snapshotForSection per section the way the flush
    // controller does -- it needs every queued record for this attempt,
    // across whichever sections still hold something. See Step 3a.
    const items = await queue.snapshotForAttempt(attemptId)

    return {
      clientInstanceId: queue.clientInstanceId(),
      responses: items.map((item) => ({
        questionId: item.questionId,
        seq: item.seq,
        selectedChoiceIds: item.selectedChoiceIds,
        answeredAt: item.answeredAt,
        timeSpentMs: item.timeSpentMs ?? undefined,
      })),
    }
  }
  ```

- [ ] **Step 3a: `buildSubmitRemainder` needs a cross-section read `AnswerQueue` does not have yet — add it to Task 8's `AnswerQueue`, not around it**

  `snapshotForSection` (Task 8) is scoped to one section by design — the flush controller only ever flushes the open section. `buildSubmitRemainder` needs every section's remainder at once, which is a real gap in Task 8's interface, not something to work around locally. Add to `packages/app/src/lib/answerQueue.ts`'s `AnswerQueue` class, alongside `snapshotForSection`:

  ```ts
  async snapshotForAttempt(attemptId: string): Promise<QueuedAnswer[]> {
    const tx = this.db.transaction(QUEUE_STORE, "readonly")
    const all = await promisify<QueuedAnswer[]>(tx.objectStore(QUEUE_STORE).getAll())
    return all.filter(
      (record) => record.attemptId === attemptId && !record.terminalRejection,
    )
  }
  ```

  Add one case to `packages/app/test/answerQueue.test.ts` proving it — a two-section attempt (`s1`/`q1`, `s2`/`q2`), asserting `snapshotForAttempt("a1")` returns both while `snapshotForSection("a1", "s1")` still returns only `q1`. Run `pnpm --filter @pp/app test answerQueue` to confirm this addition is green before moving on — it is Task 8's interface gaining a method, so it gets Task 8's own red/green cycle, not a silent addition inside this task.

- [ ] **Step 4: Run, gates**

  Run: `pnpm --filter @pp/app test`
  Expected: PASS — `lifecycleFlush` (4 cases), the new `answerQueue` case, and every earlier `packages/app` suite from Tasks 7–9.

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

  Do NOT run `git add` and do NOT commit.

---

## Definition of Done

- [ ] `pnpm lint`, `pnpm format`, `pnpm typecheck`, `pnpm test` all exit 0
- [ ] `grep -rn "new Date()\|Date\.now()" packages/{common,db,server}/src` reports only comments, never a call
- [ ] Every one of spec §5's six rules and its Ordering subsection has at least one task and at least one test that can fail — see the rule map in this plan's closing report
- [ ] The reorder guard is proven with a REAL lower `seq` (Task 4), not merely asserted
- [ ] The 413 path is proven with an ACTUAL oversized body whose bytes are recovered from `failed_write.raw_body` (Task 3), not a mocked size check
- [ ] The retry classifier is proven per status class, including the explicit 409-is-a-storm case (Task 7)
- [ ] `FailedWriteCaptureFilter` is registered in the same commit as `ZodBodyValidationPipe`, and a test proves the filter captures a payload the pipe rejected (Task 3)
- [ ] `Clock` is injected everywhere a timestamp is produced; no test sleeps — every backoff and expiry check in this plan's tests uses a fixed clock or an injected scheduler
- [ ] Attempt-level expiry finalization (grading-dependent) is explicitly out of scope and named as such (Task 6), not silently faked
