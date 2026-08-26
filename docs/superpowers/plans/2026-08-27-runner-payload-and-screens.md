# Runner Payload and Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the attempt-runner surface — the canonical `GET /attempts/{id}` envelope, section entry, media play, and position — then stand up `packages/app` (Vite + React 19, components from `@liam-public/browser-react-ui`) and build the section-rules, listening and reading screens against the real API. Delete `packages/socket` and `packages/web` once `app` runs in their place.

**Architecture:** Four new routes join plan 2's eight on `packages/server`, all behind `JwksGuard`, all reading/writing through `@pp/db` repositories on `REQUEST_POOL`. `packages/app` is a new workspace member: TanStack Router file-based routing, Tailwind v4, i18n across six locales, talking to the server over plain `fetch` with a bearer token.

**Tech Stack (server, unchanged from plan 2):** NestJS 11 · Node 24 · TypeScript 6 (ESM, `nodenext`) · PostgreSQL 16 · Vitest 4 · supertest · testcontainers

**Tech Stack (app, new):** Vite 8 · React 19 · TypeScript 6 · `@tanstack/react-router` `^1.170.32` + `@tanstack/router-plugin` `^1.168.35` · Tailwind v4 (`@tailwindcss/vite` `^4.3.3`) · `@liam-public/browser-react-ui` `^0.1.0` · `radix-ui` `^1.6.7` (the kit's own primitive layer, used directly where the kit has no matching component) · `i18next`/`react-i18next` (harvested pattern) · Vitest 4 + `@testing-library/react` `^16.3.2` + `@testing-library/jest-dom` `^7.0.1` + `@testing-library/user-event` `^14.6.6` + `jsdom` `^30.0.1`

**Spec:** `docs/superpowers/specs/2026-08-25-toefl-primary-fork-design.md` (phase 3 of §8)

**What plan 2 already delivered (do not re-plan it):** `POST /session`, `GET /me`, `GET /tests`, `GET /tests/{slug}`, `POST /attempts`, `POST /admin/tests/import`, `POST /admin/tests/{id}/publish`, `GET /admin/tests/{id}/export`, `POST /admin/media`; `JwksGuard`/`AdminGuard`/`@CurrentStudent()`; `DatabaseModule` (`REQUEST_POOL`, `JOB_POOL`, `CLOCK` tokens); the e2e harness `createTestApp`/`TokenFactory` in `packages/server/test/helpers/`; `loadForRunner` (the content-only projection, deliberately missing `status`/`completedAt`/`expiresAt` — see Decision 1); `@pp/db/scoring` and `@pp/common/scoring` (the answer-key fence). Plan 2's Task 9 names `finalizeExpiredAttempt` in its Files table but only sketches it inline (set `status`/`submitted_at`, nothing else) — Task 1 below is the real implementation, and plan 2's inline sketch must be corrected to call it. See Decision 2.

**Explicit non-goal — the durable write path stays out.** `PUT /attempts/{id}/responses/{questionId}`, `PATCH /attempts/{id}/responses`, the IndexedDB queue, the reorder guard, and `failed_write` capture are phase 4 and this plan does not touch them. The listening and reading screens render whatever `responses` the runner envelope already carries (read-only, from seeded fixtures or a future phase's writes) and hold new selections in local component state only — there is nowhere to send a save yet. Every screen component that touches a choice carries a `// PHASE 4:` comment at the point a real save call will replace the local `setState`, so the seam is visible rather than silently absent.

## Decision 1: the three fields `loadForRunner` cannot supply

`docs/architecture/plan-2-preconditions.md` item 5 is explicit: `RunnerSection.status`/`completedAt`/`expiresAt` are composed from `attempt_section` **alongside** the content projection, never invented as constants and never added to `loadForRunner` itself. Task 2 below does exactly that in a new `packages/db/src/repositories/runner.repository.ts`, leaving `loadForRunner` untouched.

## Decision 2 (flagged for ruling — see report): lazy-expiry finalization needs real grading

`GET /attempts/{id}`, `POST …/sections/{id}/enter`, `POST …/stimuli/{id}/play` and `PUT …/position` all carry a `410` "attempt expired, finalized by this request" response in `openapi.yaml`, and `attempt_finished_is_graded` (`docs/db/schema.sql:344`) makes it a `CHECK` violation to set `status <> 'in_progress'` without populating every score column. There is no cheaper path: any endpoint that can observe an expired attempt must be able to grade it. Task 1 builds a minimal grading kernel — `scoreAttempt` (pure) plus `finalizeExpiredAttempt` (the DB write) — reusing `@pp/db/scoring`, which plan 2 Task 5 restricted to "Task 10's export route and plan 5's grading." This plan extends that allowlist to include lazy-expiry finalization. Nothing new is exposed to a student: the wire response never carries `isCorrect`, only the aggregate counts `attempt_finished_is_graded` already requires to exist.

Section-level closing (`attempt_section.completed_at`) is **not** built here. Re-reading the contract: `enterSection`'s `409` is "a previous section is still open," not "close it and proceed" — closing a section is a side effect of the phase-4/5 write path (the last answer in a forward-only section, or a `Next`/`Hand in` action once writes exist), not of section entry. Phase 3's `enterSection` tests exercise the `409` by seeding an open `attempt_section` row directly via SQL fixture, not by driving a real transition through the app — the app cannot reach section 2 through its own UI until phase 4 lands, and that is expected, not a bug in this plan.

## Decision 3 (flagged for ruling): no sign-in screen, no OIDC yet

`docs/architecture/library-adoption.md` files `@liam-workspace/auth-client`, `@liam-public/browser-react-auth`, `@liam-public/browser-webauthn` and `@liam-public/auth-fetch` under "client (plans 4–5)" — but this plan is the one the spec's own build order (§8) calls "phase 3," and phase 3's scope is explicitly "the listening and reading screens," not the sign-in screen (prototype screen 1 of 12). Building real OIDC + PKCE + passkey here would mean building a whole screen and flow this plan was not asked for. `packages/app` therefore ships a **dev-only bearer seam** — `src/lib/dev-auth.ts` reads `VITE_DEV_BEARER_TOKEN` from the Vite env and is the only source of a token until the sign-in screen's plan replaces it. This is a scope call, not a technical necessity; the two documents disagree about which plan owns these packages, and Task 6 records the seam precisely so it is easy to delete when that plan lands.

## Decision 4: frontend test tooling

Nothing in the spec or `library-adoption.md` names a frontend test runner. `@liam-public/browser-react-ui` itself is built and tested with `vitest run --environment jsdom` + `@testing-library/react` (verified: `packages/public/react/browser-react-ui/package.json` in `typescript-libraries`) — this plan adopts the same pair for `packages/app`, plus `@testing-library/jest-dom` for matchers and `@testing-library/user-event` for interaction. No MSW: `library-adoption.md` names no HTTP-mocking library, so component tests stub `globalThis.fetch` directly with `vi.fn()`. Full browser e2e (Playwright, per the `node-browser-automation` decline note) is out of scope for this plan.

## Global Constraints

- Every new server file follows plan 2's conventions: ESM, `nodenext`, ids branded via `@pp/common`, repositories take `PgQueryable` and never construct a pool.
- **No `new Date()` / `Date.now()`** in `packages/{common,db,server,app}/src`. Server code takes `CLOCK`; `packages/app` reads server time from `RunnerEnvelope.serverTime`/`SectionEntry.serverTime` for any countdown, never the browser clock, so a wrong device clock cannot desync a timer. Verify with `grep -rn "new Date()\|Date\.now()" packages/{common,db,server,app}/src`.
- **`docs/api/openapi.yaml` is the contract.** Quote it; a paraphrase is a defect per the authoring guide's item 4. `redocly lint docs/api/openapi.yaml` must stay clean.
- **All four gates before every commit:** `pnpm lint && pnpm format && pnpm typecheck && pnpm test`.
- **Never write `git add -A` or a commit command into a step** — every step in this plan ends its task with the four gates and nothing else; staging and committing is the reviewer's job, exactly as plan 2's later tasks record.
- **Check `docs/architecture/library-adoption.md` before adding any dependency not already named in this plan's Tech Stack line.**
- Postgres returns `numeric`/`bigint` as strings (verified in plan 2). Any new query touching `percentage`, `count(*)`, or `points_*` arithmetic converts with `Number(...)` at the repository boundary and the test asserts `typeof`.
- `pnpm-workspace.yaml` currently narrows `packages:` to `common`, `db`, `server` specifically because `socket`/`web` still import the renamed `@razzia/common` and would break `pnpm install` if globbed. Task 6 adds `packages/app` to that list (unaffected by the `web`/`socket` problem); Task 12 removes `socket`/`web` from disk and restores `packages/*` for the whole comment's concern to lapse.

## File Structure

| File                                                           | Responsibility                                                                                      |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `packages/common/src/scoring.ts`                               | Task 1: add the pure `scoreAttempt` function                                                        |
| `packages/db/src/repositories/attempt.repository.ts`           | Task 1: `finalizeExpiredAttempt`, `loadOwnedAttempt`; Task 3: `enterSection`; Task 5: `setPosition` |
| `packages/db/src/repositories/runner.repository.ts`            | Task 2: `loadRunnerEnvelope`                                                                        |
| `packages/db/src/repositories/media-play.repository.ts`        | Task 4: `claimPlay`, `isFilenameCapped`                                                             |
| `packages/server/src/attempts/*`                               | Tasks 2–5: controller/service/module for all four routes                                            |
| `packages/server/src/media/*`                                  | Task 4: signing util, static `/media/:filename` controller                                          |
| `packages/app/*`                                               | Task 6: scaffold; Task 7: i18n; Task 8: media component + API client; Tasks 9–11: screens           |
| `oxlint.config.ts`, `pnpm-workspace.yaml`, root `package.json` | Task 6 (add `app`), Task 12 (remove `socket`/`web`)                                                 |

---

### Task 1: Lazy-expiry finalization — the grading kernel

This is the prerequisite every other task in this plan calls. Read Decision 2 before writing a line: the goal is the minimum grading that satisfies `attempt_finished_is_graded`, not the full `/result` breakdown (that stays phase 5's).

**Files:**

- Modify: `packages/common/src/scoring.ts`
- Create: `packages/common/test/scoring.test.ts`
- Modify: `packages/db/src/repositories/attempt.repository.ts` (new file — plan 2 Task 9 was meant to create it; if this plan lands first, create it here and note in your report that plan 2 Task 9 must extend it rather than recreate it)
- Create: `packages/db/test/attempt-repository.test.ts` (extend if plan 2 Task 9 already created it)

**Interfaces:**

- Consumes: `loadForScoring` from `@pp/db/scoring`; `ScoringQuestion`/`ScoringChoice` from `@pp/common/scoring`; `Clock` from `@pp/common`.
- Produces:

  ```ts
  // packages/common/src/scoring.ts (append)
  export interface RecordedAnswer {
    questionId: QuestionId
    selectedChoiceIds: ChoiceId[]
  }

  export interface AttemptScoreSummary {
    pointsEarned: number
    pointsPossible: number
    percentage: number
    answeredCount: number
    unansweredCount: number
    correctCount: number
    incorrectCount: number
    questionCount: number
  }

  /**
   * Pure. A question is correct when the selected set equals the correct
   * set exactly — single_choice's "exactly one correct" and multi_choice's
   * "all of them, none extra" are the same rule once expressed as set
   * equality, so there is one comparison, not two branches by type.
   */
  export function scoreAttempt(
    questions: ScoringQuestion[],
    answers: RecordedAnswer[],
  ): AttemptScoreSummary
  ```

  ```ts
  // packages/db/src/repositories/attempt.repository.ts
  export interface AttemptRow {
    id: string
    studentId: string
    testVersionId: string
    status: "in_progress" | "submitted" | "expired"
    startedAt: Date | null
    expiresAt: Date | null
    currentSectionId: string | null
    currentQuestionId: string | null
  }

  /** Scoped by BOTH id and studentId — a mismatch and a nonexistent id are
   * indistinguishable to the caller, which is what makes 403 (not 404) safe. */
  export async function loadOwnedAttempt(
    db: PgQueryable,
    input: { attemptId: string; studentId: string },
  ): Promise<AttemptRow | null>

  export interface FinalizedAttemptRow {
    id: string
    status: "expired"
    submittedAt: Date
  }

  /**
   * Idempotent: if `attempt.status` is already terminal, returns the
   * existing row without re-grading (re-running scoreAttempt on the same
   * frozen content and responses would be safe but wasteful, and a second
   * write past a CHECK-satisfied row is pure risk for no benefit).
   */
  export async function finalizeExpiredAttempt(
    db: PgQueryable,
    input: { attemptId: string; now: Date },
  ): Promise<FinalizedAttemptRow>
  ```

- [ ] **Step 1: Write the failing pure-scoring tests**

  `packages/common/test/scoring.test.ts`:

  ```ts
  it("awards points when the selected set exactly matches the correct set", …)
  it("awards nothing for a partial multi_choice selection", …)          // e.g. 2 of 3 correct selected
  it("awards nothing for a selection with one extra wrong choice", …)
  it("counts a question with no recorded answer as unanswered, not incorrect", …)
  it("sums pointsPossible from every question regardless of answer state", …)
  it("computes percentage as pointsEarned / pointsPossible * 100, rounded to 2 places", …)
  it("returns all-zero-but-questionCount for zero recorded answers", …)  // the phase-3 case: nothing written yet
  ```

  Run: `pnpm --filter @pp/common test scoring` → FAIL, module has no `scoreAttempt` export.

- [ ] **Step 2: Implement `scoreAttempt`**

  ```ts
  export function scoreAttempt(
    questions: ScoringQuestion[],
    answers: RecordedAnswer[],
  ): AttemptScoreSummary {
    const byQuestion = new Map(answers.map((a) => [a.questionId, a]))
    let pointsEarned = 0
    let pointsPossible = 0
    let correctCount = 0
    let incorrectCount = 0
    let answeredCount = 0

    for (const question of questions) {
      pointsPossible += question.points
      const answer = byQuestion.get(question.id)

      if (!answer || answer.selectedChoiceIds.length === 0) {
        continue
      }

      answeredCount += 1
      const correctIds = new Set(
        question.choices.filter((c) => c.isCorrect).map((c) => c.id),
      )
      const selectedIds = new Set(answer.selectedChoiceIds)
      const isCorrect =
        correctIds.size === selectedIds.size &&
        [...correctIds].every((id) => selectedIds.has(id))

      if (isCorrect) {
        correctCount += 1
        pointsEarned += question.points
      } else {
        incorrectCount += 1
      }
    }

    return {
      pointsEarned,
      pointsPossible,
      percentage:
        pointsPossible === 0
          ? 0
          : Math.round((pointsEarned / pointsPossible) * 10000) / 100,
      answeredCount,
      unansweredCount: questions.length - answeredCount,
      correctCount,
      incorrectCount,
      questionCount: questions.length,
    }
  }
  ```

  Run: `pnpm --filter @pp/common test scoring` → PASS, all seven.

- [ ] **Step 3: Write the failing DB tests for `finalizeExpiredAttempt` and `loadOwnedAttempt`**

  `packages/db/test/attempt-repository.test.ts`:

  ```ts
  it("returns the attempt row when studentId matches", …)               // loadOwnedAttempt
  it("returns null when the attempt belongs to another student", …)     // loadOwnedAttempt
  it("returns null for a nonexistent attemptId", …)                     // loadOwnedAttempt
  it("finalizes an expired attempt with zero responses recorded", …)    // status expired, submittedAt = expiresAt, all counts populated, pointsEarned 0
  it("pins submittedAt to expiresAt, not to the clock passed in", …)    // createFixedClock well past deadline; assert submittedAt === expiresAt exactly
  it("is idempotent — finalizing twice does not re-grade or throw", …)
  it("satisfies attempt_finished_is_graded — no CHECK violation", …)    // the row commits at all; a violation throws before the assertion runs
  ```

  Seed via the existing test fixtures used by `catalog-repository.test.ts` (a published one-section test is enough; this task does not need two sections). Run: `pnpm --filter @pp/db test attempt-repository` → FAIL, module not found.

- [ ] **Step 4: Implement `loadOwnedAttempt` and `finalizeExpiredAttempt`**

  ```ts
  export async function finalizeExpiredAttempt(
    db: PgQueryable,
    input: { attemptId: string; now: Date },
  ): Promise<FinalizedAttemptRow> {
    const { rows: existing } = await db.query<{
      status: string
      submitted_at: Date | null
      test_version_id: string
      expires_at: Date | null
    }>(
      `SELECT status, submitted_at, test_version_id, expires_at
         FROM attempt WHERE id = $1`,
      [input.attemptId],
    )
    const attempt = existing[0]

    if (attempt.status !== "in_progress") {
      // Already terminal — including the ordinary 'submitted' path, which
      // phase 5 owns. Reported back as 'expired' regardless, matching
      // FinalizedAttempt's fixed status; this endpoint's callers only ever
      // reach here through the expiry check, never through a real submit.
      return {
        id: input.attemptId,
        status: "expired",
        submittedAt: attempt.submitted_at ?? attempt.expires_at!,
      }
    }

    const questions = await loadForScoring(
      db as pg.Pool,
      attempt.test_version_id,
    )
    const { rows: answerRows } = await db.query<{
      question_id: string
      choice_ids: string[]
    }>(
      `SELECT r.question_id,
              COALESCE(array_agg(rc.choice_id) FILTER (WHERE rc.choice_id IS NOT NULL), '{}') AS choice_ids
         FROM response r
         LEFT JOIN response_choice rc
           ON rc.attempt_id = r.attempt_id AND rc.question_id = r.question_id
        WHERE r.attempt_id = $1
        GROUP BY r.question_id`,
      [input.attemptId],
    )
    const answers = answerRows.map((r) => ({
      questionId: asQuestionId(r.question_id),
      selectedChoiceIds: r.choice_ids.map(asChoiceId),
    }))
    const score = scoreAttempt(questions, answers)

    const { rows } = await db.query<{ submitted_at: Date }>(
      `UPDATE attempt
          SET status = 'expired', submitted_at = expires_at,
              points_earned = $2, points_possible = $3, percentage = $4,
              answered_count = $5, unanswered_count = $6,
              correct_count = $7, incorrect_count = $8, question_count = $9
        WHERE id = $1
        RETURNING submitted_at`,
      [
        input.attemptId,
        score.pointsEarned,
        score.pointsPossible,
        score.percentage,
        score.answeredCount,
        score.unansweredCount,
        score.correctCount,
        score.incorrectCount,
        score.questionCount,
      ],
    )

    return {
      id: input.attemptId,
      status: "expired",
      submittedAt: rows[0].submitted_at,
    }
  }
  ```

  `submitted_at = expires_at` is set **inside the SQL**, not passed from `input.now` — this is what step "pins submittedAt to expiresAt" actually proves; passing `now` here would silently reintroduce the bug spec §4 rules out.

  Run: `pnpm --filter @pp/db test attempt-repository` → PASS, all seven.

- [ ] **Step 5: A shared expiry guard every later task calls**

  Add to the same file:

  ```ts
  /**
   * The load-bearing check every attempt-scoped route runs first. Returns
   * the live row when the attempt is still running; finalizes and returns
   * null when it is not, so the caller's only job is `if (!row) throw 410`.
   */
  export async function loadRunningOwnedAttempt(
    db: PgQueryable,
    input: { attemptId: string; studentId: string; now: Date },
  ): Promise<
    | { attempt: AttemptRow; finalized: null }
    | { attempt: null; finalized: FinalizedAttemptRow | null }
  > {
    const attempt = await loadOwnedAttempt(db, input)

    if (!attempt) {
      return { attempt: null, finalized: null }
    }

    if (
      attempt.status === "in_progress" &&
      (!attempt.expiresAt || attempt.expiresAt > input.now)
    ) {
      return { attempt, finalized: null }
    }

    const finalized = await finalizeExpiredAttempt(db, {
      attemptId: attempt.id,
      now: input.now,
    })

    return { attempt: null, finalized }
  }
  ```

  Note `!attempt.expiresAt` reads as "still running": a null `expiresAt` means the clock has not started (untimed brief-reading), which must never be treated as expired — the same rule plan 2 Task 9 states for `startOrResumeAttempt`.

- [ ] **Step 6: Gates**

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

---

### Task 2: `GET /attempts/{id}` — the runner envelope

**Files:**

- Create: `packages/db/src/repositories/runner.repository.ts`
- Create: `packages/db/test/runner-repository.test.ts`
- Create: `packages/server/src/attempts/attempts.controller.ts`, `attempts.service.ts`, `attempts.module.ts`
- Create: `packages/server/test/attempts-runner.e2e.test.ts`
- Modify: `packages/db/src/index.ts`, `packages/server/src/app.module.ts`

**Interfaces:**

- Consumes: `loadForRunner` (`@pp/db`); `loadRunningOwnedAttempt` (Task 1); `JwksGuard`, `@CurrentStudent()`.
- Produces:

  ```ts
  export interface RunnerSectionState {
    status: "pending" | "open" | "closed"
    completedAt: string | null
    expiresAt: string | null
  }

  export interface RunnerEnvelopeRow {
    id: string
    status: "in_progress"
    expiresAt: string | null
    questionCount: number
    answeredCount: number
    unansweredOrdinals: number[]
    currentSectionId: string | null
    currentQuestionId: string | null
    sections: (RunnerSection & RunnerSectionState)[]
    responses: RecordedResponseWire[]
  }

  export async function loadRunnerEnvelope(
    db: PgQueryable,
    input: { attemptId: string; testVersionId: string },
  ): Promise<
    Omit<
      RunnerEnvelopeRow,
      "id" | "status" | "expiresAt" | "currentSectionId" | "currentQuestionId"
    >
  >
  ```

  The four fields left out of `loadRunnerEnvelope`'s return come straight off the `AttemptRow` the controller already has from `loadRunningOwnedAttempt` — no reason to re-select them.

- [ ] **Step 1: Write the failing repository tests**

  `packages/db/test/runner-repository.test.ts`, against a seeded two-section (listening + reading) published version, no attempt_section rows yet:

  ```ts
  it("marks every section pending with null completedAt/expiresAt before any section is entered", …)
  it("marks a section open with the attempt_section's expiresAt once entered", …)
  it("marks a section closed with completedAt once attempt_section.completed_at is set", …)
  it("computes answeredCount and unansweredOrdinals from recorded responses", …)
  it("aggregates multiple response_choice rows into one selectedChoiceIds array per response", …)
  it("returns an empty responses array when nothing has been recorded", …)   // the phase-3 default case
  it("never includes isCorrect anywhere in the returned tree", …)             // JSON.stringify + not.toContain, mirroring plan 2 Task 8's brief test
  ```

  Run: `pnpm --filter @pp/db test runner-repository` → FAIL.

- [ ] **Step 2: Implement `loadRunnerEnvelope`**

  ```ts
  const SECTION_STATE_QUERY = `
    SELECT test_section_id, entered_at, expires_at, completed_at
      FROM attempt_section WHERE attempt_id = $1
  `
  const RESPONSES_QUERY = `
    SELECT r.question_id, r.client_instance_id, r.client_seq, r.answered_at,
           COALESCE(array_agg(rc.choice_id) FILTER (WHERE rc.choice_id IS NOT NULL), '{}') AS choice_ids
      FROM response r
      LEFT JOIN response_choice rc
        ON rc.attempt_id = r.attempt_id AND rc.question_id = r.question_id
     WHERE r.attempt_id = $1
     GROUP BY r.question_id, r.client_instance_id, r.client_seq, r.answered_at
  `

  export async function loadRunnerEnvelope(db, { attemptId, testVersionId }) {
    const [content, stateResult, responseResult] = await Promise.all([
      loadForRunner(db as pg.Pool, testVersionId, attemptId),
      db.query(SECTION_STATE_QUERY, [attemptId]),
      db.query(RESPONSES_QUERY, [attemptId]),
    ])

    const stateBySection = new Map(
      stateResult.rows.map((r) => [r.test_section_id, r]),
    )
    const sections = content.map((section) => {
      const state = stateBySection.get(section.id)
      if (!state) {
        return {
          ...section,
          status: "pending" as const,
          completedAt: null,
          expiresAt: null,
        }
      }
      return {
        ...section,
        status: state.completed_at ? ("closed" as const) : ("open" as const),
        completedAt: state.completed_at?.toISOString() ?? null,
        expiresAt: state.expires_at.toISOString(),
      }
    })

    const questionCount = sections.reduce(
      (sum, s) => sum + s.groups.reduce((gs, g) => gs + g.questions.length, 0),
      0,
    )
    const responses = responseResult.rows.map((r) => ({
      questionId: asQuestionId(r.question_id),
      selectedChoiceIds: r.choice_ids.map(asChoiceId),
      clientInstanceId: r.client_instance_id,
      seq: r.client_seq,
      ...(r.answered_at ? { answeredAt: r.answered_at.toISOString() } : {}),
    }))
    const answeredOrdinals = new Set(
      responses
        .filter((r) => r.selectedChoiceIds.length > 0)
        .map((r) => findOrdinal(sections, r.questionId)),
    )
    const unansweredOrdinals = sections
      .flatMap((s) => s.groups.flatMap((g) => g.questions))
      .map((q) => q.ordinal)
      .filter((ord) => !answeredOrdinals.has(ord))
      .sort((a, b) => a - b)

    return {
      questionCount,
      answeredCount: answeredOrdinals.size,
      unansweredOrdinals,
      sections,
      responses,
    }
  }
  ```

  Run: `pnpm --filter @pp/db test runner-repository` → PASS, all seven.

- [ ] **Step 3: Controller**

  `GET /attempts/:id` behind `JwksGuard`. Resolve `studentId` via `findStudentBySubject`; call `loadRunningOwnedAttempt`; on `{ attempt: null, finalized: null }` → `403` (`NotYourAttempt`, matches "unowned and nonexistent are indistinguishable"); on `{ attempt: null, finalized }` → `410` with `AttemptExpiredProblem` carrying `finalized`; on `{ attempt }` → `200` with `loadRunnerEnvelope` merged with `attempt.id/status/expiresAt/currentSectionId/currentQuestionId`, serialized to the exact `RunnerEnvelope` shape (see Task 4's stimulus-shape note for the same `oneOf` care needed on `RunnerStimulus` here).

- [ ] **Step 4: Write the failing e2e test, then implement, then pass**

  `packages/server/test/attempts-runner.e2e.test.ts`:

  ```ts
  it("returns the runner envelope for the owning student", …)
  it("403s for another student's attempt", …)
  it("401s with no token", …)
  it("410s and finalizes a past-deadline attempt, returning the finalized shape", …)  // createFixedClock past expiresAt
  it("never serializes isCorrect anywhere in the response body", …)
  ```

  Run: `pnpm --filter @pp/server test attempts-runner` → FAIL, then implement, then PASS.

- [ ] **Step 5: Gates**

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

---

### Task 3: `POST /attempts/{id}/sections/{sectionId}/enter`

**Files:**

- Modify: `packages/db/src/repositories/attempt.repository.ts` (add `enterSection`)
- Modify: `packages/server/src/attempts/*`
- Create: `packages/db/test/attempt-repository.test.ts` (extend), `packages/server/test/attempts-enter.e2e.test.ts`

**Interfaces:**

- Produces:

  ```ts
  export interface SectionEntryRow {
    sectionId: string
    enteredAt: Date
    expiresAt: Date
    attemptStartedAt: Date | null // present only on the FIRST entry
    attemptExpiresAt: Date | null
  }

  export async function enterSection(
    db: PgQueryable,
    input: { attemptId: string; sectionId: string; now: Date },
  ): Promise<
    | { ok: true; entry: SectionEntryRow }
    | { ok: false; reason: "section_still_open" }
  >
  ```

- [ ] **Step 1: The rule, stated so no one infers it**

  1. If `attempt_section` already exists for `sectionId` with `completed_at IS NULL` → idempotent success, return the existing row's `entered_at`/`expires_at` unchanged (a refresh must not extend or reset the deadline).
  2. Else if a **different** `attempt_section` exists with `completed_at IS NULL` for this attempt → `{ ok: false, reason: "section_still_open" }`.
  3. Else, this is a genuine new entry: `INSERT INTO attempt_section (attempt_id, test_section_id, test_version_id, expires_at) VALUES (..., now + section.duration_seconds)`.
  4. If this is the attempt's first-ever section entry (`attempt.started_at IS NULL`), also `UPDATE attempt SET started_at = now, expires_at = now + test_version.duration_seconds, current_section_id = $section, current_question_id = <first question of this section by ordinal>` in the SAME transaction as step 3 — `attempt_clock_paired` requires both or neither.
  5. On every entry (first or not), also set `attempt.current_section_id`/`current_question_id` to this section's first question, so a reload lands correctly even mid-section.

  Wrap 1–5 in `withTransaction`.

- [ ] **Step 2: Write the failing tests — five cases**

  ```ts
  it("starts the attempt's clock on first entry, deriving expiresAt from the test's total duration", …)
  it("does not touch attempt.startedAt on a second section's entry", …)
  it("is idempotent — re-entering the same open section returns the SAME expiresAt, not a new one", …)
  it("refuses with section_still_open when a DIFFERENT attempt_section is open", …)  // seed the open row directly via SQL, per Decision 2
  it("sets current_section_id and current_question_id to the section's first question", …)
  ```

  Run: `pnpm --filter @pp/db test attempt-repository -- -t enterSection` → FAIL, implement, → PASS.

- [ ] **Step 3: Controller**

  `POST /attempts/:id/sections/:sectionId/enter`. Run `loadRunningOwnedAttempt` first (403/410 as Task 2). On the live attempt, call `enterSection`; map `{ ok: false }` → `409` with `type: "section_still_open"`; map `{ ok: true }` → `200` with the `SectionEntry` shape, pulling `title`/`type`/`questionCount`/`navigation`/`allowAnswerChange`/`playback`/`instructions` from the SAME section row `loadTestBrief` (plan 2 Task 8) already knows how to build — do not re-derive it; call the brief repository's section-building helper directly rather than duplicating the query.

- [ ] **Step 4: e2e test, gates**

  ```ts
  it("200s and starts the whole-test clock on first entry", …)
  it("409s section_still_open with the openapi Problem shape", …)
  it("410s a past-deadline attempt without ever inserting an attempt_section row", …)
  ```

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

---

### Task 4: Media signing and `POST /attempts/{id}/stimuli/{stimulusId}/play`

**Files:**

- Create: `packages/server/src/media/media-signing.ts`, `media-signing.test.ts`
- Create: `packages/server/src/media/media.controller.ts` (static `/media/:filename` serving)
- Create: `packages/db/src/repositories/media-play.repository.ts`
- Modify: `packages/server/src/attempts/*`, `packages/server/src/config.ts` (add `mediaSigningSecret`)
- Create: `packages/db/test/media-play-repository.test.ts`, `packages/server/test/attempts-play.e2e.test.ts`, `packages/server/test/media.e2e.test.ts`

**Interfaces:**

- Produces:

  ```ts
  // media-signing.ts — pure, no DB, no Clock injection needed (takes `now` directly)
  export function signMediaUrl(
    filename: string,
    expiresAt: Date,
    secret: string,
  ): string
  export function verifyMediaSignature(
    filename: string,
    expQuery: string | undefined,
    sigQuery: string | undefined,
    secret: string,
    now: Date,
  ): boolean
  ```

  ```ts
  // media-play.repository.ts
  export interface PlayClaimResult {
    playsUsed: number
    playsRemaining: number | null
    filename: string
  }

  export async function claimPlay(
    db: PgQueryable,
    input: {
      attemptId: string
      stimulusId: string
      testVersionId: string
      now: Date
    },
  ): Promise<
    | { ok: true; claim: PlayClaimResult }
    | { ok: false; reason: "no_plays_remaining" }
  >

  /** Used by the media controller to decide whether a request needs a signature. */
  export async function isFilenameCapped(
    db: PgQueryable,
    filename: string,
  ): Promise<boolean>
  ```

- [ ] **Step 1: Signing — write the failing pure test first**

  `media-signing.test.ts`:

  ```ts
  it("round-trips: a URL signed for a filename verifies for that filename", …)
  it("rejects a signature for a DIFFERENT filename", …)
  it("rejects once now is past the embedded expiry", …)
  it("rejects a tampered signature of the same length", …)
  it("rejects a missing exp or sig query param", …)
  ```

  Run: `pnpm --filter @pp/server test media-signing` → FAIL. Implement with `node:crypto` `createHmac("sha256", …)` + `timingSafeEqual` (constant-time compare — a `===` here would make the signature guessable byte-by-byte via timing, defeating the whole point of signing). Run again → PASS.

- [ ] **Step 2: `config.mediaSigningSecret`**

  Add to `ServerConfig`: `mediaSigningSecret: required(env, "MEDIA_SIGNING_SECRET")`. Update `test/helpers/app.ts` to set `process.env.MEDIA_SIGNING_SECRET` in `createTestApp`, or every test from here on fails to boot.

- [ ] **Step 3: `claimPlay` — write the failing repository tests**

  `packages/db/test/media-play-repository.test.ts`, against a seeded capped audio stimulus (`maxPlays: 1`):

  ```ts
  it("claims the first play and returns playsUsed 1, playsRemaining 0", …)
  it("refuses a second claim on a maxPlays: 1 stimulus with no_plays_remaining", …)
  it("never refuses an uncapped stimulus, however many times claimed", …)     // maxPlays null
  it("inherits the section default cap when the stimulus has no override", …)
  it("a stimulus override TIGHTENS but the query never needs to know that — it just reads whichever is non-null first", …)
  ```

  Use the guarded upsert:

  ```sql
  INSERT INTO stimulus_play (attempt_id, stimulus_id, test_version_id, play_count, last_played_at)
  VALUES ($1, $2, $3, 1, $4)
  ON CONFLICT (attempt_id, stimulus_id) DO UPDATE
     SET play_count = stimulus_play.play_count + 1, last_played_at = EXCLUDED.last_played_at
   WHERE $5::int IS NULL OR stimulus_play.play_count < $5
  RETURNING play_count
  ```

  Zero rows returned on the UPDATE path (not the INSERT path, which always succeeds once) means the cap was already hit — `ok: false`. Fetch effective cap first with the query from Decision-adjacent research: `SELECT st.max_plays stimulus_max_plays, ts.default_max_plays section_max_plays, ma.filename FROM stimulus st JOIN question_group qg ON qg.stimulus_id = st.id JOIN test_section ts ON ts.id = qg.test_section_id JOIN media_asset ma ON ma.id = st.media_asset_id WHERE st.id = $1 AND st.test_version_id = $2`.

  Run: FAIL → implement → `pnpm --filter @pp/db test media-play-repository` PASS.

- [ ] **Step 4: `GET /media/:filename` controller**

  No `JwksGuard` — an `<audio src>` tag sends no bearer header. Resolve `mediaRoot` (Task 2's config, already present from plan 2) + `filename`, reject path traversal exactly like `packages/web/vite.config.ts`'s `serveBranding` does (`resolved.startsWith(mediaRoot)` before any `fs` call — quote that pattern, it is already reviewed and correct). Call `isFilenameCapped`; if capped, require `verifyMediaSignature` to pass or `403`; if uncapped, serve unconditionally.

  ```ts
  it("serves an uncapped file with no query params at all", …)
  it("403s a capped file's request with no sig", …)
  it("403s a capped file's request with an expired sig", …)
  it("200s a capped file's request with a valid, unexpired sig", …)
  it("404s a traversal attempt (../../etc/passwd)", …)
  ```

- [ ] **Step 5: `POST /attempts/{id}/stimuli/{stimulusId}/play` controller**

  Behind `JwksGuard`. `loadRunningOwnedAttempt` first (403/410). Call `claimPlay`; `{ ok: false }` → `409 no_plays_remaining`; `{ ok: true }` → sign a URL with a 5-minute TTL from `CLOCK.now()` and return `PlayGrant`: `{ stimulusId, playsUsed, playsRemaining, mediaUrl: signMediaUrl(...), urlExpiresAt }`.

  ```ts
  it("200s and returns a mediaUrl that the media controller then accepts", …)  // integration across Steps 4 and 5
  it("409s the second claim on a capped stimulus", …)
  it("410s a past-deadline attempt without claiming a play", …)
  ```

- [ ] **Step 6: Gates**

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

---

### Task 5: `PUT /attempts/{id}/position`

**Files:**

- Modify: `packages/db/src/repositories/attempt.repository.ts` (add `setPosition`)
- Modify: `packages/server/src/attempts/*`
- Create: tests alongside

**Interfaces:**

- Produces:

  ```ts
  export async function setPosition(
    db: PgQueryable,
    input: {
      attemptId: string
      sectionId: string
      questionId: string
      now: Date
    },
  ): Promise<{ ok: true } | { ok: false; reason: "navigation_locked" }>
  ```

- [ ] **Step 1: The rule**

  Load the target section's `navigation` and the target question's `ordinal`, and the attempt's `current_question_id`'s `ordinal`. If `navigation === "free"`, always accept. If `navigation === "forward_only"`, accept only when the target ordinal is `>=` the current ordinal (moving forward or re-confirming the same question); refuse (`navigation_locked`) for anything lower. This resolves the tension between `openapi.yaml`'s summary ("refused where forward_only") and the prototype's own annotation, which lists `409 navigation_locked` as only ONE of several possible outcomes on the listening screen — meaning most forward moves succeed. Flagged in this plan's report; state your reading in the PR description if it is later challenged.

- [ ] **Step 2: Write the failing tests**

  ```ts
  it("accepts any position in a free-navigation section, forward or backward", …)
  it("accepts a forward move in a forward_only section", …)
  it("accepts re-confirming the SAME question in a forward_only section", …)
  it("refuses a backward move in a forward_only section with navigation_locked", …)
  it("persists currentSectionId and currentQuestionId on success", …)
  ```

  Run: FAIL → implement → PASS.

- [ ] **Step 3: Controller**

  `PUT /attempts/:id/position`. `loadRunningOwnedAttempt` first. `{ ok: false }` → `409`; success → `204` no body.

- [ ] **Step 4: e2e test, gates**

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

---

### Task 6: Scaffold `packages/app`

**Files:**

- Create: `packages/app/package.json`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `src/main.tsx`, `src/route.gen.ts` (generated), `src/pages/layout.tsx`, `src/lib/dev-auth.ts`, `src/lib/api-client.ts`, `src/index.css`
- Modify: `pnpm-workspace.yaml` (add `"packages/app"`), root `package.json` (scripts), `oxlint.config.ts`

**Interfaces:**

- Consumes: nothing from the server directly (talks HTTP); the `RunnerEnvelope`/`SectionEntry`/`PlayGrant` shapes from `docs/api/openapi.yaml`, hand-typed in `src/lib/api-types.ts` (this plan does not add a codegen step — none is in `library-adoption.md`).
- Produces:

  ```ts
  // src/lib/dev-auth.ts — Decision 3's seam, deliberately small and easy to delete
  export function getDevBearerToken(): string | null {
    return import.meta.env.VITE_DEV_BEARER_TOKEN ?? null
  }
  ```

  ```ts
  // src/lib/api-client.ts
  export class ApiError extends Error {
    constructor(
      public readonly problem: {
        type: string
        title: string
        status: number
        detail?: string
      },
    ) {
      super(problem.type)
    }
  }

  export async function apiFetch<T>(
    path: string,
    init?: RequestInit,
  ): Promise<T>
  ```

- [ ] **Step 1: Harvest the build config**

  Copy `packages/web/vite.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json` into `packages/app/`. Edits, not a blind copy:
  - Drop the `brandingServer` plugin and the `config/branding` alias (no branding config in this repo yet; Task 8 harvests `branding.ts` itself but not the dev-server plugin, since nothing publishes `config/branding/theme.json` here).
  - `resolve.alias`: replace `@razzia/web`/`@razzia/common`/`@razzia/socket` with `@pp/app` → `./src` and `@pp/common` → `../common/src`. No socket alias — `packages/app` has no realtime layer.
  - Drop the `/ws` proxy (no socket server).
  - Add a `/api` proxy to `http://localhost:3000` for `vite dev`, since the server has no CORS setup and none is planned — same-origin via proxy is simpler than adding one.
  - `tsconfig.app.json`: keep `moduleResolution: "bundler"` (Vite, not Node, resolves this package — unlike `common`/`db`, no `nodenext` switch belongs here).

- [ ] **Step 2: `package.json` — real dependencies, verified versions**

  ```json
  {
    "name": "@pp/app",
    "type": "module",
    "scripts": {
      "dev": "vite",
      "build": "vite build",
      "test": "vitest run",
      "start": "vite preview"
    },
    "dependencies": {
      "@liam-public/browser-react-ui": "^0.1.0",
      "@pp/common": "workspace:*",
      "@tailwindcss/vite": "^4.3.3",
      "@tanstack/react-router": "^1.170.32",
      "i18next": "^26.3.3",
      "i18next-browser-languagedetector": "^8.2.1",
      "radix-ui": "^1.6.7",
      "react": "^19.2.8",
      "react-dom": "^19.2.8",
      "react-i18next": "^17.0.8",
      "tailwindcss": "^4.3.3"
    },
    "devDependencies": {
      "@tanstack/router-plugin": "^1.168.35",
      "@testing-library/jest-dom": "^7.0.1",
      "@testing-library/react": "^16.3.2",
      "@testing-library/user-event": "^14.6.6",
      "@types/react": "^19.2.18",
      "@types/react-dom": "^19.2.5",
      "@vitejs/plugin-react": "^6.1.0",
      "jsdom": "^30.0.1",
      "vite": "^8.2.2"
    }
  }
  ```

  `radix-ui` is direct, not transitive: Task 9's choice-list has no equivalent in `browser-react-ui` (the kit ships `badge`/`button`/`card`/`dialog`/`dropdown-menu`/`input`/`label`/`select`/`separator`/`sheet`/`table` — verified against `typescript-libraries/packages/public/react/browser-react-ui/src/index.ts` — no radio-group, no progress). Building the choice list on the kit's own primitive layer keeps it visually consistent without forking the kit, which is exactly the reasoning spec §2 gives for adopting the kit in the first place.

- [ ] **Step 3: `pnpm-workspace.yaml`, root `package.json`, `oxlint.config.ts`**

  Add `"packages/app"` to `pnpm-workspace.yaml`'s `packages:` list (the comment there explains this is safe — `app` never depended on `@razzia/common`). In root `package.json`, add `--filter @pp/app` to `build`/`typecheck`/`test`, and change:

  ```json
  "lint:frontend": "frontend-lint packages/app/src",
  "lint:i18n": "i18n-lint packages/app/src",
  "lint": "pnpm build && oxlint && pnpm lint:frontend && pnpm lint:i18n",
  ```

  removing the `|| true` on both — they were soft-failing only because nothing existed to check yet; a real `packages/app/src` makes them load-bearing gates, which is what Decision 4 (via the i18n-lint requirement in the task brief) requires. In `oxlint.config.ts`, run `oxlint packages/app` once real code exists (Step 5) and add an `overrides` block ONLY for rules that actually fire, quoting the count, exactly as the `packages/server` block already does — do not pre-emptively copy the old `packages/web` override (`react/jsx-key: off`) without first confirming it still fires; that rule existed for Razzia's dynamic list rendering, which may not recur here.

- [ ] **Step 4: `src/main.tsx`, router shell, a smoke test**

  Minimal `RouterProvider` wired to `route.gen.ts` (generated by the `tanstackRouter` Vite plugin from `src/pages/`), `src/pages/layout.tsx` rendering `<Outlet />`, `src/index.css` with `@import "tailwindcss";`.

  `packages/app/src/pages/layout.test.tsx`:

  ```ts
  it("renders the app shell without throwing", …)
  ```

- [ ] **Step 5: `vitest.config.ts`**

  ```ts
  import react from "@vitejs/plugin-react"
  import { defineConfig } from "vitest/config"

  export default defineConfig({
    plugins: [react()],
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
    },
  })
  ```

  `src/test/setup.ts`: `import "@testing-library/jest-dom/vitest"`.

- [ ] **Step 6: `api-client.ts`**

  ```ts
  import { getDevBearerToken } from "./dev-auth.js"

  export async function apiFetch<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const token = getDevBearerToken()
    const response = await fetch(`/api${path}`, {
      ...init,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    })

    if (response.status === 204) {
      return undefined as T
    }

    const body: unknown = await response.json()

    if (!response.ok) {
      throw new ApiError(body as ApiError["problem"])
    }

    return body as T
  }
  ```

  `src/lib/api-client.test.ts`:

  ```ts
  it("attaches the dev bearer token when one is configured", …)
  it("throws ApiError with the parsed problem+json body on a non-2xx response", …)
  it("returns undefined for a 204 with no body", …)
  ```

  Mock `globalThis.fetch` with `vi.fn()` per Decision 4 — no MSW.

- [ ] **Step 7: Gates**

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

---

### Task 7: i18n — harvest and the `runner` namespace, six locales

**Files:**

- Create: `packages/app/src/i18n.ts` (harvested), `packages/app/src/locales/{de,en,es,fr,it,ja}/runner.json`

**Interfaces:**

- Produces: `i18n` default export (harvested `i18next` init), and a `runner` namespace with every string the section-rules/listening/reading screens need, in all six locales.

- [ ] **Step 1: Harvest `i18n.ts`**

  Copy `packages/web/src/i18n.ts` verbatim except the glob comment — the `import.meta.glob("./locales/*/*.json", { eager: true })` pattern is namespace-agnostic already, so no edit is needed there. Do NOT copy `game.json`, `quizz.json`, or `manager.json` from any locale — those are Razzia's game/CMS namespaces (`features/game/**` is explicitly left behind per spec §2). Only `common.json` (harvest, then prune to what's actually used) and the new `runner.json` (below) exist per locale.

- [ ] **Step 2: The exact key set, `en` first**

  `packages/app/src/locales/en/runner.json`:

  ```json
  {
    "sectionRules.readyButton": "I'm ready",
    "sectionRules.beforeYouBegin": "Before you begin",
    "sectionRules.attemptLabel": "Attempt {{number}}",
    "listening.rule.playsOnce": "Each recording plays once.",
    "listening.rule.noPauseRewind": "You cannot pause or rewind.",
    "listening.rule.noReturn": "You cannot return to a question you have passed.",
    "listening.rule.headphones": "Put your headphones on now.",
    "listening.playButton": "Play recording",
    "listening.playsLeft_one": "{{count}} play left",
    "listening.playsLeft_other": "{{count}} plays left",
    "listening.answerLocked": "Answer locked — this section does not allow changes.",
    "runner.questionCount": "Question {{current}} of {{total}}",
    "runner.previous": "Previous",
    "runner.next": "Next",
    "runner.handIn": "Hand in",
    "runner.savedIndicator": "Saved",
    "runner.sectionChip.listening": "Listening",
    "runner.sectionChip.reading": "Reading",
    "reading.passageQuestions": "Passage {{passageNumber}} · questions {{first}}–{{last}}"
  }
  ```

  i18next's `_one`/`_other` plural suffixes are what `playsLeft` needs — a hardcoded `"1 play left"` string is exactly what `node-i18n-lint` exists to catch (per the task brief's i18n requirement), so this key is written pluralized from the start rather than patched later.

- [ ] **Step 3: The other five locales**

  Same keys, translated, in `de/runner.json`, `es/runner.json`, `fr/runner.json`, `it/runner.json`, `ja/runner.json`. German and Japanese plurals: i18next's default pluralization treats German as a two-form language (`_one`/`_other`, same shape as English) and Japanese as a **no-plural** language — Japanese needs only `runner.listening.playsLeft` with no suffix at all (i18next's CLDR plural rules resolve `ja` to the single `other` category, so `_one`/`_other` both collapsing to one key is correct, not a shortcut). Provide real translations for every key, not placeholders — the task requires content that reads as intended, not `"TODO_ja"` stand-ins, so the reviewer should read each string and confirm it makes sense in context before checking this step.

- [ ] **Step 4: `node-i18n-lint` actually gates**

  Run `pnpm lint:i18n` (now hard, from Task 6 Step 3) and confirm it passes with zero hardcoded-string findings in whatever component code exists so far (the smoke-test layout from Task 6). It will find real work once Tasks 9–11 add JSX — this step just proves the gate itself runs and is wired, before there is anything substantial to fail it.

- [ ] **Step 5: Gates**

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

---

### Task 8: `QuestionMedia`, `branding.ts`, and the typed API surface for the two screens

**Files:**

- Create: `packages/app/src/components/QuestionMedia.tsx`, `packages/app/src/branding.ts`, `packages/app/src/lib/api-types.ts`, `packages/app/src/lib/attempts-api.ts`
- Create: tests alongside

**Interfaces:**

- Produces:

  ```ts
  // api-types.ts — hand-typed against openapi.yaml (Decision 6, no codegen)
  export interface RunnerEnvelope {
    /* mirrors the schema at openapi.yaml:1408 field-for-field */
  }
  export interface CappedStimulusWire {
    id: string
    type: string
    title?: string
    bodyText?: string
    maxPlays: number
    playsUsed: number
    allowPause: boolean
    allowSeek: boolean
  }
  export interface OpenStimulusWire {
    id: string
    type: string
    title?: string
    bodyText?: string
    maxPlays: null
    mediaUrl: string
    allowPause: boolean
    allowSeek: boolean
  }
  export type StimulusWire = CappedStimulusWire | OpenStimulusWire
  export interface SectionEntry {
    /* mirrors openapi.yaml:1252 */
  }
  export interface PlayGrant {
    /* mirrors openapi.yaml:1288 */
  }
  ```

  ```ts
  // attempts-api.ts
  export function getRunnerEnvelope(attemptId: string): Promise<RunnerEnvelope>
  export function enterSection(
    attemptId: string,
    sectionId: string,
  ): Promise<SectionEntry>
  export function claimPlay(
    attemptId: string,
    stimulusId: string,
  ): Promise<PlayGrant>
  export function setPosition(
    attemptId: string,
    sectionId: string,
    questionId: string,
  ): Promise<void>
  ```

- [ ] **Step 1: `StimulusWire` is a discriminated union on purpose**

  Write a type-level test (a `.test-d.ts` file, or a `// @ts-expect-error` assertion inside a normal test file — this repo has no `tsd` dependency, so use the latter, matching plan 2 Task 5's own technique for pinning an erased type) proving that a `CappedStimulusWire` literal with a `mediaUrl` property fails to typecheck. This exists because `openapi.yaml`'s `CappedStimulus` schema has `additionalProperties: false` and no `mediaUrl` in its properties at all (verified: `openapi.yaml:1318-1333`) — a single merged `RunnerStimulus`-shaped type (`maxPlays: number | null; mediaUrl?: string`) would let a component accidentally render a `mediaUrl` for a capped stimulus, which is exactly the play-cap bypass spec §4 calls out.

- [ ] **Step 2: `QuestionMedia.tsx` — adapted, not copied**

  Structurally follows `packages/web/src/components/QuestionMedia.tsx`'s conditional-by-type shape, but the audio branch is rewritten from the ground up:

  ```tsx
  interface Props {
    stimulus: StimulusWire
    onClaimPlay: () => Promise<void>
    playing: boolean
  }

  function QuestionMedia({ stimulus, onClaimPlay, playing }: Props) {
    if (stimulus.type === "passage") {
      return <div className="passage">{stimulus.bodyText}</div>
    }

    if (stimulus.type === "image" && stimulus.maxPlays === null) {
      return (
        <img
          src={stimulus.mediaUrl}
          alt=""
          className="max-h-60 w-auto rounded-md"
        />
      )
    }

    if (stimulus.type === "audio") {
      // NO `controls`, NO `autoPlay`, NO seek bar. Native <audio controls>
      // lets a student pause, rewind and replay — the exact behaviours
      // spec §1.4 ("audio plays once, no pause or seek, forward-only
      // navigation") forbids. Playback is a plain, unstyled <audio> element
      // driven entirely by the play button below; there is no scrubber.
      return (
        <div className="audio-box">
          <button
            onClick={onClaimPlay}
            disabled={
              playing ||
              (stimulus.maxPlays !== null &&
                stimulus.playsUsed >= stimulus.maxPlays)
            }
          >
            {t("listening.playButton")}
          </button>
        </div>
      )
    }

    return null
  }
  ```

  `onClaimPlay` calls `POST /play` (Task 4) to get a `mediaUrl`, THEN sets `<audio src>` and calls `.play()` — the component never holds a `mediaUrl` for a capped stimulus until the claim succeeds, matching the runner payload's own omission.

- [ ] **Step 3: `branding.ts`**

  Copy `packages/web/src/branding.ts` verbatim — it is already generic (fetches `/branding/theme.json`, applies CSS custom properties, no Razzia-specific types). No app wiring calls `loadBranding()` yet in this plan (no `config/branding` folder exists in this repo); it is harvested so a later plan does not have to re-port it, and a `// not yet called — see docs/architecture/library-adoption.md` comment says so at the top of the file to prevent an oxlint `no-unused-exports`-style question later. `packages/app/test/branding.test.ts`:

  ```ts
  it("applyBranding sets CSS custom properties from theme.colors", …)
  it("applyBranding is a no-op when theme is null", …)
  ```

- [ ] **Step 4: `attempts-api.ts` tests**

  ```ts
  it("getRunnerEnvelope calls GET /api/attempts/:id and returns the parsed body", …)
  it("enterSection calls POST /api/attempts/:id/sections/:sectionId/enter", …)
  it("claimPlay calls POST /api/attempts/:id/stimuli/:stimulusId/play", …)
  it("setPosition calls PUT /api/attempts/:id/position with the JSON body {sectionId, questionId}", …)
  it("propagates ApiError from apiFetch on a non-2xx response", …)
  ```

  Mock `globalThis.fetch`.

- [ ] **Step 5: Gates**

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

---

### Task 9: Section-rules screen (secintro) — the "I'm ready" trigger for section entry

Minimal by design: prototype screen 4 of 12, and the only piece of it this plan needs is the button that calls `enterSection`. Full visual parity (the conditional `finalizedPriorAttempt` notice, the exact instruction-card styling) is welcome but not required — the load-bearing behaviour is the API call and the navigation it triggers.

**Files:**

- Create: `packages/app/src/pages/attempts.$attemptId.sections.$sectionId.rules.tsx`
- Create: tests alongside

**Interfaces:**

- Consumes: `enterSection` (Task 8); route params `attemptId`, `sectionId`.
- Produces: on success, navigates to `/attempts/$attemptId/run`.

- [ ] **Step 1: Write the failing component test**

  ```ts
  it("renders the section's instructions from the SectionEntry it already has via loader data", …)
  it("calls enterSection when the ready button is clicked, not on mount", …)  // spec: "NOT on screen load"
  it("navigates to the runner route on a successful enter", …)
  it("shows the finalizedPriorAttempt notice with a link to /result when the attempt-start carried one", …)
  it("disables the ready button while the enter call is in flight, to prevent a double POST", …)
  ```

  Use `@testing-library/user-event` for the click, mock the router's `navigate` and `attempts-api`.

- [ ] **Step 2: Implement**

  Uses `<Button>` and `<Card>` from `@liam-public/browser-react-ui` for the instructions card and the ready action; the `data-testid="ready-button"` attribute so later e2e work (out of this plan's scope) has a stable hook.

- [ ] **Step 3: Gates**

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

---

### Task 10: Listening screen

**Files:**

- Create: `packages/app/src/pages/attempts.$attemptId.run.tsx` (shared shell), `packages/app/src/components/ListeningRunner.tsx`, `packages/app/src/components/ChoiceList.tsx`
- Create: tests alongside

**Interfaces:**

- Consumes: `RunnerEnvelope` (loaded via `getRunnerEnvelope` on route entry), `QuestionMedia`, `claimPlay`, `setPosition`.
- Produces: `ChoiceList` — the radio-group primitive `browser-react-ui` does not ship (Decision, Task 6 Step 2), built on `radix-ui`'s `RadioGroup` export directly:

  ```tsx
  interface ChoiceListProps {
    choices: { id: string; label: string }[]
    selectedId: string | null
    onSelect: (choiceId: string) => void
    locked: boolean // true when allowAnswerChange is false AND an answer already exists
  }

  function ChoiceList({
    choices,
    selectedId,
    onSelect,
    locked,
  }: ChoiceListProps)
  ```

- [ ] **Step 1: Write the failing tests**

  `ChoiceList.test.tsx`:

  ```ts
  it("calls onSelect with the clicked choice's id", …)
  it("renders the currently selected choice with aria-checked=true", …)
  it("does not call onSelect when locked is true", …)
  it("renders a lock indicator when locked is true", …)
  ```

  `ListeningRunner.test.tsx`, against a fixture `RunnerEnvelope` shaped like `openapi.yaml:2691`'s example (section `navigation: "forward_only"`, `allowAnswerChange: false`, one open question group with a capped audio stimulus):

  ```ts
  it("renders the current question's prompt and choices from currentQuestionId", …)
  it("hides the play button's disabled state until playsUsed reaches maxPlays", …)
  it("calls claimPlay when the play button is clicked, and only then sets the audio src", …)
  it("holds a new choice selection in local state only — no network call fires on select", …)  // PHASE 4 boundary, asserted as a negative
  it("locks the choice list once a response already exists for this question and allowAnswerChange is false", …)
  it("shows no Previous button in a forward_only section", …)
  it("calls setPosition with the next question's id when Next is clicked", …)
  it("renders the pip/progress strip from questionCount and the section's own question ordinals, read-only", …)
  ```

  Run: FAIL (components do not exist) → implement → PASS.

- [ ] **Step 2: Implement `ListeningRunner`**

  Local state: `Record<questionId, choiceId[]>` seeded from `envelope.responses`, mutated only by `ChoiceList`'s `onSelect` — never sent anywhere (the `// PHASE 4:` comment from this plan's context paragraph goes exactly here, on the line that would call a save endpoint). `Next` calls `setPosition` then advances `currentQuestionId` locally (optimistic — a full reload re-derives it from the server's own `currentQuestionId` via `getRunnerEnvelope`, so an optimistic update that turns out wrong self-heals on next load).

- [ ] **Step 3: The route shell dispatches on section type**

  `attempts.$attemptId.run.tsx` loads the envelope, finds the section matching `currentSectionId`, and renders `<ListeningRunner>` or `<ReadingRunner>` (Task 11) by `section.type`.

  ```ts
  it("renders ListeningRunner when the current section's type is listening", …)
  it("redirects to the section-rules route when currentSectionId is null", …)  // attempt exists but nothing entered yet
  ```

- [ ] **Step 4: Gates**

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

---

### Task 11: Reading screen

**Files:**

- Create: `packages/app/src/components/ReadingRunner.tsx`
- Modify: `packages/app/src/pages/attempts.$attemptId.run.tsx`
- Create: tests alongside

**Interfaces:**

- Consumes: the same `RunnerEnvelope`, `ChoiceList`, `setPosition`; `navigation: "free"` and `allowAnswerChange: true` per the seeded reading section (plan 2 Task 12).

- [ ] **Step 1: Write the failing tests**

  ```ts
  it("renders the passage body text once per question group, shared across its questions", …)
  it("shows a Previous button, enabled, unlike the listening screen", …)
  it("calls setPosition with a PRIOR question's id when Previous is clicked", …)  // exercises the `free` branch of Task 5's rule
  it("allows changing an already-selected choice, unlike listening", …)
  it("shows a disabled Hand in button with a tooltip noting submit is not yet available", …)  // PHASE 5 boundary — Hand in exists visually per the prototype but has no working action yet
  it("renders 'Passage N · questions X–Y' from the group's question ordinals", …)
  ```

- [ ] **Step 2: Implement `ReadingRunner`**

  Shares `ChoiceList` with `ListeningRunner` (Task 10); `locked` is always `false` here since `allowAnswerChange: true`. The `Hand in` button calls nothing — `disabled`, with a title attribute explaining why, rather than a fake success state, so a reviewer clicking it in a live check sees an honest "not yet" rather than a silent no-op that looks like it worked.

- [ ] **Step 3: Gates**

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

---

### Task 12: Delete `packages/socket` and `packages/web`

Sequenced last, per spec §2: "deleted in plan 3, once `app` can replace them." By this point `packages/app` builds, serves, and drives real section-entry/listening/reading screens against the real server — the condition the spec names.

**Files:**

- Delete: `packages/socket/**`, `packages/web/**`
- Modify: `pnpm-workspace.yaml`, `oxlint.config.ts`, root `package.json`, `Dockerfile` (if plan 2 Task 13 landed first and still copies `web`/`socket` manifests)

**Interfaces:** none — this task removes code, it does not add an interface.

- [ ] **Step 1: Confirm the precondition before deleting anything**

  Run `pnpm --filter @pp/app build` and `pnpm --filter @pp/app dev &` then `curl -fsS http://localhost:3000/attempts/…` (or the equivalent manual check) — do not delete `web`/`socket` on the strength of the test suite alone; the spec's condition is "the repository has a runnable application," which a passing `vitest run` does not by itself demonstrate.

- [ ] **Step 2: Delete**

  `git rm -r packages/socket packages/web` (staging by explicit path, per the authoring guide's item 9 — this plan still does not commit, but the reviewer's `git add -A` ban applies here as much as anywhere: name the paths).

- [ ] **Step 3: Restore the workspace glob**

  `pnpm-workspace.yaml`: replace the narrowed `packages:` list and its explanatory comment with the simple form:

  ```yaml
  packages:
    - "packages/*"
  ```

  now that every remaining package resolves cleanly. Remove the `packages/web/**`/`packages/socket/**` entries from `oxlint.config.ts`'s `ignorePatterns` and the `packages/web/**/*.{ts,tsx}` override block. Remove `dev:web`/`dev:socket` from root `package.json`; change `dev` from `pnpm -r --parallel dev` (unchanged — it already runs whatever workspace packages define a `dev` script, and now that is `app` and `server`, not `web` and `socket`) — verify this, do not assume it.

- [ ] **Step 4: If `Dockerfile` still names `web`/`socket`**

  Check whether plan 2 Task 13 landed first. If its `Dockerfile` copies `packages/{common,db,server}` manifests already (per that task's own corrected description), nothing here changes. If an older copy still references `web`/`socket`, fix it in the same pass — do not leave a broken image build as this task's parting gift.

- [ ] **Step 5: Gates**

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  docker compose build api   # only if Dockerfile changed in Step 4
  ```

---

## Definition of Done

- [ ] `pnpm lint`, `pnpm format`, `pnpm typecheck`, `pnpm test` all exit 0
- [ ] `redocly lint docs/api/openapi.yaml` clean
- [ ] `grep -rn "new Date()\|Date\.now()" packages/{common,db,server,app}/src` reports only comments
- [ ] Twelve of the contract's twenty operations are implemented: plan 2's eight plus `GET /attempts/{id}`, `POST …/sections/{id}/enter`, `POST …/stimuli/{id}/play`, `PUT …/position`
- [ ] `docs/architecture/plan-2-preconditions.md` item 5 is closed (this plan is the "whoever builds the runner endpoint" it names)
- [ ] A student can, against the real running server: sign a dev bearer token, start an attempt (plan 2), enter the listening section, see its questions, claim a play, advance, enter reading (given a seeded `attempt_section` fixture, per Decision 2's honest scope limit), see its passage, select and change an answer — with no write persisted anywhere, by design
- [ ] `packages/socket` and `packages/web` no longer exist; `pnpm-workspace.yaml` globs `packages/*` again
- [ ] `loadForScoring`'s reachability is still fenced to `@pp/db/scoring`; Task 1 is the only new importer, and that extension is recorded in this plan's Decision 2, not silently added
