# Screen 4 — Section intro and the section transition (`#s-secintro`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Make a two-section test completable. A child finishes Listening, passes through a card that says *"Reading — 25 min when you begin"*, taps **I'm ready**, and starts Reading. Today they cannot: `nextEntry` is scoped to the current section, so Next vanishes at the section boundary and nothing navigates onward. **This is the single defect that makes the product unusable end to end.**

**Prototype:** `#s-secintro` — *"Listening · 25 min when you begin · Practice Test 04 · Attempt 1 · Listening — Part 1 · 20 questions · 25 minutes"*.

---

## The owner's ruling on this screen (binding)

> *"Move between section doesn't mean users/kids can edit, we record responses of the section and submit, not block it."*

So: **finishing a section records and submits that section's responses and moves on.** The child simply cannot edit that section afterwards. There is no negotiation, no confirmation gate, no "are you sure" lock. A section boundary is a card you pass through, not a door you unlock.

This supersedes the earlier framing that treated early exit as a risky product choice between overloading `enterSection` and adding a guarded operation. It is neither: the transition **is** the finish.

## What already exists (verify before building)

| Thing | Status | Where |
|---|---|---|
| `POST /api/attempts/{id}/sections/{sectionId}/enter` (`enterSection`) | Implemented, idempotent | contract line 330 |
| `/attempts/$attemptId/sections/$sectionId/rules` route + screen | Implemented | `attempts.$attemptId.sections.$sectionId.rules.tsx` |
| `enterSection` closes a section whose clock expired | Implemented (`ec3971f`) | `attempt.repository.ts` |
| Section grading on close (points + all four counts) | Implemented | `closeExpiredSection` |
| `PATCH /api/attempts/{id}/responses` — full-snapshot flush | Implemented | contract line 452 |

**The rules screen already exists and is reachable only for the FIRST section.** The single navigation to it (`run.tsx:206`) fires when nothing has been entered yet.

## What is missing

1. **A finish-section operation.** `enterSection` closes only an *expired* section. A child finishing early has no way to close one.
2. **The onward transition.** Nothing computes "the next section" or navigates to its rules screen.
3. `hasNext` is section-scoped, so the runner's Next control disappears at the boundary with nothing in its place.

## Tasks

### Task 1: `POST /api/attempts/{id}/sections/{sectionId}/finish`

Idempotent, under the attempt lock. Per the owner's ruling this **records and submits, then moves on** — it does not block.

- [ ] **Step 1: Failing db test** in `packages/db/test/`: `finishSection` verifies this is the attempt's current open section, closes and grades it, and returns the next section's id (or "no section left"). A second call returns the same result and does not re-grade. Model the grading on `closeExpiredSection`, which already satisfies `attempt_section_counts_reconcile` — reuse it rather than writing a second closer.
- [ ] **Step 2: Failing test:** the request carries the queue remainder for that section and it is applied with the SAME per-item semantics as submit (one rejected item does not roll back the rest). An answer tapped a moment before finishing must not be lost.
- [ ] **Step 3: Failing e2e test** in `packages/server/test/`: 200 with the next section; 403 for another student's attempt; 409 if that section is not the open one; 410 if the attempt expired.
- [ ] **Step 4:** Declare the operation in `docs/api/openapi.yaml` FIRST, then implement to it. The contract is the authority.

### Task 2: The next-section transition in the runner

- [ ] **Step 1: Failing test** in `attempts.$attemptId.run.test.tsx`: on the LAST question of a non-final section, a control appears offering the next section — and it must not appear mid-section. Both directions.
- [ ] **Step 2: Failing test:** tapping it calls `finishSection`, then navigates to the next section's rules screen with the returned id. Assert the navigation target, not just the call.
- [ ] **Step 3: Failing test:** on the last question of the FINAL section, the control leads to hand-in instead. A child must never be offered a section that does not exist.
- [ ] **Step 4:** Implement. `entries` stays section-scoped — the transition is a separate control, not a widened `nextEntry`.

### Task 3: The section-intro card

- [ ] **Step 1:** Read `attempts.$attemptId.sections.$sectionId.rules.tsx` before writing anything. If it already renders what `#s-secintro` specifies, this task is **wiring, not building** — say so and do not duplicate a screen.
- [ ] **Step 2: Failing test:** the screen renders the section's title, question count, duration and "25 min when you begin", and the authoritative `attemptNumber`.
- [ ] **Step 3: Failing test:** "I'm ready" calls `enterSection` and enters the runner. Entering is what starts the clock — assert that nothing before it does.

### Task 4: The end-to-end test that would have caught all of this

- [ ] A single test walking Listening → answer → finish section → Reading → answer → hand in → result, asserting a **non-zero** score. This is the control the whole branch lacked: six hundred tests and five review passes missed both the answer loss and this section wall, because every one verified a layer instead of the path a child walks.

## Global Constraints

- Four gates, CHAINED, exit 0. Never commit.
- `components/` STATELESS and props-only.
- i18next, FLAT dotted keys, six locales, real translations.
- `size-11` touch targets.
- **A closed section is irreversible.** Once finished, its answers cannot change — that is the point of closing it. Make sure the runner cannot navigate back into a closed section, and that `setPosition` into one still refuses (it does; do not regress it).

## Definition of Done

- [ ] Four gates exit 0.
- [ ] A child completes a two-section test start to finish without a typed URL.
- [ ] Finishing a section records its answers before closing — verified with an answer tapped immediately before finishing.
- [ ] Finishing is idempotent.
- [ ] The end-to-end test asserts a non-zero result.
