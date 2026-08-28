# Screen 6 — Save trouble / offline (`#s-offline`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** When the iPad loses the network mid-test, the child sees *"We can't reach the server right now. Keep answering — your answers are saved on this iPad and will be sent as soon as the connection is back,"* with a count of what is waiting. Today all of that is true and none of it is visible: the durability machinery works and says nothing.

**Prototype:** `#s-offline` — a "Saving…" chip in the app bar, the banner above, and a "Waiting to be sent" count.

**The prototype's note, and the reason this screen exists:** *"Designed against a real incident in awesome-survey, where answers were lost four different ways. The rule here: an answer is durable on the device BEFORE it is sent, and the server never discards a payload it cannot apply."*

---

## What already exists (verify before building)

This screen is **almost entirely presentation over machinery that is already built and tested.** Resist rebuilding any of it.

| Thing | Status | Where |
|---|---|---|
| IndexedDB queue, durable before send | Implemented | `lib/answerQueue.ts` |
| Full-snapshot flush, per-item acks | Implemented | `lib/flushController.ts` |
| Retry classification (retryable vs terminal) | Implemented | `lib/retryClassifier.ts` |
| `pagehide` keepalive flush, `/api` + bearer | Implemented (`39fc589`) | `lib/lifecycleFlush.ts` |
| Queue restored and re-flushed on mount | Implemented (`39fc589`) | `run.tsx` |
| Terminal rejection surfaced to the child | Implemented (`39fc589`) | `runner.saveFailed` |
| `PATCH /api/attempts/{id}/responses`, 200 even when items fail | Implemented | contract line 452 |
| Server captures anything it cannot apply to `failed_write` | Implemented | `durability/` |

## What is missing

1. **A save-state indicator.** Nothing renders "Saving…", "Saved", or "Waiting to be sent".
2. **An offline banner.** Nothing observes connectivity or flush failure and tells the child to keep going.
3. **A pending count.** `AnswerQueue.snapshotForSection` can answer "how many are waiting"; nothing asks.

## The one rule this screen must not break

**Never tell a child to stop.** The entire durability design exists so a network failure is a non-event: answers are on the device before they are sent, and they go when the connection returns. The banner's job is to say *keep answering*. It must never block input, never disable a control, and never imply an answer was lost — because it was not.

Distinguish three states honestly:
- **Waiting to be sent** — queued, retryable, will go. Reassure.
- **Saved** — acked by the server. Say so briefly; do not nag.
- **Did not save** — terminally rejected (`retryClassifier` says stop). Already implemented as `runner.saveFailed`; this screen must not soften it into "waiting", which would be a lie.

## Global Constraints

- Four gates, CHAINED, exit 0. Never commit.
- `components/` is STATELESS and props-only — the banner and chip are components; the connectivity and queue-depth state live in the page.
- i18next, FLAT dotted keys, six locales, real translations. A child reading Japanese must get the reassurance too.
- `size-11` for anything interactive.
- **No test may sleep.** Drive retries and transitions with the injected clock and fake timers.
- Do NOT weaken the flush path to make a state easier to render. If a state is hard to observe, expose it from `FlushController` deliberately rather than reaching into the queue from the screen.

## Tasks

### Task 1: Expose save state from the machinery

- [ ] **Step 1:** Read `flushController.ts` and `answerQueue.ts` first. `flushSection` already returns `rejectedQuestionIds` (added in `39fc589`); decide whether it should also report pending depth and last-outcome, or whether the page should read `snapshotForSection`. Pick one and write the reason down — two sources of truth for "is anything waiting" will drift.
- [ ] **Step 2: Failing test** for whatever you chose: after a queued answer with a failing network, the reported state is "pending" with a count of 1; after a successful flush it is "saved" with a count of 0; after a terminal rejection it is "failed" and does NOT report pending.
- [ ] **Step 3:** Implement.

### Task 2: The save-state chip

- [ ] **Step 1: Failing test** for a stateless `SaveState` component in `components/`: renders "Saving…", "Saved", and a pending count from props. Assert all three; a chip that renders the same text for two states is the "recorded but never shown" defect this codebase has already produced twice.
- [ ] **Step 2:** Implement, six locales.

### Task 3: The offline banner

- [ ] **Step 1: Failing test:** when flushes are failing with a retryable error, the banner appears with the prototype's copy and the pending count; when a flush next succeeds, it disappears.
- [ ] **Step 2: Failing test — the load-bearing one:** while the banner is showing, the child can STILL select an answer, and that answer is recorded to the queue. Nothing is disabled. If this test does not exist, a later change will quietly add a `disabled` and nobody will notice until a child is stuck offline mid-test.
- [ ] **Step 3: Failing test:** a terminal rejection shows the "did not save" message and NOT the offline banner. The two must never be confused — one says "relax", the other says "this one is gone".
- [ ] **Step 4:** Implement. Observe connectivity from flush outcomes rather than trusting `navigator.onLine` alone — it reports the radio, not whether your server is reachable. If you use it at all, use it as a hint on top of real request outcomes, and say so in a comment.

### Task 4: Prove it end to end

- [ ] **Step 1: Failing test:** with the network failing, answer three questions; assert all three are in IndexedDB, the banner shows a count of 3, and nothing is disabled. Restore the network; assert one flush sends all three as a full snapshot and the banner clears.
- [ ] **Step 2:** Reload mid-outage. The three answers are still visible and still pending — `39fc589` restores them; this asserts the child SEES that, which is what turns a working mechanism into a trustworthy one.

## Definition of Done

- [ ] Four gates exit 0.
- [ ] A child can answer through a full network outage and lose nothing.
- [ ] Nothing is ever disabled because the network is down.
- [ ] "Waiting", "saved" and "did not save" are three visibly different states, each asserted.
- [ ] The pending count survives a reload.
- [ ] No test sleeps.
