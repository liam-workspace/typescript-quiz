# Screen 5 — Time is up (`#s-expired`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** When a timed test runs out, the child sees *"Time is up — your test was handed in automatically. Everything saved before time ran out has been kept and marked,"* with their answered count and a way to their result. Today there is no countdown on screen and no expiry screen: a child watches a runner that has silently stopped accepting writes.

**Prototype:** `#s-expired` — a `00:00` clock, the reassurance above, and "Answered 38".

**The prototype's design note, which is the whole architecture of this screen:** *"Nothing schedules this. The attempt is finalized by whichever request next touches it after the deadline."* Expiry is **discovered, not pushed**. There is no cron, no websocket, no server timer.

---

## What already exists (verify before building)

The backend is **complete**, and this is the rare screen where the server side is genuinely finished.

| Thing | Status | Where |
|---|---|---|
| Lazy finalization on the next touching request | Implemented | `loadRunningOwnedAttempt` → `finalizeExpiredAttempt` |
| `410 attempt_expired` carrying `{ id, status, submittedAt, resultUrl }` | Implemented | `attempts.service.ts:123,191`; contract `AttemptExpiredProblem` |
| `submittedAt` pinned to the DEADLINE, not to arrival | Implemented, in SQL | `attempt_expired_pins_deadline` |
| Result readable for an expired attempt | Implemented | `results.service.ts` |
| The client already handles a 410 from several call sites | Implemented | `ExpiredState` in `run.tsx`, the runners' expired branch |

## What is missing

1. **No visible countdown.** `envelope.expiresAt` and `serverTime` are both in the payload; nothing renders a clock.
2. **No client-side expiry transition.** The child sits on a dead runner until they happen to tap something that triggers a 410.
3. **No dedicated time-up screen.** The runners render a small inline expired notice; the prototype specifies a full screen with the answered count and the reassurance.

## The two things this screen must get right

**The server's clock wins, always.** `serverTime` arrives with the envelope; the device's clock may be wrong or deliberately changed. Compute an offset once on load and count down against that — never against `Date.now()` alone. A child who changes the iPad clock must not gain time.

**Reaching zero locally is a prompt, not a verdict.** The countdown hitting 00:00 does not mean the attempt is expired — only the server decides that. On reaching zero, the client should TOUCH the server (any attempt-scoped read) and let the real 410 answer. Never mark an attempt expired purely on local arithmetic, and never navigate to "time up" without the server having said so.

## Global Constraints

- Four gates, CHAINED, exit 0. Never commit.
- **No test may sleep.** Clocks are injected throughout this codebase — `createFixedClock` on the server, and the countdown must take its time source as a parameter. A test that waits for a real 25 minutes, or that sleeps at all, is not acceptable.
- `components/` is STATELESS and props-only — a countdown that ticks needs state, so the ticking lives in the page and the component renders a formatted value it is handed.
- i18next, FLAT dotted keys, six locales, real translations.
- `size-11` touch targets.
- Respect `prefers-reduced-motion` if the clock animates at all. It probably should not.

## Tasks

### Task 1: The countdown, as pure arithmetic

- [ ] **Step 1: Failing test** in `packages/app/test/countdown.test.ts` for a pure function taking `expiresAt`, `serverTime`, and "now": returns remaining milliseconds, clamps at zero and never goes negative, and — the case that matters — is computed against the SERVER offset, so a device clock skewed by an hour yields the same remaining time.
- [ ] **Step 2: Failing test:** formatting. `25:00`, `04:07`, `00:00`. Assert the leading zero; a child reading `4:7` is a bug.
- [ ] **Step 3:** Implement `packages/app/src/lib/countdown.ts`. No React, no timers — arithmetic only.

### Task 2: The ticking clock in the runner chrome

- [ ] **Step 1: Failing test:** the runner renders the remaining time, and it decreases as the injected time source advances. Drive it with a fake timer or an injected clock — never a real wait.
- [ ] **Step 2: Failing test:** the display switches to an at-risk treatment under a threshold you choose deliberately (state it in a comment). This is for a child, so the signal should be calm, not alarming.
- [ ] **Step 3:** Implement. The interval lives in the page and is cleared on unmount — a leaked interval on a page a child leaves and returns to will tick twice.

### Task 3: Reaching zero touches the server

- [ ] **Step 1: Failing test:** when the countdown reaches zero, the client makes ONE attempt-scoped request and, on the resulting `410`, moves to the time-up screen carrying the problem's `attempt` payload.
- [ ] **Step 2: Failing test:** if that request unexpectedly succeeds — the server disagrees, its clock is authoritative — the child is NOT sent to time-up. Assert this direction explicitly; it is the one that protects a child from losing a test to a clock-skew bug.
- [ ] **Step 3: Failing test:** exactly one such request fires, not one per tick.

### Task 4: The time-up screen

- [ ] **Step 1: Failing test** for `packages/app/src/pages/attempts.$attemptId.time-up.tsx`: renders `00:00`, the reassurance copy, the answered count, and a link to the result using the `resultUrl` from the 410 payload — which the server already supplies, so nothing needs recomputing.
- [ ] **Step 2: Failing test:** reached directly (a reload on that URL), it still renders from a plain `GET /result` rather than requiring the 410 payload.
- [ ] **Step 3:** Implement, six locales. The copy must be honest: *everything saved before time ran out has been kept*. That is true — answers are durable in IndexedDB and flushed — so say it plainly.

## Definition of Done

- [ ] Four gates exit 0.
- [ ] A visible countdown driven by the server's clock, not the device's.
- [ ] Reaching zero consults the server; the server decides.
- [ ] A success at zero does NOT expire the child's test.
- [ ] The time-up screen renders on a direct reload.
- [ ] No test sleeps.
