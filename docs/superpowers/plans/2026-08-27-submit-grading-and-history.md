# Submit, Grading, Result, Review and History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the student loop. A student hands in an attempt, the server grades it against frozen content, and three read surfaces — result, review, history — render that score consistently. Grading itself is a pure function with no database; everything around it (locating an attempt, applying its final answers, finalizing it exactly once, reading it back) is a thin, well-tested shell.

**Architecture:** `packages/common/src/grading.ts` and `src/rules.ts` are pure — no `pg`, no `Date.now()`, unit-tested in isolation. `packages/db/src/repositories/attempt.repository.ts` (write side: finalize, submit) and the new `attempt-result.repository.ts` (read side: result, review, history) are the only things that touch Postgres for this phase, and both funnel every answer-key read through `loadForScoring` from `@pp/db/scoring` — never through `@pp/db`'s default barrel. `packages/server/src/attempts/*` exposes four routes behind `JwksGuard`, each resolving `AttemptId → studentId` ownership before doing anything else. `packages/app/src/pages/attempts/$attemptId/*` and `src/pages/history/` render the three read screens plus the hand-in dialog.

**Tech Stack:** NestJS 11 · Node 24 · TypeScript 6 (ESM, `nodenext`) · PostgreSQL 16 · `@liam-public/node-postgres` · `@liam-workspace/platform` (`Clock`) · Vitest 4 · supertest · testcontainers · React 19 + Vite · `@liam-public/browser-react-ui` · TanStack Router

**Spec:** `docs/superpowers/specs/2026-08-25-toefl-primary-fork-design.md` (phase 5 of §8)

**Inherited state this plan builds on:** Plan 1 (foundation) shipped the domain vocabulary this plan implements against — `Score`, `SectionScore`, `ItemResult`, `RejectReason`, `AttemptStatus` all already exist in `packages/common/src/domain/attempt.ts`, and `ScoringQuestion`/`loadForScoring` already exist behind the `@pp/db/scoring` fence (plan 2 Task 5). Plan 2 shipped `JwksGuard`, `AdminGuard`, `@CurrentStudent()`, the two-pool `DatabaseModule`, `CLOCK`, and the e2e harness (`createTestApp`, `mint`) this plan's tests reuse verbatim. This plan assumes plan 2 Task 9 (`POST /attempts`), plan 3 (runner payload, section entry, play, position, the listening/reading screens, `packages/app`'s scaffold) and plan 4 (the durable write path — queue, snapshot flush, reorder guard, `failed_write`, retry classification) are complete. **Boundary Task 6 below states the one place this plan's steps depend on plan 4's exact shape and how to adapt if it differs.**

## Global Constraints

- **No `new Date()` and no `Date.now()`** anywhere in `packages/{common,db,server}/src`. Time comes from the injected `Clock`. Verify with: `grep -rn "new Date()\|Date\.now()" packages/{common,db,server}/src`
- **`docs/api/openapi.yaml` is the contract.** Quote it; do not paraphrase it. Every schema referenced below (`SubmitRequest`, `SubmitResult`, `AttemptResult`, `ReviewPayload`, `AttemptHistoryRow`, `Problem`, `AttemptExpiredProblem`, `SectionOrAttemptExpired`) is `additionalProperties: false` where declared — a repository row returned directly leaks columns the schema forbids.
- **Grading has no database.** `gradeAttempt` in `packages/common/src/grading.ts` takes plain data in and returns plain data out. It is unit-tested with zero Postgres involvement. Every repository that calls it is tested separately, against a real container.
- **Postgres returns strings for `numeric`/`bigint`.** `attempt.percentage` is `numeric(5,2)`; `points_earned`/`points_possible` are plain `integer` and need no conversion. Convert at the repository boundary with `Number(...)`; assert `typeof` in tests, not just value.
- **The answer key stays fenced.** Every read of `is_correct` in this plan's repositories goes through `loadForScoring` (`@pp/db/scoring`) — with the ONE documented exception of `loadReview`, which selects `choice.is_correct` directly because spec §4 says `choice.isCorrect` reaches a student only via `/review`. Say so in a comment at that query, or a future tidy-up "fixes" it into a leak everywhere else.
- **Expiry is server-authoritative.** `submitted_at` on a lazily-finalized attempt pins to `expires_at`, never to `now`. No test sleeps; every expiry test uses `createFixedClock`.
- **All four gates pass before every commit:** `pnpm lint`, `pnpm format`, `pnpm typecheck`, `pnpm test`.
- **Never write `git add -A` or a commit command into a step.** Leave work uncommitted; the reviewer stages by explicit path.
- **Never add a dependency without checking `docs/architecture/library-adoption.md` first.**
- **Verify library and internal-package APIs against the installed code, never from memory or from this plan's prose** — quote what you find, the way plan 2 quoted `node-auth-server`'s real `verify()` behaviour. `@liam-public/browser-react-ui` is not yet installed anywhere in this repository as of this plan's authoring (`packages/app` does not exist yet); confirm its real export names against `node_modules/@liam-public/browser-react-ui/dist/*.d.ts` once plan 3/4 have added it, rather than trusting the component names in the library-adoption doc's prose.

## File Structure

| File                                                                                            | Responsibility                                                                             |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `packages/common/src/grading.ts`                                                                | Task 2: `gradeAttempt`, `isQuestionCorrect` — pure                                         |
| `packages/common/src/rules.ts`                                                                  | Task 3: `canSetPosition`, `canClaimPlay`, `canAcceptAnswerChange`, `isPastDeadline` — pure |
| `packages/common/src/domain/attempt.ts`                                                         | Task 2: `SectionScore.type` retyped to `SectionType`                                       |
| `packages/common/src/scoring.ts`                                                                | Task 4: `ScoringQuestion` gains `sectionId`                                                |
| `packages/db/src/repositories/test-version.repository.ts`                                       | Task 4: `loadForRunner`/`loadForScoring` retyped to accept `PgQueryable`                   |
| `packages/db/src/repositories/attempt.repository.ts`                                            | Task 5: `finalizeAttempt` (+ internal `finalizeAttemptTx`); Task 6: `submitAttempt`        |
| `packages/db/src/repositories/attempt-result.repository.ts`                                     | Task 7: `loadAttemptResult`; Task 8: `loadReview`; Task 9: `listAttemptHistory`            |
| `packages/server/src/attempts/problem.exception.ts`, `problem.filter.ts`                        | Task 1: `application/problem+json` bodies matching the `Problem` schema exactly            |
| `packages/server/src/attempts/ownership.ts`                                                     | Task 6: `resolveOwnedAttempt` — 403/404 shared by submit, result, review                   |
| `packages/server/src/attempts/attempts.controller.ts`, `attempts.service.ts`                    | Task 6: `POST …/submit`; Task 9: `GET /attempts`                                           |
| `packages/server/src/attempts/results.controller.ts`, `results.service.ts`, `results.module.ts` | Task 7–8: `GET …/result`, `GET …/review`                                                   |
| `packages/app/src/pages/attempts/$attemptId/hand-in.tsx`                                        | Task 10: hand-in confirmation + submit                                                     |
| `packages/app/src/pages/attempts/$attemptId/result.tsx`                                         | Task 11: result screen                                                                     |
| `packages/app/src/pages/attempts/$attemptId/review.tsx`                                         | Task 12: review screen                                                                     |
| `packages/app/src/pages/history/index.tsx`                                                      | Task 13: history screen                                                                    |

---

### Task 1: `application/problem+json` bodies that actually match `Problem`

`AllExceptionsFilter` (`@liam-public/node-nest-common`, already wired in `main.ts` and every e2e harness) renders `response.status(status).json({ error, message, statusCode, ...exceptionResponse })` with content-type `application/json`. Nothing in this repository has exercised it against the `Problem` schema yet — no earlier task asserted an error body's exact shape. This phase is where that stops being true: `AttemptExpiredProblem` requires a nested `attempt` object, `SectionOrAttemptExpired` is a `oneOf` on two closed (`additionalProperties: false`) shapes, and `PayloadCaptured` requires `capturedAs`. None of those survive being merged with `{error, message, statusCode}` under `application/json`. This task adds a narrow, controller-scoped exception path that renders the contract exactly; it does not touch `AllExceptionsFilter` itself, which stays the default for everything this plan does not own.

**Files:**

