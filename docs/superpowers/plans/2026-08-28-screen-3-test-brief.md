# Screen 3 — Test brief (`#s-intro`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Between "Start test" and the first section's rules, a child reads what they are about to sit: *"Practice Test 04 · Step 1 · Two sections · 50 minutes · Attempt 1 of this test"*, with each section's real rules laid out — 20 questions, 25 min, "Each recording plays once. You cannot go back to an earlier question." Then they commit.

**Prototype:** `#s-intro`.

**The prototype's design constraint:** *"The brief must state the rules truthfully, so it reads them from the same section rows the server later enforces."* The brief must never paraphrase a rule the server implements differently.

---

## What already exists (verify before building)

The backend is **complete**.

| Thing | Status | Where |
|---|---|---|
| `GET /api/tests/{slug}` (`getTest`) — sections, rules, instructions, NO questions | Implemented | `catalog.controller.ts:33`, contract line 188 |
| `POST /api/attempts` (`startAttempt`) — start, resume and re-attempt in one call | Implemented | `attempts.controller.ts`, contract line 248 |
| `finalizedPriorAttempt` on the start response | Implemented | `attempts.service.ts:126,194` |

There is **no client** for either, and no page.

## What is missing

1. `getTest(slug)` and `startAttempt(slug)` clients.
2. `packages/app/src/pages/tests.$slug.tsx` — the brief route.
3. Consumption of `finalizedPriorAttempt` — the server already reports that a stale attempt was closed to make room; nothing tells the child.

## The two subtleties this screen exists to get right

**Attempt number is optimistic, then authoritative.** The brief renders "Attempt N" from `attemptCount + 1` — a guess made before any call. `POST /api/attempts` then returns the real `attemptNumber`. If another device started an attempt in between, the guess is wrong and **the section-rules screen renders the authoritative value**, correcting it before the child answers anything. Do not "fix" this by making the brief wait for the start call: the point is that reading is untimed and uncommitted.

**No clock starts here.** `POST /api/attempts` creates the attempt row but leaves `startedAt` and `expiresAt` null until the first section entry. A child can read the brief and the section rules untimed. Nothing on this screen may start a timer.

## Global Constraints

- Four gates, CHAINED, exit 0. Never commit.
- `components/` is STATELESS and props-only.
- i18next, FLAT dotted keys, six locales, real translations. The section rules are *rendered from server data*, not hardcoded English — a rule the server enforces in a language the child cannot read is worse than no rule.
- `size-11` touch targets.
- **`docs/api/openapi.yaml` is the authority** on the response shapes. Read it; do not infer from the prototype's sample JSON.

## Tasks

### Task 1: The catalog-detail and start clients

- [ ] **Step 1: Failing test:** `getTest(slug)` calls `GET /api/tests/{slug}`; `startAttempt(slug)` POSTs to `/api/attempts` with the slug in the body per the contract. Assert both URLs exactly, including the `/api` prefix.
- [ ] **Step 2:** Add the response types to `src/lib/api-types.ts` from the contract — including `finalizedPriorAttempt` and `attemptNumber`.
- [ ] **Step 3:** Implement in `src/lib/catalog-api.ts` (detail) and `src/lib/attempts-api.ts` (start).

### Task 2: The brief screen

- [ ] **Step 1: Failing test** `packages/app/src/pages/tests.$slug.test.tsx`:
  - renders the test title, step, section count and total duration;
  - renders EACH section's title, question count, duration and instructions from the response — assert with a two-section fixture whose two sections have DIFFERENT rules, so a screen that renders the first section twice fails;
  - renders "Attempt 1 of this test" from `attemptCount + 1`;
  - a `404` (unknown or unpublished slug) renders a readable state with a way back to the library, not a crash.
- [ ] **Step 2:** Implement the route with a loader and an `errorComponent`.

### Task 3: Starting, resuming and re-attempting

- [ ] **Step 1: Failing test:** pressing Start calls `startAttempt` once and navigates to the FIRST section's rules screen with the returned attempt id.
- [ ] **Step 2: Failing test:** pressing Start twice does not create two attempts — the second press returns the in-progress one. The endpoint is idempotent by design; the screen must not defeat that with its own duplicate-submit bug. Assert the call count.
- [ ] **Step 3: Failing test:** when the response carries `finalizedPriorAttempt`, the child is TOLD — "your previous attempt ran out of time and was handed in" — rather than it happening silently. This is the whole reason the server returns that field.
- [ ] **Step 4:** Implement, six locales.

## Definition of Done

- [ ] Four gates exit 0.
- [ ] A child can go library → brief → section rules without a typed URL.
- [ ] No clock starts on this screen; `startedAt`/`expiresAt` are still null after Start.
- [ ] Section rules are rendered from server data, in the child's language.
- [ ] A double-press of Start yields one attempt.
- [ ] `finalizedPriorAttempt` is surfaced, not swallowed.
