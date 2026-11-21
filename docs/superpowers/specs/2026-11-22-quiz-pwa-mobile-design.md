# Quiz PWA mobile web app — design

**Status:** proposed · **Date:** 2026-11-22
**Visual and behavioural authority:** `docs/prototype/pwa-mobile.html` (published at https://quiz.preview.icovn.me). Where this document and the prototype disagree about what a student sees or does, the prototype wins, except for the explicit deviations in §11.
**Companion plan:** `docs/superpowers/plans/2026-11-22-quiz-pwa-mobile.md`

## 1. Goal

Turn the existing student web app (`packages/app`, React 19 + TanStack Router + Tailwind 4, served by `packages/server`) into an installable, phone-first PWA that is 100 % faithful to the clickable prototype: same screens, same copy, same states, same behaviour, same visual system.

"100 %" means every item in the parity matrix (§3) is implemented and verified against the prototype at 390 × 844 and at 320 × 568. It does not mean shipping the prototype's scaffolding.

**Not shipped (prototype scaffolding):** the desktop notes column, the phone frame, the mock status bar / browser bar / home indicator, the "Prototype controls" panel, the hash router, `localStorage`-backed fake server state, simulated timers/audio/scoring, the demo "Reset" button.

**Out of scope:** the admin console (`/admin/*`) stays desktop-first and untouched, except that Profile links to it for admins. No change to content authoring, grading rules, or the six-locale set.

## 2. Context the implementer must know

- The app already has a durable answer path (§5 of `2026-08-25-toefl-primary-fork-design.md`): IndexedDB `AnswerQueue` → `FlushController` → `PATCH /api/attempts/:id/responses`. Keep it; do not rewrite it.
- The **clock is section-based and server-authoritative**. `POST /api/attempts` creates an untimed attempt; `POST …/sections/:id/enter` ("I'm ready") starts the section clock; `PUT …/position`, `POST …/sections/:id/finish`, `POST …/stimuli/:id/play`, `POST …/submit` are all server calls. Today a failed `setPosition` (offline) leaves the student stuck on a question — mid-test offline navigation does **not** work yet.
- **Listening audio is play-capped by the server.** `/api/media/:filename` for a capped file requires a signed `exp`/`sig` minted only by `POST …/play` (`stimulus_play.play_count`). The runner payload carries no `mediaUrl` for a capped stimulus.
- `components/` must be stateless/props-only (`@liam-workspace/node-frontend-lint`); state lives in `pages/` and `lib/`. `lint:i18n` forbids hard-coded strings in TSX; `locale-parity.test.ts` requires identical keys in all six locales (`en de es fr it ja`).
- `@liam-workspace/vite-preset-pwa@0.1.0` (manifest + base workbox options) is already the adopted library for the PWA concern (`docs/architecture/library-adoption.md`) but is **not yet installed**. Its default `runtimeCaching` caches every `/api` GET `NetworkFirst`; this app must **not** use that default (see D1).
- Generated file `packages/app/src/route.gen.ts` is committed; adding a route file requires regenerating it (`pnpm --filter @pp/app build`) and committing the diff.
- Repo gates: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format`, `redocly lint docs/api/openapi.yaml`. Every task ends green on the gates it touches.

## 3. Parity matrix

Status: **Reuse** (exists, keep) · **Restyle** (exists, change presentation) · **New** (client only) · **New+server** (needs API/DB change).

| # | Prototype feature (function / element) | Real implementation | Status | Task |
|---|---|---|---|---|
| 1 | Installable standalone app, manifest, icons, splash | `vite-plugin-pwa` + preset manifest, PNG icons, `<Splash>` | New | 1, 4 |
| 2 | Offline app shell | Workbox precache + navigate fallback | New | 1, 2 |
| 3 | Install banner on Library; Android prompt; iOS "Add to Home Screen" steps; dismiss; installed state | `pwaStore`, `<InstallCard>`, install sheets | New | 3, 4, 7 |
| 4 | "New version ready" banner; deferred during a test (no button, "after you finish this test"); Refresh | `pwaStore.updateReady`, `<UpdateBanner>` | New | 3, 4 |
| 5 | Offline banner (browsing vs in-test wording) with "Waiting to be sent: N" | `networkStore` + `<OfflineBanner>` | Restyle | 4, 13 |
| 6 | Tab bar Library / History / Profile with `aria-current` | `<TabBar>` in `AppLayout` | New | 4 |
| 7 | Toasts (status role, icon, 3.8 s) | `toastStore` + `<ToastHost>` | New | 4 |
| 8 | Bottom sheets (modal, title, close, scrim inside viewport, Esc, focus return) | `<BottomSheet>` on Radix Dialog | New | 4 |
| 9 | Sign-in: logo, copy, busy "Signing in…", error alert; no-access screen with Sign out | `sign-in.tsx`; library no-access state | Restyle | 8 |
| 10 | Library: greeting, plural-aware subtitle, filter (All / To do / Done), cards, skeleton, stats, in-progress card, "Finish X first" disabled reason | `index.tsx` | Restyle | 7 |
| 11 | Start test → rules directly (no brief screen), busy state | library Start calls `startAttempt` then routes to rules | Restyle | 7, 9 |
| 12 | Per-test "Save offline · N MB", progress, "Available offline", remove | offline library (D5) | New+server | 14, 15, 16 |
| 13 | Rules screen per section, "I'm ready" busy → run | `…/rules.tsx` | Restyle | 9 |
| 14 | Run top bar: menu ⋯, section chip, save chip, timer chip (low ≤ 60 s + icon, `role=timer`), progress bar | `run.tsx` + new chrome components | Restyle | 10 |
| 15 | Run bottom bar: Previous (free-nav only), navigator `n/N`, Next / Finish X / Hand in | `run.tsx` | Restyle | 10 |
| 16 | Listening card: scene, Play recording → Playing… → Played, progress, "1 play left", answers locked until played, failure message, no pause | `ListeningRunner`, `QuestionMedia` | Restyle | 11 |
| 17 | Reading passage `<details>`, A–D lettered choices, multi-select hint | `ReadingRunner`, `ChoiceList` | Restyle | 11 |
| 18 | Navigator sheet: per-section grids, statuses, legend, forward-only note | `QuestionNavigator` | Restyle | 10 |
| 19 | Finish-section confirm sheet (blank count) | `run.tsx` | New | 10 |
| 20 | Run menu sheet: "Leave test", clock-keeps-running note | replaces `AppMenu` drawer in run | Restyle | 10 |
| 21 | Save chip states: Saved / Saving… / Waiting to send: N / Did not save; toast "Back online — N answers sent." | `SaveState` + flush events | Restyle | 13 |
| 22 | Hand-in screen: tiles, blank notice, minutes left, offline-disabled with reason, busy | `hand-in.tsx` | Restyle | 12 |
| 23 | Time-up (section and attempt variants) | `time-up.tsx`, run expiry | Restyle | 12 |
| 24 | Result: ring, headline by score band, personal-best chip, per-section breakdown, practice notice | `result.tsx` | Restyle | 13 |
| 25 | Review: outcome chip, passage, tagged choices, explanation, prev/next, jump sheet | `review.tsx` | Restyle | 13 |
| 26 | History cards: status chip with icon, score, Review / Result | `history.tsx` | Restyle | 13 |
| 27 | Profile: identity, install row, reminders switch, version/update row, offline storage list with remove, sign out sheet | new `profile.tsx` | New | 6 |
| 28 | Practice reminders: permission sheet, on / off / denied, iOS-needs-install | Web Push (D7) | New+server | 23, 24, 25 |
| 29 | Offline mid-test: Next / Finish / play / answer all work, answers queued | journal-first lifecycle (D6) | New+server | 17–21 |
| 30 | Offline start of a downloaded test; Start disabled with reason if not downloaded | D5 + D6 | New+server | 16, 21 |
| 31 | Hand-in blocked offline with reason | gateway guard | New | 22 |
| 32 | Resume after reload mid-test with answers and clock intact | server envelope (online) / journal (offline) | Reuse + New | 21 |
| 33 | Safe-area padding, 44 px targets, reduced motion, focus rings, no horizontal overflow at 320 px | CSS + tests | New | 4, 26 |
| 34 | Sign-out clears every offline/auth cache | `purgeClientCaches()` | New | 2 |

## 4. Decisions

### D1 — PWA plumbing: allow-listed caching, never blanket `/api`

Use `vite-plugin-pwa` (`generateSW`, `registerType: "prompt"`) seeded with `cmsPwaOptions({...})` for the manifest and base workbox options, then **replace** its `runtimeCaching`:

- Precache the build output (`js, css, html, svg, png, ico, woff2`) including self-hosted fonts (D9) so the shell and type render offline.
- `navigateFallback: "/index.html"` with `navigateFallbackDenylist: [/^\/api\//, /^\/media\//, /^\/health/]`.
- Runtime caching only for GET `/api/tests` (library), `/api/me`, `/api/attempts` history list and `/api/attempts/:id/result|review` — strategy `NetworkFirst`, 4 s network timeout, cache name `pp-api-v1`, max 60 entries / 7 days. **Never** cache `/api/media/*`, `/api/attempts/:id/{submit,position,responses,play,sections}`, `/api/session`, or anything with a `Range` header.
- A shared device must not leak one student's cached data to the next: `purgeClientCaches()` (D8 list) runs on sign-out and on a token-subject change, before the sign-in redirect.
- `sw.js`, `workbox-*.js`, and `manifest.webmanifest` are served `Cache-Control: no-cache`; hashed assets stay `immutable`. `SpaFallbackFilter` must not answer `/sw.js` or `/manifest.webmanifest` with `index.html` (they are real files, so `express.static` serves them first; add a regression test).

### D2 — Install experience

- Capture `beforeinstallprompt` (Chromium) in `pwaStore`; `promptInstall()` calls `.prompt()` and resolves `accepted | dismissed | unavailable`.
- iOS Safari has no prompt: when `platform === "ios"` and not standalone, **Install** opens the three-step sheet ("Share → Add to Home Screen → Add"); its confirm button is labelled "I've added it" and only dismisses the card (the app cannot detect the install).
- Standalone = `matchMedia("(display-mode: standalone)").matches || navigator.standalone === true`. In standalone the install card and Profile "Install" button are replaced by the "Installed" chip. `appinstalled` flips it live.
- "Not now" persists in `localStorage["pp.install.dismissed"]` (try/catch around every access; the UI must work when storage throws). Profile always offers Install while not standalone.
- On `appinstalled` (or "I've added it") show toast "Installed. Open it from your home screen."

### D3 — Update experience

`registerSW({ onNeedRefresh })` sets `pwaStore.updateReady`. `<UpdateBanner>` shows "A new version is ready." with **Refresh** everywhere **except** `/attempts/*` routes, where it shows "A new version is ready. It will install after you finish this test." with no button. `applyUpdate()` calls `updateServiceWorker(true)`. The service worker must never `skipWaiting` on its own (`registerType: "prompt"`), so a student is never reloaded mid-test. Profile's Version row shows `__APP_VERSION__` plus "up to date" / "update ready" with a Refresh button.

### D4 — Navigation chrome

`AppLayout` renders: `<Banners/>` slot, the routed page, then `<TabBar/>` only on `/`, `/history`, `/profile`. Run, rules, hand-in, time-up, result and review have no tab bar and own their bottom action bar. The left-drawer `AppMenu` is retired: the run screen's ⋯ opens a bottom sheet ("Leave test"); language, sign-out and the admin link move to Profile (additive rows, §11). `DeviceSheet` stays only until nothing imports it, then is deleted.

### D5 — Offline library ("Save offline")

A test can be saved for offline use. "Saved" means everything needed to *run* it is on the device:

- **Bundle endpoint (new):** `GET /api/tests/:slug/offline-bundle` (student JWT) returns `{ slug, testVersionId, version, title, level, durationSeconds, sections: [...runner-shaped sections with questions, stimuli and choices but NO answer keys...], media: [{ key, url, bytes, capped }], totalBytes }`. For `capped` listening media, `url` is a short-lived download URL signed for *bundle download only* (not play).
- **Storage (client):** bundle JSON in IndexedDB `pp-offline` (store `tests`, key = slug); media bytes in Cache Storage `pp-offline-media-v1` keyed by `key`. Progress = bytes done / `totalBytes`. Download aborts cleanly when the network drops ("Save paused — you're offline. Try again when connected.").
- **Availability:** `offlineStore.has(slug)`; library shows "Available offline" chip; Start is enabled offline only if saved, else disabled with the reason "Needs a connection. Save it for offline use while you're online." Profile lists saved tests with size and a Remove button (toast "{title} removed from this phone.").
- **Accepted trade-off (record in the PR):** capped audio is retrievable by any signed-in student through the bundle endpoint, so the "plays once" rule becomes enforced by the app and re-checked at sync, not by the byte-gate. This is a single-family practice platform; the server still **audits** play counts at sync (D6) and rejects an offline attempt whose journal claims more plays than allowed.
- Bundle `version` pins the published `test_version`; if the server later reports a newer version for the slug, the card shows "Update saved copy" (re-download) and an attempt already started on the old version continues on it.

### D6 — Offline attempt protocol (journal-first lifecycle)

Every lifecycle mutation becomes **durable on the device before it is sent**, exactly like answers today, and the server **replays** the journal.

- **Journal events** (append-only, IndexedDB `pp-attempts`): `start`, `enter_section`, `play`, `position`, `finish_section`, plus the existing answers (still in `AnswerQueue`). Each event carries `{ clientAttemptId, eventSeq, type, clientAt (ISO), payload }`. `clientAttemptId` is a UUID minted at start; the server stores it in `attempt.client_attempt_id` (unique) for idempotency.
- **Gateway abstraction:** `run`, `rules` and `hand-in` talk to an `AttemptGateway` (D-contract §6). `RemoteAttemptGateway` = today's API calls (behaviour-preserving). `LocalAttemptGateway` applies the event to the local attempt state, appends it to the journal, and tries to flush. A selector picks local-first whenever the network is down **or** the attempt is journal-backed; online attempts that lose connectivity mid-test continue on the local gateway seamlessly (their state is hydrated from the last envelope).
- **Local clock:** section deadline = `enteredAt + section.durationSeconds` using a monotonic guard (`performance.now()` deltas anchored at enter; wall-clock jumps backwards are ignored; a jump forwards beyond the monotonic delta by > 2 min is treated as tamper and the monotonic value wins).
- **Server replay** — `POST /api/attempts/offline-sync` `{ clientAttemptId, slug, testVersionId, events[] }`, idempotent by `clientAttemptId`. Validation (reject with a recorded `failed_write`, never silently drop): events strictly ordered by `eventSeq`; `clientAt` monotonic non-decreasing, ≤ server receive time + 60 s, ≥ receive time − 72 h; `testVersionId` still resolvable; one `start`; `enter_section` durations ≤ section limit (a section's later events clamp to `entered + limit`; answers/events after that are recorded as late and **not applied**); ≤ `maxPlays` `play` events per capped stimulus, else the whole offline attempt is rejected with problem `offline_play_cap_exceeded`. The server then applies the events through the **existing** repository functions with `now = clientAt`, so expiry/finalisation rules are reused rather than re-implemented.
- **Hand-in requires a connection** (prototype). A student who finishes all sections offline sees "Hand in" disabled with the offline reason; if the final section's clock runs out offline the attempt shows the Time's-up screen's **waiting variant** (§11) and finalises at next sync with `submitted_at` pinned to the deadline (existing rule).
- Sync trigger: on `online`, on app start, on `visibilitychange → visible`, and after each journal append (debounced); backoff reuses `retryClassifier`. Successful sync toasts "Back online — N answers sent." (N = answers acknowledged).

### D7 — Practice reminders (Web Push)

- **Client:** Profile switch → permission sheet ("Allow reminders?") → `Notification.requestPermission()` → `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VITE_VAPID_PUBLIC_KEY })` → `PUT /api/me/reminders { subscription, timezone, hour: 16, minute: 30 }`. Off → `DELETE /api/me/reminders` + `subscription.unsubscribe()`. Denied → row disabled, "Blocked in your browser settings." iOS not installed → disabled, "On iPhone, install the app first to turn reminders on." The service worker's `push` handler shows the notification and `notificationclick` focuses/opens `/`.
- **Server:** table `reminder_subscription`; env `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; library `web-push`; an in-process scheduler (every 60 s, `pg_try_advisory_lock`) sends at the student's local time, skipping a student who already finished an attempt that local day; `410/404` from the push service deletes the subscription. Payloads contain no student data ("Time for a little practice 🎧").

### D8 — Storage inventory and purge

| Store | Name | Holds | Purged on sign-out |
|---|---|---|---|
| localStorage | `pp.install.dismissed`, i18n language | UI prefs | no (not user data) |
| IndexedDB | existing answer-queue DB | durable answers | **no** — unsent answers must survive; keyed by attempt, flushed after re-auth (existing behaviour) |
| IndexedDB | `pp-offline` | saved test bundles | yes |
| IndexedDB | `pp-attempts` | journal + local attempt state | **no if unsynced** (same rule as the answer queue); synced rows deleted |
| Cache Storage | `pp-offline-media-v1` | downloaded media | yes |
| Cache Storage | `pp-api-v1` | cached GET responses | yes |
| Service worker | push subscription | reminder endpoint | yes (and server row deleted) |

`purgeClientCaches()` returns `Promise<void>`, never rejects, and is idempotent.

### D9 — Visual system and fonts

Port the prototype's tokens verbatim (they already equal the app's `@theme` palette). Self-host **Nunito** (variable) and **IBM Plex Mono** via `@fontsource-variable/nunito` and `@fontsource/ibm-plex-mono` so the precache contains them and the offline shell is not rendered in a fallback face; remove the Google Fonts `<link>`s from `packages/app/index.html`. Layout is full-viewport mobile-first (320 px → tablet); on ≥ 560 px the app column is centred at max-width 520 px with the same chrome (no fake device frame). Respect `env(safe-area-inset-*)` on every edge-pinned bar and `prefers-reduced-motion`.

## 5. Routes

| Prototype | Real route | Tab bar |
|---|---|---|
| `#/signin` | `/sign-in` | no |
| `#/library` | `/` | yes |
| `#/history` | `/history` | yes |
| `#/profile` | **`/profile` (new file `pages/profile.tsx`)** | yes |
| `#/rules` | `/attempts/$attemptId/sections/$sectionId/rules` | no |
| `#/run` | `/attempts/$attemptId/run` | no |
| `#/handin` | `/attempts/$attemptId/hand-in` | no |
| `#/timeup` | `/attempts/$attemptId/time-up` | no |
| `#/result/:id` | `/attempts/$attemptId/result` | no |
| `#/review/:id/:n` | `/attempts/$attemptId/review?q=<ordinal>` (search param, 1-based) | no |
| (none) | `/tests/$slug` brief — kept for deep links, no longer linked from the library | no |

## 6. Shared interface contract

Plan tasks are written by different authors; these names and shapes are binding. All paths are under `packages/app/src` unless noted. Time/ids are ISO strings / UUIDs.

```ts
// lib/network.ts — Task 3
export interface NetworkSnapshot { readonly online: boolean }
export const networkStore: {
  subscribe(listener: () => void): () => void
  getSnapshot(): NetworkSnapshot            // online = navigator.onLine && no recent hard fetch failure
  reportFetchFailure(): void                // called by api-client on TypeError("Failed to fetch")
  reportFetchSuccess(): void
  setOnlineForTests(online: boolean): void
}

// lib/pwa/pwa-store.ts — Task 3
export type PwaPlatform = "ios" | "android" | "other"
export interface PwaSnapshot {
  readonly standalone: boolean
  readonly canPromptInstall: boolean        // Chromium event captured
  readonly platform: PwaPlatform
  readonly installDismissed: boolean
  readonly updateReady: boolean
}
export const pwaStore: {
  subscribe(listener: () => void): () => void
  getSnapshot(): PwaSnapshot
  promptInstall(): Promise<"accepted" | "dismissed" | "unavailable">
  markInstalled(): void                     // iOS "I've added it"
  dismissInstall(): void
  setUpdateReady(applyFn: () => Promise<void>): void
  applyUpdate(): Promise<void>
}
// lib/pwa/register.ts — Task 3:  export function registerPwa(): void
// lib/pwa/purge.ts — Task 2:     export function purgeClientCaches(): Promise<void>

// lib/toast.ts — Task 4
export type ToastIcon = "check" | "wifioff" | "cloud" | "trash" | "bell" | "refresh" | "clock"
export const toastStore: {
  subscribe(listener: () => void): () => void
  getSnapshot(): { readonly id: number; readonly message: string; readonly icon: ToastIcon } | null
  show(message: string, icon?: ToastIcon): void   // auto-clears after 3800 ms
}

// components/BottomSheet.tsx — Task 4 (stateless; Radix Dialog inside)
export interface BottomSheetProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly title: string
  readonly closeLabel: string
  readonly returnFocusRef?: RefObject<HTMLElement | null>
  readonly children: ReactNode
}
// components/TabBar.tsx — props { readonly active: "library" | "history" | "profile"; readonly labels: { library: string; history: string; profile: string; nav: string } }
// components/Banners.tsx exports OfflineBanner, UpdateBanner, InstallCard (props-only)
// components/Splash.tsx — props { readonly visible: boolean }

// lib/offline/offline-store.ts — Task 15
export interface OfflineTestRecord {
  readonly slug: string; readonly testVersionId: string; readonly version: number
  readonly title: string; readonly totalBytes: number; readonly savedAt: string
}
export type DownloadProgress = { readonly doneBytes: number; readonly totalBytes: number }
export const offlineStore: {
  list(): Promise<OfflineTestRecord[]>
  has(slug: string): Promise<boolean>
  getBundle(slug: string): Promise<OfflineBundle | null>
  download(slug: string, opts: { onProgress(p: DownloadProgress): void; signal: AbortSignal }): Promise<OfflineTestRecord>
  remove(slug: string): Promise<void>
  removeAll(): Promise<void>
  subscribe(listener: () => void): () => void
}
// OfflineBundle mirrors the server response in D5 (lib/api-types.ts).

// lib/attempt/attempt-gateway.ts — Task 20
export interface AttemptGateway {
  start(slug: string): Promise<AttemptStart>
  loadEnvelope(attemptId: string): Promise<RunnerEnvelope>
  enterSection(attemptId: string, sectionId: string): Promise<SectionEntry>
  setPosition(attemptId: string, sectionId: string, questionId: string): Promise<void>
  claimPlay(attemptId: string, stimulusId: string): Promise<PlayGrant>
  finishSection(attemptId: string, sectionId: string, body: FinishSectionBody): Promise<FinishSectionResult>
  submit(attemptId: string, body: SubmitBody): Promise<FinalizedAttempt>   // remote only; local gateway rejects with OfflineError
}
export class OfflineError extends Error { readonly kind = "offline" }
// lib/attempt/gateway-selector.ts — Task 21: export function gatewayFor(attemptId: string): AttemptGateway

// lib/reminders.ts — Task 25
export type ReminderState = "off" | "on" | "denied" | "needs-install" | "unsupported"
export const reminders: {
  state(): Promise<ReminderState>
  enable(): Promise<ReminderState>     // permission + subscribe + PUT
  disable(): Promise<ReminderState>
}
```

Server (`packages/server/src`, `packages/db/src`, `docs/api/openapi.yaml`):

| Endpoint | Task | Notes |
|---|---|---|
| `GET /api/tests/:slug/offline-bundle` | 14 | `CatalogController`; 404 `test_not_found`, 409 `test_not_published` |
| `POST /api/attempts/offline-sync` | 18 | idempotent on `clientAttemptId`; 200 `{ attemptId, applied, late, answersAcked }`; 409 `offline_play_cap_exceeded`; 422 `offline_journal_invalid` |
| `PUT /api/me/reminders` · `DELETE /api/me/reminders` | 23 | 204 |
| Migration `1016_offline_attempts.cjs` | 17 | `attempt.client_attempt_id uuid UNIQUE NULL`, `attempt.origin text NOT NULL DEFAULT 'server' CHECK (origin IN ('server','offline'))` |
| Migration `1017_reminder_subscription.cjs` | 23 | `reminder_subscription(student_id PK/FK, endpoint, p256dh, auth, timezone, hour, minute, last_sent_on date, created_at)` |

## 7. Accessibility and interaction requirements

These apply to every task (copied from the html-prototype contract; the prototype already satisfies them and the port must not regress them):

- Native elements first; every flow keyboard-operable; visible `:focus-visible`.
- After a route change focus the page `h1` (`tabindex=-1`, no outline); after answering/next, focus the question heading or keep the focused control; sheets contain focus, close on `Esc`, restore focus to the trigger.
- Status changes announced through one polite live region (`role=status`); errors tied to controls; timer is `role=timer` with a label and does **not** announce every second (one "One minute left." announcement).
- Colour is never the only signal: statuses carry an icon or text (✓ / ✕ / –, "Saved", "Waiting to send: N").
- Targets ≥ 44 × 44 px; no page-level horizontal overflow at 320 px; safe-area insets on top bar, tab bar, action bar and sheets.
- `prefers-reduced-motion`: no spinner/equaliser/skeleton/sheet-slide animation; state still visible.

## 8. Testing strategy

- **TDD** per task: failing test → implementation → green. RTL for screens and components; plain Vitest for `lib/`; server tests follow existing `packages/server` patterns (real-Postgres integration tests where the repo already uses them).
- **Service worker:** assert the generated workbox config (allow-list, denylist, `registerType`, manifest fields) in a unit test over the exported options factory, and a build test that `dist/sw.js`, `dist/manifest.webmanifest`, icons and woff2 files exist and that `sw.js` contains no `/api/media` runtime route.
- **Browser verification** (Task 26): Chrome DevTools at 390 × 844 and 320 × 568, offline toggle, Application panel (manifest installable, SW activated), Lighthouse "installable" + "PWA optimized", reduced-motion emulation, screenshot of each screen compared side by side with the prototype. No automated pixel diff is claimed.
- A real-device pass (iOS Safari add-to-home-screen, Android Chrome install, push on both) is **manual** and listed in the Task 26 checklist; the plan does not claim it is automated.

## 9. Security and privacy

- Bundle and sync endpoints sit behind the existing `JwksGuard` and student-ownership checks; the sync endpoint trusts no client state beyond the journal and re-derives scoring server-side.
- Cached API data is limited to the allow-list in D1 and purged on sign-out/subject change.
- Push payloads carry no PII; subscription endpoints are student-scoped and deleted on sign-out.
- New env vars (`VAPID_*`) must be added to `compose.yml`'s explicit environment block and `loadServerConfig`; `VITE_VAPID_PUBLIC_KEY` is a public build arg in the `Dockerfile`.

## 10. Phasing (each phase ships working software)

| Phase | Tasks | Result |
|---|---|---|
| A — Installable foundation | 1–6 | Installable, offline shell, tab bar, sheets, toasts, Profile |
| B — Mobile screens | 7–13 | Every screen matches the prototype; today's online/offline-queue behaviour preserved |
| C — Offline library | 14–16 | "Save offline" works end to end |
| D — Offline attempts | 17–22 | Start/continue/finish sections offline; sync on reconnect; hand-in online-only |
| E — Reminders | 23–25 | Web Push reminders |
| F — Acceptance | 26 | Parity verification, Lighthouse, docs, deploy config |

Phases C–E can be cut without invalidating A–B; the parity matrix rows 12, 28–32 depend on them.

## 11. Deviations from the prototype (deliberate, minimal)

1. **Profile has two additive rows** the prototype omitted but the product needs: a language group (six locales) and, for admins only, an "Admin console" link.
2. **Time's-up "waiting" variant:** if the final section's clock expires while offline the prototype's immediate result is impossible; the screen shows the same layout with "We'll score it as soon as you're back online." and a disabled "See your result" until sync completes.
3. **Brief screen retained** at `/tests/$slug` for deep links but bypassed by the library.
4. **Fonts self-hosted** instead of Google Fonts links (offline correctness).
5. **Sheets** are Radix-dialog bottom sheets, not native `<dialog>`; visuals and behaviour match.
6. **Real data, real timers, real audio** replace the simulation; copy comes from the existing i18n catalogue where a key already exists, and from the prototype's strings otherwise.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Journal replay lets a student game timing offline | Server bounds (§D6), monotonic local clock, play-cap audit, `origin='offline'` flagged in admin results; accepted for a private family platform |
| Capped audio downloadable via bundle | Documented trade-off (D5); audit at sync |
| Service worker caches stale authenticated data on shared devices | Allow-list + purge on sign-out + subject-change purge |
| `registerType: "prompt"` leaves users on old shells | Update banner + Profile Refresh; version row |
| iOS push requires installed PWA and iOS ≥ 16.4 | `needs-install` / `unsupported` states |
| Refactoring `run.tsx` (1 221 lines, 2 111-line test) onto a gateway regresses behaviour | Task 20 is behaviour-preserving with the existing suite as the guard before any local gateway exists |

## 13. Amendments after plan drafting (authoritative over D5, D6 and §6 where they differ)

Drafting the plan against the real code found defects in D6 and several contract changes. Where this section and an earlier section disagree, **this section wins**.

### 13.1 D6 corrections

1. **Answers are journal events.** The server rejects an answer to an earlier question of a forward-only section as `navigation_locked` once the replayed position has moved on. Offline answers therefore travel in the journal, interleaved with `position` events, not only through the answer queue. (A pre-existing *online* variant — a queued answer flushed after Next — is not fixed here.)
2. **Time is skew-normalised, not rejected.** `effectiveAt = clientAt + (receivedAt − clientSentAt)`. A phone whose clock is wrong is accepted; it neither gains time nor is rejected for a fast clock. The "≤ receive time + 60 s" rule is dropped.
3. **Local clock:** `elapsed = max(monotonic, wall)` with a persisted high-water mark. The "wall jump over 2 minutes is tamper" rule is dropped (it granted free time when iOS pauses `performance.now()` in sleep).
4. **Two deadlines.** `attempt.expires_at` (first enter + whole-test duration) is enforced independently of each section's `expires_at`; the validator tracks both.
5. **Offline start cannot reuse `startOrResumeAttempt`** (it resumes an existing in-progress attempt, so a journal could be applied to a different attempt). Instead: new `createOfflineAttempt`; the **client-minted UUID is the server `attempt.id`**; there is **no `client_attempt_id` column**. Migration `1016_offline_attempts.cjs` adds `attempt.origin ('server'|'offline')` and `offline_journal_cursor`. Request body is `{ attemptId, clientSentAt, events[] }`; errors `offline_journal_invalid` (422), `offline_play_cap_exceeded` (409), `offline_attempt_conflict` (409). A *timed* in-progress attempt can be continued offline only if this device already loaded it (hydration); otherwise Continue is disabled with the connection reason.
6. **Shared device:** local attempts carry `ownerSub` (JWT `sub`); sync, Continue, resume and counts act only for the signed-in student; sign-out purge keeps unsynced work.

### 13.2 Contract changes

- `OfflineStore` gains `getMediaBlob`, `snapshot()`, `whenReady()`. `TestCard` gains `testVersionId` and `mediaBytes` (server, openapi, app type).
- `AttemptGateway`: `start(slug, hint?)`, plus `noteAnswer`, `flushAnswers(ctx)`, `isLocalOnly`; `submit` returns the real `SubmitResult`. Pages use a forwarding `attemptGateway` proxy and accept an optional `gateway` prop for tests; `setAttemptGateway` + `installOfflineAttempts()` (from `main.tsx`) install the hybrid; `gatewayFor(attemptId)` returns the same singleton.
- Shell additions: `registerPurgeStep` (evolved with an unregister return, synchronous start and a re-entrancy guard) + `purgeIfSubjectChanged`; `pendingCountStore` (`lib/pending-count.ts`, fed by the run screen); `startInstall()` (`lib/pwa/install-flow.ts`); `Icon`/`IconName`; `InstallSheet`; `RemindersRow`; `OfflineStorageList`; `shell-routes.ts`; `TabBar` has a required `onNavigate`; `usePageTitleFocus`; `useReminders` in `lib/`.
- `PUT /api/me/reminders` accepts an optional `locale`; `reminder_subscription` has a `locale` column. `DELETE` works even when push is unconfigured; only `PUT` returns 503 `reminders_not_configured`. Migration `1017` follows `1016`.

### 13.3 Added deviations from the prototype (extends §11)

7. **Design tokens:** the prototype's contrast-corrected values (`ink-2 #4b5966`, `good #1f7a43`, `bad #b53a34`, plus new `teal-d`, `amber-bg`) replace the app's existing `@theme` values; existing screens' text colours change slightly.
8. **iOS status bar** is `default`, not `black-translucent`, and `maximum-scale=1` is removed (pinch zoom).
9. **Student routes render in a max-520 px centred column**; `/admin/*` stays full width; the tab bar is `position: fixed`.
10. **Android install** calls the real native prompt; the manual-steps sheet appears only when no prompt event is available.
11. **Sign-out copy** says saved tests "will be removed from this phone" (the prototype said they stay) because D8 purges them.
12. **Reminders "Don't allow"** closes the soft-ask sheet without marking `denied`; "Reminders blocked." appears only when the real browser prompt is denied.
13. **Data the real API lacks is dropped:** history cards show no "Attempt n" or level; the in-progress chip shows the test's first section name.
14. **Listening unlock on failure:** answers stay locked until the recording has played, but unlock if it fails to load, so a student is never stuck.
15. **Removed legacy UI:** left drawer (`AppMenu`/`DeviceSheet`), footer Hand-in button, section-complete card, pip strip, per-section score columns in History.

### 13.4 Known and accepted

Capped audio is downloadable through the bundle endpoint (play counts are audited at sync, not byte-gated); `apiFetch` has no per-call timeout so a "connected but dead" network keeps choosing the remote gateway; a rare ±1 play over-count can follow a crash mid-apply or a lost `claimPlay` response; `origin = 'offline'` is recorded but not yet surfaced in the admin results table; the "recording didn't load" retry copy can claim a play was used when the local gateway did not consume one.