- Create: `packages/server/src/attempts/problem.exception.ts`, `packages/server/src/attempts/problem.filter.ts`
- Create: `packages/server/test/problem.e2e.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces:

  ```ts
  export interface ProblemBody {
    type: string
    title: string
    status: number
    detail?: string
    retryable?: false
    [extra: string]: unknown // AttemptExpiredProblem's `attempt`, PayloadCaptured's `capturedAs`
  }
  export class ProblemException extends HttpException {
    constructor(body: ProblemBody)
  }
  ```

  Every later task in this plan throws `ProblemException`, never a bare NestJS `HttpException`, for a `409`/`410`/`413` body the contract shapes.

- [ ] **Step 1: Write the failing test — both content-type AND shape, and the negative case**

  `packages/server/test/problem.e2e.test.ts`. Mount two probe controllers inside the test module: one throwing `ProblemException`, one throwing a plain `NotFoundException("x")`, both under `@UseFilters(ProblemExceptionFilter)` on the first and nothing extra on the second — proving the filter is scoped, not global.

  ```ts
  it("renders a ProblemException as application/problem+json with the exact body given", …)
  // asserts res.headers["content-type"] starts with "application/problem+json"
  // asserts res.body deep-equals EXACTLY { type, title, status } — no error/message/statusCode
  it("carries extra Problem fields (attempt, capturedAs) through untouched", …)
  it("leaves an ordinary HttpException on AllExceptionsFilter's shape, unaffected", …)
  // asserts res.body has `statusCode` and `error` — the OLD shape, proving no regression elsewhere
  ```

  The third case is the one that matters: without it, a future edit that makes `ProblemExceptionFilter` global would pass the first two tests while silently reshaping every other route's error body.

- [ ] **Step 2: Run it to verify it fails**

  Run: `pnpm --filter @pp/server test problem`
  Expected: FAIL — `ProblemException`/`ProblemExceptionFilter` do not exist.

- [ ] **Step 3: Implement**

  `packages/server/src/attempts/problem.exception.ts`:

  ```ts
  import { HttpException } from "@nestjs/common"

  export interface ProblemBody {
    type: string
    title: string
    status: number
    detail?: string
    retryable?: false
    [extra: string]: unknown
  }

  /**
   * A Problem-shaped HttpException. Its body IS the wire body, verbatim — no
   * merging with AllExceptionsFilter's {error, message, statusCode} default.
   */
  export class ProblemException extends HttpException {
    constructor(body: ProblemBody) {
      super(body, body.status)
    }
  }
  ```

  `packages/server/src/attempts/problem.filter.ts`:

  ```ts
  import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common"
  import { Catch } from "@nestjs/common"
  import { ProblemException } from "./problem.exception.js"

  /** Structural, not express's Response — see test/helpers/app.ts's own note. */
  interface ProblemHttpResponse {
    status(code: number): ProblemHttpResponse
    type(contentType: string): ProblemHttpResponse
    json(body: unknown): void
  }

  @Catch(ProblemException)
  export class ProblemExceptionFilter implements ExceptionFilter {
    catch(exception: ProblemException, host: ArgumentsHost): void {
      const res = host.switchToHttp().getResponse<ProblemHttpResponse>()

      res
        .status(exception.getStatus())
        .type("application/problem+json")
        .json(exception.getResponse())
    }
  }
  ```

  Apply with `@UseFilters(ProblemExceptionFilter)` at the controller level on every controller Tasks 6–9 create — never globally, so `AllExceptionsFilter`'s existing behaviour for session/catalog/admin is untouched.

- [ ] **Step 4: Run, gates**

  Run: `pnpm --filter @pp/server test problem` → PASS, all three.

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

  Do NOT commit. Leave the work uncommitted for the reviewer to stage.

---

### Task 2: Pure grading

Spec §6: "Scoring — Pure unit tests over responses + questions. No database." A question is correct when the selected choice set exactly equals the correct choice set — this holds for `single_choice` (exactly one correct choice by publication validation) and is this plan's explicit, documented decision for `multi_choice`: no partial credit for selecting some but not all correct choices, since nothing in the spec, schema or contract describes partial credit and `points` is a single whole integer per question.

**Files:**

- Create: `packages/common/src/grading.ts`
- Create: `packages/common/test/grading.test.ts`
- Modify: `packages/common/src/domain/attempt.ts` (`SectionScore.type: string` → `SectionType` — it was left untyped when the domain vocabulary was scaffolded ahead of any implementation; the contract's `SectionScore.type` is `$ref: SectionType`)
- Modify: `packages/common/src/index.ts` (export `grading.ts`)

**Interfaces:**

- Consumes: `ScoringQuestion`, `ScoringChoice` from `./scoring.js` (same package, not the fenced `@pp/db/scoring` — grading never RETRIEVES the answer key, it only accepts one a caller already fetched through the fence). `Score`, `SectionScore` from `./domain/attempt.js`.
- Produces:

  ```ts
  export interface GradableSection {
    id: SectionId
    title: string
    type: SectionType
  }
  export interface GradableResponse {
    questionId: QuestionId
    selectedChoiceIds: ChoiceId[]
  }
  export type GradeResult = Omit<Score, "isPersonalBest">

  /** True iff the selected set exactly equals the correct-choice set. No partial credit. */
  export function isQuestionCorrect(
    question: ScoringQuestion,
    selectedChoiceIds: readonly ChoiceId[],
  ): boolean

  export function gradeAttempt(input: {
    sections: GradableSection[]
    questions: ScoringQuestion[] // must carry sectionId — see Task 4
    responses: GradableResponse[]
  }): GradeResult
  ```

  `gradeAttempt` does NOT re-export `ScoringQuestion`/`ScoringChoice` — it only imports them with `import type` for its own signature, so `packages/common/src/index.ts`'s `export * from "./grading.js"` does not reintroduce them into the default barrel. Task 4's boundary test keeps proving that.

- [ ] **Step 1: Write the failing unit tests — nine cases**

  `packages/common/test/grading.test.ts`, all synchronous, no `withDatabase`, no container:

  ```ts
  it("awards full points for an exact single_choice match", …)
  it("awards zero for a wrong single_choice selection", …)
  it("treats an unanswered question as unanswered, not incorrect, and awards zero", …)
  it("awards full points for a multi_choice selection matching ALL correct choices", …)
  it("awards ZERO — not partial credit — for a multi_choice selection missing one correct choice", …)
  it("awards zero for a multi_choice selection with an extra, incorrect choice included", …)
  it("sums points per section by the question's sectionId, not by ordinal ranges", …)
  // two sections' questions interleaved by ordinal in the input array, asserting the
  // section totals are still correct — a range-based grouping would pass a
  // sorted fixture and fail this one
  it("rounds percentage to two decimal places, matching numeric(5,2)", …)
  // pointsEarned: 1, pointsPossible: 3 => percentage === 33.33, not 33.333333…
  it("returns percentage 0 rather than NaN when pointsPossible is 0", …)
  ```

- [ ] **Step 2: Run to verify the failure**

  Run: `pnpm --filter @pp/common test grading`
  Expected: FAIL — `../src/grading.js` does not exist.

- [ ] **Step 3: `SectionScore.type` fix**

  In `packages/common/src/domain/attempt.ts`, change:

  ```ts
  export interface SectionScore {
    title: string
    type: SectionType // was: string
    pointsEarned: number
    pointsPossible: number
  }
  ```

  Add `import type { SectionType } from "./test.js"` at the top.

- [ ] **Step 4: Implement**

  ```ts
  import type { ChoiceId, QuestionId, SectionId } from "./domain/ids.js"
  import type { Score, SectionScore } from "./domain/attempt.js"
  import type { SectionType } from "./domain/test.js"
  import type { ScoringChoice, ScoringQuestion } from "./scoring.js"

  export interface GradableSection {
    id: SectionId
    title: string
    type: SectionType
  }

  export interface GradableResponse {
    questionId: QuestionId
    selectedChoiceIds: ChoiceId[]
  }

  export type GradeResult = Omit<Score, "isPersonalBest">

  export function isQuestionCorrect(
    question: ScoringQuestion,
    selectedChoiceIds: readonly ChoiceId[],
  ): boolean {
    const correct = new Set(
      question.choices
        .filter((c: ScoringChoice) => c.isCorrect)
        .map((c) => c.id),
    )
    const selected = new Set(selectedChoiceIds)

    return (
      correct.size === selected.size &&
      [...correct].every((id) => selected.has(id))
    )
  }

  function roundToTwoDecimals(value: number): number {
    return Math.round(value * 100) / 100
  }

  export function gradeAttempt(input: {
    sections: GradableSection[]
    questions: ScoringQuestion[]
    responses: GradableResponse[]
  }): GradeResult {
    const responseByQuestion = new Map(
      input.responses.map((r) => [r.questionId, r.selectedChoiceIds]),
    )

    const perSection = new Map<
      SectionId,
      { earned: number; possible: number; answered: number; correct: number }
    >()
    for (const section of input.sections) {
      perSection.set(section.id, {
        earned: 0,
        possible: 0,
        answered: 0,
        correct: 0,
      })
    }

    let pointsEarned = 0
    let pointsPossible = 0
    let answered = 0
    let correct = 0

    for (const question of input.questions) {
      const bucket = perSection.get(question.sectionId)
      if (!bucket) {
        // A question whose group's section is absent from `sections` is a
        // caller bug (frozen content and the section list disagreeing), not
        // a grading decision — fail loudly rather than silently dropping points.
        throw new Error(
          `gradeAttempt: unknown sectionId for question ${question.id}`,
        )
      }

      pointsPossible += question.points
      bucket.possible += question.points

      const selected = responseByQuestion.get(question.id) ?? []
      if (selected.length === 0) {
        continue
      }
      answered += 1
      bucket.answered += 1

      if (isQuestionCorrect(question, selected)) {
        correct += 1
        bucket.correct += 1
        pointsEarned += question.points
        bucket.earned += question.points
      }
    }

    const sections: SectionScore[] = input.sections.map((section) => {
      const bucket = perSection.get(section.id)
      if (!bucket) {
        throw new Error(`gradeAttempt: unreachable — bucket seeded above`)
      }

      return {
        title: section.title,
        type: section.type,
        pointsEarned: bucket.earned,
        pointsPossible: bucket.possible,
      }
    })

    return {
      pointsEarned,
      pointsPossible,
      percentage:
        pointsPossible === 0
          ? 0
          : roundToTwoDecimals((pointsEarned / pointsPossible) * 100),
      answered,
      unanswered: input.questions.length - answered,
      correct,
      incorrect: answered - correct,
      sections,
    }
  }
  ```

- [ ] **Step 5: Run, wire the barrel, gates**

  Add `export * from "./grading.js"` to `packages/common/src/index.ts`.

  Run: `pnpm --filter @pp/common test grading` → PASS, all nine.

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

  Do NOT commit.

---

### Task 3: Pure rule-enforcement predicates

Spec §6: "Rule enforcement — Pure predicates: forward-only, answer-change, max-plays, expiry." These four are not endpoint logic — they are the shared decisions `PUT …/position` (plan 3), `POST …/play` (plan 3), the response-write path (plan 4) and this plan's own submit/result/review all make. No earlier plan created this module; this plan does, because expiry alone is load-bearing for every route in this file, and the other three have no other owner yet. Plan 3/4's endpoints are expected to import from here rather than growing their own copies — if they already have inline versions by the time this executes, extract to match these signatures rather than leaving two implementations of the same rule.

**Files:**

- Create: `packages/common/src/rules.ts`
- Create: `packages/common/test/rules.test.ts`
- Modify: `packages/common/src/index.ts` (export `rules.ts`)

**Interfaces:**

- Consumes: `NavigationMode` from `./domain/test.js`.
- Produces:

  ```ts
  export function canSetPosition(navigation: NavigationMode): boolean
  export function canClaimPlay(
    maxPlays: number | null,
    playsUsed: number,
  ): boolean
  export function remainingPlays(
    maxPlays: number | null,
    playsUsed: number,
  ): number | null
  export function canAcceptAnswerChange(
    allowAnswerChange: boolean,
    existingSelection: readonly string[] | null,
    incomingSelection: readonly string[],
  ): boolean
  export function isPastDeadline(deadline: Date | null, now: Date): boolean
  ```

  Task 6's `submitAttempt` consumes `canAcceptAnswerChange` and `isPastDeadline` directly. Tasks 7–8 consume `isPastDeadline`.

- [ ] **Step 1: Write the failing tests — bracketed in BOTH directions for every predicate**

  `packages/common/test/rules.test.ts`:

  ```ts
  describe("canSetPosition", () => {
    it("allows a position write when navigation is free", …)      // true
    it("refuses a position write when navigation is forward_only", …) // false
  })
  describe("canClaimPlay", () => {
    it("allows an unlimited stimulus regardless of plays used", …)      // maxPlays: null
    it("allows a claim while plays used is below the cap", …)
    it("refuses a claim once plays used reaches the cap", …)
  })
  describe("remainingPlays", () => {
    it("returns null for an unlimited stimulus", …)
    it("returns the cap minus plays used, floored at zero", …)
  })
  describe("canAcceptAnswerChange", () => {
    it("allows any change when allowAnswerChange is true", …)
    it("allows a first answer (existingSelection null) even when allowAnswerChange is false", …)
    it("allows an idempotent re-send of the identical selection, order-independent, when false", …)
    it("refuses a genuinely different selection when allowAnswerChange is false", …)
    // the case that must actually reject — without it the suite could pass
    // against a predicate that always returns true
  })
  describe("isPastDeadline", () => {
    it("is false when the deadline is null (untimed)", …)
    it("is false when now is before the deadline", …)
    it("is true when now exactly equals the deadline", …)
    // submitted_at pins TO the deadline (attempt_expired_pins_deadline), so
    // the boundary itself must count as past
    it("is true when now is after the deadline", …)
  })
  ```

- [ ] **Step 2: Run to verify the failure**

  Run: `pnpm --filter @pp/common test rules`
  Expected: FAIL — `../src/rules.js` does not exist.

- [ ] **Step 3: Implement**

  ```ts
  import type { NavigationMode } from "./domain/test.js"

  /** The navigator's disabled cells are a rendering of exactly this. */
  export function canSetPosition(navigation: NavigationMode): boolean {
    return navigation === "free"
  }

  export function canClaimPlay(
    maxPlays: number | null,
    playsUsed: number,
  ): boolean {
    return maxPlays === null || playsUsed < maxPlays
  }

  export function remainingPlays(
    maxPlays: number | null,
    playsUsed: number,
  ): number | null {
    return maxPlays === null ? null : Math.max(maxPlays - playsUsed, 0)
  }

  function sameSelection(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) {
      return false
    }
    const sortedA = [...a].sort()
    const sortedB = [...b].sort()

    return sortedA.every((id, i) => id === sortedB[i])
  }

  /**
   * Tests the SELECTION, not the mere existence of a prior answer (openapi
   * saveResponse description) — re-sending identical content under
   * allowAnswerChange: false is an idempotent no-op, or every network retry
   * would 409.
   */
  export function canAcceptAnswerChange(
    allowAnswerChange: boolean,
    existingSelection: readonly string[] | null,
    incomingSelection: readonly string[],
  ): boolean {
    if (allowAnswerChange || existingSelection === null) {
      return true
    }

    return sameSelection(existingSelection, incomingSelection)
  }

  /**
   * Inclusive of the boundary: attempt_expired_pins_deadline requires
   * submitted_at = expires_at exactly, so "now === deadline" must count as
   * past, not still-running.
   */
  export function isPastDeadline(deadline: Date | null, now: Date): boolean {
    return deadline !== null && now.getTime() >= deadline.getTime()
  }
  ```

- [ ] **Step 4: Run, wire the barrel, gates**

  Add `export * from "./rules.js"` to `packages/common/src/index.ts`.

  Run: `pnpm --filter @pp/common test rules` → PASS, all thirteen.

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

  Do NOT commit.

---

### Task 4: Give scoring questions a section, and make `loadForScoring` callable from a transaction

Two gaps discovered while designing Task 5, both verified against the real code rather than assumed:

1. `ScoringQuestion` (`packages/common/src/scoring.ts`) has no `sectionId`. Grading needs to bucket points per section (Task 2's `gradeAttempt` requires it), and nothing today supplies it.
2. `loadForScoring(pool: pg.Pool, versionId): Promise<ScoringQuestion[]>` (`packages/db/src/repositories/test-version.repository.ts:201`) is typed to accept a real `pg.Pool`, but Task 5's `finalizeAttempt` must call it from INSIDE a transaction, where the available handle is a `PgQueryable` (a `withTransaction` client), not a `Pool`. `PgQueryable = { query: PgPool['query'] }` — a `pg.Pool` already satisfies that shape, so widening the parameter type is backward-compatible: every existing caller passing a real `Pool` still type-checks.

**Files:**

- Modify: `packages/common/src/scoring.ts` (`ScoringQuestion` gains `sectionId`)
- Modify: `packages/db/src/repositories/test-version.repository.ts` (`loadForRunner`/`loadForScoring` retyped to `PgQueryable`; `loadForScoring`'s query joins `test_section`)
- Modify: `packages/db/test/boundary.test.ts` (extend the existing scoring-fence case)
- Create: `packages/db/test/scoring-projection.test.ts`

**Interfaces:**

- Consumes: `seedPublishedTest` fixture (`packages/db/test/helpers/fixtures.ts`) — already seeds a listening and a reading section with one question each.
- Produces: `ScoringQuestion { …; sectionId: SectionId }`; `loadForScoring(db: PgQueryable, versionId: string): Promise<ScoringQuestion[]>`.

- [ ] **Step 1: Write the failing test**

  `packages/db/test/scoring-projection.test.ts`:

  ```ts
  it("carries sectionId on every scoring question, matching the seeded sections", …)
  // asserts the listening question's sectionId === fixture.listeningSectionId
  // and the reading question's === fixture.readingSectionId
  it("is callable with a transaction client, not only a bare Pool", …)
  // withTransaction(pool, (tx) => loadForScoring(tx, versionId)) resolves, not a type error
  ```

  The second case is a runtime proof, not just a type-check: `pnpm typecheck` would already catch a signature regression, but this proves the query itself executes correctly through a `tx` client, which a type-only assertion cannot.

- [ ] **Step 2: Run to verify the failure**

  Run: `pnpm --filter @pp/db test scoring-projection`
  Expected: FAIL — `sectionId` is `undefined` on both questions (case 1); case 2 currently does not even compile once written with a `tx` argument, which IS the red this step records.

- [ ] **Step 3: `ScoringQuestion` gains `sectionId`**

  `packages/common/src/scoring.ts`:

  ```ts
  import type { SectionId } from "./domain/ids.js"
  import type { RunnerChoice, RunnerQuestion } from "./domain/test.js"

  export interface ScoringChoice extends RunnerChoice {
    isCorrect: boolean
  }

  export interface ScoringQuestion extends Omit<RunnerQuestion, "choices"> {
    sectionId: SectionId
    points: number
    choices: ScoringChoice[]
  }
  ```

- [ ] **Step 4: Retype and extend the query**

  In `packages/db/src/repositories/test-version.repository.ts`, change both `loadForRunner` and `loadForScoring`'s first parameter from `pool: pg.Pool` to `db: PgQueryable` (add `import type { PgQueryable } from "@liam-public/node-postgres"`; every internal `pool.query` call becomes `db.query`). Extend `ScoringRow` and the query in `loadForScoring`:

  ```ts
  interface ScoringRow {
    q_id: string
    q_ordinal: number
    q_type: string
    q_prompt: string
    q_points: number
    section_id: string // new
    c_id: string
    c_label: string
    c_correct: boolean
  }

  export async function loadForScoring(
    db: PgQueryable,
    versionId: string,
  ): Promise<ScoringQuestion[]> {
    const { rows } = await db.query<ScoringRow>(
      `SELECT q.id q_id, q.ordinal q_ordinal, q.type::text q_type, q.prompt q_prompt,
              q.points q_points, ts.id section_id,
              c.id c_id, c.label c_label, c.is_correct c_correct
         FROM question q
         JOIN question_group g ON g.id = q.question_group_id
         JOIN test_section ts ON ts.id = g.test_section_id
         JOIN choice c ON c.question_id = q.id
        WHERE q.test_version_id = $1
        ORDER BY q.ordinal, c.ordinal`,
      [versionId],
    )
    // findOrCreateScoringQuestion now also sets sectionId: asSectionId(r.section_id)
    …
  }
  ```

- [ ] **Step 5: Extend the boundary test**

  In `packages/db/test/boundary.test.ts`, add a case proving `sectionId` survived the retype without the field silently vanishing under the new join — reuse the existing fixture-based assertion pattern already in that file rather than inventing a new fixture.

- [ ] **Step 6: Run, gates**

  Run: `pnpm --filter @pp/db test scoring-projection boundary` → PASS.

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

  Do NOT commit.

---

### Task 5: `finalizeAttempt` — grade once, cache the result, never re-grade

The schema's own comment on `attempt` calls the score columns "a cache of a pure function over frozen content" — and `attempt_finished_is_graded` enforces that ALL eight score columns are non-null the instant `status <> 'in_progress'`. That means finalization and grading are one atomic operation, and it is this task, not Task 6, that anyone finalizing an attempt must call — including plan 2 Task 9's stale-attempt finalization inside `POST /attempts` (see the note at the end of this task).

Two entry points are produced: `finalizeAttempt` (opens its own transaction — for callers outside one, like Tasks 7–8's lazy finalize) and an un-exported `finalizeAttemptTx` (takes an existing `PgQueryable` — for Task 6's submit, which must apply the final responses and finalize in the SAME transaction, per spec §5 rule 6).

**Files:**

- Modify: `packages/db/src/repositories/attempt.repository.ts` (does not exist as a file yet in this repository as of this plan's authoring — plan 2 Task 9 creates it for `startOrResumeAttempt`; treat this as Modify, and if it is genuinely absent when this task starts, stop and flag that plan 2 Task 9 has not landed)
- Create: `packages/db/test/attempt-finalize.test.ts`

**Interfaces:**

- Consumes: `gradeAttempt` (Task 2), `isPastDeadline` (Task 3), `loadForScoring` (Task 4), `withTransaction`, `type PgPool`, `type PgQueryable` from `@liam-public/node-postgres`.
- Produces:

  ```ts
  export interface AttemptScoreRow {
    attemptId: string
    testVersionId: string
    status: "submitted" | "expired"
    submittedAt: Date
    pointsEarned: number
    pointsPossible: number
    percentage: number
    answered: number
    unanswered: number
    correct: number
    incorrect: number
    sections: SectionScore[]
  }

  export async function finalizeAttempt(
    pool: PgPool,
    input: {
      attemptId: string
      status: "submitted" | "expired"
      submittedAt: Date
    },
  ): Promise<AttemptScoreRow | null> // null: no such attempt
  ```

  `finalizeAttemptTx(tx: PgQueryable, input): Promise<AttemptScoreRow | null>` is NOT exported from the package — it is exported only for this task's own test file via a relative import, proven by a case in Step 2 that imports it directly. Tasks 7 and 8 call `finalizeAttempt`, never the transaction-scoped version, so they never need to manage a transaction themselves.

- [ ] **Step 1: The idempotence rule, stated so no implementer improvises one**

  1. Lock the attempt row `FOR UPDATE` inside the transaction — this is what makes concurrent finalization (a lazy `/result` read racing a `/submit`) safe.
  2. If `status <> 'in_progress'`: this is NOT a re-grade. Read back the already-cached columns and return them as-is. `input.status`/`input.submittedAt` are IGNORED on this path — the point of idempotence is that a second call cannot change what a first call already froze.
  3. If `status = 'in_progress'`: load sections (`test_section` for the version, ordered), scoring questions (`loadForScoring`, same `tx`), and this attempt's responses (`response` joined to `response_choice`, grouped by question). Call `gradeAttempt`. `UPDATE attempt` with the graded totals, `input.status`, `input.submittedAt`, and `question_count = questions.length`.
  4. Return the graded `AttemptScoreRow`, including `sections` from `gradeAttempt`'s output — nothing is written to `attempt_section` by this function. `attempt_section`'s own score columns are populated (or not) by whichever normal section-completion flow plan 3/4 implements when a section closes mid-attempt; nothing in the schema requires every `attempt_section` row to be completed for `attempt.status` to be `submitted`/`expired`, and every reader of `Score.sections` in this plan (Tasks 7 and 9) gets it fresh from `gradeAttempt`, never from `attempt_section`. State this decision in a comment at the write, not just here — it is the kind of thing a later "why isn't `attempt_section` updated here" question needs answering in place.

- [ ] **Step 2: Write the failing tests — seven cases**

  `packages/db/test/attempt-finalize.test.ts`, built on `seedPublishedTest` (which publishes one listening question worth 1 point and one reading question worth 1 point) plus a real `attempt` row inserted per case:

  ```ts
  it("grades an unanswered attempt as 0/2 and marks every question unanswered", …)
  it("grades a fully-correct attempt as 2/2", …)
  it("writes status and submittedAt exactly as given", …)
  it("pins submittedAt to the given deadline, not to a later now, when called for an expired attempt", …)
  // createFixedClock is irrelevant here — finalizeAttempt takes submittedAt as
  // an explicit argument precisely so the caller (Task 6/7) controls this
  it("is idempotent: a second call with a DIFFERENT status/submittedAt does not change the stored result", …)
  // call once with status:'submitted', submittedAt: T1; call again with
  // status:'expired', submittedAt: T2; assert the row still reads
  // status:'submitted', submittedAt: T1 — proving ignoring is real, not
  // vacuous, because a caller passing identical values could pass by luck
  it("returns null for an attempt id that does not exist", …)
  it("sums pointsEarned across BOTH sections into the attempt-level total", …)
  ```

- [ ] **Step 3–4: Run to verify the first case fails, then implement, then run to verify PASS.**

- [ ] **Step 5: The forward dependency plan 2 Task 9 incurred**

  Plan 2 Task 9's `startOrResumeAttempt` finalizes a stale in-progress attempt (rule 3: "finalize it … and create a new one in the same transaction") to satisfy `attempt_one_active`. `attempt_finished_is_graded` means that finalization was ALWAYS required to populate all eight score columns — including `question_count`, which this task's `finalizeAttempt` computes from `loadForScoring`. If plan 2 Task 9 was implemented before this task existed, it necessarily either stubbed the score columns (which would violate `attempt_running_is_ungraded`/`attempt_finished_is_graded`'s NOT NULL-together requirement and could not have passed its own constraint tests) or it already duplicated grading inline. Check `packages/db/src/repositories/attempt.repository.ts`'s `startOrResumeAttempt` for how it currently finalizes a stale attempt. If it duplicates grading, replace that inline logic with a call to THIS task's `finalizeAttempt`, and say so in your report — do not leave two independent implementations of "what score does an expired attempt get."

- [ ] **Step 6: Gates**

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

  Do NOT commit.

---

### Task 6: `POST /attempts/{id}/submit`

Spec §5 rule 6: `POST /submit` carries the queue's remainder in its own body, applied first, then graded, in one transaction. **The queue itself — client-side IndexedDB, retry/backoff, the reorder guard's general form, `failed_write` capture — is plan 4's territory (spec §8 phase 4: "queue, snapshot flush, reorder guard, failed_write, retry classification") and this task does not re-plan it.** What this task owns is narrower: given the (optional) array `SubmitRequest.responses` already validated as `ResponseSnapshotItem[]`, apply each item to the ALREADY-open section using plan 4's per-item apply function, then finalize.

**This task has a hard dependency on plan 4.** It assumes plan 4 exports a function from `@pp/db` shaped approximately like:

```ts
export async function applyResponseItem(
  tx: PgQueryable,
  input: {
    attemptId: string
    sectionId: string
    clientInstanceId: string
    questionId: string
    seq: number
    selectedChoiceIds: string[]
    answeredAt: string | null
    timeSpentMs: number | null
    now: Date
  },
): Promise<ItemResult> // from @pp/common: ItemAccepted | ItemRejected, i.e. applied/ignored_stale/rejected+capturedAs
```

— matching `PATCH …/responses`'s per-item semantics (reorder guard by `(clientInstanceId, seq)`, `canAcceptAnswerChange` from Task 3, `failed_write` capture on rejection). **If plan 4 has landed by the time this task is implemented, import its real function and adapt the call in Step 4 to its actual name and shape — do not write a second reorder guard or a second `failed_write` capture; that duplication is exactly the two-sources-of-truth risk spec §6 warns about for the Zod/SQL split, applied to this pair instead.** If plan 4 has NOT landed, stop and say so in your report rather than inventing the queue machinery yourself.

**Files:**

- Modify: `packages/db/src/repositories/attempt.repository.ts` (add `submitAttempt`)
- Create: `packages/server/src/attempts/ownership.ts`
- Create: `packages/server/src/attempts/submit-request.schema.ts`
- Create (if `packages/server/src/attempts/*` does not already exist from plan 2 Task 9 — Modify otherwise): `attempts.controller.ts`, `attempts.service.ts`, `attempts.module.ts`
- Create: `packages/db/test/attempt-submit.test.ts`, `packages/server/test/submit.e2e.test.ts`

**Interfaces:**

- Consumes: `finalizeAttemptTx` (Task 5, internal), `canAcceptAnswerChange`/`isPastDeadline` (Task 3), `applyResponseItem` (plan 4, assumed shape above), `ProblemException` (Task 1).
- Produces:

  ```ts
  export type SubmitOutcome =
    | { kind: "not_found" }
    | { kind: "already_expired"; finalized: AttemptScoreRow }
    | { kind: "nothing_answered" }
    | {
        kind: "submitted"
        alreadySubmitted: boolean
        finalized: AttemptScoreRow
        finalFlush: ItemResult[]
      }

  export async function submitAttempt(
    pool: PgPool,
    input: {
      attemptId: string
      now: Date
      clientInstanceId: string
      responses: Array<{
        questionId: string
        seq: number
        selectedChoiceIds: string[]
        answeredAt?: string
        timeSpentMs?: number
      }>
    },
  ): Promise<SubmitOutcome>
  ```

- [ ] **Step 1: The rules, stated in full**

  All of the below runs inside ONE `withTransaction`, with the attempt row locked `FOR UPDATE` first:

  1. Not found → `{kind: "not_found"}`.
  2. `status = 'submitted'` already → `{kind: "submitted", alreadySubmitted: true, finalized: <cached row, read not re-graded>, finalFlush: []}`. This is the `200` case — "the same row, not a regrade" (openapi).
  3. `status = 'expired'` already (finalized by an earlier lazy read, e.g. a concurrent `GET /result`) → `{kind: "already_expired", finalized: <cached row>}`.
  4. `status = 'in_progress'` and `isPastDeadline(expiresAt, now)` → call `finalizeAttemptTx` with `status: 'expired', submittedAt: expiresAt` (pinned, never `now`) → `{kind: "already_expired", finalized}`. This IS the request that just finalized it; the caller still gets `410`, matching `AttemptExpiredProblem`'s "either the one this request touched, or a stale one" framing.
  5. `status = 'in_progress'` and NOT past deadline: resolve the currently open section via `SELECT test_section_id FROM attempt_section WHERE attempt_id = $1 AND completed_at IS NULL`. For each item in `input.responses`, call `applyResponseItem` with that `sectionId` (an item is `ignored_stale` by construction if no section is open — nothing left to apply against). Collect `finalFlush: ItemResult[]`.
  6. Check "nothing answered" AFTER applying the remainder: `SELECT EXISTS(SELECT 1 FROM response_choice WHERE attempt_id = $1)`. A `response` row can exist with zero `response_choice` children (an answer that was cleared) — checking `response_choice` existence, not `response`, is what makes this test correct rather than vacuously true. If false → `{kind: "nothing_answered"}`, WITHOUT finalizing. The remainder's writes from step 5 still commit — refusing to submit is not a reason to discard answers just applied.
  7. Otherwise: `finalizeAttemptTx` with `status: 'submitted', submittedAt: now` → `{kind: "submitted", alreadySubmitted: false, finalized, finalFlush}`. This is the `201` case.

- [ ] **Step 2: Write the failing repository tests — eight cases**

  `packages/db/test/attempt-submit.test.ts`:

  ```ts
  it("grades and finalizes as submitted, returning alreadySubmitted: false", …)
  it("is idempotent: submitting an already-submitted attempt returns the SAME cached score, not a regrade", …)
  it("refuses with nothing_answered when the attempt has no response_choice rows at all", …)
  it("does NOT refuse nothing_answered when the remainder itself supplies the only answer", …)
  // responses: [] beforehand, but input.responses carries one item -- proves
  // the check runs AFTER applying the remainder, not before
  it("finalizes as expired, pinning submittedAt to expiresAt, when called past the deadline", …)
  // createFixedClock well past expiresAt; assert submittedAt === expiresAt, not now
  it("returns already_expired for an attempt some other read already finalized as expired", …)
  it("returns not_found for an unknown attempt id", …)
  it("commits the remainder's writes even when the final verdict is nothing_answered", …)
  // a single non-empty item that itself gets REJECTED (e.g. answer_change_not_allowed)
  // combined with zero prior answers still yields nothing_answered; a
  // DIFFERENT case with one ACCEPTED item and zero prior answers must NOT
  // yield nothing_answered -- covers both branches of "the remainder decides it"
  ```

- [ ] **Step 3–4: Run to verify the first case fails (module not found), implement, run to verify PASS.**

- [ ] **Step 5: `submit-request.schema.ts`, ownership, controller**

  `packages/server/src/attempts/submit-request.schema.ts` — a small Zod schema matching `SubmitRequest` exactly (`required: [clientInstanceId]`, `additionalProperties: false`, `responses` optional array of `ResponseSnapshotItem`-shaped objects); `422`-worthy validation failures become `ProblemException({type:"invalid_request", title:"Invalid request body", status: 400, detail: <zod issue summary>})` — `400`, per the contract's `flushResponses` sibling operation using `400` for a malformed body, not `422` (that status is reserved for admin import/publish in this contract).

  `packages/server/src/attempts/ownership.ts`:

  ```ts
  export type OwnedAttempt =
    | { kind: "ok"; studentId: string }
    | { kind: "not_found" }
    | { kind: "forbidden" }

  export async function resolveOwnedAttempt(
    pool: PgPool,
    input: { attemptId: string; subjectClaim: string },
  ): Promise<OwnedAttempt>
  ```

  Resolves the caller's `student.id` via `findStudentBySubject` (Task 6 of plan 2), then compares it to the attempt's `student_id` (a lightweight `SELECT student_id FROM attempt WHERE id = $1`). Tasks 7 and 8 reuse this verbatim rather than each writing their own ownership check.

  `packages/server/src/attempts/attempts.controller.ts` — `@Controller("attempts")`, `@UseGuards(JwksGuard)`, `@UseFilters(ProblemExceptionFilter)`:

  ```ts
  @Post(":id/submit")
  async submit(
    @CurrentStudent() claims: JwtClaims,
    @Param("id") id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: StatusSettable,
  ): Promise<SubmitResultView> {
    const parsed = submitRequestSchema.safeParse(body)
    if (!parsed.success) {
      throw new ProblemException({ type: "invalid_request", title: "Invalid request body", status: 400, retryable: false })
    }

    const owned = await this.attempts.checkOwnership(id, subjectOf(claims))
    if (owned.kind === "not_found") throw new NotFoundException("attempt_not_found")
    if (owned.kind === "forbidden") {
      throw new ProblemException({ type: "not_your_attempt", title: "Not your attempt", status: 403, retryable: false })
    }

    const outcome = await this.attempts.submit(id, parsed.data)
    return this.attempts.renderSubmitResult(id, outcome, res)
  }
  ```

  `renderSubmitResult` maps `SubmitOutcome`: `not_found` → (unreachable here, ownership already checked) `nothing_answered` → `409` `ProblemException({type:"nothing_answered", title:"Nothing answered", status:409, retryable:false})`; `already_expired` → `410` `ProblemException({type:"attempt_expired", title:"Time is up", status:410, retryable:false, attempt:{id, status:"expired", submittedAt: finalized.submittedAt.toISOString(), resultUrl: \`/attempts/${id}/result\`}})`; `submitted` → `res.status(alreadySubmitted ? 200 : 201)`, body `{attemptId, status:"submitted", submittedAt: finalized.submittedAt.toISOString(), resultUrl: \`/attempts/${id}/result\`, finalFlush}`.

  **`resultUrl` is `/attempts/{id}/result`, not `/api/attempts/{id}/result`.** `openapi.yaml` declares `servers: [{url: "/api"}]`, but no task through plan 2 ever called `app.setGlobalPrefix("api")` — `main.ts` mounts every controller unprefixed today, and `session`/`catalog`'s already-passing e2e tests call bare `/session`, `/tests`. Adding the prefix here would be repo-wide and would break those tests, which is out of this plan's authority. This task follows the established (unprefixed) convention for internal consistency and flags the mismatch — see this plan's closing report.

- [ ] **Step 6: Write the failing e2e tests — seven cases**

  `packages/server/test/submit.e2e.test.ts`, using `createTestApp`'s `mint`:

  ```ts
  it("401s with no token", …)
  it("403s for another student's attempt", …)
  it("404s for an unknown attempt id", …)
  it("201s and grades on first submit, 200s and returns the identical body on a second submit", …)
  it("409s with nothing_answered when nothing was ever answered and the body carries no responses", …)
  it("410s with an AttemptExpiredProblem body carrying the finalized attempt when called past the deadline", …)
  it("400s on a body missing clientInstanceId", …)
  ```

- [ ] **Step 7: Run, gates**

  ```bash
  pnpm --filter @pp/db test attempt-submit
  pnpm --filter @pp/server test submit
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

  Do NOT commit.

---

### Task 7: `GET /attempts/{id}/result`

Lazy-finalizes a past-deadline attempt and returns `200`; `409` is reserved for an attempt genuinely still running. `isPersonalBest` is computed at read time, scoped to `test_version_id` — matching the existing precedent in `catalog.repository.ts`'s `bestAttempt` (also scoped to the CURRENT version, not across every historical version of the test), and consistent with spec §7's own risk entry that attempts spanning versions "may not be strictly comparable."

**Files:**

- Create: `packages/db/src/repositories/attempt-result.repository.ts` (`loadAttemptResult`; also the shared internal `gradeExistingAttempt` helper Task 9 reuses)
- Create: `packages/server/src/attempts/results.controller.ts`, `results.service.ts`, `results.module.ts`
- Modify: `packages/server/src/app.module.ts` (import `ResultsModule`)
- Create: `packages/db/test/attempt-result.test.ts`, `packages/server/test/result.e2e.test.ts`

**Interfaces:**

- Consumes: `finalizeAttempt` (Task 5), `gradeAttempt` + `loadForScoring` (for the fresh per-section breakdown — see rationale below), `isPastDeadline` (Task 3), `resolveOwnedAttempt` (Task 6).
- Produces:

  ```ts
  export type AttemptResultOutcome =
    | { kind: "not_found" }
    | { kind: "still_running" }
    | {
        kind: "ready"
        result: {
          attemptId: string
          testTitle: string
          testVersion: number
          status: "submitted" | "expired"
          submittedAt: Date
          elapsedSeconds: number
          score: GradeResult
          isPersonalBest: boolean
        }
      }

  export async function loadAttemptResult(
    pool: PgPool,
    input: { attemptId: string; now: Date },
  ): Promise<AttemptResultOutcome>
  ```

- [ ] **Step 1: Why the section breakdown is re-graded, not read from a cache**

  `attempt`'s TOTAL score columns are cached (Task 5). Nothing caches a PER-SECTION breakdown anywhere (Task 5 deliberately left `attempt_section` untouched). Rather than build a second cache with its own invalidation story, `loadAttemptResult` calls `gradeAttempt` fresh every read, over the frozen content and the attempt's (also frozen, post-finalization) responses — cheap, for a dataset this size, and it can never disagree with itself. Assert this equivalence directly: a test that the fresh section-level sum of `pointsEarned` equals the attempt row's cached total.

- [ ] **Step 2: Write the failing repository tests — six cases**

  `packages/db/test/attempt-result.test.ts`:

  ```ts
  it("returns not_found for an unknown attempt", …)
  it("returns still_running for an in_progress attempt not yet past its deadline", …)
  it("lazily finalizes and returns ready for an in_progress attempt past its deadline", …)
  // assert the attempt row's status is now 'expired' in the database — the
  // read had a side effect, which is the whole point of lazy finalization
  it("returns ready directly, without re-finalizing, for an already-submitted attempt", …)
  it("computes isPersonalBest true for the only finished attempt on a version", …)
  it("computes isPersonalBest false for an attempt scoring below this student's other attempt on the SAME version", …)
  // and true for the one that IS the best -- both directions of the same fixture
  ```

- [ ] **Step 3–4: Run to verify the first case fails, implement, run to verify PASS.**

- [ ] **Step 5: Controller**

  `GET /attempts/:id/result` behind `JwksGuard`, `@UseFilters(ProblemExceptionFilter)`. `not_found` → `404`; `still_running` → `ProblemException({type:"still_running", title:"Attempt still running", status:409, retryable:false})`; `ready` → `200` with `AttemptResult`. Ownership check (Task 6's `resolveOwnedAttempt`) runs BEFORE calling `loadAttemptResult` — `403` must not depend on whether the attempt happens to be finished.

- [ ] **Step 6: Write the failing e2e tests — five cases, gates**

  ```ts
  it("401s with no token", …)
  it("403s for another student's attempt", …)
  it("409s for a genuinely running attempt", …)
  it("200s with the score for a submitted attempt", …)
  it("200s, having lazily finalized, for a past-deadline attempt never explicitly submitted", …)
  ```

  ```bash
  pnpm --filter @pp/db test attempt-result
  pnpm --filter @pp/server test result
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

  Do NOT commit.

---

### Task 8: `GET /attempts/{id}/review`

The one place `choice.isCorrect` reaches a student (spec §4). `loadReview` selects `choice.is_correct` directly rather than going through `@pp/db/scoring` — say so at the query, since it is the one deliberate exception to the fence Task 4 (and plan 2 Task 5) otherwise enforces everywhere else.

**Files:**

- Modify: `packages/db/src/repositories/attempt-result.repository.ts` (add `loadReview`)
- Modify: `packages/server/src/attempts/results.controller.ts`, `results.service.ts`
- Create: `packages/db/test/attempt-review.test.ts`, `packages/server/test/review.e2e.test.ts`

**Interfaces:**

- Consumes: `isQuestionCorrect` (Task 2, reused so `/result` and `/review` can never disagree about which questions are correct), `finalizeAttempt`/`isPastDeadline` (same lazy-finalize shape as Task 7).
- Produces:

  ```ts
  export type ReviewOutcome =
    | { kind: "not_found" }
    | { kind: "still_running" }
    | { kind: "ready"; items: ReviewItem[] } // ReviewItem shape matches openapi's ReviewItem exactly

  export async function loadReview(
    pool: PgPool,
    input: { attemptId: string; now: Date; mediaBaseUrl: string },
  ): Promise<ReviewOutcome>
  ```

  `mediaBaseUrl` (e.g. `config.mediaRoot`'s public mount, `/media`) is threaded through because `ReviewMediaStimulus.mediaUrl` is unsigned and static here — unlike the runner's play-capped, signed URL, the attempt is over and there is nothing left to guard.

- [ ] **Step 1: The query and grouping**

  One row per (question, choice), joined through `question_group` → `test_section` for context and `stimulus`/`media_asset` for the (optional) stimulus, with `response_choice` left-joined on this attempt to derive `selected`:

  ```sql
  SELECT q.id q_id, q.ordinal q_ordinal, q.prompt q_prompt, q.type::text q_type,
         ts.id section_id,
         c.id c_id, c.label c_label, c.is_correct c_is_correct,
         (rc.choice_id IS NOT NULL) c_selected,
         st.id st_id, st.type::text st_type, st.title st_title, st.body_text st_body,
         ma.filename st_filename
    FROM question q
    JOIN question_group g ON g.id = q.question_group_id
    JOIN test_section ts  ON ts.id = g.test_section_id
    LEFT JOIN stimulus st    ON st.id = g.stimulus_id
    LEFT JOIN media_asset ma ON ma.id = st.media_asset_id
    JOIN choice c ON c.question_id = q.id
    LEFT JOIN response_choice rc
      ON rc.attempt_id = $2 AND rc.question_id = q.id AND rc.choice_id = c.id
   WHERE q.test_version_id = $1
   ORDER BY q.ordinal, c.ordinal
  ```

  Group by question (same `findOrCreate` shape as `loadForRunner`). `outcome` per question: no `c_selected` true anywhere → `"unanswered"`; else `isQuestionCorrect`-equivalent exact-match on the selected ids using the row's OWN `c_is_correct` values (no second query) → `"correct"` or `"incorrect"`. `stimulus.mediaUrl`, when `st_filename` is present, is `` `${mediaBaseUrl}/${st_filename}` ``.

- [ ] **Step 2: Write the failing repository tests — five cases**

  `packages/db/test/attempt-review.test.ts`:

  ```ts
  it("returns EVERY question, including one never answered", …)
  it("marks a correct answer's outcome correct and its choice selected: true", …)
  it("marks a wrong answer's outcome incorrect and shows the choice actually selected", …)
  it("carries a passage stimulus's title and bodyText for the reading question", …)
  it("carries an unsigned, un-capped mediaUrl for the listening question's audio stimulus, with no play-count field anywhere", …)
  // asserts the response has no playsUsed/maxPlays key at all -- the runner's
  // cap machinery does not leak into review, which is unlimited by construction
  ```

- [ ] **Step 3–4: Run to verify the first case fails, implement, run to verify PASS.**

- [ ] **Step 5: Controller**

  `GET /attempts/:id/review` — same lazy-finalize/ownership/`409`/`403` shape as Task 7's result route, sharing the module. `200` with `ReviewPayload`.

- [ ] **Step 6: Write the failing e2e tests — four cases, gates**

  ```ts
  it("401s with no token", …)
  it("403s for another student's attempt", …)
  it("409s for a genuinely running attempt", …)
  it("200s with every question, answered and unanswered, for a finished attempt", …)
  ```

  ```bash
  pnpm --filter @pp/db test attempt-review
  pnpm --filter @pp/server test review
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

  Do NOT commit.

---

### Task 9: `GET /attempts` — history

`status=finished` (the default) covers `submitted` AND `expired` — filtering out expired attempts would hide real, graded results. Keyset-paginated on `(submitted_at DESC, id)`, exactly matching the existing `attempt_history_idx` partial index.

**Files:**

- Modify: `packages/db/src/repositories/attempt-result.repository.ts` (add `listAttemptHistory`, reusing `gradeExistingAttempt` from Task 7)
- Modify: `packages/server/src/attempts/attempts.controller.ts`, `attempts.service.ts`
- Create: `packages/db/test/attempt-history.test.ts`, `packages/server/test/history.e2e.test.ts`

**Interfaces:**

- Consumes: `findStudentBySubject`; the same cursor encode/decode shape `catalog.repository.ts` already uses (`InvalidCursorError`, base64 of an opaque pair) — reuse that pattern rather than inventing a second cursor format for the same API surface.
- Produces:

  ```ts
  export interface AttemptHistoryRow {
    id: string
    testTitle: string
    submittedAt: Date
    status: "submitted" | "expired"
    pointsEarned: number
    pointsPossible: number
    percentage: number
    sections: SectionScore[]
  }

  export async function listAttemptHistory(
    pool: PgPool,
    input: {
      studentId: string
      status: "finished" | "submitted" | "expired"
      limit: number
      cursor: string | null
    },
  ): Promise<{ attempts: AttemptHistoryRow[]; nextCursor: string | null }>
  ```

- [ ] **Step 1: N+1 is the deliberate choice here, and why**

  Each row's `sections` breakdown is computed by calling the SAME `gradeAttempt` pure function Task 7 uses (`gradeExistingAttempt(pool, {attemptId, testVersionId})`), once per row on the page — up to 50 extra lightweight queries per page, for a family-scale app. The alternative — a single hand-written SQL aggregate re-deriving "what counts as correct" — is a second implementation of `isQuestionCorrect`, and spec §6 already names that exact class of risk (Zod vs. SQL) as something to test against, not reproduce. Say this in a comment at the call site.

- [ ] **Step 2: Write the failing repository tests — five cases**

  `packages/db/test/attempt-history.test.ts`:

  ```ts
  it("lists finished attempts newest-submitted-first", …)
  it("includes an expired attempt under the default finished filter", …)
  it("excludes an in_progress attempt entirely", …)
  it("filters to only expired when status=expired is given", …)
  it("paginates by keyset and the cursor round-trips: page 1 + page 2 == all, no overlap", …)
  ```

- [ ] **Step 3–4: Run to verify the first case fails, implement, run to verify PASS.**

- [ ] **Step 5: Controller**

  `GET /attempts?status=&limit=&cursor=` behind `JwksGuard`. `status` defaults to `finished`; an out-of-range `limit` is `400` (mirroring `catalog.controller.ts`'s existing `parseLimit`, reused rather than reimplemented); a bad `cursor` is `400` via the shared `InvalidCursorError` mapping.

- [ ] **Step 6: Write the failing e2e tests — three cases, gates**

  ```ts
  it("401s with no token", …)
  it("200s with only this student's finished attempts, newest first", …)
  it("400s on an undecodable cursor", …)
  ```

  ```bash
  pnpm --filter @pp/db test attempt-history
  pnpm --filter @pp/server test history
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

  Do NOT commit.

---

### Task 10: React — the hand-in dialog and submit

This plan assumes `packages/app` (scaffolded by plan 3, wired to the runner endpoints by plans 3–4) already exists with a TanStack Router file-based tree under `src/pages/` (matching the convention harvested from `packages/web/src/pages/**` — `$param.tsx` for dynamic segments), an authenticated fetch client via `@liam-public/auth-fetch`, and a local answer queue exposing SOME drain-remainder call (plan 4). **Confirm the actual shape of both against what plan 3/4 produced before writing this task's code — the interfaces below are this plan's best-supported assumption, not a verified fact, because neither package exists in this repository as of this plan's authoring.**

**Files:**

- Create: `packages/app/src/pages/attempts/$attemptId/hand-in.tsx`
- Create: `packages/app/src/api/attempts.ts` (or extend it, if plan 3/4 already created a file by this name for the runner/queue calls)
- Create: `packages/app/test/hand-in.test.tsx`

**Interfaces:**

- Consumes (assumed, from plan 4 — verify before use): `drainQueueRemainder(attemptId: string): { clientInstanceId: string; items: ResponseSnapshotItem[] }` reading the local queue without clearing it (cleared only once `finalFlush` acks arrive, per spec §5 rule 1).
- Produces: `submitAttempt(attemptId: string): Promise<SubmitResult>` — a thin `POST /attempts/{id}/submit` wrapper carrying the drained remainder, typed against the `SubmitRequest`/`SubmitResult` schemas quoted in this plan's header.

- [ ] **Step 1: The dialog content, from the prototype**

  `docs/prototype/index.html`'s hand-in screen (`#s-hand-in`, the panel immediately before `#s-result`) shows an Answered/Not answered count pair and, when the count is non-zero, a notice naming the blank question numbers and the time remaining, with "Keep working" and "Hand in" actions. Both counts and the blank list come from the ALREADY-LOADED runner envelope (`answeredCount`, `unansweredOrdinals`) — this task does not fetch them again, it renders what plan 3's runner state already holds.

- [ ] **Step 2: Write the failing test**

  `packages/app/test/hand-in.test.tsx` (React Testing Library or the harness plan 3/4 established — verify which is already in use before assuming one):

  ```ts
  it("disables Hand in while the local queue is non-empty", …)
  // per spec §5: the client refuses to submit while unsent answers remain;
  // this is the client-side guard, distinct from the server's own belt-and-
  // braces remainder handling in Task 6
  it("calls submit with the drained remainder and navigates to the result screen on success", …)
  it("renders the time-up screen, not an error toast, when submit responds 410", …)
  ```

- [ ] **Step 3–4: Run to verify the failure, implement, run to verify PASS, gates.**

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

  Do NOT commit.

---

### Task 11: React — result screen

`docs/prototype/index.html`'s `#s-result` screen: a score ring (`percentage%` / `pointsEarned / pointsPossible`), a headline sentence naming `isPersonalBest`, per-section progress bars, and "Back to library" / "Review answers →" actions. Reachable from three places — straight after submit, from the library card, from history — so it must be a plain `GET`, never reading submit's response body directly.

**Files:**

- Create: `packages/app/src/pages/attempts/$attemptId/result.tsx`
- Modify: `packages/app/src/api/attempts.ts` (`getAttemptResult`)
- Create: `packages/app/test/result.test.tsx`

**Interfaces:**

- Consumes: `GET /attempts/{id}/result` (Task 7) — quoted status handling: `200` renders the screen; `409` (a still-running attempt reached this route directly, e.g. a stale bookmark) redirects to the runner rather than rendering a broken score; `403`/`404` render the app's existing not-found/forbidden state (verify what that is in plan 3's shell before inventing a new one).

- [ ] **Step 1: Write the failing test**

  ```ts
  it("renders the percentage, the fraction, and per-section bars from GET /result", …)
  it("shows a personal-best callout only when isPersonalBest is true", …)
  // and — the other direction — does NOT show it when false, on a second
  // fixture attempt scoring below the student's existing best
  it("redirects to the runner rather than rendering a score when the attempt is still running (409)", …)
  ```

- [ ] **Step 2–3: Run to verify the failure, implement, run to verify PASS, gates.**

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

  Do NOT commit.

---

### Task 12: React — review screen

`docs/prototype/index.html`'s `#s-review` screen: one question at a time, its prompt, its choices with correctness/selection markers, a replay-audio control when a stimulus has media, and Previous/Next. **The full collapsible question navigator (the `sheet` drawer primitive, i18n, iPad polish) is phase 6's "Navigator, menu, i18n sweep, iPad polish" deliverable — out of this plan's scope by the stated boundary.** This task ships a plain, functional Previous/Next plus a minimal jump-to-question list sufficient for review alone; phase 6 replaces it wholesale with the shared drawer component used everywhere else.

**Files:**

- Create: `packages/app/src/pages/attempts/$attemptId/review.tsx`
- Modify: `packages/app/src/api/attempts.ts` (`getAttemptReview`)
- Create: `packages/app/test/review.test.tsx`

**Interfaces:**

- Consumes: `GET /attempts/{id}/review` (Task 8) — `ReviewItem[]`, flat, not grouped by section in the response; this task groups by `sectionId` client-side purely for the "Listening" / "Reading" chip shown in the app bar.

- [ ] **Step 1: Write the failing test**

  ```ts
  it("shows the selected choice, marked correct or incorrect, for an answered question", …)
  it("shows every choice unmarked-selected and a 'left blank' notice for an unanswered question", …)
  it("renders a replay control for a question whose group has a media stimulus, and none for a passage-only one", …)
  // both directions of the same fixture
  it("moves to the next question's prompt when Next is pressed, without a network refetch", …)
  // the whole payload was already loaded by the one GET /review call
  ```

- [ ] **Step 2–3: Run to verify the failure, implement, run to verify PASS, gates.**

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

  Do NOT commit.

---

### Task 13: React — history screen

`docs/prototype/index.html`'s `#s-history` screen: a table of finished attempts — test name, date, per-section score, total score badge, "How it ended" (rendered specially for `expired`, per the contract's own `AttemptHistoryRow.status` description: "an expired attempt must not read as an ordinary hand-in"), and a Review link per row.

**Files:**

- Create: `packages/app/src/pages/history/index.tsx`
- Modify: `packages/app/src/api/attempts.ts` (`listAttemptHistory`)
- Create: `packages/app/test/history.test.tsx`

**Interfaces:**

- Consumes: `GET /attempts` (Task 9).

- [ ] **Step 1: Write the failing test**

  ```ts
  it("renders one row per finished attempt with its per-section and total scores", …)
  it("renders 'Time ran out' styling, not the ordinary 'Handed in' text, for a status: expired row", …)
  // and the ordinary text for a status: submitted row -- both directions
  it("fetches the next page on Load more and appends rather than replaces the rows", …)
  it("disables Load more when nextCursor is null", …)
  ```

- [ ] **Step 2–3: Run to verify the failure, implement, run to verify PASS, gates.**

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

  Do NOT commit.

---

## Definition of Done

- [ ] `pnpm lint`, `pnpm format`, `pnpm typecheck`, `pnpm test` all exit 0
- [ ] `redocly lint docs/api/openapi.yaml` clean
- [ ] `grep -rn "new Date()\|Date\.now()" packages/{common,db,server}/src` reports only comments, never a call
- [ ] Four of the contract's twenty operations are implemented here: `POST /attempts/{id}/submit`, `GET /attempts/{id}/result`, `GET /attempts/{id}/review`, `GET /attempts`
- [ ] `gradeAttempt` and every predicate in `rules.ts` have zero database involvement in their tests — verified by the absence of `withDatabase`/`createTestApp` in `packages/common/test/grading.test.ts` and `rules.test.ts`
- [ ] `loadForScoring` remains unreachable from `@pp/db`'s default entry point (Task 4 extends, not weakens, plan 2 Task 5's boundary test)
- [ ] Every `409`/`410`/`413` this plan's routes emit is `application/problem+json` and matches its named schema exactly — no `statusCode`/`error` leaking through
- [ ] Plan 2 Task 9's stale-attempt finalization calls this plan's `finalizeAttempt` rather than a second, independent grading path (Task 5, Step 5)
