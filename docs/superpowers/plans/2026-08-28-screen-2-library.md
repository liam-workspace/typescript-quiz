# Screen 2 — Test library (`#s-home`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** The `/` route. A child signs in and sees "Welcome back, Tom · You have one test waiting" with a card per published test, and can start, continue, re-attempt or see a previous result. Today `/` does not exist: two shipped screens link to it and land on a not-found page.

**Prototype:** `#s-home`. The card carries title, step, section counts and duration (*"Step 1 · Listening 20 · Reading 20 · 50 minutes"*) and a **Start test** button.

**Prototype's own note, which is the design constraint:** *"Everything on this screen must arrive in one round trip — the card needs the test AND this student's standing against it. A finished test stays re-attemptable, so its card carries both See result and Try again."*

---

## What already exists (verify before building)

The backend is **complete**, including the per-student standing that makes this screen possible in one call.

| Thing | Status | Where |
|---|---|---|
| `GET /api/tests` (`listTests`), paginated | Implemented | `catalog.controller.ts:24`, contract line 157 |
| `inProgressAttemptId`, `attemptCount`, `bestAttempt` per card | Implemented | `catalog.repository.ts:11-13,103,134` |
| `GET /api/me` for the app bar | Implemented | `session.controller.ts:55` |

There is **no client** for `GET /api/tests` in `packages/app/src/lib/` and no page.

## What is missing

1. `packages/app/src/lib/catalog-api.ts` — `listTests(cursor?)`.
2. `packages/app/src/pages/index.tsx` — the `/` route.
3. Card state logic: which of Start / Continue / Try again / See result appears.
4. Pagination (the endpoint pages; the screen must not assume one page).

## Global Constraints

- Four gates, CHAINED, exit 0. Never commit.
- `components/` is STATELESS and props-only. Pagination and loading state live in the page.
- i18next, FLAT dotted keys, six locales, real translations.
- `size-11` touch targets.
- **Route with a typed `<Link>`, not `<a href>`.** Once `/` exists, the existing `<a href="/">` in `result.tsx` and `history.tsx` become typed links — that conversion is part of this plan, and it is what proves the route is real.
- Read `attempts.$attemptId.result.tsx` first and follow its shape: a loader, an `errorComponent`, and tests asserting BOTH directions of every conditional.

## Tasks

### Task 1: The catalog client

- [ ] **Step 1: Failing test** in `packages/app/test/catalog-api.test.ts`: `listTests()` calls `GET /api/tests` with no method override and returns the parsed page; `listTests(cursor)` passes the cursor. Assert the URL exactly — a missing `/api` prefix has already shipped once in this codebase.
- [ ] **Step 2:** Add the `TestCard` and page types to `src/lib/api-types.ts` from `docs/api/openapi.yaml` — read the contract, do not infer the shape from the prototype's sample JSON.
- [ ] **Step 3:** Implement `src/lib/catalog-api.ts`.

### Task 2: The card, as a pure decision

The card's four possible actions are a rule, not JSX. Write the rule once so the screen renders it and cannot drift.

- [ ] **Step 1: Failing test** in `packages/app/test/testCardState.test.ts` covering every branch:
  - `inProgressAttemptId !== null` → **Continue**, and no Start.
  - `inProgressAttemptId === null && attemptCount === 0` → **Start test**, and no See result.
  - `attemptCount > 0 && bestAttempt !== null` → **Try again** AND **See result**, both.
  - A finished attempt never suppresses Start/Try again — only an in-progress one does. Assert that explicitly; it is the prototype's stated rule and the easiest to get backwards.
- [ ] **Step 2:** Implement `packages/app/src/lib/testCardState.ts` returning a discriminated result the screen renders.

### Task 3: The library screen

- [ ] **Step 1: Failing test** `packages/app/src/pages/index.test.tsx`:
  - renders one card per test with title, step, per-section counts and total duration;
  - renders the greeting from `GET /me`, and still renders the list when the profile fetch fails (identity is a nicety; the library is not);
  - renders each of the four action states from Task 2;
  - "See result" targets `/attempts/{bestAttempt.attemptId}/result`;
  - an empty catalog renders a real empty state, not a blank page.
- [ ] **Step 2: Failing test** for pagination: a second page appends rather than replaces, and the control disappears when `nextCursor` is null. `nextCursor: null` is the ONLY end signal — never a short page.
- [ ] **Step 3:** Implement the route, its loader and its `errorComponent`.

### Task 4: Make the dead links real

- [ ] **Step 1:** Convert `<a href="/">` in `result.tsx` and `history.tsx` to typed `<Link to="/">`. This must now COMPILE — before this plan it could not, which is how the missing route was found.
- [ ] **Step 2:** Keep the root `notFoundComponent`; it still guards genuinely unknown routes. Update its copy if it now reads oddly next to a real library.

## Definition of Done

- [ ] Four gates exit 0.
- [ ] A signed-in child lands on `/` and can start a test without anyone typing a URL.
- [ ] Every card state is asserted in both directions.
- [ ] `<a href="/">` no longer appears in `result.tsx` or `history.tsx`.
- [ ] The screen renders with a failed `GET /me` and with an empty catalog.
