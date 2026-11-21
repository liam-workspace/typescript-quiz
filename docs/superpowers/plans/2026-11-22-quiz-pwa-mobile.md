# Quiz PWA Mobile Web App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task is self-contained: read this header, the spec's §13 amendments, and your own task — not the whole file.

**Goal:** Turn the student web app into an installable, offline-capable, phone-first PWA that is 100 % faithful to the clickable prototype `docs/prototype/pwa-mobile.html`.

**Architecture:** `vite-plugin-pwa` (`generateSW`, prompt-style updates) seeded from `@liam-workspace/vite-preset-pwa` gives the installable offline shell with an allow-listed API cache. A shared mobile shell (tab bar, bottom sheets, toasts, banners) wraps the existing TanStack routes, which are restyled screen by screen. Offline use is built in two layers on the existing durable answer queue: a saved-test library (bundle endpoint + Cache Storage/IndexedDB) and a journal-first attempt lifecycle replayed by the server through its existing repository functions. Web Push drives the reminders row.

**Tech Stack:** React 19, TanStack Router 1.170.16, Tailwind CSS 4, Radix UI, Vitest + Testing Library + fake-indexeddb, `vite-plugin-pwa` 2.0.0 + workbox 7.4.1, NestJS 11 + `pg` + node-pg-migrate (`.cjs`), `web-push` 4, i18next (6 locales), pnpm 11.1.1, Node 24.

**Spec:** `docs/superpowers/specs/2026-11-22-quiz-pwa-mobile-design.md` — **§13 "Amendments after plan drafting" overrides D5/D6 and §6 wherever they differ.** Visual/behavioural authority: `docs/prototype/pwa-mobile.html`.

## Global Constraints

- Prototype tokens (verbatim): ink `#1c2530`, ink-2 `#4b5966`, faint `#8d9aa6`, paper `#ffffff`, surface `#f4f7f9`, line `#dfe6ec`, teal `#0f6e78`, teal-d `#0b5a63`, teal-bg `#e4f1f2`, clay `#a8622f`, clay-bg `#f8ede4`, good `#1f7a43`, good-bg `#e6f4eb`, bad `#b53a34`, bad-bg `#faeae9`, amber `#e8a33d`, amber-bg `#fdf3df`.
- Fonts: Nunito (variable) for text, IBM Plex Mono for timers/tabular numbers; both self-hosted via `@fontsource-variable/nunito` and `@fontsource/ibm-plex-mono` — no Google Fonts links.
- Service worker: `registerType: "prompt"`; never `skipWaiting` unprompted; runtime cache `pp-api-v1` (NetworkFirst, 4 s timeout, 60 entries, 7 days) for GET `/api/tests`, `/api/me`, `/api/attempts` list and `/api/attempts/:id/{result,review}` only; **never** cache `/api/media/*`, `/api/session`, or `/api/attempts/:id/{submit,position,responses,play,sections}`; `navigateFallbackDenylist` = `/api/`, `/media/`, `/health`; `sw.js`, `push-sw.js`, `workbox-*.js`, `manifest.webmanifest` served `Cache-Control: no-cache`.
- Storage names: IndexedDB `pp-offline`, `pp-attempts` (plus the existing answer-queue DB); Cache Storage `pp-offline-media-v1`, `pp-api-v1`; localStorage `pp.install.dismissed`, `pp.last-student`. Sign-out/subject change purges everything except **unsynced** answers and journal rows.
- Hand-in requires a connection; the clock is server-judged: offline journals are replayed with skew-normalised timestamps, section **and** whole-attempt deadlines, and a play-cap audit.
- Migrations: `1016_offline_attempts.cjs` first, then `1017_reminder_subscription.cjs`.
- Routes (spec §5): add `/profile`; review uses `?q=<1-based ordinal>`; library bypasses `/tests/$slug`.
- i18n: every user-visible string in all six locales (`en de es fr it ja`) with real translations; prefixes by owner — Tasks 1–6: `pwa.* tabs.* toast.* profile.*`; Tasks 7–13: the existing `library.* signIn.* sectionRules.* runner.* navigator.* handIn.* timeUp.* result.* review.* history.*`; Tasks 14–22: `offline.*`; Tasks 23–26: `reminders.*`; `lint:i18n` and `locale-parity.test.ts` must pass.
- Code style: Prettier (`semi: false`, double quotes, trailing commas, width 80); `components/` stateless and props-only; hooks in `pages/` or `lib/`; no `any`.
- Accessibility: targets ≥ 44 × 44 px; `env(safe-area-inset-*)` on every edge-pinned bar; `prefers-reduced-motion` honoured; no horizontal overflow at 320 px; timer is `role="timer"` and announces only "One minute left."; colour is never the only status signal.
- Edit anchoring: tasks reshape shared files, so every Modify step names a **symbol**, not a line number — re-read the file before editing.
- Gates every task ends green on (those it touches): `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format`, `pnpm lint:api`. Server tests need Docker (Postgres global setup).
- Commits: `type(scope): summary`, one commit per task (plus an explicit `chore(app): regenerate route tree` when `route.gen.ts` changes).

## Review Focus

Input classes and failure modes the spec implies but a feature test would not naturally exercise. Each is pinned by a test in the owning task.

1. **Two students on one shared device** — B signs in after A: A's cached API data, saved tests and reminder subscription must not reach B, and A's *unsent* offline work must neither be lost nor synced under B. Pinned: Task 2 (`purgeClientCaches`, `purgeIfSubjectChanged`), Task 21 (`ownerSub` tests), Task 25 Step 4 (sign-out purges before tokens clear; PUT evicts a subscription already held by another student).
2. **A phone offline for most of a test with a wrong clock** (10 min fast, set back mid-test, rebooted/slept): the journal still syncs with no answers lost, and the student neither gets rejected nor gains time. Pinned: Task 17 ("normalises a fast device clock instead of rejecting the attempt"), Task 19 (`LocalClock` high-water-mark tests).
3. **A listening recording that never loads** (corrupt file or failure mid-claim): the student must still be able to answer and move on. Pinned: Task 11 (`audioFailed` unlocks the choices in `QuestionMedia`/`ListeningRunner`).
4. **Wi-Fi flapping while unsynced journal events exist**: no duplicated plays or answers, no reordering, and the save chip/toast tell the truth. Pinned: Task 18 ("is idempotent and supports incremental sync via the cursor"), Task 21 (hybrid gateway routing tests).
5. **Review deep links with bad input** (`?q=0`, `?q=abc`, `?q=999`, single-item review): renders a valid question and never writes a bad `q` back. Pinned: Task 13 (`reviewSearchSchema` `.catch(1)` + "starts on the question named by initialOrdinal and clamps out-of-range values").

Known and accepted, not pinned (see spec §12 and Task 18/21 notes): capped audio is downloadable through the bundle endpoint; "connected but dead" (lie-fi) networks have no per-call timeout; a rare ±1 play over-count window after a crash mid-apply.

## Task map

| Phase | Task | Deliverable | Owns |
|---|---|---|---|
| A — Installable foundation | 1 | Deps, self-hosted fonts, icons, manifest, `vite-plugin-pwa` config | `vite.config.ts`, `public/`, `index.html` |
| | 2 | SW caching policy, no-cache headers, `purgeClientCaches()` | `lib/pwa/purge.ts`, server SPA headers |
| | 3 | `networkStore`, `pwaStore`, `registerPwa`, `pendingCountStore`, install flow | `lib/network.ts`, `lib/pwa/*`, `lib/pending-count.ts` |
| | 4 | Shell primitives: tokens/CSS, `Icon`, `BottomSheet`, toasts, `TabBar`, banners, splash, `AppLayout` | `components/*`, `pages/layout.tsx`, `index.css` |
| | 5 | Shell/profile i18n strings (six locales) | `locales/*` |
| | 6 | `/profile` route | `pages/profile.tsx` |
| B — Mobile screens | 7 | Library | `pages/index.tsx` |
| | 8 | Sign-in + no-access | `pages/sign-in.tsx` |
| | 9 | Section rules | `…rules.tsx` |
| | 10 | Run chrome, navigator sheet, finish sheet, run menu | `run.tsx`, `components/Run*` |
| | 11 | Run question surfaces | `ListeningRunner`, `QuestionMedia`, `ChoiceList`, `ReadingRunner` |
| | 12 | Hand-in + time-up | `hand-in.tsx`, `time-up.tsx` |
| | 13 | Result, Review, History, save-state/offline parity, pending-count + title focus wiring, drawer removal | `result/review/history`, `SaveState` |
| C — Offline library | 14 | Server offline-bundle endpoint | `catalog`, `openapi.yaml` |
| | 15 | `offlineStore` | `lib/offline/offline-store.ts` |
| | 16 | Library/Profile download UI + offline gating | `pages/index.tsx`, `profile.tsx` |
| D — Offline attempts | 17 | Migration 1016 + journal validator | `db`, `server/attempts` |
| | 18 | `POST /api/attempts/offline-sync` | `server/attempts` |
| | 19 | Client journal store + `LocalClock` | `lib/attempt/journal-store.ts` |
| | 20 | `AttemptGateway` + remote impl + page refactor (behaviour-preserving) | `lib/attempt/*` |
| | 21 | Local/hybrid gateway, offline start, sync triggers | `lib/attempt/*` |
| | 22 | Offline time-up waiting state + hand-in guard + pending-sync indicator | `time-up.tsx`, `hand-in.tsx` |
| E — Reminders | 23 | Server subscription table + endpoints + VAPID config | `db`, `server` |
| | 24 | Server scheduler | `server/reminders` |
| | 25 | Client reminders + push SW + Profile wiring | `lib/reminders.ts`, `push-sw.js` |
| F — Acceptance | 26 | Parity checklist, build-output test, docs, deploy args, dead-code check | `docs/…acceptance.md`, `Dockerfile`, `README.md` |

**"Part A/B/C/D" inside tasks** means Tasks 1–6 / 7–13 / 14–22 / 23–26 respectively (the plan was drafted in four parts).

**Order:** strictly 1 → 26. Phases C–E may be dropped without invalidating A–B (parity matrix rows 12, 28–32 depend on them).

---

### Task 1: Installable build — dependencies, self-hosted fonts, icons, manifest, `vite-plugin-pwa`

**Files:**
- Modify: `packages/app/package.json`, `package.json` (root), `pnpm-lock.yaml` (generated by pnpm)
- Create: `scripts/generate-pwa-icons.ts`
- Create (generated, committed): `packages/app/public/icon.svg`, `packages/app/public/pwa-192x192.png`, `packages/app/public/pwa-512x512.png`, `packages/app/public/pwa-maskable-512x512.png`, `packages/app/public/apple-touch-icon-180x180.png`
- Create: `packages/app/pwa.config.ts`
- Modify: `packages/app/vite.config.ts`, `packages/app/index.html`, `packages/app/src/index.css`, `packages/app/tsconfig.json`
- Test: `packages/app/test/pwa-config.test.ts`

**Interfaces:**
- Consumes: `cmsPwaOptions(options): Record<string, unknown>` from `@liam-workspace/vite-preset-pwa@0.1.0` (returns `{ registerType, manifest, workbox }`; `manifest` built by `buildManifest`).
- Produces: `export const pwaOptions: Partial<VitePWAOptions>` in `packages/app/pwa.config.ts` — Task 2 edits its `workbox.runtimeCaching` and `workbox.navigateFallbackDenylist`. Build output gains `manifest.webmanifest`, `sw.js`, `workbox-*.js`, icon PNGs, self-hosted `.woff2` files.

- [ ] **Step 1: Confirm install prerequisites**

The `@liam-workspace` scope comes from GitHub Packages; `pnpm install` needs a token. Do not print it.

Run: `grep -c npm.pkg.github ~/.npmrc` — Expected: `1` or more. If `0`, export `NODE_AUTH_TOKEN` before the next step.

Run: `pnpm view vite-plugin-pwa@2.0.0 peerDependencies --json` — Expected: `vite` range includes `^8.0.0` (this repo is on Vite 8.2.2), plus `workbox-build` and `workbox-window` `^7.4.1`.

- [ ] **Step 2: Write the failing test**

Create `packages/app/test/pwa-config.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { pwaOptions } from "../pwa.config.js"

const appRoot = process.cwd()

function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(join(appRoot, "public", file))

  // PNG IHDR: width at byte 16, height at byte 20 (big-endian).
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

describe("pwaOptions manifest", () => {
  const manifest = pwaOptions.manifest as Record<string, unknown>

  it("describes a standalone, installable app that starts at /", () => {
    expect(manifest).toMatchObject({
      name: "Primary Practice",
      short_name: "Primary Practice",
      id: "/",
      start_url: "/",
      scope: "/",
      display: "standalone",
      orientation: "portrait",
      theme_color: "#ffffff",
      background_color: "#0f6e78",
    })
  })

  it("declares 192, 512 and a separate maskable 512 icon, and every file exists at that size", () => {
    const icons = manifest.icons as Array<{
      src: string
      sizes: string
      purpose?: string
    }>

    expect(icons.map((icon) => [icon.src, icon.sizes, icon.purpose])).toEqual([
      ["/pwa-192x192.png", "192x192", "any"],
      ["/pwa-512x512.png", "512x512", "any"],
      ["/pwa-maskable-512x512.png", "512x512", "maskable"],
    ])

    expect(pngSize("pwa-192x192.png")).toEqual({ width: 192, height: 192 })
    expect(pngSize("pwa-512x512.png")).toEqual({ width: 512, height: 512 })
    expect(pngSize("pwa-maskable-512x512.png")).toEqual({
      width: 512,
      height: 512,
    })
    expect(pngSize("apple-touch-icon-180x180.png")).toEqual({
      width: 180,
      height: 180,
    })
    expect(existsSync(join(appRoot, "public", "icon.svg"))).toBe(true)
  })
})

describe("pwaOptions registration and caching", () => {
  it("never skips waiting on its own: the app, not the worker, decides when to update", () => {
    expect(pwaOptions.registerType).toBe("prompt")
    expect(pwaOptions.injectRegister).toBe(false)
  })

  it("does not inherit the preset's blanket /api runtime cache", () => {
    const workbox = pwaOptions.workbox as { runtimeCaching?: unknown[] }

    expect(workbox.runtimeCaching).toEqual([])
  })

  it("precaches the shell including fonts and the manifest", () => {
    const workbox = pwaOptions.workbox as {
      globPatterns: string[]
      navigateFallback: string
    }

    expect(workbox.globPatterns.join(",")).toContain("woff2")
    expect(workbox.navigateFallback).toBe("/index.html")
  })
})

describe("index.html", () => {
  const html = readFileSync(join(appRoot, "index.html"), "utf8")

  it("self-hosts type: no Google Fonts links remain (the offline shell must not depend on them)", () => {
    expect(html).not.toContain("fonts.googleapis.com")
    expect(html).not.toContain("fonts.gstatic.com")
  })

  it("allows pinch zoom and uses a dark-on-light status bar over the white app bar", () => {
    expect(html).not.toContain("maximum-scale")
    expect(html).toContain('content="default"')
    expect(html).toContain('rel="apple-touch-icon"')
    expect(html).toContain('rel="icon"')
  })
})
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `pnpm --filter @pp/app exec vitest run test/pwa-config.test.ts`
Expected: FAIL — `Failed to resolve import "../pwa.config.js"`.

- [ ] **Step 4: Install dependencies**

```bash
pnpm --filter @pp/app add vite-plugin-pwa@2.0.0 workbox-window@7.4.1 @fontsource-variable/nunito@5.3.0 @fontsource/ibm-plex-mono@5.3.0 @liam-workspace/vite-preset-pwa@0.1.0
pnpm --filter @pp/app add -D workbox-build@7.4.1
pnpm add -D -w sharp@0.35.5
```

If pnpm rejects a version with a `minimumReleaseAge` message (the workspace holds new third-party releases for 7 days), run `pnpm view <pkg> time --json` and re-run with the newest version older than 7 days. Do not add the package to `minimumReleaseAgeExclude`.

- [ ] **Step 5: Write the icon generator**

Create `scripts/generate-pwa-icons.ts`. The glyph is a path (not `<text>`) so rasterisation does not depend on installed fonts.

```ts
/**
 * One-shot generator for the installable-app icons. Output is committed
 * under packages/app/public; re-run only when the mark changes:
 *   pnpm icons:pwa
 *
 * Mark = the prototype's logo (docs/prototype/pwa-mobile.html `.logo`):
 * a white "P" on the app's teal. Maskable and Apple icons are full-bleed
 * (the OS rounds them) with the glyph inside the maskable safe zone.
 */
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const outDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../packages/app/public",
)
const TEAL = "#0f6e78"
const GLYPH =
  "M176 120h112c58 0 98 38 98 92s-40 92-98 92h-48v88h-64V120zm64 56v72h44c24 0 40-14 40-36s-16-36-40-36h-44z"
const NS = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"'
const glyph = `<path transform="translate(-24 0)" fill="#fff" fill-rule="evenodd" d="${GLYPH}"/>`

const rounded = `<svg ${NS}><rect width="512" height="512" rx="112" fill="${TEAL}"/>${glyph}</svg>`

function fullBleed(scale: number): string {
  return `<svg ${NS}><rect width="512" height="512" fill="${TEAL}"/><g transform="translate(256 256) scale(${String(scale)}) translate(-256 -256)">${glyph}</g></svg>`
}

async function png(svg: string, size: number, file: string): Promise<void> {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(resolve(outDir, file))
}

await mkdir(outDir, { recursive: true })
await writeFile(resolve(outDir, "icon.svg"), rounded)
await png(rounded, 192, "pwa-192x192.png")
await png(rounded, 512, "pwa-512x512.png")
await png(fullBleed(0.7), 512, "pwa-maskable-512x512.png")
await png(fullBleed(0.82), 180, "apple-touch-icon-180x180.png")
```

In root `package.json` add to `scripts`: `"icons:pwa": "node scripts/generate-pwa-icons.ts"`.

Run: `pnpm icons:pwa && ls -l packages/app/public`
Expected: the five files listed; open `packages/app/public/pwa-512x512.png` and confirm a white P on teal.

- [ ] **Step 6: Create `packages/app/pwa.config.ts`**

```ts
import { cmsPwaOptions } from "@liam-workspace/vite-preset-pwa"
import type { VitePWAOptions } from "vite-plugin-pwa"

/**
 * Task 1 of docs/superpowers/plans/2026-11-22-quiz-pwa-mobile.md.
 *
 * Manifest + app shell only. The preset's default `runtimeCaching` caches
 * EVERY /api GET NetworkFirst, which would keep one student's results in a
 * shared browser for the next student; it is replaced here (and filled
 * with an explicit allow-list in Task 2) rather than inherited.
 *
 * `registerType: "prompt"`: a new worker waits; the app decides when to
 * apply it so a student is never reloaded mid-test (spec D3).
 */
const preset = cmsPwaOptions({
  name: "Primary Practice",
  shortName: "Primary Practice",
  description: "Listening and reading practice tests for TOEFL Primary.",
  themeColor: "#ffffff",
  backgroundColor: "#0f6e78",
  startUrl: "/",
  icons: [
    {
      src: "/pwa-192x192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/pwa-512x512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/pwa-maskable-512x512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ],
}) as { manifest: Record<string, unknown>; workbox: Record<string, unknown> }

export const pwaOptions: Partial<VitePWAOptions> = {
  registerType: "prompt",
  injectRegister: false,
  includeAssets: ["icon.svg", "apple-touch-icon-180x180.png"],
  manifest: {
    ...preset.manifest,
    id: "/",
    lang: "en",
    orientation: "portrait",
    categories: ["education"],
  } as VitePWAOptions["manifest"],
  workbox: {
    ...preset.workbox,
    globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2,webmanifest}"],
    maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
    runtimeCaching: [],
  } as VitePWAOptions["workbox"],
  devOptions: { enabled: false },
}
```

- [ ] **Step 7: Wire the plugin, fonts, `index.html` and tsconfig**

In `packages/app/vite.config.ts`, add the imports and plugin (anchor: the `plugins: [` array and the existing imports):

```ts
import { VitePWA } from "vite-plugin-pwa"
import { pwaOptions } from "./pwa.config.js"
```

```ts
  plugins: [
    tanstackRouter({
      /* unchanged */
    }),
    react(),
    tailwindcss(),
    VitePWA(pwaOptions),
  ],
```

In `packages/app/src/index.css` replace the first line `@import "tailwindcss";` with:

```css
@import "tailwindcss";
@import "@fontsource-variable/nunito/index.css";
@import "@fontsource/ibm-plex-mono/500.css";
@import "@fontsource/ibm-plex-mono/600.css";
```

and in the `@layer base { body { … } }` rule change the `font-family` list so the self-hosted variable face is first:

```css
    font-family:
      "Nunito Variable",
      Nunito,
      ui-sans-serif,
      system-ui,
      -apple-system,
      sans-serif;
```

Replace `packages/app/index.html` `<head>` so it reads exactly:

```html
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, viewport-fit=cover"
    />
    <meta name="theme-color" content="#ffffff" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="Primary Practice" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <link rel="icon" href="/icon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="/apple-touch-icon-180x180.png" />
    <title>Primary Practice</title>
  </head>
```

(`vite-plugin-pwa` injects `<link rel="manifest">` at build; do not add it by hand.)

In `packages/app/tsconfig.json` add `"vite-plugin-pwa/client"` to `compilerOptions.types` (so Task 3's `virtual:pwa-register` import type-checks) and add `"test/pwa-build.test.ts"` to `exclude` next to `"test/dev-auth-prod-build.test.ts"` (Task 2 creates that file; adding the exclude now is harmless).

- [ ] **Step 8: Run the test and a real build**

Run: `pnpm --filter @pp/app exec vitest run test/pwa-config.test.ts`
Expected: PASS (8 tests).

Run: `pnpm --filter @pp/app build && ls packages/app/dist | grep -E "manifest.webmanifest|sw.js|workbox|pwa-" && ls packages/app/dist/assets | grep -c woff2`
Expected: `manifest.webmanifest`, `sw.js`, one `workbox-*.js`, the three `pwa-*.png`; woff2 count ≥ 1.

Run: `pnpm --filter @pp/app typecheck && pnpm exec prettier --check packages/app/pwa.config.ts packages/app/test/pwa-config.test.ts scripts/generate-pwa-icons.ts packages/app/index.html`
Expected: no errors (run `pnpm exec prettier --write <files>` first if it reports differences).

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-lock.yaml scripts/generate-pwa-icons.ts packages/app/package.json packages/app/pwa.config.ts packages/app/vite.config.ts packages/app/index.html packages/app/src/index.css packages/app/tsconfig.json packages/app/public packages/app/test/pwa-config.test.ts
git commit -m "feat(app): installable build — manifest, icons, self-hosted fonts, vite-plugin-pwa (prompt mode)"
```

---

### Task 2: Service-worker caching policy, no-cache headers, and `purgeClientCaches()`

**Files:**
- Modify: `packages/app/pwa.config.ts`, `packages/app/test/pwa-config.test.ts`
- Create: `packages/app/test/pwa-build.test.ts`
- Modify: `packages/app/tsconfig.node.json`
- Create: `packages/app/src/lib/pwa/purge.ts`, `packages/app/src/lib/pwa/purge.test.ts`
- Modify: `packages/app/src/lib/auth.ts`, `packages/app/src/lib/auth.complete-sign-in.test.ts`
- Create: `packages/server/src/spa/static-headers.ts`, `packages/server/test/spa-static-headers.test.ts`
- Modify: `packages/server/src/spa/spa-fallback.filter.ts`, `packages/server/src/main.ts`, `packages/server/test/spa.e2e.test.ts`

**Interfaces:**
- Consumes: `pwaOptions` (Task 1); `signOut()` and `completeSignIn(code)` in `lib/auth.ts` (`completeSignIn` ends with `return await establishSession()`; `SessionResult extends Student { created: boolean }` so `result.id` is the student id).
- Produces:
  - `isCacheableApiRequest({ url, request }): boolean` exported from `pwa.config.ts` (self-contained: Workbox serialises it into `sw.js`).
  - `lib/pwa/purge.ts`: `purgeClientCaches(): Promise<void>`, `registerPurgeStep(step: () => Promise<void>): void`, `purgeIfSubjectChanged(subject: string): Promise<void>` (**contract extension** — Tasks 16, 19, 25 call `registerPurgeStep` instead of editing `purge.ts`).
  - Server: `spaStaticHeaders(res, filePath, root): void` and `shouldServeSpaShell(method, path): boolean`.

- [ ] **Step 1: Write the failing config tests**

In `packages/app/test/pwa-config.test.ts` change the import line to `import { isCacheableApiRequest, pwaOptions } from "../pwa.config.js"`, **delete** the test `does not inherit the preset's blanket /api runtime cache`, and append:

```ts
interface RequestLike {
  readonly method: string
  readonly headers: { has(name: string): boolean }
}

function check(
  path: string,
  request: RequestLike = { method: "GET", headers: new Headers() },
): boolean {
  return isCacheableApiRequest({
    url: new URL(path, "https://quiz.example"),
    request,
  })
}

describe("isCacheableApiRequest (the only API data the worker may keep)", () => {
  it.each([
    "/api/tests",
    "/api/tests?cursor=abc",
    "/api/me",
    "/api/attempts?limit=20",
    "/api/attempts/3f1c/result",
    "/api/attempts/3f1c/review",
  ])("caches %s", (path) => {
    expect(check(path)).toBe(true)
  })

  it.each([
    "/api/tests/practice-1",
    "/api/tests/practice-1/offline-bundle",
    "/api/attempts/3f1c",
    "/api/attempts/3f1c/position",
    "/api/attempts/3f1c/responses",
    "/api/attempts/3f1c/stimuli/s1/play",
    "/api/attempts/3f1c/submit",
    "/api/session",
    "/api/media/q1.mp3?exp=1&sig=ab",
    "/api/admin/overview",
    "/assets/index-abc.js",
  ])("never caches %s", (path) => {
    expect(check(path)).toBe(false)
  })

  it("never caches a non-GET or a Range request", () => {
    expect(check("/api/me", { method: "POST", headers: new Headers() })).toBe(false)
    expect(
      check("/api/me", { method: "GET", headers: new Headers({ range: "bytes=0-9" }) }),
    ).toBe(false)
  })
})

describe("workbox policy", () => {
  const workbox = pwaOptions.workbox as {
    runtimeCaching: Array<{
      urlPattern: unknown
      handler: string
      options: {
        cacheName: string
        networkTimeoutSeconds: number
        expiration: { maxEntries: number; maxAgeSeconds: number }
        cacheableResponse: { statuses: number[] }
      }
    }>
    navigateFallbackDenylist: RegExp[]
  }

  it("has exactly one runtime route: NetworkFirst, 4 s timeout, 60 entries, 7 days, 200s only", () => {
    expect(workbox.runtimeCaching).toHaveLength(1)

    const [route] = workbox.runtimeCaching

    expect(route?.urlPattern).toBe(isCacheableApiRequest)
    expect(route?.handler).toBe("NetworkFirst")
    expect(route?.options.cacheName).toBe("pp-api-v1")
    expect(route?.options.networkTimeoutSeconds).toBe(4)
    expect(route?.options.expiration).toEqual({
      maxEntries: 60,
      maxAgeSeconds: 7 * 24 * 60 * 60,
    })
    expect(route?.options.cacheableResponse).toEqual({ statuses: [200] })
  })

  it("keeps /api, /media and /health out of the navigation fallback", () => {
    const denied = (path: string) =>
      workbox.navigateFallbackDenylist.some((pattern) => pattern.test(path))

    expect(denied("/api/tests")).toBe(true)
    expect(denied("/media/x.mp3")).toBe(true)
    expect(denied("/health")).toBe(true)
    expect(denied("/history")).toBe(false)
    expect(denied("/callback")).toBe(false)
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @pp/app exec vitest run test/pwa-config.test.ts`
Expected: FAIL — `isCacheableApiRequest` is not exported.

- [ ] **Step 3: Implement the allow-list in `pwa.config.ts`**

Add above `export const pwaOptions`:

```ts
interface WorkboxMatchContext {
  readonly url: URL
  readonly request: {
    readonly method: string
    readonly headers: { has(name: string): boolean }
  }
}

/**
 * The ONLY /api responses the worker may keep (spec D1). A function
 * declaration with inline regexes and no outside references on purpose:
 * Workbox `generateSW` serialises `urlPattern` into sw.js with
 * `Function#toString`, so any closure variable would be undefined there.
 */
export function isCacheableApiRequest({
  url,
  request,
}: WorkboxMatchContext): boolean {
  if (request.method !== "GET" || request.headers.has("range")) {
    return false
  }

  return (
    /^\/api\/(tests|me|attempts)$/u.test(url.pathname) ||
    /^\/api\/attempts\/[^/]+\/(result|review)$/u.test(url.pathname)
  )
}
```

Replace `runtimeCaching: [],` inside the `workbox` object with:

```ts
    navigateFallbackDenylist: [/^\/api\//u, /^\/media\//u, /^\/health/u],
    runtimeCaching: [
      {
        urlPattern: isCacheableApiRequest,
        handler: "NetworkFirst",
        options: {
          cacheName: "pp-api-v1",
          networkTimeoutSeconds: 4,
          expiration: { maxEntries: 60, maxAgeSeconds: 7 * 24 * 60 * 60 },
          cacheableResponse: { statuses: [200] },
        },
      },
    ],
```

- [ ] **Step 4: Run and confirm pass**

Run: `pnpm --filter @pp/app exec vitest run test/pwa-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing build test**

Create `packages/app/test/pwa-build.test.ts` (same pattern as `dev-auth-prod-build.test.ts`: a real `vite build`, because only the real output proves the worker contains what the config says):

```ts
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

describe("production build: installable shell and worker policy", () => {
  const appRoot = process.cwd()
  let outDir = ""
  let sw = ""

  beforeAll(() => {
    outDir = mkdtempSync(join(tmpdir(), "pp-app-pwa-build-"))

    execFileSync(
      "pnpm",
      ["exec", "vite", "build", "--mode", "production", "--outDir", outDir],
      {
        cwd: appRoot,
        env: { ...process.env, NODE_ENV: "production", VITEST: undefined },
        stdio: "pipe",
      },
    )

    sw = readFileSync(join(outDir, "sw.js"), "utf8")
  }, 120_000)

  afterAll(() => {
    if (outDir) {
      rmSync(outDir, { recursive: true, force: true })
    }
  })

  it("emits the manifest, worker, icons and self-hosted fonts", () => {
    for (const file of [
      "manifest.webmanifest",
      "sw.js",
      "pwa-192x192.png",
      "pwa-512x512.png",
      "pwa-maskable-512x512.png",
      "apple-touch-icon-180x180.png",
      "icon.svg",
    ]) {
      expect(existsSync(join(outDir, file)), file).toBe(true)
    }

    const fonts = readdirSync(join(outDir, "assets")).filter((name) =>
      name.endsWith(".woff2"),
    )

    expect(fonts.length).toBeGreaterThan(0)
  })

  it("links the manifest from index.html exactly once", () => {
    const html = readFileSync(join(outDir, "index.html"), "utf8")

    expect(html.match(/rel="manifest"/gu)).toHaveLength(1)
  })

  it("runtime-caches only the API cache and never the media or offline caches", () => {
    expect(sw).toContain("pp-api-v1")
    expect(sw).not.toContain("pp-offline-media")
    expect(sw).not.toMatch(/api\/media/u)
  })

  it("serialised the allow-list function intact (no __name helper, anchored regexes)", () => {
    expect(sw).not.toContain("__name")
    expect(sw).toMatch(/\\\/api\\\/\(tests\|me\|attempts\)/u)
  })

  it("keeps /api out of the navigation fallback and never calls skipWaiting by itself", () => {
    expect(sw).toMatch(/denylist:\[[^\]]*api/u)
    expect(sw).not.toMatch(/skipWaiting\(\)\s*;?\s*self\.addEventListener\("install"/u)
  })
})
```

Add `"test/pwa-build.test.ts"` to the `include` array of `packages/app/tsconfig.node.json` (it uses Node types, like `dev-auth-prod-build.test.ts`).

Run: `pnpm --filter @pp/app exec vitest run test/pwa-build.test.ts`
Expected: with Step 3 already applied it should PASS. If a regex assertion fails because the minifier rewrote the text, open the printed `sw.js` (`KEEP` the dir by temporarily commenting `rmSync`), adjust only that assertion to the real emitted text, and keep its intent. If it FAILS on `__name`, the config bundler injected a name helper: change `isCacheableApiRequest` to an arrow function assigned to a `const` is **not** a fix; instead add `esbuild: { keepNames: false }` to `defineConfig` — and re-run.

- [ ] **Step 6: Write the failing purge tests**

Create `packages/app/src/lib/pwa/purge.test.ts`:

```ts
import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  purgeClientCaches,
  purgeIfSubjectChanged,
  registerPurgeStep,
  resetPurgeStepsForTests,
} from "./purge.js"

function createDb(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1)

    request.onsuccess = () => {
      request.result.close()
      resolve()
    }
    request.onerror = () => reject(request.error)
  })
}

async function dbNames(): Promise<string[]> {
  return (await indexedDB.databases()).map((db) => db.name ?? "")
}

describe("purgeClientCaches", () => {
  const deleted: string[] = []

  beforeEach(() => {
    deleted.length = 0
    resetPurgeStepsForTests()
    vi.stubGlobal("caches", {
      delete: vi.fn((name: string) => {
        deleted.push(name)

        return Promise.resolve(true)
      }),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it("deletes the API cache and the offline media cache", async () => {
    await purgeClientCaches()

    expect(deleted.sort()).toEqual(["pp-api-v1", "pp-offline-media-v1"])
  })

  it("deletes the saved-test database but leaves the answer queue's database alone", async () => {
    await createDb("pp-offline")
    await createDb("pp-answer-queue-sentinel")

    await purgeClientCaches()

    expect(await dbNames()).toEqual(["pp-answer-queue-sentinel"])
  })

  it("runs registered steps and survives one that throws or rejects", async () => {
    const ran = vi.fn()

    registerPurgeStep(() => {
      throw new Error("sync boom")
    })
    registerPurgeStep(() => Promise.reject(new Error("async boom")))
    registerPurgeStep(() => {
      ran()

      return Promise.resolve()
    })

    await expect(purgeClientCaches()).resolves.toBeUndefined()
    expect(ran).toHaveBeenCalledTimes(1)
  })

  it("is idempotent and tolerates a browser with no Cache Storage", async () => {
    vi.unstubAllGlobals()
    vi.stubGlobal("caches", undefined)

    await purgeClientCaches()
    await expect(purgeClientCaches()).resolves.toBeUndefined()
  })
})

describe("purgeIfSubjectChanged", () => {
  const cacheDelete = vi.fn(() => Promise.resolve(true))

  beforeEach(() => {
    resetPurgeStepsForTests()
    cacheDelete.mockClear()
    vi.stubGlobal("caches", { delete: cacheDelete })
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("does not purge on the very first sign-in, but remembers who signed in", async () => {
    await purgeIfSubjectChanged("student-a")

    expect(cacheDelete).not.toHaveBeenCalled()
    expect(localStorage.getItem("pp.last-student")).toBe("student-a")
  })

  it("does not purge when the same student signs in again", async () => {
    await purgeIfSubjectChanged("student-a")
    await purgeIfSubjectChanged("student-a")

    expect(cacheDelete).not.toHaveBeenCalled()
  })

  it("purges when a different student signs in on the same browser", async () => {
    await purgeIfSubjectChanged("student-a")
    await purgeIfSubjectChanged("student-b")

    expect(cacheDelete).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem("pp.last-student")).toBe("student-b")
  })

  it("does nothing when storage throws (private mode) and never rejects", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied")
    })

    await expect(purgeIfSubjectChanged("student-a")).resolves.toBeUndefined()
    vi.restoreAllMocks()
  })
})
```

Run: `pnpm --filter @pp/app exec vitest run src/lib/pwa/purge.test.ts`
Expected: FAIL — `./purge.js` does not exist.

- [ ] **Step 7: Implement `purge.ts`**

Create `packages/app/src/lib/pwa/purge.ts`:

```ts
/**
 * Spec D8 — what a sign-out (or a different student signing in) must wipe
 * from this browser. NOT wiped here: the answer queue and any unsynced
 * attempt journal — unsent answers must survive a sign-out so they flush
 * after the next sign-in (api-client.ts). Later tasks that own other
 * stores add their own step with `registerPurgeStep` instead of editing
 * this file.
 */
const CACHE_NAMES = ["pp-api-v1", "pp-offline-media-v1"] as const
const DATABASE_NAMES = ["pp-offline"] as const
const LAST_STUDENT_KEY = "pp.last-student"

type PurgeStep = () => Promise<void>

let steps: PurgeStep[] = []

export function registerPurgeStep(step: PurgeStep): void {
  steps.push(step)
}

/** Test-only seam. */
export function resetPurgeStepsForTests(): void {
  steps = []
}

async function deleteCaches(): Promise<void> {
  if (typeof caches === "undefined") {
    return
  }

  await Promise.all(CACHE_NAMES.map((name) => caches.delete(name)))
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(name)

      // A blocked delete completes as soon as the other connection closes;
      // waiting on it would stall sign-out, so settle on all three.
      request.onsuccess = () => resolve()
      request.onerror = () => resolve()
      request.onblocked = () => resolve()
    } catch {
      resolve()
    }
  })
}

/** Never rejects; idempotent. */
export async function purgeClientCaches(): Promise<void> {
  await Promise.allSettled([
    deleteCaches(),
    ...DATABASE_NAMES.map(deleteDatabase),
    ...steps.map((step) => Promise.resolve().then(step)),
  ])
}

/**
 * Called after a successful sign-in. A different student on the same
 * browser must not inherit the previous student's cached data even if the
 * previous session ended without a clean sign-out (expired refresh token).
 */
export async function purgeIfSubjectChanged(subject: string): Promise<void> {
  try {
    const previous = globalThis.localStorage.getItem(LAST_STUDENT_KEY)

    globalThis.localStorage.setItem(LAST_STUDENT_KEY, subject)

    if (previous !== null && previous !== subject) {
      await purgeClientCaches()
    }
  } catch {
    // Storage unavailable: nothing to compare against, nothing to purge.
  }
}
```

Run: `pnpm --filter @pp/app exec vitest run src/lib/pwa/purge.test.ts` — Expected: PASS (8 tests).

- [ ] **Step 8: Write the failing auth wiring tests**

Append to the `describe("completeSignIn", …)` block in `packages/app/src/lib/auth.complete-sign-in.test.ts` (it already mocks `session-api.js`; add a mock for the purge module next to the other `vi.mock` calls):

```ts
const { purgeClientCaches, purgeIfSubjectChanged } = vi.hoisted(() => ({
  purgeClientCaches: vi.fn(() => Promise.resolve()),
  purgeIfSubjectChanged: vi.fn(() => Promise.resolve()),
}))

vi.mock("./pwa/purge.js", () => ({ purgeClientCaches, purgeIfSubjectChanged }))
```

```ts
  it("checks for a student change using the established session's id", async () => {
    establishSession.mockResolvedValue({ id: "student-b", created: false })
    const { completeSignIn } = await import("./auth.js")

    await completeSignIn("code")

    expect(purgeIfSubjectChanged).toHaveBeenCalledWith("student-b")
  })

  it("purges client caches on sign-out", async () => {
    const { signOut } = await import("./auth.js")

    signOut()

    expect(purgeClientCaches).toHaveBeenCalledTimes(1)
  })
```

Run: `pnpm --filter @pp/app exec vitest run src/lib/auth.complete-sign-in.test.ts`
Expected: FAIL — `purgeIfSubjectChanged` / `purgeClientCaches` never called.

- [ ] **Step 9: Wire `auth.ts`**

In `packages/app/src/lib/auth.ts` add `import { purgeClientCaches, purgeIfSubjectChanged } from "./pwa/purge.js"`. In `completeSignIn`, replace `return await establishSession()` (inside the `try`) with:

```ts
    const session = await establishSession()

    await purgeIfSubjectChanged(session.id)

    return session
```

and in `signOut()` add after the if/else (so every caller — the library's no-access link, history, the Profile sheet, and the 401 path in `clearSessionAndRedirectToSignIn` — purges):

```ts
  void purgeClientCaches()
```

Run: `pnpm --filter @pp/app exec vitest run src/lib/auth.complete-sign-in.test.ts test/auth.test.ts`
Expected: PASS.

- [ ] **Step 10: Server — failing tests for headers and the SPA-shell predicate**

Create `packages/server/test/spa-static-headers.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { shouldServeSpaShell } from "../src/spa/spa-fallback.filter.js"
import { spaStaticHeaders } from "../src/spa/static-headers.js"

function headersFor(file: string): Record<string, string> {
  const set: Record<string, string> = {}

  spaStaticHeaders({ setHeader: (n, v) => { set[n] = v } }, `/app/public/${file}`, "/app/public")

  return set
}

describe("spaStaticHeaders", () => {
  it.each(["sw.js", "manifest.webmanifest", "index.html", "workbox-3d4e5f.js"])(
    "serves %s with no-cache so an update is seen on the next load",
    (file) => {
      expect(headersFor(file)["Cache-Control"]).toBe("no-cache")
    },
  )

  it("lets the worker control the whole origin", () => {
    expect(headersFor("sw.js")["Service-Worker-Allowed"]).toBe("/")
  })

  it("serves hashed build assets as immutable", () => {
    expect(headersFor("assets/index-9f8e7d.js")["Cache-Control"]).toBe(
      "public, max-age=31536000, immutable",
    )
  })

  it("leaves other files (icons) on the default policy", () => {
    expect(headersFor("pwa-192x192.png")["Cache-Control"]).toBeUndefined()
  })
})

describe("shouldServeSpaShell", () => {
  it("serves the shell for a client route", () => {
    expect(shouldServeSpaShell("GET", "/profile")).toBe(true)
  })

  it.each(["/api/x", "/media/x", "/sw.js", "/manifest.webmanifest", "/workbox-abc123.js"])(
    "does not answer %s with index.html (a worker or manifest request must 404, not parse as HTML)",
    (path) => {
      expect(shouldServeSpaShell("GET", path)).toBe(false)
    },
  )

  it("never serves the shell for a non-GET", () => {
    expect(shouldServeSpaShell("POST", "/profile")).toBe(false)
  })
})
```

Run (needs Docker — the server suite's `globalSetup` starts Postgres): `pnpm --filter @pp/server exec vitest run test/spa-static-headers.test.ts`
Expected: FAIL — module `../src/spa/static-headers.js` not found.

- [ ] **Step 11: Server — implement**

Create `packages/server/src/spa/static-headers.ts`:

```ts
import { basename, relative, sep } from "node:path"

export interface HeaderSink {
  setHeader(name: string, value: string): unknown
}

const REVALIDATE = new Set(["sw.js", "manifest.webmanifest", "index.html"])
const WORKBOX = /^workbox-[\w-]+\.js$/u

/**
 * Cache policy for the built SPA (spec D1). The worker script, its
 * runtime, the manifest and the shell are always revalidated — a worker
 * cached for a day would pin students on an old app for a day. Only
 * hashed files under /assets are immutable.
 */
export function spaStaticHeaders(
  res: HeaderSink,
  filePath: string,
  root: string,
): void {
  const name = basename(filePath)

  if (REVALIDATE.has(name) || WORKBOX.test(name)) {
    res.setHeader("Cache-Control", "no-cache")

    if (name === "sw.js") {
      res.setHeader("Service-Worker-Allowed", "/")
    }

    return
  }

  if (relative(root, filePath).split(sep)[0] === "assets") {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable")
  }
}
```

In `packages/server/src/spa/spa-fallback.filter.ts` add above the class:

```ts
const PWA_FILE = /^\/(?:sw\.js|manifest\.webmanifest|workbox-[\w-]+\.js)$/u

/**
 * A missing worker/manifest must be a real 404: answering `/sw.js` with
 * index.html makes the browser reject registration with a MIME error that
 * is far harder to diagnose than a plain 404.
 */
export function shouldServeSpaShell(method: string, path: string): boolean {
  return (
    method === "GET" &&
    !path.startsWith("/api/") &&
    !path.startsWith("/media/") &&
    !PWA_FILE.test(path)
  )
}
```

and replace the `servesSpa` computation and the `sendFile` call inside `catch`:

```ts
    const servesSpa = shouldServeSpaShell(req.method, req.path)

    if (servesSpa) {
      // Keep hidden ancestors (e.g. .worktrees) outside dotfile checks.
      res.sendFile("index.html", {
        root: this.spaRoot,
        headers: { "Cache-Control": "no-cache" },
      })

      return
    }
```

In `packages/server/src/main.ts` add `import { spaStaticHeaders } from "./spa/static-headers.js"` and change the static mount to:

```ts
    server.use(
      express.static(spaRoot, {
        index: false,
        setHeaders: (res, filePath) => {
          spaStaticHeaders(res, filePath, spaRoot)
        },
      }),
    )
```

- [ ] **Step 12: Server — e2e regression cases and run**

Append inside `describeIfSpaBuilt("SPA serving", …)` in `packages/server/test/spa.e2e.test.ts`:

```ts
  it("serves the worker and manifest as real files with revalidation headers", async () => {
    if (!app) {
      throw new Error("Application failed to initialize")
    }

    const sw = await request(app.http.getHttpServer() as App)
      .get("/sw.js")
      .expect(200)
      .expect("Content-Type", /javascript/)
      .expect("Cache-Control", "no-cache")
    expect(sw.text).not.toContain('<div id="root">')

    await request(app.http.getHttpServer() as App)
      .get("/manifest.webmanifest")
      .expect(200)
      .expect("Content-Type", /manifest\+json|application\/json/)
      .expect("Cache-Control", "no-cache")
  })

  it("marks the shell no-cache and hashed assets immutable", async () => {
    if (!app) {
      throw new Error("Application failed to initialize")
    }

    await request(app.http.getHttpServer() as App)
      .get("/history")
      .expect(200)
      .expect("Cache-Control", "no-cache")

    const assets = await readdir(join(hiddenSpaRoot, "assets"))
    const script = assets.find((asset) => asset.endsWith(".js"))

    await request(app.http.getHttpServer() as App)
      .get(`/assets/${script}`)
      .expect("Cache-Control", /immutable/)
  })

  it("answers a missing worker file with a JSON 404, never the shell", async () => {
    if (!app) {
      throw new Error("Application failed to initialize")
    }

    const res = await request(app.http.getHttpServer() as App)
      .get("/workbox-doesnotexist.js")
      .expect(404)
      .expect("Content-Type", /application\/json/)
    expect(res.body).toMatchObject({ statusCode: 404 })
  })
```

Run: `pnpm --filter @pp/server exec vitest run test/spa-static-headers.test.ts` — Expected: PASS.
Run the e2e against a real build: `pnpm --filter @pp/app build && SPA_ROOT="$PWD/packages/app/dist" pnpm --filter @pp/server exec vitest run test/spa.e2e.test.ts` — Expected: PASS (the suite skips, and so proves nothing, if `SPA_ROOT` is unset).

- [ ] **Step 13: Gates and commit**

Run: `pnpm --filter @pp/app typecheck && pnpm --filter @pp/server exec tsc --noEmit && pnpm exec oxlint packages/app packages/server && pnpm exec prettier --write packages/app/pwa.config.ts packages/app/test packages/app/src/lib/pwa packages/server/src/spa packages/server/test/spa-static-headers.test.ts packages/server/test/spa.e2e.test.ts`
Expected: no errors.

```bash
git add packages/app/pwa.config.ts packages/app/test packages/app/tsconfig.node.json packages/app/src/lib/pwa packages/app/src/lib/auth.ts packages/app/src/lib/auth.complete-sign-in.test.ts packages/server/src/spa packages/server/src/main.ts packages/server/test/spa-static-headers.test.ts packages/server/test/spa.e2e.test.ts
git commit -m "feat(app): allow-listed worker caching, no-cache worker/manifest headers, purge client caches on sign-out"
```

---

### Task 3: Client stores — network, PWA install/update, registration, pending count

**Files:**
- Create: `packages/app/src/lib/network.ts`, `packages/app/src/lib/network.test.ts`
- Create: `packages/app/src/lib/pending-count.ts`, `packages/app/src/lib/pending-count.test.ts`
- Create: `packages/app/src/lib/pwa/pwa-store.ts`, `packages/app/src/lib/pwa/pwa-store.test.ts`
- Create: `packages/app/src/lib/pwa/install-flow.ts`, `packages/app/src/lib/pwa/install-flow.test.ts`
- Create: `packages/app/src/lib/pwa/register.ts`, `packages/app/src/lib/pwa/register.test.ts`
- Create: `packages/app/src/test/virtual-pwa-register.ts`
- Modify: `packages/app/vitest.config.ts`, `packages/app/src/lib/api-client.ts`, `packages/app/src/main.tsx`
- Test: `packages/app/src/lib/api-client.network.test.ts`

**Interfaces:**
- Consumes: `apiFetch` in `lib/api-client.ts` (`const response = await sendRequest(`/api${path}`, init)`); `virtual:pwa-register` (`registerSW`, typed by `vite-plugin-pwa/client`, added to tsconfig `types` in Task 1).
- Produces (all exactly as spec §6 unless noted):
  - `networkStore`, `NetworkSnapshot`; plus `resetNetworkStoreForTests(): void`, `setRecoveryProbeForTests(probe: () => Promise<boolean>): void`.
  - `pwaStore`, `PwaSnapshot`, `PwaPlatform`; plus `createPwaStore(deps)` (factory used by tests).
  - `registerPwa(deps?: Partial<RegisterDeps>): void`.
  - **Contract extensions:** `lib/pending-count.ts` → `pendingCountStore: { subscribe; getSnapshot(): number; set(count: number): void }` (the run page and flush results set it; the layout's browsing banner reads it). `lib/pwa/install-flow.ts` → `startInstall(): Promise<"accepted" | "dismissed" | "show-ios" | "show-manual">` (Library and Profile both call it).

- [ ] **Step 1: Write the failing `networkStore` tests**

Create `packages/app/src/lib/network.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  networkStore,
  resetNetworkStoreForTests,
  setRecoveryProbeForTests,
} from "./network.js"

describe("networkStore", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetNetworkStoreForTests()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("starts online and notifies subscribers only when the value changes", () => {
    const listener = vi.fn()
    const unsubscribe = networkStore.subscribe(listener)

    networkStore.reportFetchSuccess()
    expect(listener).not.toHaveBeenCalled()

    networkStore.reportFetchFailure()
    expect(networkStore.getSnapshot().online).toBe(false)
    expect(listener).toHaveBeenCalledTimes(1)

    networkStore.reportFetchFailure()
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    networkStore.reportFetchSuccess()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("returns a referentially stable snapshot while nothing changed (useSyncExternalStore requirement)", () => {
    expect(networkStore.getSnapshot()).toBe(networkStore.getSnapshot())
  })

  it("goes offline on the browser offline event and recovers on the online event", () => {
    window.dispatchEvent(new Event("offline"))
    expect(networkStore.getSnapshot().online).toBe(false)

    window.dispatchEvent(new Event("online"))
    expect(networkStore.getSnapshot().online).toBe(true)
  })

  it("treats a hard fetch failure as offline even though navigator.onLine is still true, then probes until the server answers", async () => {
    const probe = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)

    setRecoveryProbeForTests(probe)
    networkStore.reportFetchFailure()
    expect(networkStore.getSnapshot().online).toBe(false)

    await vi.advanceTimersByTimeAsync(5000)
    expect(networkStore.getSnapshot().online).toBe(false)

    await vi.advanceTimersByTimeAsync(5000)
    expect(networkStore.getSnapshot().online).toBe(true)
    expect(probe).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(20000)
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it("setOnlineForTests forces the snapshot", () => {
    networkStore.setOnlineForTests(false)
    expect(networkStore.getSnapshot().online).toBe(false)
    networkStore.setOnlineForTests(true)
    expect(networkStore.getSnapshot().online).toBe(true)
  })
})
```

Run: `pnpm --filter @pp/app exec vitest run src/lib/network.test.ts` — Expected: FAIL (`./network.js` missing).

- [ ] **Step 2: Implement `network.ts`**

```ts
export interface NetworkSnapshot {
  readonly online: boolean
}

type Listener = () => void

const PROBE_INTERVAL_MS = 5000

/**
 * `navigator.onLine` only says whether a network interface is up; a phone
 * on captive wifi reports `true` while every request fails. So the store
 * combines the browser signal with what real requests report:
 * `api-client.ts` calls `reportFetchFailure()` when a request rejects with
 * a TypeError and `reportFetchSuccess()` on any response. After a failure
 * it probes `/health` every 5 s (outside /api, so the worker's allow-list
 * and the bearer header are irrelevant) until the server answers.
 */
async function defaultProbe(): Promise<boolean> {
  try {
    const response = await fetch("/health", { cache: "no-store" })

    return response.ok
  } catch {
    return false
  }
}

let browserOnline = true
let failed = false
let snapshot: NetworkSnapshot = { online: true }
let probe: () => Promise<boolean> = defaultProbe
let probeTimer: ReturnType<typeof setInterval> | undefined = undefined
const listeners = new Set<Listener>()

function recompute(): void {
  const next = browserOnline && !failed

  if (next === snapshot.online) {
    return
  }

  snapshot = { online: next }

  for (const listener of [...listeners]) {
    listener()
  }
}

function stopProbe(): void {
  if (probeTimer !== undefined) {
    clearInterval(probeTimer)
    probeTimer = undefined
  }
}

function startProbe(): void {
  if (probeTimer !== undefined) {
    return
  }

  probeTimer = setInterval(() => {
    void probe().then((ok) => {
      if (ok) {
        networkStore.reportFetchSuccess()
      }
    })
  }, PROBE_INTERVAL_MS)
}

export const networkStore = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener)

    return () => {
      listeners.delete(listener)
    }
  },
  getSnapshot(): NetworkSnapshot {
    return snapshot
  },
  reportFetchFailure(): void {
    failed = true
    startProbe()
    recompute()
  },
  reportFetchSuccess(): void {
    failed = false
    stopProbe()
    recompute()
  },
  setOnlineForTests(online: boolean): void {
    browserOnline = online
    failed = false
    stopProbe()
    recompute()
  },
}

export function setRecoveryProbeForTests(next: () => Promise<boolean>): void {
  probe = next
}

export function resetNetworkStoreForTests(): void {
  stopProbe()
  browserOnline = true
  failed = false
  probe = defaultProbe
  snapshot = { online: true }
  listeners.clear()
}

if (typeof window !== "undefined") {
  browserOnline = navigator.onLine
  snapshot = { online: browserOnline }
  window.addEventListener("online", () => {
    browserOnline = true
    failed = false
    stopProbe()
    recompute()
  })
  window.addEventListener("offline", () => {
    browserOnline = false
    recompute()
  })
}
```

Run: `pnpm --filter @pp/app exec vitest run src/lib/network.test.ts` — Expected: PASS (5 tests).

- [ ] **Step 3: `apiFetch` reports connectivity — failing test**

Create `packages/app/src/lib/api-client.network.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { apiFetch, resetApiClientForTests } from "./api-client.js"
import { resetAuthClientForTests } from "./auth.js"
import { networkStore, resetNetworkStoreForTests } from "./network.js"
import { tokenStore } from "./tokenStore.js"

describe("apiFetch connectivity reporting", () => {
  beforeEach(() => {
    tokenStore.clear()
    resetAuthClientForTests()
    resetApiClientForTests()
    resetNetworkStoreForTests()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetNetworkStoreForTests()
  })

  it("marks the network down when the request itself rejects, and rethrows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch")),
    )

    await expect(apiFetch("/tests")).rejects.toBeInstanceOf(TypeError)
    expect(networkStore.getSnapshot().online).toBe(false)
  })

  it("marks the network up again on any response, including an error status", async () => {
    networkStore.reportFetchFailure()
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ type: "x", title: "x", status: 409 }), {
          status: 409,
          headers: { "content-type": "application/json" },
        }),
      ),
    )

    await expect(apiFetch("/tests")).rejects.toMatchObject({ problem: { status: 409 } })
    expect(networkStore.getSnapshot().online).toBe(true)
  })

  it("does not blame the network for a non-network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValue(new Error("something else")),
    )

    await expect(apiFetch("/tests")).rejects.toThrow("something else")
    expect(networkStore.getSnapshot().online).toBe(true)
  })
})
```

Run: `pnpm --filter @pp/app exec vitest run src/lib/api-client.network.test.ts` — Expected: FAIL (first test: snapshot still online).

- [ ] **Step 4: Report from `apiFetch`**

In `packages/app/src/lib/api-client.ts` add `import { networkStore } from "./network.js"` and replace the single line `const response = await sendRequest(`/api${path}`, init)` inside `apiFetch` with:

```ts
  let response: Response

  try {
    response = await sendRequest(`/api${path}`, init)
  } catch (error) {
    // `fetch` rejects with a TypeError when the request could not be made at
    // all (offline, DNS, refused). Anything else is not a connectivity fact.
    if (error instanceof TypeError) {
      networkStore.reportFetchFailure()
    }

    throw error
  }

  networkStore.reportFetchSuccess()
```

Run: `pnpm --filter @pp/app exec vitest run src/lib/api-client.network.test.ts src/lib/api-client.test.ts test/flushHttp.test.ts test/answer-queue-survives-401.test.ts`
Expected: PASS (existing suites unchanged — a rejected fetch still reaches `apiFlushHttp` as `network-error`).

- [ ] **Step 5: Write the failing `pendingCountStore` test, then implement**

Create `packages/app/src/lib/pending-count.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { pendingCountStore } from "./pending-count.js"

describe("pendingCountStore", () => {
  it("holds the number of answers waiting to be sent and notifies on change only", () => {
    const listener = vi.fn()
    const unsubscribe = pendingCountStore.subscribe(listener)

    pendingCountStore.set(0)
    expect(listener).not.toHaveBeenCalled()

    pendingCountStore.set(3)
    expect(pendingCountStore.getSnapshot()).toBe(3)
    expect(listener).toHaveBeenCalledTimes(1)

    pendingCountStore.set(-2)
    expect(pendingCountStore.getSnapshot()).toBe(0)

    unsubscribe()
    pendingCountStore.set(5)
    expect(listener).toHaveBeenCalledTimes(2)
    pendingCountStore.set(0)
  })
})
```

Run it — FAIL (module missing). Create `packages/app/src/lib/pending-count.ts`:

```ts
type Listener = () => void

let count = 0
const listeners = new Set<Listener>()

/**
 * How many answers are durable on this device but not yet acknowledged.
 * Written by whoever owns the flush (the run screen); read by the app
 * layout's offline banner so "Waiting to be sent: N" can show on any screen.
 */
export const pendingCountStore = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener)

    return () => {
      listeners.delete(listener)
    }
  },
  getSnapshot(): number {
    return count
  },
  set(next: number): void {
    const clamped = Math.max(0, Math.floor(next))

    if (clamped === count) {
      return
    }

    count = clamped

    for (const listener of [...listeners]) {
      listener()
    }
  },
}
```

Run it — PASS.

- [ ] **Step 6: Write the failing `pwaStore` tests**

Create `packages/app/src/lib/pwa/pwa-store.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createPwaStore, detectPlatform } from "./pwa-store.js"

interface FakeWindow {
  navigator: { userAgent: string; maxTouchPoints: number; standalone?: boolean }
  matchMedia: (query: string) => {
    matches: boolean
    addEventListener: (type: string, fn: () => void) => void
  }
  addEventListener: (type: string, fn: (event: Event) => void) => void
  dispatch: (type: string, event?: Event) => void
}

function fakeWindow(options: { ua?: string; standalone?: boolean; touch?: number } = {}): FakeWindow {
  const handlers = new Map<string, Array<(event: Event) => void>>()

  return {
    navigator: {
      userAgent: options.ua ?? "Mozilla/5.0 (Linux; Android 14) Chrome/130",
      maxTouchPoints: options.touch ?? 5,
    },
    matchMedia: () => ({
      matches: options.standalone ?? false,
      addEventListener: () => undefined,
    }),
    addEventListener: (type, fn) => {
      handlers.set(type, [...(handlers.get(type) ?? []), fn])
    },
    dispatch: (type, event = new Event(type)) => {
      for (const fn of handlers.get(type) ?? []) {
        fn(event)
      }
    },
  }
}

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> & { data: Map<string, string> } {
  const data = new Map<string, string>()

  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
  }
}

function installEvent(outcome: "accepted" | "dismissed") {
  const event = new Event("beforeinstallprompt") as Event & {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
  }

  event.prompt = vi.fn(() => Promise.resolve())
  event.userChoice = Promise.resolve({ outcome })

  return event
}

describe("detectPlatform", () => {
  it.each([
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", 5, "ios"],
    ["Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", 5, "ios"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5, "ios"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0, "other"],
    ["Mozilla/5.0 (Linux; Android 14) Chrome/130", 5, "android"],
    ["Mozilla/5.0 (Windows NT 10.0) Chrome/130", 0, "other"],
  ])("%s (touch %i) → %s", (ua, touch, expected) => {
    expect(detectPlatform(ua, touch)).toBe(expected)
  })
})

describe("pwaStore", () => {
  let storage: ReturnType<typeof memoryStorage>

  beforeEach(() => {
    storage = memoryStorage()
  })

  it("is not standalone in a browser tab and standalone when launched from the home screen", () => {
    expect(createPwaStore({ win: fakeWindow(), storage }).getSnapshot().standalone).toBe(false)
    expect(
      createPwaStore({ win: fakeWindow({ standalone: true }), storage }).getSnapshot().standalone,
    ).toBe(true)

    const ios = fakeWindow({ ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" })

    ios.navigator.standalone = true
    expect(createPwaStore({ win: ios, storage }).getSnapshot().standalone).toBe(true)
  })

  it("captures beforeinstallprompt, prompts on demand and reports the user's choice", async () => {
    const win = fakeWindow()
    const store = createPwaStore({ win, storage })
    const event = installEvent("accepted")

    expect(store.getSnapshot().canPromptInstall).toBe(false)
    await expect(store.promptInstall()).resolves.toBe("unavailable")

    win.dispatch("beforeinstallprompt", event)
    expect(store.getSnapshot().canPromptInstall).toBe(true)
    expect(event.defaultPrevented).toBe(true)

    await expect(store.promptInstall()).resolves.toBe("accepted")
    expect(event.prompt).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().canPromptInstall).toBe(false)
  })

  it("flips to standalone on appinstalled", () => {
    const win = fakeWindow()
    const store = createPwaStore({ win, storage })

    win.dispatch("appinstalled")
    expect(store.getSnapshot().standalone).toBe(true)
  })

  it("remembers Not now across loads, and markInstalled also dismisses the card", () => {
    const first = createPwaStore({ win: fakeWindow(), storage })

    expect(first.getSnapshot().installDismissed).toBe(false)
    first.dismissInstall()
    expect(storage.data.get("pp.install.dismissed")).toBe("1")
    expect(createPwaStore({ win: fakeWindow(), storage }).getSnapshot().installDismissed).toBe(true)

    const second = createPwaStore({ win: fakeWindow(), storage: memoryStorage() })

    second.markInstalled()
    expect(second.getSnapshot().installDismissed).toBe(true)
  })

  it("works when storage is unavailable or throws", () => {
    const store = createPwaStore({ win: fakeWindow(), storage: null })

    expect(() => store.dismissInstall()).not.toThrow()
    expect(store.getSnapshot().installDismissed).toBe(true)

    const throwing = {
      getItem: () => {
        throw new Error("denied")
      },
      setItem: () => {
        throw new Error("denied")
      },
    }

    expect(createPwaStore({ win: fakeWindow(), storage: throwing }).getSnapshot().installDismissed).toBe(false)
  })

  it("holds an update until applied, then runs the supplied apply function once", async () => {
    const store = createPwaStore({ win: fakeWindow(), storage })
    const apply = vi.fn(() => Promise.resolve())
    const listener = vi.fn()

    store.subscribe(listener)
    expect(store.getSnapshot().updateReady).toBe(false)

    store.setUpdateReady(apply)
    expect(store.getSnapshot().updateReady).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)

    await store.applyUpdate()
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it("applyUpdate with nothing waiting is a no-op", async () => {
    const store = createPwaStore({ win: fakeWindow(), storage })

    await expect(store.applyUpdate()).resolves.toBeUndefined()
  })

  it("keeps the snapshot object stable between changes", () => {
    const store = createPwaStore({ win: fakeWindow(), storage })

    expect(store.getSnapshot()).toBe(store.getSnapshot())
  })
})
```

Run: `pnpm --filter @pp/app exec vitest run src/lib/pwa/pwa-store.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 7: Implement `pwa-store.ts`**

```ts
export type PwaPlatform = "ios" | "android" | "other"

export interface PwaSnapshot {
  readonly standalone: boolean
  readonly canPromptInstall: boolean
  readonly platform: PwaPlatform
  readonly installDismissed: boolean
  readonly updateReady: boolean
}

type Listener = () => void

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  readonly userChoice: Promise<{ readonly outcome: "accepted" | "dismissed" }>
}

export interface PwaStoreDeps {
  readonly win: {
    readonly navigator: {
      readonly userAgent: string
      readonly maxTouchPoints: number
      readonly standalone?: boolean
    }
    matchMedia(query: string): {
      readonly matches: boolean
      addEventListener(type: string, listener: () => void): void
    }
    addEventListener(type: string, listener: (event: Event) => void): void
  }
  readonly storage: Pick<Storage, "getItem" | "setItem"> | null
}

const DISMISS_KEY = "pp.install.dismissed"

export function detectPlatform(userAgent: string, maxTouchPoints: number): PwaPlatform {
  if (/iPhone|iPad|iPod/u.test(userAgent)) {
    return "ios"
  }

  // iPadOS 13+ reports a desktop Mac UA; only touch tells them apart.
  if (/Macintosh/u.test(userAgent) && maxTouchPoints > 1) {
    return "ios"
  }

  return /Android/u.test(userAgent) ? "android" : "other"
}

export function createPwaStore({ win, storage }: PwaStoreDeps) {
  const listeners = new Set<Listener>()
  let deferred: InstallPromptEvent | null = null
  let applyFn: (() => Promise<void>) | null = null
  let installedLive = false

  const readDismissed = (): boolean => {
    try {
      return storage?.getItem(DISMISS_KEY) === "1"
    } catch {
      return false
    }
  }

  const standaloneNow = (): boolean =>
    installedLive ||
    win.matchMedia("(display-mode: standalone)").matches ||
    win.navigator.standalone === true

  const platform = detectPlatform(win.navigator.userAgent, win.navigator.maxTouchPoints)
  let dismissed = readDismissed()
  let snapshot: PwaSnapshot = build()

  function build(): PwaSnapshot {
    return {
      standalone: standaloneNow(),
      canPromptInstall: deferred !== null,
      platform,
      installDismissed: dismissed,
      updateReady: applyFn !== null,
    }
  }

  function publish(): void {
    const next = build()

    if (
      next.standalone === snapshot.standalone &&
      next.canPromptInstall === snapshot.canPromptInstall &&
      next.installDismissed === snapshot.installDismissed &&
      next.updateReady === snapshot.updateReady
    ) {
      return
    }

    snapshot = next

    for (const listener of [...listeners]) {
      listener()
    }
  }

  win.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault()
    deferred = event as InstallPromptEvent
    publish()
  })
  win.addEventListener("appinstalled", () => {
    installedLive = true
    deferred = null
    publish()
  })
  win.matchMedia("(display-mode: standalone)").addEventListener("change", publish)

  const remember = (): void => {
    dismissed = true

    try {
      storage?.setItem(DISMISS_KEY, "1")
    } catch {
      // Storage unavailable: the card stays dismissed for this page load only.
    }

    publish()
  }

  return {
    subscribe(listener: Listener): () => void {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot(): PwaSnapshot {
      return snapshot
    },
    async promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
      if (!deferred) {
        return "unavailable"
      }

      const event = deferred

      deferred = null
      publish()
      await event.prompt()

      return (await event.userChoice).outcome
    },
    /** iOS "I've added it": the app cannot detect the install, so it only hides the card. */
    markInstalled(): void {
      remember()
    },
    dismissInstall(): void {
      remember()
    },
    setUpdateReady(apply: () => Promise<void>): void {
      applyFn = apply
      publish()
    },
    async applyUpdate(): Promise<void> {
      await applyFn?.()
    },
  }
}

function browserStore(): ReturnType<typeof createPwaStore> {
  if (typeof window === "undefined") {
    throw new Error("pwaStore is browser-only")
  }

  let storage: Storage | null = null

  try {
    storage = window.localStorage
  } catch {
    storage = null
  }

  return createPwaStore({ win: window, storage })
}

export const pwaStore: ReturnType<typeof createPwaStore> = browserStore()
```

Run: `pnpm --filter @pp/app exec vitest run src/lib/pwa/pwa-store.test.ts` — Expected: PASS (all). If jsdom lacks `matchMedia` for the singleton at import time, add to `packages/app/src/test/setup.ts`:

```ts
if (typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
      onchange: null,
    }) as MediaQueryList
}
```

- [ ] **Step 8: Write the failing `startInstall` test, then implement**

Create `packages/app/src/lib/pwa/install-flow.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import type { PwaSnapshot } from "./pwa-store.js"
import { startInstall } from "./install-flow.js"

function store(snapshot: Partial<PwaSnapshot>, outcome: "accepted" | "dismissed" | "unavailable" = "accepted") {
  return {
    getSnapshot: () =>
      ({
        standalone: false,
        canPromptInstall: false,
        platform: "other",
        installDismissed: false,
        updateReady: false,
        ...snapshot,
      }) as PwaSnapshot,
    promptInstall: vi.fn(() => Promise.resolve(outcome)),
  }
}

describe("startInstall", () => {
  it("uses the browser's own prompt when it is available", async () => {
    const s = store({ canPromptInstall: true, platform: "android" }, "dismissed")

    await expect(startInstall(s)).resolves.toBe("dismissed")
    expect(s.promptInstall).toHaveBeenCalledTimes(1)
  })

  it("shows the Share-menu steps on iOS Safari (no prompt exists)", async () => {
    const s = store({ platform: "ios" })

    await expect(startInstall(s)).resolves.toBe("show-ios")
    expect(s.promptInstall).not.toHaveBeenCalled()
  })

  it("shows manual steps when a Chromium browser has no prompt to offer (already used or unsupported)", async () => {
    await expect(startInstall(store({ platform: "android" }))).resolves.toBe("show-manual")
    await expect(startInstall(store({ platform: "other" }))).resolves.toBe("show-manual")
  })

  it("falls back to manual steps if the captured prompt turns out to be gone", async () => {
    await expect(
      startInstall(store({ canPromptInstall: true, platform: "android" }, "unavailable")),
    ).resolves.toBe("show-manual")
  })
})
```

Run — FAIL (module missing). Create `packages/app/src/lib/pwa/install-flow.ts`:

```ts
import { pwaStore, type PwaSnapshot } from "./pwa-store.js"

export type InstallStep = "accepted" | "dismissed" | "show-ios" | "show-manual"

interface InstallSource {
  getSnapshot(): PwaSnapshot
  promptInstall(): Promise<"accepted" | "dismissed" | "unavailable">
}

/**
 * What "Install" does on this browser (spec D2). The prototype's Android
 * sheet only simulated Chrome's own prompt, so on Chromium this calls the
 * real one; iOS has none and needs the Share-menu steps.
 */
export async function startInstall(
  source: InstallSource = pwaStore,
): Promise<InstallStep> {
  const snapshot = source.getSnapshot()

  if (snapshot.canPromptInstall) {
    const outcome = await source.promptInstall()

    if (outcome === "accepted" || outcome === "dismissed") {
      return outcome
    }
  }

  return snapshot.platform === "ios" ? "show-ios" : "show-manual"
}
```

Run — PASS (4 tests).

- [ ] **Step 9: Write the failing registration test, add the virtual-module stub, implement `register.ts`**

Create `packages/app/src/test/virtual-pwa-register.ts` (Vitest cannot resolve a virtual module; this stub is only reachable if a test imports the default loader):

```ts
export function registerSW(): (reloadPage?: boolean) => Promise<void> {
  return () => Promise.resolve()
}
```

In `packages/app/vitest.config.ts` add the alias:

```ts
import { fileURLToPath } from "node:url"
// …
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "virtual:pwa-register": fileURLToPath(
        new URL("./src/test/virtual-pwa-register.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
})
```

Create `packages/app/src/lib/pwa/register.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { registerPwa } from "./register.js"

type Options = { immediate?: boolean; onNeedRefresh?: () => void; onRegisterError?: (e: unknown) => void }

function setup(enabled = true) {
  const update = vi.fn(() => Promise.resolve())
  let captured: Options = {}
  const registerSW = vi.fn((options: Options) => {
    captured = options

    return update
  })
  const store = { setUpdateReady: vi.fn() }

  registerPwa({
    enabled,
    loadRegister: () => Promise.resolve(registerSW),
    store,
  })

  return { registerSW, update, store, options: () => captured }
}

describe("registerPwa", () => {
  it("registers immediately and publishes an update that applies with a reload", async () => {
    const { registerSW, update, store, options } = setup()

    await vi.waitFor(() => expect(registerSW).toHaveBeenCalledTimes(1))
    expect(options().immediate).toBe(true)

    options().onNeedRefresh?.()
    expect(store.setUpdateReady).toHaveBeenCalledTimes(1)

    const apply = store.setUpdateReady.mock.calls[0]?.[0] as () => Promise<void>

    await apply()
    expect(update).toHaveBeenCalledWith(true)
  })

  it("does nothing outside a production build (dev has no worker)", async () => {
    const { registerSW } = setup(false)

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(registerSW).not.toHaveBeenCalled()
  })

  it("never throws when the registration module fails to load", async () => {
    expect(() =>
      registerPwa({
        enabled: true,
        loadRegister: () => Promise.reject(new Error("no worker")),
        store: { setUpdateReady: vi.fn() },
      }),
    ).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
})
```

Run — FAIL. Create `packages/app/src/lib/pwa/register.ts`:

```ts
import { pwaStore } from "./pwa-store.js"

type RegisterSW = (options: {
  immediate?: boolean
  onNeedRefresh?: () => void
  onRegisterError?: (error: unknown) => void
}) => (reloadPage?: boolean) => Promise<void>

export interface RegisterDeps {
  readonly enabled: boolean
  readonly loadRegister: () => Promise<RegisterSW>
  readonly store: { setUpdateReady(apply: () => Promise<void>): void }
}

const loadVirtualRegister = async (): Promise<RegisterSW> =>
  (await import("virtual:pwa-register")).registerSW

/**
 * Registers the service worker (production builds only) and hands a waiting
 * update to `pwaStore`. The worker never activates itself (`registerType:
 * "prompt"`); `applyUpdate()` → `update(true)` does, from the Refresh button
 * or the Profile row, never during a test (layout defers the banner).
 */
export function registerPwa(deps: Partial<RegisterDeps> = {}): void {
  const {
    enabled = import.meta.env.PROD,
    loadRegister = loadVirtualRegister,
    store = pwaStore,
  } = deps

  if (!enabled) {
    return
  }

  loadRegister()
    .then((registerSW) => {
      const update = registerSW({
        immediate: true,
        onNeedRefresh() {
          store.setUpdateReady(() => update(true))
        },
        onRegisterError() {
          // No worker means no offline shell, not a broken app.
        },
      })
    })
    .catch(() => undefined)
}
```

In `packages/app/src/main.tsx` add `import { registerPwa } from "@pp/app/lib/pwa/register"` and call `registerPwa()` on the line before `createRoot(root).render(`.

Run: `pnpm --filter @pp/app exec vitest run src/lib && pnpm --filter @pp/app typecheck && pnpm exec oxlint packages/app && pnpm exec prettier --write packages/app/src/lib packages/app/src/test packages/app/vitest.config.ts packages/app/src/main.tsx`
Expected: tests PASS; typecheck/lint clean.

- [ ] **Step 10: Commit**

```bash
git add packages/app/src/lib packages/app/src/test packages/app/vitest.config.ts packages/app/src/main.tsx
git commit -m "feat(app): network, install/update and pending-count stores; register the service worker in production"
```

---

### Task 4: Shell primitives — tokens/CSS, `Icon`, `BottomSheet`, toasts, `TabBar`, banners, splash, `AppLayout`

**Files:**
- Modify: `packages/app/src/index.css`
- Create: `packages/app/src/components/Icon.tsx`, `packages/app/src/components/Icon.test.tsx`
- Create: `packages/app/src/components/BottomSheet.tsx`, `packages/app/src/components/BottomSheet.test.tsx`
- Create: `packages/app/src/lib/toast.ts`, `packages/app/src/lib/toast.test.ts`
- Create: `packages/app/src/components/ToastHost.tsx`, `packages/app/src/components/ToastHost.test.tsx`
- Create: `packages/app/src/lib/shell-routes.ts`, `packages/app/src/lib/shell-routes.test.ts`
- Create: `packages/app/src/components/TabBar.tsx`, `packages/app/src/components/TabBar.test.tsx`
- Create: `packages/app/src/components/Banners.tsx`, `packages/app/src/components/Banners.test.tsx`
- Create: `packages/app/src/components/Splash.tsx`, `packages/app/src/components/Splash.test.tsx`
- Modify: `packages/app/src/pages/layout.tsx`, `packages/app/src/pages/layout.test.tsx`
- Modify (strings needed before tests can render real text): see Step 1 — this task adds a **minimal** key subset; Task 5 completes all six locales.

**Interfaces:**
- Consumes: `networkStore`, `pwaStore`, `pendingCountStore` (Task 3); `@radix-ui` `Dialog` via `import { Dialog } from "radix-ui"` (same as `DeviceSheet.tsx`); `useRouter`, `useRouterState` from `@tanstack/react-router`.
- Produces (binding for other parts):
  - `Icon { name: IconName; small?: boolean }`, `type IconName` — **contract extension** (prototype's `P` icon set; Parts B/C reuse it).
  - `BottomSheet`, `TabBar` (**contract extension:** extra prop `onNavigate: (tab: ShellTab) => void`), `OfflineBanner`, `UpdateBanner`, `InstallCard`, `Splash`, `ToastHost { toast: ToastSnapshot | null }`.
  - `toastStore`, `ToastIcon`, `ToastSnapshot` (spec §6).
  - `lib/shell-routes.ts`: `ShellTab`, `tabForPath(pathname): ShellTab | null`, `isAttemptPath(pathname): boolean`, `TAB_HREF: Record<ShellTab, string>`.
  - CSS vocabulary (prototype names): `.btn` (+`.secondary .ghost .danger .sm .block`), `.chip` (+`.teal .good .bad .warn .clay`), `.card` (+`.hl`), `.avatar`, `.iconbtn`, `svg.i`, `.eyebrow`, `.reason`, `.grow`, `.list`, `.li`, `.switch`, `.banner` (+`.off .upd`), `.install`, `.tabbar`, `.toast`, `.splash`, `.bsheet*`, `.steps`, `.btnrow`, `.app-shell--column`, `.app-shell--tabs`.

- [ ] **Step 1: Add the minimal English strings the shell components render**

Task 5 adds the final, translated catalogue for all six locales. Tests in this task render real English text, so add these keys to `packages/app/src/locales/en/runner.json` **now** (append before the closing brace, keeping the file's flat dotted-key style), and the identical keys with the same English values to `de es fr it ja` `runner.json` (Task 5 overwrites the non-English values with translations):

```json
  "tabs.nav": "Main",
  "tabs.library": "Library",
  "tabs.history": "History",
  "tabs.profile": "Profile",
  "pwa.sheet.close": "Close",
  "pwa.install.title": "Add Primary Practice to your home screen",
  "pwa.install.body": "Opens full screen, keeps your tests ready offline, and never loses an answer.",
  "pwa.install.button": "Install",
  "pwa.install.notNow": "Not now",
  "pwa.update.ready": "A new version is ready.",
  "pwa.update.refresh": "Refresh",
  "pwa.update.deferred": "A new version is ready. It will install after you finish this test.",
  "pwa.offline.browsing": "You're offline. Showing what is saved on this phone.",
  "pwa.offline.inTest": "You're offline. Keep answering — your answers are saved on this phone and will be sent when you reconnect.",
  "pwa.offline.waiting": "Waiting to be sent: {{count}}",
  "pwa.live.offline": "You are offline. Answers will be saved on this phone.",
  "pwa.live.online": "Back online."
```

Run: `pnpm --filter @pp/app exec vitest run src/locales/locale-parity.test.ts` — Expected: PASS.

- [ ] **Step 2: Port the tokens and shell CSS**

First confirm none of the new selectors already exist in `index.css`:

Run: `grep -nE "^\s*\.(btn|chip|card|avatar|iconbtn|eyebrow|reason|grow|list|li|switch|banner|install|tabbar|toast|splash|steps|btnrow|bsheet[a-z-]*)\b|svg\.i\b" packages/app/src/index.css`
Expected: no output. If a selector prints, rename the new one with a `pw-` prefix in this step **and** in the components below, and note it in the commit message.

In the `@theme { … }` block of `packages/app/src/index.css`, set the prototype's contrast-corrected values and add the two new tokens (prototype `:root` in `docs/prototype/pwa-mobile.html`; these three darker values are what the prototype actually ships):

```css
  --color-ink-2: #4b5966;
  --color-good: #1f7a43;
  --color-bad: #b53a34;
  --color-teal-d: #0b5a63;
  --color-amber-bg: #fdf3df;
```

Append inside the existing `@layer components { … }` block (before its closing brace). Values are copied from the prototype's `<style>`:

```css
  /* ───── Prototype shell vocabulary (docs/prototype/pwa-mobile.html) ───── */
  .grow {
    flex: 1;
  }
  .eyebrow {
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--color-ink-2);
  }
  .reason {
    font-size: 13px;
    color: var(--color-ink-2);
    margin-top: 6px;
  }
  svg.i {
    width: 22px;
    height: 22px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    flex: none;
  }
  svg.i.sm {
    width: 16px;
    height: 16px;
  }
  .avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--color-teal);
    color: #fff;
    display: grid;
    place-items: center;
    font-weight: 800;
    font-size: 14px;
  }
  .iconbtn {
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: 12px;
    background: transparent;
    display: grid;
    place-items: center;
    color: var(--color-ink);
    cursor: pointer;
  }
  .iconbtn:active {
    background: var(--color-surface);
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 48px;
    padding: 10px 18px;
    border-radius: 14px;
    border: 2px solid var(--color-teal);
    background: var(--color-teal);
    color: #fff;
    font-weight: 800;
    font-size: 16px;
    text-decoration: none;
    text-align: center;
    cursor: pointer;
    touch-action: manipulation;
  }
  .btn:hover {
    background: var(--color-teal-d);
  }
  .btn.secondary {
    background: var(--color-paper);
    color: var(--color-teal);
  }
  .btn.secondary:hover {
    background: var(--color-teal-bg);
  }
  .btn.ghost {
    background: transparent;
    border-color: transparent;
    color: var(--color-teal);
  }
  .btn.danger {
    background: var(--color-bad);
    border-color: var(--color-bad);
  }
  .btn.sm {
    min-height: 44px;
    padding: 6px 14px;
    font-size: 14px;
  }
  .btn.block {
    width: 100%;
  }
  .btn[disabled],
  .btn[aria-disabled="true"] {
    background: #e8edf1;
    border-color: #e8edf1;
    color: #5d6a76;
    cursor: not-allowed;
  }
  .btn[aria-busy="true"]::after {
    content: "";
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 3px solid currentColor;
    border-right-color: transparent;
    animation: pw-spin 0.8s linear infinite;
  }
  @keyframes pw-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .card {
    background: var(--color-paper);
    border: 1.5px solid var(--color-line);
    border-radius: 16px;
    padding: 14px;
  }
  .card.hl {
    border-color: var(--color-teal);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 10px;
    border-radius: 99px;
    font-size: 12.5px;
    font-weight: 800;
    background: var(--color-surface);
    color: var(--color-ink-2);
    border: 1px solid var(--color-line);
  }
  .chip.teal {
    background: var(--color-teal-bg);
    color: var(--color-teal-d);
    border-color: transparent;
  }
  .chip.good {
    background: var(--color-good-bg);
    color: var(--color-good);
    border-color: transparent;
  }
  .chip.bad {
    background: var(--color-bad-bg);
    color: var(--color-bad);
    border-color: transparent;
  }
  .chip.warn {
    background: var(--color-amber-bg);
    color: #7a4d00;
    border-color: transparent;
  }
  .chip.clay {
    background: var(--color-clay-bg);
    color: var(--color-clay);
    border-color: transparent;
  }

  .list {
    background: var(--color-paper);
    border: 1.5px solid var(--color-line);
    border-radius: 16px;
    overflow: hidden;
  }
  .list > * + * {
    border-top: 1px solid var(--color-line);
  }
  .li {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 60px;
    padding: 8px 14px;
    width: 100%;
    background: none;
    border: 0;
    text-align: left;
  }
  .li .t {
    flex: 1;
    font-weight: 800;
  }
  .li .t small {
    display: block;
    font-weight: 600;
    color: var(--color-ink-2);
    font-size: 13px;
  }
  .li .ticon {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    display: grid;
    place-items: center;
    background: var(--color-teal-bg);
    color: var(--color-teal);
    flex: none;
  }
  .switch {
    position: relative;
    width: 52px;
    height: 32px;
    flex: none;
  }
  .switch input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    margin: 0;
    cursor: pointer;
  }
  .switch i {
    position: absolute;
    inset: 0;
    border-radius: 99px;
    background: #b7c2cb;
    transition: background 0.15s;
  }
  .switch i::after {
    content: "";
    position: absolute;
    top: 3px;
    left: 3px;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.15s;
  }
  .switch input:checked + i {
    background: var(--color-teal);
  }
  .switch input:checked + i::after {
    transform: translateX(20px);
  }
  .switch input:focus-visible + i {
    outline: 3px solid var(--color-teal);
    outline-offset: 2px;
  }
  .switch input:disabled {
    cursor: not-allowed;
  }
  .switch input:disabled + i {
    opacity: 0.5;
  }

  .banner {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 10px 14px;
    font-size: 14px;
    font-weight: 600;
  }
  .banner.off {
    background: #2b3540;
    color: #fff;
  }
  .banner.upd {
    background: var(--color-teal-bg);
    color: var(--color-teal-d);
  }
  .banner .btn {
    min-height: 44px;
    padding: 2px 12px;
    font-size: 13px;
    border-radius: 10px;
  }
  .install {
    background: var(--color-teal-bg);
    border-color: transparent;
  }
  .install p {
    font-size: 14px;
    color: var(--color-ink-2);
    margin: 2px 0 0;
  }
  .install .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
  }

  /* App column and tab bar: phone width is the design; wider screens centre a 520px column. */
  .app-shell--column {
    max-width: 520px;
    margin-inline: auto;
  }
  .app-shell--tabs {
    padding-bottom: 60px;
  }
  .tabbar {
    position: fixed;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    width: min(100%, 520px);
    z-index: 40;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    background: var(--color-paper);
    border-top: 1px solid var(--color-line);
    padding-bottom: env(safe-area-inset-bottom);
  }
  .tabbar a {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 8px 4px;
    min-height: 60px;
    text-decoration: none;
    color: var(--color-ink-2);
    font-size: 12px;
    font-weight: 700;
    position: relative;
  }
  .tabbar a[aria-current="page"] {
    color: var(--color-teal);
  }
  .tabbar a[aria-current="page"]::before {
    content: "";
    position: absolute;
    top: 0;
    left: 30%;
    right: 30%;
    height: 3px;
    border-radius: 0 0 3px 3px;
    background: var(--color-teal);
  }
  .tabbar a:focus-visible {
    outline: 3px solid var(--color-teal);
    outline-offset: -3px;
  }

  .toast {
    position: fixed;
    left: 12px;
    right: 12px;
    max-width: 496px;
    margin-inline: auto;
    bottom: calc(76px + env(safe-area-inset-bottom));
    z-index: 80;
    background: #1c2530;
    color: #fff;
    padding: 12px 14px;
    border-radius: 14px;
    font-weight: 700;
    font-size: 14px;
    display: flex;
    gap: 10px;
    align-items: center;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    animation: pw-toast-in 0.2s ease-out;
  }
  @keyframes pw-toast-in {
    from {
      transform: translateY(10px);
      opacity: 0;
    }
  }

  .splash {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: var(--color-teal);
    color: #fff;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 14px;
    transition:
      opacity 0.35s,
      visibility 0s;
  }
  .splash[data-visible="false"] {
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition:
      opacity 0.35s,
      visibility 0s 0.35s;
  }
  .splash .logo {
    width: 84px;
    height: 84px;
    border-radius: 24px;
    background: #fff;
    color: var(--color-teal);
    display: grid;
    place-items: center;
    font-weight: 800;
    font-size: 40px;
  }
  .splash b {
    font-size: 22px;
  }

  .bsheet-overlay {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: rgba(16, 22, 28, 0.45);
  }
  .bsheet {
    position: fixed;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    z-index: 70;
    width: min(100vw, 520px);
    max-height: 86dvh;
    overflow: auto;
    background: var(--color-paper);
    color: var(--color-ink);
    border-radius: 24px 24px 0 0;
    box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.2);
    padding: 6px 18px calc(18px + env(safe-area-inset-bottom));
    animation: pw-sheet-up 0.22s ease-out;
  }
  @keyframes pw-sheet-up {
    from {
      transform: translate(-50%, 28px);
      opacity: 0;
    }
  }
  .bsheet-grab {
    width: 44px;
    height: 5px;
    border-radius: 9px;
    background: var(--color-line);
    margin: 8px auto 4px;
  }
  .bsheet-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }
  .bsheet-title {
    flex: 1;
    font-size: 20px;
    font-weight: 800;
    margin: 0;
  }
  .steps {
    padding-left: 0;
    list-style: none;
    display: grid;
    gap: 10px;
    margin: 12px 0;
  }
  .steps li {
    display: flex;
    gap: 12px;
    align-items: center;
    background: var(--color-surface);
    border-radius: 14px;
    padding: 10px 12px;
    font-weight: 700;
  }
  .steps .n {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--color-teal);
    color: #fff;
    display: grid;
    place-items: center;
    font-weight: 800;
    flex: none;
  }
  .btnrow {
    display: grid;
    gap: 10px;
    margin-top: 14px;
  }

  @media (prefers-reduced-motion: reduce) {
    .bsheet,
    .toast,
    .btn[aria-busy="true"]::after {
      animation: none;
    }
    .switch i,
    .switch i::after,
    .splash {
      transition: none;
    }
  }
```

Run: `pnpm --filter @pp/app build` — Expected: build succeeds (Tailwind resolves the file; `grep -c "tabbar" packages/app/dist/assets/*.css` ≥ 1).

- [ ] **Step 3: `Icon` — failing test, then implement**

Create `packages/app/src/components/Icon.test.tsx`:

```tsx
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { Icon, type IconName } from "./Icon.js"

const NAMES: IconName[] = [
  "home", "clock", "user", "check", "x", "minus", "download", "back", "grid",
  "headphones", "play", "wifioff", "share", "plus", "bell", "chev", "trash",
  "book", "calc", "refresh", "logout", "more", "lock", "cloud", "alert",
]

describe("Icon", () => {
  afterEach(cleanup)

  it.each(NAMES)("%s renders decorative SVG geometry", (name) => {
    const { container } = render(<Icon name={name} />)
    const svg = container.querySelector("svg")

    expect(svg).toHaveAttribute("aria-hidden", "true")
    expect(svg).toHaveClass("i")
    expect(svg?.children.length).toBeGreaterThan(0)
  })

  it("adds the small modifier on request", () => {
    const { container } = render(<Icon name="check" small />)

    expect(container.querySelector("svg")).toHaveClass("sm")
  })
})
```

Run: `pnpm --filter @pp/app exec vitest run src/components/Icon.test.tsx` — FAIL (module missing). Create `packages/app/src/components/Icon.tsx` (geometry copied from the prototype's `P` table, converted to JSX):

```tsx
import type { JSX, ReactNode } from "react"

export type IconName =
  | "home" | "clock" | "user" | "check" | "x" | "minus" | "download" | "back"
  | "grid" | "headphones" | "play" | "wifioff" | "share" | "plus" | "bell"
  | "chev" | "trash" | "book" | "calc" | "refresh" | "logout" | "more"
  | "lock" | "cloud" | "alert"

const GEOMETRY: Record<IconName, ReactNode> = {
  home: (
    <>
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M9 22V12h6v10" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  user: (
    <>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  minus: <path d="M5 12h14" />,
  download: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5M12 15V3" />
    </>
  ),
  back: <path d="M19 12H5M12 19l-7-7 7-7" />,
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </>
  ),
  headphones: (
    <>
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
    </>
  ),
  play: <path d="M6 4l14 8-14 8z" />,
  wifioff: (
    <path d="M12 20h.01M8.5 16.4a5 5 0 0 1 7 0M2 8.8a15 15 0 0 1 4.2-2.6M22 8.8a15 15 0 0 0-10-3.8M5 12.9a10 10 0 0 1 5.2-2.7M19 12.9a10 10 0 0 0-1.6-1.3M2 2l20 20" />
  ),
  share: (
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13" />
  ),
  plus: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
  bell: (
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a2 2 0 0 0 3.4 0" />
  ),
  chev: <path d="m9 18 6-6-6-6" />,
  trash: (
    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  ),
  book: (
    <path d="M2 4h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 4h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
  ),
  calc: (
    <>
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M8 6h8M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" />
    </>
  ),
  refresh: <path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5" />,
  logout: <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
  more: (
    <>
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="19" r="1" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  cloud: <path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9z" />,
  alert: (
    <>
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    </>
  ),
}

export interface IconProps {
  readonly name: IconName
  readonly small?: boolean
}

export function Icon({ name, small = false }: IconProps): JSX.Element {
  return (
    <svg
      className={small ? "i sm" : "i"}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      {GEOMETRY[name]}
    </svg>
  )
}
```

Run — PASS (26 tests).

- [ ] **Step 4: `BottomSheet` — failing test, then implement**

Create `packages/app/src/components/BottomSheet.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createRef, useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { BottomSheet } from "./BottomSheet.js"

function Harness({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false)
  const trigger = createRef<HTMLButtonElement>()

  return (
    <>
      <button ref={trigger} type="button" onClick={() => setOpen(true)}>
        Open sheet
      </button>
      <BottomSheet
        open={open}
        onOpenChange={(next) => {
          onOpenChange?.(next)
          setOpen(next)
        }}
        title="Sign out?"
        closeLabel="Close"
        returnFocusRef={trigger}
      >
        <p>Body copy</p>
      </BottomSheet>
    </>
  )
}

describe("BottomSheet", () => {
  afterEach(cleanup)

  it("is a modal dialog named by its title, with a labelled close control", async () => {
    const user = userEvent.setup()

    render(<Harness />)
    await user.click(screen.getByRole("button", { name: "Open sheet" }))

    expect(screen.getByRole("dialog", { name: "Sign out?" })).toBeInTheDocument()
    expect(screen.getByText("Body copy")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument()
  })

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()

    render(<Harness onOpenChange={onOpenChange} />)
    await user.click(screen.getByRole("button", { name: "Open sheet" }))
    await user.keyboard("{Escape}")

    expect(onOpenChange).toHaveBeenLastCalledWith(false)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open sheet" })).toHaveFocus()
  })

  it("closes from the close button", async () => {
    const user = userEvent.setup()

    render(<Harness />)
    await user.click(screen.getByRole("button", { name: "Open sheet" }))
    await user.click(screen.getByRole("button", { name: "Close" }))

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })
})
```

Run — FAIL. Create `packages/app/src/components/BottomSheet.tsx`:

```tsx
import { Dialog } from "radix-ui"
import type { JSX, ReactNode, RefObject } from "react"
import { Icon } from "./Icon.js"

export interface BottomSheetProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly title: string
  readonly closeLabel: string
  readonly returnFocusRef?: RefObject<HTMLElement | null>
  readonly children: ReactNode
}

/**
 * The prototype's `openSheet()` as a Radix dialog: modal focus scope, Escape,
 * outside content hidden from assistive tech, and focus returned to the
 * trigger. The title names the dialog; there is no description, so
 * `aria-describedby` is explicitly undefined (otherwise Radix warns).
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  closeLabel,
  returnFocusRef,
  children,
}: BottomSheetProps): JSX.Element {
  return (
    <Dialog.Root modal open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="bsheet-overlay" />
        <Dialog.Content
          className="bsheet"
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            if (!returnFocusRef?.current) {
              return
            }

            event.preventDefault()
            returnFocusRef.current.focus()
          }}
        >
          <div className="bsheet-grab" aria-hidden="true" />
          <div className="bsheet-head">
            <Dialog.Title className="bsheet-title">{title}</Dialog.Title>
            <Dialog.Close
              type="button"
              className="iconbtn"
              aria-label={closeLabel}
            >
              <Icon name="x" />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
```

Run — PASS (3 tests).

- [ ] **Step 5: `toastStore` + `ToastHost` — failing tests, then implement**

Create `packages/app/src/lib/toast.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { toastStore } from "./toast.js"

describe("toastStore", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    toastStore.show("reset")
    vi.advanceTimersByTime(4000)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("shows a message with the default check icon and clears it after 3800 ms", () => {
    const listener = vi.fn()

    toastStore.subscribe(listener)
    toastStore.show("Saved")

    expect(toastStore.getSnapshot()).toMatchObject({ message: "Saved", icon: "check" })

    vi.advanceTimersByTime(3799)
    expect(toastStore.getSnapshot()).not.toBeNull()

    vi.advanceTimersByTime(1)
    expect(toastStore.getSnapshot()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it("a newer toast replaces the older one and restarts the timer", () => {
    toastStore.show("first", "cloud")
    vi.advanceTimersByTime(3000)
    toastStore.show("second", "bell")

    expect(toastStore.getSnapshot()).toMatchObject({ message: "second", icon: "bell" })

    vi.advanceTimersByTime(3000)
    expect(toastStore.getSnapshot()?.message).toBe("second")

    vi.advanceTimersByTime(800)
    expect(toastStore.getSnapshot()).toBeNull()
  })

  it("gives each toast a new id so an identical message re-announces", () => {
    toastStore.show("same")
    const first = toastStore.getSnapshot()?.id

    toastStore.show("same")

    expect(toastStore.getSnapshot()?.id).not.toBe(first)
  })
})
```

Create `packages/app/src/lib/toast.ts`:

```ts
export type ToastIcon =
  | "check" | "wifioff" | "cloud" | "trash" | "bell" | "refresh" | "clock"

export interface ToastSnapshot {
  readonly id: number
  readonly message: string
  readonly icon: ToastIcon
}

type Listener = () => void

const TOAST_MS = 3800

let current: ToastSnapshot | null = null
let nextId = 1
let timer: ReturnType<typeof setTimeout> | undefined = undefined
const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of [...listeners]) {
    listener()
  }
}

export const toastStore = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener)

    return () => {
      listeners.delete(listener)
    }
  },
  getSnapshot(): ToastSnapshot | null {
    return current
  },
  show(message: string, icon: ToastIcon = "check"): void {
    clearTimeout(timer)
    current = { id: nextId, message, icon }
    nextId += 1
    emit()
    timer = setTimeout(() => {
      current = null
      emit()
    }, TOAST_MS)
  },
}
```

Run: `pnpm --filter @pp/app exec vitest run src/lib/toast.test.ts` — PASS.

Create `packages/app/src/components/ToastHost.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { ToastHost } from "./ToastHost.js"

describe("ToastHost", () => {
  afterEach(cleanup)

  it("renders nothing when there is no toast", () => {
    render(<ToastHost toast={null} />)

    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })

  it("renders the message in a status region with its icon", () => {
    const { container } = render(
      <ToastHost toast={{ id: 1, message: "Installed.", icon: "check" }} />,
    )

    expect(screen.getByRole("status")).toHaveTextContent("Installed.")
    expect(container.querySelector("svg")).toBeInTheDocument()
  })
})
```

Create `packages/app/src/components/ToastHost.tsx`:

```tsx
import type { JSX } from "react"
import type { ToastSnapshot } from "../lib/toast.js"
import { Icon } from "./Icon.js"

export interface ToastHostProps {
  readonly toast: ToastSnapshot | null
}

export function ToastHost({ toast }: ToastHostProps): JSX.Element | null {
  if (!toast) {
    return null
  }

  return (
    <div key={toast.id} className="toast" role="status">
      <Icon name={toast.icon} />
      <span>{toast.message}</span>
    </div>
  )
}
```

Run: `pnpm --filter @pp/app exec vitest run src/components/ToastHost.test.tsx` — PASS.

- [ ] **Step 6: `shell-routes` and `TabBar` — failing tests, then implement**

Create `packages/app/src/lib/shell-routes.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { TAB_HREF, isAttemptPath, tabForPath } from "./shell-routes.js"

describe("tabForPath", () => {
  it.each([
    ["/", "library"],
    ["/history", "history"],
    ["/history/", "history"],
    ["/profile", "profile"],
  ])("%s → %s", (path, tab) => {
    expect(tabForPath(path)).toBe(tab)
  })

  it.each([
    "/sign-in",
    "/callback",
    "/tests/practice-1",
    "/attempts/a1/run",
    "/attempts/a1/result",
    "/admin",
    "/admin/quizzes",
  ])("%s shows no tab bar", (path) => {
    expect(tabForPath(path)).toBeNull()
  })
})

describe("isAttemptPath", () => {
  it("is true only under /attempts/", () => {
    expect(isAttemptPath("/attempts/a1/run")).toBe(true)
    expect(isAttemptPath("/history")).toBe(false)
    expect(isAttemptPath("/attemptsx")).toBe(false)
  })
})

describe("TAB_HREF", () => {
  it("maps every tab to its route", () => {
    expect(TAB_HREF).toEqual({ library: "/", history: "/history", profile: "/profile" })
  })
})
```

Create `packages/app/src/lib/shell-routes.ts`:

```ts
export type ShellTab = "library" | "history" | "profile"

export const TAB_HREF: Record<ShellTab, string> = {
  library: "/",
  history: "/history",
  profile: "/profile",
}

/** Spec §5: the tab bar shows on exactly these three routes. */
export function tabForPath(pathname: string): ShellTab | null {
  const path = pathname.replace(/\/+$/u, "") || "/"

  if (path === "/") {
    return "library"
  }

  if (path === "/history") {
    return "history"
  }

  return path === "/profile" ? "profile" : null
}

export function isAttemptPath(pathname: string): boolean {
  return pathname.startsWith("/attempts/")
}
```

Create `packages/app/src/components/TabBar.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TabBar } from "./TabBar.js"

const labels = { library: "Library", history: "History", profile: "Profile", nav: "Main" }

describe("TabBar", () => {
  afterEach(cleanup)

  it("is a labelled navigation with three links and aria-current only on the active tab", () => {
    render(<TabBar active="history" labels={labels} onNavigate={() => undefined} />)

    const nav = screen.getByRole("navigation", { name: "Main" })

    expect(nav).toHaveClass("tabbar")
    expect(screen.getAllByRole("link")).toHaveLength(3)
    expect(screen.getByRole("link", { name: "History" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("link", { name: "Library" })).not.toHaveAttribute("aria-current")
    expect(screen.getByRole("link", { name: "Profile" })).toHaveAttribute("href", "/profile")
  })

  it("navigates in-app on a plain click but leaves modified clicks to the browser", async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()

    render(<TabBar active="library" labels={labels} onNavigate={onNavigate} />)

    await user.click(screen.getByRole("link", { name: "Profile" }))
    expect(onNavigate).toHaveBeenCalledWith("profile")

    onNavigate.mockClear()
    await user.keyboard("{Control>}")
    await user.click(screen.getByRole("link", { name: "History" }))
    await user.keyboard("{/Control}")
    expect(onNavigate).not.toHaveBeenCalled()
  })
})
```

Create `packages/app/src/components/TabBar.tsx`:

```tsx
import type { JSX } from "react"
import { TAB_HREF, type ShellTab } from "../lib/shell-routes.js"
import { Icon, type IconName } from "./Icon.js"

export interface TabBarProps {
  readonly active: ShellTab
  readonly labels: {
    readonly library: string
    readonly history: string
    readonly profile: string
    readonly nav: string
  }
  readonly onNavigate: (tab: ShellTab) => void
}

const TABS: ReadonlyArray<{ key: ShellTab; icon: IconName }> = [
  { key: "library", icon: "home" },
  { key: "history", icon: "clock" },
  { key: "profile", icon: "user" },
]

export function TabBar({ active, labels, onNavigate }: TabBarProps): JSX.Element {
  return (
    <nav className="tabbar" aria-label={labels.nav}>
      {TABS.map(({ key, icon }) => (
        <a
          key={key}
          href={TAB_HREF[key]}
          aria-current={active === key ? "page" : undefined}
          onClick={(event) => {
            if (
              event.defaultPrevented ||
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            ) {
              return
            }

            event.preventDefault()
            onNavigate(key)
          }}
        >
          <Icon name={icon} />
          {labels[key]}
        </a>
      ))}
    </nav>
  )
}
```

Run: `pnpm --filter @pp/app exec vitest run src/lib/shell-routes.test.ts src/components/TabBar.test.tsx` — PASS.

- [ ] **Step 7: Banners and Splash — failing tests, then implement**

Create `packages/app/src/components/Banners.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import { InstallCard, OfflineBanner, UpdateBanner } from "./Banners.js"

describe("OfflineBanner", () => {
  afterEach(cleanup)

  it("browsing: says what is on screen is saved, no keep-answering advice", () => {
    render(<OfflineBanner variant="browsing" pendingCount={0} />)

    expect(screen.getByRole("status")).toHaveTextContent(
      "You're offline. Showing what is saved on this phone.",
    )
    expect(screen.queryByText(/Waiting to be sent/u)).not.toBeInTheDocument()
  })

  it("in-test: tells the student to keep answering and shows the queue", () => {
    render(<OfflineBanner variant="in-test" pendingCount={3} />)

    expect(screen.getByRole("status")).toHaveTextContent("Keep answering")
    expect(screen.getByRole("status")).toHaveTextContent("Waiting to be sent: 3")
  })
})

describe("UpdateBanner", () => {
  afterEach(cleanup)

  it("offers Refresh outside a test", async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn()

    render(<UpdateBanner deferred={false} onRefresh={onRefresh} />)

    expect(screen.getByRole("status")).toHaveTextContent("A new version is ready.")
    await user.click(screen.getByRole("button", { name: "Refresh" }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it("inside a test has no button and says it will install afterwards", () => {
    render(<UpdateBanner deferred onRefresh={() => undefined} />)

    expect(screen.getByRole("status")).toHaveTextContent(
      "It will install after you finish this test.",
    )
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })
})

describe("InstallCard", () => {
  afterEach(cleanup)

  it("is a labelled section with Install and Not now", async () => {
    const user = userEvent.setup()
    const onInstall = vi.fn()
    const onDismiss = vi.fn()

    render(<InstallCard onInstall={onInstall} onDismiss={onDismiss} />)

    expect(
      screen.getByRole("region", { name: "Add Primary Practice to your home screen" }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Install" }))
    await user.click(screen.getByRole("button", { name: "Not now" }))
    expect(onInstall).toHaveBeenCalledTimes(1)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
```

Create `packages/app/src/components/Banners.tsx`:

```tsx
import { useId, type JSX } from "react"
import { useTranslation } from "react-i18next"
import { Icon } from "./Icon.js"

export interface OfflineBannerProps {
  readonly variant: "browsing" | "in-test"
  readonly pendingCount: number
}

/** Prototype `banners()` → `.banner.off`. */
export function OfflineBanner({ variant, pendingCount }: OfflineBannerProps): JSX.Element {
  const { t } = useTranslation("runner")

  return (
    <div className="banner off" role="status" data-variant={variant}>
      <Icon name="wifioff" />
      <span>
        {t(variant === "in-test" ? "pwa.offline.inTest" : "pwa.offline.browsing")}
        {pendingCount > 0 ? (
          <>
            {" "}
            <b>{t("pwa.offline.waiting", { count: pendingCount })}</b>
          </>
        ) : null}
      </span>
    </div>
  )
}

export interface UpdateBannerProps {
  readonly deferred: boolean
  readonly onRefresh: () => void
}

/** Prototype `banners()` → `.banner.upd`; `deferred` is the in-test wording with no button. */
export function UpdateBanner({ deferred, onRefresh }: UpdateBannerProps): JSX.Element {
  const { t } = useTranslation("runner")

  if (deferred) {
    return (
      <div className="banner upd" role="status">
        <Icon name="refresh" />
        <span>{t("pwa.update.deferred")}</span>
      </div>
    )
  }

  return (
    <div className="banner upd" role="status">
      <Icon name="refresh" />
      <span className="grow">{t("pwa.update.ready")}</span>
      <button type="button" className="btn sm" onClick={onRefresh}>
        {t("pwa.update.refresh")}
      </button>
    </div>
  )
}

export interface InstallCardProps {
  readonly onInstall: () => void
  readonly onDismiss: () => void
}

/** Prototype `vLibrary()` → `section.card.install`. */
export function InstallCard({ onInstall, onDismiss }: InstallCardProps): JSX.Element {
  const { t } = useTranslation("runner")
  const headingId = useId()

  return (
    <section className="card install" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-base font-extrabold">
        {t("pwa.install.title")}
      </h2>
      <p>{t("pwa.install.body")}</p>
      <div className="actions">
        <button type="button" className="btn sm" onClick={onInstall}>
          <Icon name="plus" small /> {t("pwa.install.button")}
        </button>
        <button type="button" className="btn sm ghost" onClick={onDismiss}>
          {t("pwa.install.notNow")}
        </button>
      </div>
    </section>
  )
}
```

Create `packages/app/src/components/Splash.test.tsx` and `Splash.tsx`:

```tsx
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import "../i18n.js"
import { Splash } from "./Splash.js"

describe("Splash", () => {
  afterEach(cleanup)

  it("is visible with the brand, hidden from assistive tech either way", () => {
    const { container, rerender } = render(<Splash visible />)
    const splash = container.querySelector(".splash")

    expect(splash).toHaveAttribute("data-visible", "true")
    expect(splash).toHaveAttribute("aria-hidden", "true")
    expect(splash).toHaveTextContent("Primary Practice")

    rerender(<Splash visible={false} />)
    expect(container.querySelector(".splash")).toHaveAttribute("data-visible", "false")
  })
})
```

```tsx
import type { JSX } from "react"
import { useTranslation } from "react-i18next"

export interface SplashProps {
  readonly visible: boolean
}

/** Prototype `#splash`: teal, white logo, brand. Fades out via `data-visible`. */
export function Splash({ visible }: SplashProps): JSX.Element {
  const { t } = useTranslation("runner")

  return (
    <div className="splash" data-visible={visible} aria-hidden="true">
      <div className="logo">P</div>
      <b>{t("library.brand")}</b>
    </div>
  )
}
```

Run: `pnpm --filter @pp/app exec vitest run src/components` — Expected: PASS (existing component suites still green).

- [ ] **Step 8: `AppLayout` wiring — failing tests**

Replace the imports at the top of `packages/app/src/pages/layout.test.tsx` and append the new `describe` (keep both existing `AppShell` tests unchanged):

```tsx
import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router"
import { afterEach, describe, expect, it } from "vitest"
import "../i18n.js"
import { networkStore } from "../lib/network.js"
import { pendingCountStore } from "../lib/pending-count.js"
import { pwaStore } from "../lib/pwa/pwa-store.js"
import { toastStore } from "../lib/toast.js"
import { AppLayout, AppShell } from "./layout.js"

async function renderAt(path: string) {
  const rootRoute = createRootRoute({ component: AppLayout })
  const page = (label: string) => () => <main>{label}</main>
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      createRoute({ getParentRoute: () => rootRoute, path: "/", component: page("library page") }),
      createRoute({ getParentRoute: () => rootRoute, path: "/history", component: page("history page") }),
      createRoute({ getParentRoute: () => rootRoute, path: "/profile", component: page("profile page") }),
      createRoute({ getParentRoute: () => rootRoute, path: "/attempts/$attemptId/run", component: page("run page") }),
      createRoute({ getParentRoute: () => rootRoute, path: "/admin", component: page("admin page") }),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })

  await router.load()
  render(<RouterProvider router={router} />)

  return router
}

describe("AppLayout chrome", () => {
  afterEach(() => {
    cleanup()
    networkStore.setOnlineForTests(true)
    pendingCountStore.set(0)
  })

  it.each(["/", "/history", "/profile"])("shows the tab bar on %s", async (path) => {
    await renderAt(path)

    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument()
  })

  it.each(["/attempts/a1/run", "/admin"])("shows no tab bar on %s", async (path) => {
    await renderAt(path)

    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument()
  })

  it("marks the current tab and switches route when another tab is tapped", async () => {
    const user = userEvent.setup()
    const router = await renderAt("/")

    expect(screen.getByRole("link", { name: "Library" })).toHaveAttribute("aria-current", "page")
    await user.click(screen.getByRole("link", { name: "Profile" }))

    expect(router.state.location.pathname).toBe("/profile")
    expect(await screen.findByText("profile page")).toBeInTheDocument()
  })

  it("shows the browsing offline banner with the queue count outside a test", async () => {
    pendingCountStore.set(2)
    networkStore.setOnlineForTests(false)
    await renderAt("/history")

    expect(screen.getByText(/Showing what is saved on this phone/u)).toBeInTheDocument()
    expect(screen.getByText("Waiting to be sent: 2")).toBeInTheDocument()
  })

  it("leaves the offline banner to the run screen on /attempts/*", async () => {
    networkStore.setOnlineForTests(false)
    await renderAt("/attempts/a1/run")

    expect(screen.queryByText(/Showing what is saved on this phone/u)).not.toBeInTheDocument()
  })

  it("announces going offline and coming back through one polite live region", async () => {
    await renderAt("/")

    act(() => networkStore.setOnlineForTests(false))
    expect(await screen.findByText("You are offline. Answers will be saved on this phone.")).toBeInTheDocument()

    act(() => networkStore.setOnlineForTests(true))
    expect(await screen.findByText("Back online.")).toBeInTheDocument()
  })

  it("shows a ready update with Refresh normally, and the deferred wording with no button during a test", async () => {
    pwaStore.setUpdateReady(() => Promise.resolve())
    await renderAt("/")

    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument()
    cleanup()

    await renderAt("/attempts/a1/run")
    expect(screen.getByText(/It will install after you finish this test/u)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument()
  })

  it("renders toasts from the toast store", async () => {
    await renderAt("/")

    act(() => toastStore.show("Installed. Open it from your home screen."))
    expect(await screen.findByText("Installed. Open it from your home screen.")).toBeInTheDocument()
  })

  it("constrains student screens to the app column but leaves admin full width", async () => {
    await renderAt("/")
    expect(document.querySelector(".app-shell")).toHaveClass("app-shell--column", "app-shell--tabs")
    cleanup()

    await renderAt("/admin")
    expect(document.querySelector(".app-shell")).not.toHaveClass("app-shell--column")
  })
})
```

Run: `pnpm --filter @pp/app exec vitest run src/pages/layout.test.tsx`
Expected: FAIL (no tab bar / banners yet).

- [ ] **Step 9: Implement `AppLayout`**

Replace `packages/app/src/pages/layout.tsx` with:

```tsx
import { Outlet, useRouter, useRouterState } from "@tanstack/react-router"
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { useTranslation } from "react-i18next"
import { OfflineBanner, UpdateBanner } from "../components/Banners.js"
import { Splash } from "../components/Splash.js"
import { TabBar } from "../components/TabBar.js"
import { ToastHost } from "../components/ToastHost.js"
import { networkStore } from "../lib/network.js"
import { pendingCountStore } from "../lib/pending-count.js"
import { pwaStore } from "../lib/pwa/pwa-store.js"
import {
  TAB_HREF,
  isAttemptPath,
  tabForPath,
  type ShellTab,
} from "../lib/shell-routes.js"
import { toastStore } from "../lib/toast.js"

export interface AppShellProps {
  readonly children?: ReactNode
  /** Phone-width column, centred on wider screens (student screens). */
  readonly column?: boolean
  /** Reserve room for the fixed tab bar. */
  readonly withTabBar?: boolean
}

export function AppShell({ children, column = false, withTabBar = false }: AppShellProps) {
  const classes = [
    "app-shell",
    column ? "app-shell--column" : "",
    withTabBar ? "app-shell--tabs" : "",
  ]
    .filter(Boolean)
    .join(" ")

  return <div className={classes}>{children}</div>
}

const SPLASH_MS = 600
let splashShown = false

/** Cold-start splash, only when launched from the home screen (prototype `#splash`). */
function useColdStartSplash(standalone: boolean): boolean {
  const [visible, setVisible] = useState(() => standalone && !splashShown)

  useEffect(() => {
    if (!visible) {
      return undefined
    }

    splashShown = true

    const timer = setTimeout(() => {
      setVisible(false)
    }, SPLASH_MS)

    return () => {
      clearTimeout(timer)
    }
  }, [visible])

  return visible
}

export function AppLayout() {
  const { t } = useTranslation("runner")
  const router = useRouter()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const network = useSyncExternalStore(networkStore.subscribe, networkStore.getSnapshot)
  const pwa = useSyncExternalStore(pwaStore.subscribe, pwaStore.getSnapshot)
  const toast = useSyncExternalStore(toastStore.subscribe, toastStore.getSnapshot)
  const pending = useSyncExternalStore(pendingCountStore.subscribe, pendingCountStore.getSnapshot)
  const splashVisible = useColdStartSplash(pwa.standalone)
  const [announcement, setAnnouncement] = useState("")
  const previousOnline = useRef(network.online)

  const admin = pathname.startsWith("/admin")
  const tab = admin ? null : tabForPath(pathname)
  const inAttempt = isAttemptPath(pathname)

  useEffect(() => {
    if (previousOnline.current === network.online) {
      return
    }

    previousOnline.current = network.online
    setAnnouncement(t(network.online ? "pwa.live.online" : "pwa.live.offline"))
  }, [network.online, t])

  function handleNavigate(next: ShellTab): void {
    // `href` (not `to`) keeps this independent of the generated route tree;
    // router-core parses a same-origin path href and navigates in-app.
    void router.navigate({ href: TAB_HREF[next] })
  }

  return (
    <>
      <Splash visible={splashVisible} />
      <AppShell column={!admin} withTabBar={tab !== null}>
        {!admin && !network.online && !inAttempt ? (
          <OfflineBanner variant="browsing" pendingCount={pending} />
        ) : null}
        {!admin && pwa.updateReady ? (
          <UpdateBanner
            deferred={inAttempt}
            onRefresh={() => {
              void pwaStore.applyUpdate()
            }}
          />
        ) : null}
        <Outlet />
      </AppShell>
      {tab ? (
        <TabBar
          active={tab}
          labels={{
            library: t("tabs.library"),
            history: t("tabs.history"),
            profile: t("tabs.profile"),
            nav: t("tabs.nav"),
          }}
          onNavigate={handleNavigate}
        />
      ) : null}
      <ToastHost toast={toast} />
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
    </>
  )
}
```

Run: `pnpm --filter @pp/app exec vitest run src/pages/layout.test.tsx` — Expected: PASS.

- [ ] **Step 10: Full-package gates, browser check, commit**

Run: `pnpm --filter @pp/app test && pnpm --filter @pp/app typecheck && pnpm lint:frontend && pnpm lint:i18n && pnpm exec oxlint packages/app && pnpm exec prettier --write packages/app/src`
Expected: all green. (`lint:frontend` verifies components stayed stateless — `Banners.tsx` uses `useId`/`useTranslation` only, as `SaveState.tsx` does `useTranslation`; if the rule rejects `useId`, pass the heading id in as a prop `headingId` from the caller and update the test.)

Browser check: `pnpm --filter @pp/app dev` (API on 3001 per `vite.config.ts`), open `http://localhost:3000/` at 390 × 844 in Chrome DevTools: tab bar pinned bottom with safe-area padding, no horizontal scroll, Network → Offline shows the banner. Compare with `docs/prototype/pwa-mobile.html` for tab bar height (60 px), banner colours, toast position.

```bash
git add packages/app/src
git commit -m "feat(app): mobile shell — tab bar, bottom sheet, toasts, banners, splash, app-column layout"
```

---

### Task 5: Translated strings for the shell, install, update and profile UI (all six locales)

**Files:**
- Create: `packages/app/src/locales/pwa-strings.test.ts`
- Modify: `packages/app/src/locales/{en,de,es,fr,it,ja}/runner.json`
- Create (throwaway, **not committed**): `$TMPDIR/merge-pwa-strings.mjs` (see Step 3)

**Interfaces:**
- Consumes: the flat dotted-key `runner.json` format (`"menu.title": "Menu"`); `locale-parity.test.ts` (strips `_one`/`_other`… plural suffixes before comparing, so Japanese carries only `_other`).
- Produces: every key listed in `REQUIRED_KEYS` below in all six locales. Later tasks (6–13, 16, 25) use these keys; **do not rename them**.

- [ ] **Step 1: Write the failing catalogue test**

Create `packages/app/src/locales/pwa-strings.test.ts`:

```ts
import { describe, expect, it } from "vitest"

const LOCALES = ["de", "en", "es", "fr", "it", "ja"] as const

const REQUIRED_KEYS = [
  "tabs.nav", "tabs.library", "tabs.history", "tabs.profile",
  "pwa.sheet.close",
  "pwa.install.title", "pwa.install.body", "pwa.install.button", "pwa.install.notNow",
  "pwa.install.close", "pwa.install.installed", "pwa.install.runningAsApp", "pwa.install.notInstalled",
  "pwa.install.ios.title", "pwa.install.ios.hint", "pwa.install.ios.step1",
  "pwa.install.ios.step2", "pwa.install.ios.step3", "pwa.install.ios.done",
  "pwa.install.manual.title", "pwa.install.manual.body",
  "pwa.update.ready", "pwa.update.refresh", "pwa.update.deferred", "pwa.update.applied",
  "pwa.offline.browsing", "pwa.offline.inTest", "pwa.offline.waiting",
  "pwa.live.offline", "pwa.live.online",
  "toast.installed", "toast.savedOffline", "toast.savePaused", "toast.removedOffline",
  "toast.remindersOn", "toast.remindersOff", "toast.remindersBlocked",
  "profile.title", "profile.signedInWith", "profile.error",
  "profile.section.app", "profile.section.offline",
  "profile.install.title",
  "profile.reminders.title", "profile.reminders.on", "profile.reminders.off",
  "profile.reminders.denied", "profile.reminders.needsInstall", "profile.reminders.unsupported",
  "profile.reminders.permission.title", "profile.reminders.permission.body",
  "profile.reminders.permission.allow", "profile.reminders.permission.deny",
  "profile.version.title", "profile.version.upToDate", "profile.version.updateReady",
  "profile.offline.empty", "profile.offline.item", "profile.offline.remove",
  "profile.language", "profile.admin", "profile.signOut",
  "profile.signOutConfirm.title", "profile.signOutConfirm.body", "profile.signOutConfirm.cancel",
]

// i18next plural families: every language needs `_other`; the rest vary.
const PLURAL_KEYS = ["toast.backOnline"]

const modules = import.meta.glob("./*/runner.json", { eager: true }) as Record<
  string,
  { default: Record<string, string> }
>

function catalogue(locale: string): Record<string, string> {
  return modules[`./${locale}/runner.json`]?.default ?? {}
}

describe("PWA UI strings", () => {
  it.each(LOCALES)("%s defines every shell/profile key with a non-empty value", (locale) => {
    const strings = catalogue(locale)
    const missing = REQUIRED_KEYS.filter((key) => !strings[key]?.trim())

    expect(missing).toEqual([])
  })

  it.each(LOCALES)("%s defines the plural keys it needs", (locale) => {
    const strings = catalogue(locale)

    for (const key of PLURAL_KEYS) {
      expect(strings[`${key}_other`]?.trim(), `${key}_other`).toBeTruthy()
    }
  })

  it("keeps interpolation placeholders identical across locales", () => {
    const placeholders = (value: string) => [...value.matchAll(/\{\{(\w+)\}\}/gu)].map((m) => m[1]).sort()
    const english = catalogue("en")

    for (const locale of LOCALES) {
      const strings = catalogue(locale)

      for (const key of [...REQUIRED_KEYS, "toast.backOnline_other"]) {
        expect({ locale, key, vars: placeholders(strings[key] ?? "") }).toEqual({
          locale,
          key,
          vars: placeholders(english[key] ?? ""),
        })
      }
    }
  })

  it("never ships an English string in a translated locale for the new install/profile copy", () => {
    const english = catalogue("en")
    const untranslated = ["pwa.install.title", "profile.signOutConfirm.body", "pwa.update.deferred"]

    for (const locale of LOCALES.filter((l) => l !== "en")) {
      for (const key of untranslated) {
        expect({ locale, key, same: catalogue(locale)[key] === english[key] }).toEqual({
          locale,
          key,
          same: false,
        })
      }
    }
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @pp/app exec vitest run src/locales/pwa-strings.test.ts`
Expected: FAIL — many keys missing (only the Task 4 subset exists, with English values in the other locales so the last test also fails).

- [ ] **Step 3: Write the merge script with the full catalogue and run it once**

Create `$TMPDIR/merge-pwa-strings.mjs` (outside the repo; delete after use). It merges into each existing flat file, keeping the current 2-space JSON format, overwriting the Task 4 provisional values:

```js
import { readFileSync, writeFileSync } from "node:fs"

const root = `${process.cwd()}/packages/app/src/locales`

const en = {
  "tabs.nav": "Main",
  "tabs.library": "Library",
  "tabs.history": "History",
  "tabs.profile": "Profile",
  "pwa.sheet.close": "Close",
  "pwa.install.title": "Add Primary Practice to your home screen",
  "pwa.install.body": "Opens full screen, keeps your tests ready offline, and never loses an answer.",
  "pwa.install.button": "Install",
  "pwa.install.notNow": "Not now",
  "pwa.install.close": "Close",
  "pwa.install.installed": "Installed",
  "pwa.install.runningAsApp": "Installed — running as an app",
  "pwa.install.notInstalled": "Not installed",
  "pwa.install.ios.title": "Add to Home Screen",
  "pwa.install.ios.hint": "Safari installs apps from the Share menu.",
  "pwa.install.ios.step1": "Tap the Share button in Safari's toolbar",
  "pwa.install.ios.step2": "Choose Add to Home Screen",
  "pwa.install.ios.step3": "Tap Add and open Primary Practice from your home screen",
  "pwa.install.ios.done": "I've added it",
  "pwa.install.manual.title": "Install this app",
  "pwa.install.manual.body": "Open your browser menu and choose Install app or Add to Home screen.",
  "pwa.update.ready": "A new version is ready.",
  "pwa.update.refresh": "Refresh",
  "pwa.update.deferred": "A new version is ready. It will install after you finish this test.",
  "pwa.update.applied": "Updated to version {{version}}.",
  "pwa.offline.browsing": "You're offline. Showing what is saved on this phone.",
  "pwa.offline.inTest": "You're offline. Keep answering — your answers are saved on this phone and will be sent when you reconnect.",
  "pwa.offline.waiting": "Waiting to be sent: {{count}}",
  "pwa.live.offline": "You are offline. Answers will be saved on this phone.",
  "pwa.live.online": "Back online.",
  "toast.installed": "Installed. Open it from your home screen.",
  "toast.backOnline_one": "Back online — {{count}} answer sent.",
  "toast.backOnline_other": "Back online — {{count}} answers sent.",
  "toast.savedOffline": "{{title}} is saved for offline use.",
  "toast.savePaused": "Save paused — you're offline. Try again when connected.",
  "toast.removedOffline": "{{title}} removed from this phone.",
  "toast.remindersOn": "Reminders turned on.",
  "toast.remindersOff": "Reminders turned off.",
  "toast.remindersBlocked": "Reminders blocked.",
  "profile.title": "Profile",
  "profile.signedInWith": "Signed in with auth.icovn.me",
  "profile.error": "Your profile could not be loaded. Please try again.",
  "profile.section.app": "App",
  "profile.section.offline": "Saved for offline",
  "profile.install.title": "Home screen app",
  "profile.reminders.title": "Practice reminders",
  "profile.reminders.on": "Daily at 4:30 pm",
  "profile.reminders.off": "Off",
  "profile.reminders.denied": "Blocked in your browser settings.",
  "profile.reminders.needsInstall": "On iPhone, install the app first to turn reminders on.",
  "profile.reminders.unsupported": "This browser can't send reminders.",
  "profile.reminders.permission.title": "Allow reminders?",
  "profile.reminders.permission.body": "Primary Practice would like to send a short reminder to practise each afternoon.",
  "profile.reminders.permission.allow": "Allow",
  "profile.reminders.permission.deny": "Don't allow",
  "profile.version.title": "Version",
  "profile.version.upToDate": "{{version}} · up to date",
  "profile.version.updateReady": "{{version}} · update ready",
  "profile.offline.empty": "Nothing saved yet. Use “Save offline” on a test while you're online.",
  "profile.offline.item": "{{level}} · {{size}} MB",
  "profile.offline.remove": "Remove {{title}} from this phone",
  "profile.language": "Language",
  "profile.admin": "Admin console",
  "profile.signOut": "Sign out",
  "profile.signOutConfirm.title": "Sign out?",
  "profile.signOutConfirm.body": "You will need to sign in again. Tests saved for offline use will be removed from this phone.",
  "profile.signOutConfirm.cancel": "Cancel",
}

const de = {
  "tabs.nav": "Hauptnavigation",
  "tabs.library": "Bibliothek",
  "tabs.history": "Verlauf",
  "tabs.profile": "Profil",
  "pwa.sheet.close": "Schließen",
  "pwa.install.title": "Primary Practice zum Home-Bildschirm hinzufügen",
  "pwa.install.body": "Öffnet im Vollbild, hält deine Tests offline bereit und verliert nie eine Antwort.",
  "pwa.install.button": "Installieren",
  "pwa.install.notNow": "Nicht jetzt",
  "pwa.install.close": "Schließen",
  "pwa.install.installed": "Installiert",
  "pwa.install.runningAsApp": "Installiert – läuft als App",
  "pwa.install.notInstalled": "Nicht installiert",
  "pwa.install.ios.title": "Zum Home-Bildschirm",
  "pwa.install.ios.hint": "Safari installiert Apps über das Teilen-Menü.",
  "pwa.install.ios.step1": "Tippe in der Safari-Leiste auf „Teilen“",
  "pwa.install.ios.step2": "Wähle „Zum Home-Bildschirm“",
  "pwa.install.ios.step3": "Tippe auf „Hinzufügen“ und öffne Primary Practice vom Home-Bildschirm",
  "pwa.install.ios.done": "Ich habe sie hinzugefügt",
  "pwa.install.manual.title": "App installieren",
  "pwa.install.manual.body": "Öffne das Browsermenü und wähle „App installieren“ oder „Zum Startbildschirm hinzufügen“.",
  "pwa.update.ready": "Eine neue Version ist bereit.",
  "pwa.update.refresh": "Aktualisieren",
  "pwa.update.deferred": "Eine neue Version ist bereit. Sie wird installiert, sobald du diesen Test beendet hast.",
  "pwa.update.applied": "Auf Version {{version}} aktualisiert.",
  "pwa.offline.browsing": "Du bist offline. Es werden die auf diesem Telefon gespeicherten Inhalte angezeigt.",
  "pwa.offline.inTest": "Du bist offline. Antworte einfach weiter – deine Antworten werden auf diesem Telefon gespeichert und gesendet, sobald du wieder verbunden bist.",
  "pwa.offline.waiting": "Warten auf Versand: {{count}}",
  "pwa.live.offline": "Du bist offline. Antworten werden auf diesem Telefon gespeichert.",
  "pwa.live.online": "Wieder online.",
  "toast.installed": "Installiert. Öffne die App von deinem Home-Bildschirm.",
  "toast.backOnline_one": "Wieder online – {{count}} Antwort gesendet.",
  "toast.backOnline_other": "Wieder online – {{count}} Antworten gesendet.",
  "toast.savedOffline": "{{title}} ist für die Offline-Nutzung gespeichert.",
  "toast.savePaused": "Speichern pausiert – du bist offline. Versuche es erneut, wenn du verbunden bist.",
  "toast.removedOffline": "{{title}} wurde von diesem Telefon entfernt.",
  "toast.remindersOn": "Erinnerungen eingeschaltet.",
  "toast.remindersOff": "Erinnerungen ausgeschaltet.",
  "toast.remindersBlocked": "Erinnerungen blockiert.",
  "profile.title": "Profil",
  "profile.signedInWith": "Angemeldet mit auth.icovn.me",
  "profile.error": "Dein Profil konnte nicht geladen werden. Bitte versuche es erneut.",
  "profile.section.app": "App",
  "profile.section.offline": "Offline gespeichert",
  "profile.install.title": "Home-Bildschirm-App",
  "profile.reminders.title": "Übungserinnerungen",
  "profile.reminders.on": "Täglich um 16:30 Uhr",
  "profile.reminders.off": "Aus",
  "profile.reminders.denied": "In den Browsereinstellungen blockiert.",
  "profile.reminders.needsInstall": "Auf dem iPhone musst du die App zuerst installieren, um Erinnerungen einzuschalten.",
  "profile.reminders.unsupported": "Dieser Browser kann keine Erinnerungen senden.",
  "profile.reminders.permission.title": "Erinnerungen erlauben?",
  "profile.reminders.permission.body": "Primary Practice möchte dir jeden Nachmittag eine kurze Erinnerung zum Üben senden.",
  "profile.reminders.permission.allow": "Erlauben",
  "profile.reminders.permission.deny": "Nicht erlauben",
  "profile.version.title": "Version",
  "profile.version.upToDate": "{{version}} · aktuell",
  "profile.version.updateReady": "{{version}} · Update bereit",
  "profile.offline.empty": "Noch nichts gespeichert. Nutze „Offline speichern“ bei einem Test, solange du online bist.",
  "profile.offline.item": "{{level}} · {{size}} MB",
  "profile.offline.remove": "{{title}} von diesem Telefon entfernen",
  "profile.language": "Sprache",
  "profile.admin": "Admin-Konsole",
  "profile.signOut": "Abmelden",
  "profile.signOutConfirm.title": "Abmelden?",
  "profile.signOutConfirm.body": "Du musst dich erneut anmelden. Offline gespeicherte Tests werden von diesem Telefon entfernt.",
  "profile.signOutConfirm.cancel": "Abbrechen",
}

const es = {
  "tabs.nav": "Navegación principal",
  "tabs.library": "Biblioteca",
  "tabs.history": "Historial",
  "tabs.profile": "Perfil",
  "pwa.sheet.close": "Cerrar",
  "pwa.install.title": "Añade Primary Practice a tu pantalla de inicio",
  "pwa.install.body": "Se abre a pantalla completa, mantiene tus pruebas listas sin conexión y nunca pierde una respuesta.",
  "pwa.install.button": "Instalar",
  "pwa.install.notNow": "Ahora no",
  "pwa.install.close": "Cerrar",
  "pwa.install.installed": "Instalada",
  "pwa.install.runningAsApp": "Instalada: se ejecuta como app",
  "pwa.install.notInstalled": "No instalada",
  "pwa.install.ios.title": "Añadir a pantalla de inicio",
  "pwa.install.ios.hint": "Safari instala las apps desde el menú Compartir.",
  "pwa.install.ios.step1": "Toca el botón Compartir en la barra de Safari",
  "pwa.install.ios.step2": "Elige Añadir a pantalla de inicio",
  "pwa.install.ios.step3": "Toca Añadir y abre Primary Practice desde tu pantalla de inicio",
  "pwa.install.ios.done": "Ya la he añadido",
  "pwa.install.manual.title": "Instalar esta app",
  "pwa.install.manual.body": "Abre el menú del navegador y elige Instalar app o Añadir a la pantalla de inicio.",
  "pwa.update.ready": "Hay una nueva versión lista.",
  "pwa.update.refresh": "Actualizar",
  "pwa.update.deferred": "Hay una nueva versión lista. Se instalará cuando termines esta prueba.",
  "pwa.update.applied": "Actualizada a la versión {{version}}.",
  "pwa.offline.browsing": "Estás sin conexión. Se muestra lo guardado en este teléfono.",
  "pwa.offline.inTest": "Estás sin conexión. Sigue respondiendo: tus respuestas se guardan en este teléfono y se enviarán cuando vuelvas a conectarte.",
  "pwa.offline.waiting": "Pendientes de enviar: {{count}}",
  "pwa.live.offline": "Estás sin conexión. Las respuestas se guardarán en este teléfono.",
  "pwa.live.online": "De nuevo con conexión.",
  "toast.installed": "Instalada. Ábrela desde tu pantalla de inicio.",
  "toast.backOnline_one": "De nuevo con conexión: se envió {{count}} respuesta.",
  "toast.backOnline_other": "De nuevo con conexión: se enviaron {{count}} respuestas.",
  "toast.savedOffline": "{{title}} está guardada para usar sin conexión.",
  "toast.savePaused": "Guardado en pausa: no tienes conexión. Inténtalo de nuevo cuando te conectes.",
  "toast.removedOffline": "{{title}} se ha quitado de este teléfono.",
  "toast.remindersOn": "Recordatorios activados.",
  "toast.remindersOff": "Recordatorios desactivados.",
  "toast.remindersBlocked": "Recordatorios bloqueados.",
  "profile.title": "Perfil",
  "profile.signedInWith": "Sesión iniciada con auth.icovn.me",
  "profile.error": "No se pudo cargar tu perfil. Inténtalo de nuevo.",
  "profile.section.app": "App",
  "profile.section.offline": "Guardado sin conexión",
  "profile.install.title": "App en la pantalla de inicio",
  "profile.reminders.title": "Recordatorios de práctica",
  "profile.reminders.on": "Todos los días a las 16:30",
  "profile.reminders.off": "Desactivados",
  "profile.reminders.denied": "Bloqueados en los ajustes del navegador.",
  "profile.reminders.needsInstall": "En iPhone, instala primero la app para activar los recordatorios.",
  "profile.reminders.unsupported": "Este navegador no puede enviar recordatorios.",
  "profile.reminders.permission.title": "¿Permitir recordatorios?",
  "profile.reminders.permission.body": "Primary Practice quiere enviarte un breve recordatorio para practicar cada tarde.",
  "profile.reminders.permission.allow": "Permitir",
  "profile.reminders.permission.deny": "No permitir",
  "profile.version.title": "Versión",
  "profile.version.upToDate": "{{version}} · al día",
  "profile.version.updateReady": "{{version}} · actualización lista",
  "profile.offline.empty": "Todavía no hay nada guardado. Usa «Guardar sin conexión» en una prueba mientras tengas conexión.",
  "profile.offline.item": "{{level}} · {{size}} MB",
  "profile.offline.remove": "Quitar {{title}} de este teléfono",
  "profile.language": "Idioma",
  "profile.admin": "Consola de administración",
  "profile.signOut": "Cerrar sesión",
  "profile.signOutConfirm.title": "¿Cerrar sesión?",
  "profile.signOutConfirm.body": "Tendrás que iniciar sesión de nuevo. Las pruebas guardadas sin conexión se quitarán de este teléfono.",
  "profile.signOutConfirm.cancel": "Cancelar",
}

const fr = {
  "tabs.nav": "Navigation principale",
  "tabs.library": "Bibliothèque",
  "tabs.history": "Historique",
  "tabs.profile": "Profil",
  "pwa.sheet.close": "Fermer",
  "pwa.install.title": "Ajoute Primary Practice à ton écran d'accueil",
  "pwa.install.body": "S'ouvre en plein écran, garde tes tests prêts hors connexion et ne perd jamais une réponse.",
  "pwa.install.button": "Installer",
  "pwa.install.notNow": "Pas maintenant",
  "pwa.install.close": "Fermer",
  "pwa.install.installed": "Installée",
  "pwa.install.runningAsApp": "Installée — fonctionne comme une appli",
  "pwa.install.notInstalled": "Non installée",
  "pwa.install.ios.title": "Sur l'écran d'accueil",
  "pwa.install.ios.hint": "Safari installe les applis depuis le menu Partager.",
  "pwa.install.ios.step1": "Touche le bouton Partager dans la barre de Safari",
  "pwa.install.ios.step2": "Choisis « Sur l'écran d'accueil »",
  "pwa.install.ios.step3": "Touche Ajouter, puis ouvre Primary Practice depuis ton écran d'accueil",
  "pwa.install.ios.done": "Je l'ai ajoutée",
  "pwa.install.manual.title": "Installer cette appli",
  "pwa.install.manual.body": "Ouvre le menu du navigateur et choisis Installer l'application ou Ajouter à l'écran d'accueil.",
  "pwa.update.ready": "Une nouvelle version est prête.",
  "pwa.update.refresh": "Actualiser",
  "pwa.update.deferred": "Une nouvelle version est prête. Elle s'installera quand tu auras terminé ce test.",
  "pwa.update.applied": "Mise à jour vers la version {{version}}.",
  "pwa.offline.browsing": "Tu es hors connexion. Affichage de ce qui est enregistré sur ce téléphone.",
  "pwa.offline.inTest": "Tu es hors connexion. Continue à répondre : tes réponses sont enregistrées sur ce téléphone et seront envoyées dès que tu seras reconnecté.",
  "pwa.offline.waiting": "En attente d'envoi : {{count}}",
  "pwa.live.offline": "Tu es hors connexion. Les réponses seront enregistrées sur ce téléphone.",
  "pwa.live.online": "De nouveau en ligne.",
  "toast.installed": "Installée. Ouvre-la depuis ton écran d'accueil.",
  "toast.backOnline_one": "De nouveau en ligne — {{count}} réponse envoyée.",
  "toast.backOnline_other": "De nouveau en ligne — {{count}} réponses envoyées.",
  "toast.savedOffline": "{{title}} est enregistré pour une utilisation hors connexion.",
  "toast.savePaused": "Enregistrement en pause — tu es hors connexion. Réessaie une fois connecté.",
  "toast.removedOffline": "{{title}} a été supprimé de ce téléphone.",
  "toast.remindersOn": "Rappels activés.",
  "toast.remindersOff": "Rappels désactivés.",
  "toast.remindersBlocked": "Rappels bloqués.",
  "profile.title": "Profil",
  "profile.signedInWith": "Connecté avec auth.icovn.me",
  "profile.error": "Impossible de charger ton profil. Réessaie.",
  "profile.section.app": "Appli",
  "profile.section.offline": "Enregistré hors connexion",
  "profile.install.title": "Appli sur l'écran d'accueil",
  "profile.reminders.title": "Rappels d'entraînement",
  "profile.reminders.on": "Chaque jour à 16 h 30",
  "profile.reminders.off": "Désactivés",
  "profile.reminders.denied": "Bloqués dans les réglages du navigateur.",
  "profile.reminders.needsInstall": "Sur iPhone, installe d'abord l'appli pour activer les rappels.",
  "profile.reminders.unsupported": "Ce navigateur ne peut pas envoyer de rappels.",
  "profile.reminders.permission.title": "Autoriser les rappels ?",
  "profile.reminders.permission.body": "Primary Practice voudrait t'envoyer un court rappel pour t'entraîner chaque après-midi.",
  "profile.reminders.permission.allow": "Autoriser",
  "profile.reminders.permission.deny": "Ne pas autoriser",
  "profile.version.title": "Version",
  "profile.version.upToDate": "{{version}} · à jour",
  "profile.version.updateReady": "{{version}} · mise à jour prête",
  "profile.offline.empty": "Rien d'enregistré pour l'instant. Utilise « Enregistrer hors connexion » sur un test quand tu es en ligne.",
  "profile.offline.item": "{{level}} · {{size}} Mo",
  "profile.offline.remove": "Supprimer {{title}} de ce téléphone",
  "profile.language": "Langue",
  "profile.admin": "Console d'administration",
  "profile.signOut": "Se déconnecter",
  "profile.signOutConfirm.title": "Se déconnecter ?",
  "profile.signOutConfirm.body": "Tu devras te reconnecter. Les tests enregistrés hors connexion seront supprimés de ce téléphone.",
  "profile.signOutConfirm.cancel": "Annuler",
}

const it = {
  "tabs.nav": "Navigazione principale",
  "tabs.library": "Libreria",
  "tabs.history": "Cronologia",
  "tabs.profile": "Profilo",
  "pwa.sheet.close": "Chiudi",
  "pwa.install.title": "Aggiungi Primary Practice alla schermata Home",
  "pwa.install.body": "Si apre a schermo intero, tiene i tuoi test pronti offline e non perde mai una risposta.",
  "pwa.install.button": "Installa",
  "pwa.install.notNow": "Non ora",
  "pwa.install.close": "Chiudi",
  "pwa.install.installed": "Installata",
  "pwa.install.runningAsApp": "Installata — in esecuzione come app",
  "pwa.install.notInstalled": "Non installata",
  "pwa.install.ios.title": "Aggiungi a Home",
  "pwa.install.ios.hint": "Safari installa le app dal menu Condividi.",
  "pwa.install.ios.step1": "Tocca il pulsante Condividi nella barra di Safari",
  "pwa.install.ios.step2": "Scegli Aggiungi a Home",
  "pwa.install.ios.step3": "Tocca Aggiungi e apri Primary Practice dalla schermata Home",
  "pwa.install.ios.done": "L'ho aggiunta",
  "pwa.install.manual.title": "Installa questa app",
  "pwa.install.manual.body": "Apri il menu del browser e scegli Installa app oppure Aggiungi a schermata Home.",
  "pwa.update.ready": "È pronta una nuova versione.",
  "pwa.update.refresh": "Aggiorna",
  "pwa.update.deferred": "È pronta una nuova versione. Verrà installata quando avrai finito questo test.",
  "pwa.update.applied": "Aggiornata alla versione {{version}}.",
  "pwa.offline.browsing": "Sei offline. Vengono mostrati i contenuti salvati su questo telefono.",
  "pwa.offline.inTest": "Sei offline. Continua a rispondere: le tue risposte vengono salvate su questo telefono e saranno inviate quando tornerai online.",
  "pwa.offline.waiting": "In attesa di invio: {{count}}",
  "pwa.live.offline": "Sei offline. Le risposte verranno salvate su questo telefono.",
  "pwa.live.online": "Di nuovo online.",
  "toast.installed": "Installata. Aprila dalla schermata Home.",
  "toast.backOnline_one": "Di nuovo online — {{count}} risposta inviata.",
  "toast.backOnline_other": "Di nuovo online — {{count}} risposte inviate.",
  "toast.savedOffline": "{{title}} è salvato per l'uso offline.",
  "toast.savePaused": "Salvataggio in pausa — sei offline. Riprova quando sei connesso.",
  "toast.removedOffline": "{{title}} rimosso da questo telefono.",
  "toast.remindersOn": "Promemoria attivati.",
  "toast.remindersOff": "Promemoria disattivati.",
  "toast.remindersBlocked": "Promemoria bloccati.",
  "profile.title": "Profilo",
  "profile.signedInWith": "Accesso con auth.icovn.me",
  "profile.error": "Impossibile caricare il tuo profilo. Riprova.",
  "profile.section.app": "App",
  "profile.section.offline": "Salvati offline",
  "profile.install.title": "App sulla schermata Home",
  "profile.reminders.title": "Promemoria di pratica",
  "profile.reminders.on": "Ogni giorno alle 16:30",
  "profile.reminders.off": "Disattivati",
  "profile.reminders.denied": "Bloccati nelle impostazioni del browser.",
  "profile.reminders.needsInstall": "Su iPhone, installa prima l'app per attivare i promemoria.",
  "profile.reminders.unsupported": "Questo browser non può inviare promemoria.",
  "profile.reminders.permission.title": "Consentire i promemoria?",
  "profile.reminders.permission.body": "Primary Practice vorrebbe inviarti un breve promemoria per esercitarti ogni pomeriggio.",
  "profile.reminders.permission.allow": "Consenti",
  "profile.reminders.permission.deny": "Non consentire",
  "profile.version.title": "Versione",
  "profile.version.upToDate": "{{version}} · aggiornata",
  "profile.version.updateReady": "{{version}} · aggiornamento pronto",
  "profile.offline.empty": "Ancora niente di salvato. Usa «Salva offline» su un test mentre sei online.",
  "profile.offline.item": "{{level}} · {{size}} MB",
  "profile.offline.remove": "Rimuovi {{title}} da questo telefono",
  "profile.language": "Lingua",
  "profile.admin": "Console di amministrazione",
  "profile.signOut": "Esci",
  "profile.signOutConfirm.title": "Uscire?",
  "profile.signOutConfirm.body": "Dovrai accedere di nuovo. I test salvati offline verranno rimossi da questo telefono.",
  "profile.signOutConfirm.cancel": "Annulla",
}

const ja = {
  "tabs.nav": "メインナビゲーション",
  "tabs.library": "ライブラリ",
  "tabs.history": "履歴",
  "tabs.profile": "プロフィール",
  "pwa.sheet.close": "閉じる",
  "pwa.install.title": "Primary Practice をホーム画面に追加",
  "pwa.install.body": "全画面で開き、テストをオフラインでも使えるようにして、答えを失くしません。",
  "pwa.install.button": "インストール",
  "pwa.install.notNow": "あとで",
  "pwa.install.close": "閉じる",
  "pwa.install.installed": "インストール済み",
  "pwa.install.runningAsApp": "インストール済み — アプリとして実行中",
  "pwa.install.notInstalled": "未インストール",
  "pwa.install.ios.title": "ホーム画面に追加",
  "pwa.install.ios.hint": "Safari では共有メニューからアプリを追加します。",
  "pwa.install.ios.step1": "Safari のツールバーで共有ボタンをタップ",
  "pwa.install.ios.step2": "「ホーム画面に追加」を選ぶ",
  "pwa.install.ios.step3": "「追加」をタップして、ホーム画面から Primary Practice を開く",
  "pwa.install.ios.done": "追加しました",
  "pwa.install.manual.title": "このアプリをインストール",
  "pwa.install.manual.body": "ブラウザのメニューを開き、「アプリをインストール」または「ホーム画面に追加」を選んでください。",
  "pwa.update.ready": "新しいバージョンの準備ができました。",
  "pwa.update.refresh": "更新",
  "pwa.update.deferred": "新しいバージョンの準備ができました。このテストが終わったあとにインストールされます。",
  "pwa.update.applied": "バージョン {{version}} に更新しました。",
  "pwa.offline.browsing": "オフラインです。この端末に保存されている内容を表示しています。",
  "pwa.offline.inTest": "オフラインです。そのまま答え続けてください。答えはこの端末に保存され、接続が戻ると送信されます。",
  "pwa.offline.waiting": "送信待ち: {{count}}",
  "pwa.live.offline": "オフラインです。答えはこの端末に保存されます。",
  "pwa.live.online": "オンラインに戻りました。",
  "toast.installed": "インストールしました。ホーム画面から開いてください。",
  "toast.backOnline_other": "オンラインに戻りました — {{count}} 件の答えを送信しました。",
  "toast.savedOffline": "{{title}} をオフライン用に保存しました。",
  "toast.savePaused": "保存を一時停止しました — オフラインです。接続できたらもう一度お試しください。",
  "toast.removedOffline": "{{title}} をこの端末から削除しました。",
  "toast.remindersOn": "リマインダーをオンにしました。",
  "toast.remindersOff": "リマインダーをオフにしました。",
  "toast.remindersBlocked": "リマインダーはブロックされています。",
  "profile.title": "プロフィール",
  "profile.signedInWith": "auth.icovn.me でサインイン中",
  "profile.error": "プロフィールを読み込めませんでした。もう一度お試しください。",
  "profile.section.app": "アプリ",
  "profile.section.offline": "オフライン用に保存",
  "profile.install.title": "ホーム画面アプリ",
  "profile.reminders.title": "練習のリマインダー",
  "profile.reminders.on": "毎日 午後4:30",
  "profile.reminders.off": "オフ",
  "profile.reminders.denied": "ブラウザの設定でブロックされています。",
  "profile.reminders.needsInstall": "iPhone では、リマインダーをオンにする前にアプリをインストールしてください。",
  "profile.reminders.unsupported": "このブラウザはリマインダーを送信できません。",
  "profile.reminders.permission.title": "リマインダーを許可しますか？",
  "profile.reminders.permission.body": "Primary Practice は、毎日午後に練習を促す短い通知を送りたいと考えています。",
  "profile.reminders.permission.allow": "許可",
  "profile.reminders.permission.deny": "許可しない",
  "profile.version.title": "バージョン",
  "profile.version.upToDate": "{{version}} · 最新です",
  "profile.version.updateReady": "{{version}} · 更新できます",
  "profile.offline.empty": "まだ何も保存されていません。オンラインのときにテストの「オフライン用に保存」を使ってください。",
  "profile.offline.item": "{{level}} · {{size}} MB",
  "profile.offline.remove": "{{title}} をこの端末から削除",
  "profile.language": "言語",
  "profile.admin": "管理コンソール",
  "profile.signOut": "サインアウト",
  "profile.signOutConfirm.title": "サインアウトしますか？",
  "profile.signOutConfirm.body": "もう一度サインインが必要です。オフライン用に保存したテストはこの端末から削除されます。",
  "profile.signOutConfirm.cancel": "キャンセル",
}

for (const [locale, entries] of Object.entries({ en, de, es, fr, it, ja })) {
  const file = `${root}/${locale}/runner.json`
  const merged = { ...JSON.parse(readFileSync(file, "utf8")), ...entries }

  writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`)
}
```

Run: `node "$TMPDIR/merge-pwa-strings.mjs" && rm "$TMPDIR/merge-pwa-strings.mjs" && git diff --stat packages/app/src/locales`
Expected: six `runner.json` files changed, only additions/updates (no key removed). If a file's formatting changed beyond the added keys, run `pnpm exec prettier --write packages/app/src/locales` and re-check `git diff` is additions only.

- [ ] **Step 4: Run the catalogue tests and the existing locale gates**

Run: `pnpm --filter @pp/app exec vitest run src/locales && pnpm lint:i18n`
Expected: PASS (`pwa-strings.test.ts` and `locale-parity.test.ts`); `lint:i18n` reports nothing new.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/locales
git commit -m "feat(app): translated strings for install, update, offline, toast and profile UI (six locales)"
```

---

### Task 6: Profile route — identity, install, reminders, version, saved tests, language, admin, sign out

**Files:**
- Create: `packages/app/src/app-version.ts`
- Create: `packages/app/src/lib/reminders.ts`, `packages/app/src/lib/reminders.test.ts`
- Create: `packages/app/src/components/InstallSheet.tsx`, `packages/app/src/components/InstallSheet.test.tsx`
- Create: `packages/app/src/components/RemindersRow.tsx`, `packages/app/src/components/RemindersRow.test.tsx`
- Create: `packages/app/src/components/OfflineStorageList.tsx`, `packages/app/src/components/OfflineStorageList.test.tsx`
- Create: `packages/app/src/pages/profile.tsx`, `packages/app/src/pages/profile.test.tsx`
- Modify: `packages/app/src/index.css` (language group), `packages/app/src/route.gen.ts` (regenerated)

**Interfaces:**
- Consumes: `getCurrentStudent(): Promise<Student>` (`lib/session-api.ts`; `Student { id; displayName; email; level; isAdmin }`); `signOut()` and `SIGN_IN_PATH` (`lib/auth.ts`, `lib/authPaths.ts`); `pwaStore`, `startInstall` (Task 3); `BottomSheet`, `Icon`, `toastStore` (Task 4); `i18n.changeLanguage`, `LANGUAGES = ["en","fr","de","es","it","ja"]` (same list as `AppMenu.tsx`).
- Produces:
  - `lib/reminders.ts`: `type ReminderState = "off" | "on" | "denied" | "needs-install" | "unsupported"`; `reminders: { state(): Promise<ReminderState>; enable(): Promise<ReminderState>; disable(): Promise<ReminderState> }` — **in this task every method resolves `"unsupported"`** (no push yet; Task 25 replaces the body, not the shape).
  - `InstallSheet { open; onOpenChange; kind: "ios" | "manual"; onConfirm: () => void; returnFocusRef? }` — Task 7 (Library) reuses it.
  - `RemindersRow { state: ReminderState; busy?: boolean; onToggle: (next: boolean) => void }`.
  - `OfflineStorageList { items: ReadonlyArray<OfflineStorageItem>; onRemove: (slug: string) => void }` with `OfflineStorageItem { slug; title; level: string; sizeMb: number }` — Task 16 feeds it real data.
  - `APP_VERSION: string` (`app-version.ts`).
  - Route `/profile` (file `pages/profile.tsx`).

- [ ] **Step 1: Failing tests for `reminders` and `APP_VERSION`**

Create `packages/app/src/lib/reminders.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { reminders } from "./reminders.js"

describe("reminders (before Web Push exists)", () => {
  it("reports unsupported and cannot be switched on", async () => {
    await expect(reminders.state()).resolves.toBe("unsupported")
    await expect(reminders.enable()).resolves.toBe("unsupported")
    await expect(reminders.disable()).resolves.toBe("unsupported")
  })
})
```

Create `packages/app/src/lib/reminders.ts`:

```ts
export type ReminderState =
  | "off"
  | "on"
  | "denied"
  | "needs-install"
  | "unsupported"

/**
 * Task 6 ships the Profile row against this interface with no push backend:
 * every method answers "unsupported", which renders the row disabled with
 * an honest reason. Task 25 replaces these bodies (permission → subscribe
 * → PUT /api/me/reminders) without changing the shape.
 */
export const reminders: {
  state(): Promise<ReminderState>
  enable(): Promise<ReminderState>
  disable(): Promise<ReminderState>
} = {
  state: () => Promise.resolve("unsupported"),
  enable: () => Promise.resolve("unsupported"),
  disable: () => Promise.resolve("unsupported"),
}
```

Create `packages/app/src/app-version.ts`:

```ts
declare const __APP_VERSION__: string

/** Injected by vite.config.ts `define`; Vitest does not define it. */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev"
```

Run: `pnpm --filter @pp/app exec vitest run src/lib/reminders.test.ts` — PASS.

- [ ] **Step 2: Failing tests for `InstallSheet`, `RemindersRow`, `OfflineStorageList`**

Create `packages/app/src/components/InstallSheet.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import { InstallSheet } from "./InstallSheet.js"

describe("InstallSheet", () => {
  afterEach(cleanup)

  it("iOS: three numbered Share-menu steps and an 'I've added it' confirmation", async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()

    render(<InstallSheet open onOpenChange={() => undefined} kind="ios" onConfirm={onConfirm} />)

    expect(screen.getByRole("dialog", { name: "Add to Home Screen" })).toBeInTheDocument()
    expect(screen.getAllByRole("listitem")).toHaveLength(3)
    expect(screen.getByText("Safari installs apps from the Share menu.")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "I've added it" }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it("manual: tells the student to use the browser menu, with a Close button instead of a confirmation", async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()

    render(<InstallSheet open onOpenChange={onOpenChange} kind="manual" onConfirm={() => undefined} />)

    expect(screen.getByRole("dialog", { name: "Install this app" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "I've added it" })).not.toBeInTheDocument()
    await user.click(screen.getAllByRole("button", { name: "Close" }).at(-1) as HTMLElement)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
```

Create `packages/app/src/components/RemindersRow.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import { RemindersRow } from "./RemindersRow.js"

describe("RemindersRow", () => {
  afterEach(cleanup)

  it("off: an unchecked, enabled switch described as Off", async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()

    render(<RemindersRow state="off" onToggle={onToggle} />)

    const toggle = screen.getByRole("switch", { name: "Practice reminders" })

    expect(toggle).not.toBeChecked()
    expect(toggle).toBeEnabled()
    expect(toggle).toHaveAccessibleDescription("Off")
    await user.click(toggle)
    expect(onToggle).toHaveBeenCalledWith(true)
  })

  it("on: checked, shows the daily time, turning it off reports false", async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()

    render(<RemindersRow state="on" onToggle={onToggle} />)

    expect(screen.getByRole("switch")).toBeChecked()
    expect(screen.getByRole("switch")).toHaveAccessibleDescription("Daily at 4:30 pm")
    await user.click(screen.getByRole("switch"))
    expect(onToggle).toHaveBeenCalledWith(false)
  })

  it.each([
    ["denied", "Blocked in your browser settings."],
    ["needs-install", "On iPhone, install the app first to turn reminders on."],
    ["unsupported", "This browser can't send reminders."],
  ] as const)("%s: switch is disabled and the reason is shown", (state, reason) => {
    render(<RemindersRow state={state} onToggle={() => undefined} />)

    expect(screen.getByRole("switch")).toBeDisabled()
    expect(screen.getByRole("switch")).toHaveAccessibleDescription(reason)
  })

  it("busy: disables the switch while a change is in flight", () => {
    render(<RemindersRow state="off" busy onToggle={() => undefined} />)

    expect(screen.getByRole("switch")).toBeDisabled()
  })
})
```

Create `packages/app/src/components/OfflineStorageList.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import { OfflineStorageList } from "./OfflineStorageList.js"

describe("OfflineStorageList", () => {
  afterEach(cleanup)

  it("shows the empty explanation when nothing is saved", () => {
    render(<OfflineStorageList items={[]} onRemove={() => undefined} />)

    expect(
      screen.getByText("Nothing saved yet. Use “Save offline” on a test while you're online."),
    ).toBeInTheDocument()
  })

  it("lists each saved test with level and size and a named Remove control", async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()

    render(
      <OfflineStorageList
        items={[
          { slug: "practice-3", title: "Practice Test 3", level: "Step 1", sizeMb: 18 },
          { slug: "practice-1-s2", title: "Practice Test 1", level: "Step 2", sizeMb: 21 },
        ]}
        onRemove={onRemove}
      />,
    )

    expect(screen.getByText("Step 1 · 18 MB")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Remove Practice Test 3 from this phone" }))
    expect(onRemove).toHaveBeenCalledWith("practice-3")
  })
})
```

Run: `pnpm --filter @pp/app exec vitest run src/components/InstallSheet.test.tsx src/components/RemindersRow.test.tsx src/components/OfflineStorageList.test.tsx` — Expected: FAIL (modules missing).

- [ ] **Step 3: Implement the three components**

`packages/app/src/components/InstallSheet.tsx`:

```tsx
import type { JSX, RefObject } from "react"
import { useTranslation } from "react-i18next"
import { BottomSheet } from "./BottomSheet.js"
import { Icon } from "./Icon.js"

export interface InstallSheetProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly kind: "ios" | "manual"
  readonly onConfirm: () => void
  readonly returnFocusRef?: RefObject<HTMLElement | null>
}

/** Prototype `case "install"` sheet. Android's native prompt is Chrome's own UI, so only iOS and manual steps live here. */
export function InstallSheet({
  open,
  onOpenChange,
  kind,
  onConfirm,
  returnFocusRef,
}: InstallSheetProps): JSX.Element {
  const { t } = useTranslation("runner")

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t(kind === "ios" ? "pwa.install.ios.title" : "pwa.install.manual.title")}
      closeLabel={t("pwa.sheet.close")}
      returnFocusRef={returnFocusRef}
    >
      {kind === "ios" ? (
        <>
          <p className="reason">{t("pwa.install.ios.hint")}</p>
          <ol className="steps">
            <li>
              <span className="n">1</span>
              <span>
                {t("pwa.install.ios.step1")} <Icon name="share" small />
              </span>
            </li>
            <li>
              <span className="n">2</span>
              <span>
                {t("pwa.install.ios.step2")} <Icon name="plus" small />
              </span>
            </li>
            <li>
              <span className="n">3</span>
              <span>{t("pwa.install.ios.step3")}</span>
            </li>
          </ol>
          <div className="btnrow">
            <button type="button" className="btn" onClick={onConfirm}>
              {t("pwa.install.ios.done")}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                onOpenChange(false)
              }}
            >
              {t("pwa.install.close")}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="reason">{t("pwa.install.manual.body")}</p>
          <div className="btnrow">
            <button
              type="button"
              className="btn"
              onClick={() => {
                onOpenChange(false)
              }}
            >
              {t("pwa.install.close")}
            </button>
          </div>
        </>
      )}
    </BottomSheet>
  )
}
```

`packages/app/src/components/RemindersRow.tsx`:

```tsx
import { useId, type JSX } from "react"
import { useTranslation } from "react-i18next"
import type { ReminderState } from "../lib/reminders.js"
import { Icon } from "./Icon.js"

export interface RemindersRowProps {
  readonly state: ReminderState
  readonly busy?: boolean
  readonly onToggle: (next: boolean) => void
}

const BLOCKED_KEY: Partial<Record<ReminderState, string>> = {
  denied: "profile.reminders.denied",
  "needs-install": "profile.reminders.needsInstall",
  unsupported: "profile.reminders.unsupported",
}

/** Prototype `vProfile()` reminders row (`.li` + `.switch`). */
export function RemindersRow({ state, busy = false, onToggle }: RemindersRowProps): JSX.Element {
  const { t } = useTranslation("runner")
  const descriptionId = useId()
  const blockedKey = BLOCKED_KEY[state]
  const description = blockedKey ?? (state === "on" ? "profile.reminders.on" : "profile.reminders.off")

  return (
    <div className="li">
      <span className="ticon">
        <Icon name="bell" />
      </span>
      <div className="t">
        {t("profile.reminders.title")}
        <small id={descriptionId}>{t(description)}</small>
      </div>
      <span className="switch">
        <input
          type="checkbox"
          role="switch"
          aria-label={t("profile.reminders.title")}
          aria-describedby={descriptionId}
          checked={state === "on"}
          disabled={blockedKey !== undefined || busy}
          onChange={(event) => {
            onToggle(event.currentTarget.checked)
          }}
        />
        <i />
      </span>
    </div>
  )
}
```

`packages/app/src/components/OfflineStorageList.tsx`:

```tsx
import type { JSX } from "react"
import { useTranslation } from "react-i18next"
import { Icon } from "./Icon.js"

export interface OfflineStorageItem {
  readonly slug: string
  readonly title: string
  readonly level: string
  readonly sizeMb: number
}

export interface OfflineStorageListProps {
  readonly items: ReadonlyArray<OfflineStorageItem>
  readonly onRemove: (slug: string) => void
}

/** Prototype `vProfile()` "Saved for offline" list. */
export function OfflineStorageList({ items, onRemove }: OfflineStorageListProps): JSX.Element {
  const { t } = useTranslation("runner")

  if (items.length === 0) {
    return (
      <div className="list">
        <div className="li">
          <div className="t">
            <small>{t("profile.offline.empty")}</small>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="list">
      {items.map((item) => (
        <div className="li" key={item.slug}>
          <span className="ticon">
            <Icon name="cloud" />
          </span>
          <div className="t">
            {item.title}
            <small>{t("profile.offline.item", { level: item.level, size: item.sizeMb })}</small>
          </div>
          <button
            type="button"
            className="iconbtn"
            aria-label={t("profile.offline.remove", { title: item.title })}
            onClick={() => {
              onRemove(item.slug)
            }}
          >
            <Icon name="trash" />
          </button>
        </div>
      ))}
    </div>
  )
}
```

Run the three component test files — Expected: PASS.

- [ ] **Step 4: Failing tests for the Profile screen**

Create `packages/app/src/pages/profile.test.tsx`:

```tsx
import { cleanup, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import i18n from "../i18n.js"
import type { Student } from "../lib/api-types.js"
import type { PwaSnapshot } from "../lib/pwa/pwa-store.js"
import { renderWithRouter } from "../test/renderWithRouter.js"
import { OfflineStorageList } from "../components/OfflineStorageList.js"
import { ProfileScreen } from "./profile.js"

const student: Student = {
  id: "s1",
  displayName: "Minh Anh",
  email: "minh@example.com",
  level: "primary-step-1",
  isAdmin: false,
}

const browserTab: PwaSnapshot = {
  standalone: false,
  canPromptInstall: true,
  platform: "android",
  installDismissed: false,
  updateReady: false,
}

function renderProfile(overrides: Partial<Parameters<typeof ProfileScreen>[0]> = {}) {
  const props: Parameters<typeof ProfileScreen>[0] = {
    student,
    pwa: browserTab,
    version: "4.1.0",
    reminders: { state: "unsupported", busy: false, onToggle: () => undefined },
    offlineStorage: <OfflineStorageList items={[]} onRemove={() => undefined} />,
    onInstall: () => undefined,
    onRefresh: () => undefined,
    onSignOut: () => undefined,
    ...overrides,
  }

  return renderWithRouter(<ProfileScreen {...props} />)
}

describe("ProfileScreen", () => {
  afterEach(async () => {
    cleanup()
    await i18n.changeLanguage("en")
  })

  it("names the student and how they signed in, under one h1", async () => {
    renderProfile()

    expect(await screen.findByRole("heading", { level: 1, name: "Profile" })).toBeInTheDocument()
    expect(screen.getByText("Minh Anh")).toBeInTheDocument()
    expect(screen.getByText("Signed in with auth.icovn.me")).toBeInTheDocument()
  })

  it("offers Install in a browser tab and the Installed chip when running as an app", async () => {
    const user = userEvent.setup()
    const onInstall = vi.fn()

    const view = renderProfile({ onInstall })

    expect(await screen.findByText("Not installed")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Install" }))
    expect(onInstall).toHaveBeenCalledTimes(1)
    view.unmount()

    renderProfile({ pwa: { ...browserTab, standalone: true } })
    expect(await screen.findByText("Installed — running as an app")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument()
  })

  it("shows the version with up-to-date wording, or an update with a Refresh button", async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn()

    const view = renderProfile()

    expect(await screen.findByText("4.1.0 · up to date")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument()
    view.unmount()

    renderProfile({ pwa: { ...browserTab, updateReady: true }, onRefresh })
    expect(await screen.findByText("4.1.0 · update ready")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Refresh" }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it("renders the reminders row and forwards toggles", async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()

    renderProfile({ reminders: { state: "off", busy: false, onToggle } })

    await user.click(await screen.findByRole("switch", { name: "Practice reminders" }))
    expect(onToggle).toHaveBeenCalledWith(true)
  })

  it("renders the injected offline-storage slot", async () => {
    renderProfile({
      offlineStorage: (
        <OfflineStorageList
          items={[{ slug: "p3", title: "Practice Test 3", level: "Step 1", sizeMb: 18 }]}
          onRemove={() => undefined}
        />
      ),
    })

    expect(await screen.findByText("Step 1 · 18 MB")).toBeInTheDocument()
  })

  it("switches the interface language", async () => {
    const user = userEvent.setup()

    renderProfile()
    await user.click(await screen.findByRole("button", { name: "fr" }))

    await waitFor(() => expect(i18n.resolvedLanguage).toBe("fr"))
    expect(screen.getByRole("button", { name: "fr" })).toHaveAttribute("aria-pressed", "true")
  })

  it("shows the admin console link only to admins", async () => {
    const view = renderProfile()

    await screen.findByRole("heading", { level: 1 })
    expect(screen.queryByRole("link", { name: "Admin console" })).not.toBeInTheDocument()
    view.unmount()

    renderProfile({ student: { ...student, isAdmin: true } })
    expect(await screen.findByRole("link", { name: "Admin console" })).toHaveAttribute("href", "/admin")
  })

  it("asks before signing out, explains saved tests go too, and only then signs out", async () => {
    const user = userEvent.setup()
    const onSignOut = vi.fn()

    renderProfile({ onSignOut })

    await user.click(await screen.findByRole("button", { name: "Sign out" }))

    const dialog = screen.getByRole("dialog", { name: "Sign out?" })

    expect(dialog).toHaveTextContent("Tests saved for offline use will be removed from this phone.")
    expect(onSignOut).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Cancel" }))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(onSignOut).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Sign out" }))
    await user.click(screen.getAllByRole("button", { name: "Sign out" }).at(-1) as HTMLElement)
    expect(onSignOut).toHaveBeenCalledTimes(1)
  })
})
```

Run: `pnpm --filter @pp/app exec vitest run src/pages/profile.test.tsx` — Expected: FAIL (`./profile.js` missing).

- [ ] **Step 5: Implement `pages/profile.tsx` and the language-group CSS**

Append to the `@layer components` block in `packages/app/src/index.css`:

```css
  .lang-group {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }
  .lang-btn {
    min-width: 44px;
    min-height: 44px;
    border-radius: 12px;
    border: 1.5px solid var(--color-line);
    background: var(--color-paper);
    font-weight: 800;
    color: var(--color-ink-2);
    cursor: pointer;
  }
  .lang-btn[aria-pressed="true"] {
    background: var(--color-teal);
    border-color: var(--color-teal);
    color: #fff;
  }
```

Create `packages/app/src/pages/profile.tsx`:

```tsx
import { Link, createFileRoute } from "@tanstack/react-router"
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type JSX,
  type ReactNode,
} from "react"
import { useTranslation } from "react-i18next"
import { APP_VERSION } from "../app-version.js"
import { BottomSheet } from "../components/BottomSheet.js"
import { Icon } from "../components/Icon.js"
import { InstallSheet } from "../components/InstallSheet.js"
import { OfflineStorageList } from "../components/OfflineStorageList.js"
import { RemindersRow } from "../components/RemindersRow.js"
import type { Student } from "../lib/api-types.js"
import { signOut } from "../lib/auth.js"
import { SIGN_IN_PATH } from "../lib/authPaths.js"
import { startInstall } from "../lib/pwa/install-flow.js"
import { pwaStore, type PwaSnapshot } from "../lib/pwa/pwa-store.js"
import { reminders, type ReminderState } from "../lib/reminders.js"
import { getCurrentStudent } from "../lib/session-api.js"
import { toastStore } from "../lib/toast.js"

const LANGUAGES = ["en", "fr", "de", "es", "it", "ja"] as const

export interface ProfileScreenProps {
  readonly student: Student
  readonly pwa: PwaSnapshot
  readonly version: string
  readonly reminders: {
    readonly state: ReminderState
    readonly busy: boolean
    readonly onToggle: (next: boolean) => void
  }
  /** Task 16 injects the real saved-tests list; Task 6 passes an empty one. */
  readonly offlineStorage: ReactNode
  readonly onInstall: () => void
  readonly onRefresh: () => void
  readonly onSignOut: () => void
}

/** Prototype `vProfile()`. Language and the admin link are additive rows (spec §11). */
export function ProfileScreen({
  student,
  pwa,
  version,
  reminders: reminderProps,
  offlineStorage,
  onInstall,
  onRefresh,
  onSignOut,
}: ProfileScreenProps): JSX.Element {
  const { t, i18n } = useTranslation("runner")
  const [confirmOpen, setConfirmOpen] = useState(false)
  const signOutTrigger = useRef<HTMLButtonElement>(null)
  const [language] = (i18n.resolvedLanguage ?? i18n.language).split("-")

  return (
    <div className="device-page">
      <header className="app-bar">
        <span className="app-brand">{t("profile.title")}</span>
      </header>

      <main className="device-main">
        <h1 className="screen-title" tabIndex={-1}>
          {t("profile.title")}
        </h1>

        <div className="my-3.5 flex items-center gap-3">
          <span
            className="avatar"
            style={{ width: 52, height: 52, fontSize: 22 }}
            aria-hidden="true"
          >
            {student.displayName[0]}
          </span>
          <div>
            <b className="text-lg">{student.displayName}</b>
            <p className="text-ink-2 text-[13.5px]">{t("profile.signedInWith")}</p>
          </div>
        </div>

        <h2 className="eyebrow mt-5.5 mb-2">{t("profile.section.app")}</h2>
        <div className="list">
          <div className="li">
            <span className="ticon">
              <Icon name="plus" />
            </span>
            <div className="t">
              {t("profile.install.title")}
              <small>
                {t(pwa.standalone ? "pwa.install.runningAsApp" : "pwa.install.notInstalled")}
              </small>
            </div>
            {pwa.standalone ? (
              <span className="chip good">
                <Icon name="check" small /> {t("pwa.install.installed")}
              </span>
            ) : (
              <button type="button" className="btn sm secondary" onClick={onInstall}>
                {t("pwa.install.button")}
              </button>
            )}
          </div>

          <RemindersRow
            state={reminderProps.state}
            busy={reminderProps.busy}
            onToggle={reminderProps.onToggle}
          />

          <div className="li">
            <span className="ticon">
              <Icon name="refresh" />
            </span>
            <div className="t">
              {t("profile.version.title")}
              <small>
                {t(pwa.updateReady ? "profile.version.updateReady" : "profile.version.upToDate", {
                  version,
                })}
              </small>
            </div>
            {pwa.updateReady ? (
              <button type="button" className="btn sm" onClick={onRefresh}>
                {t("pwa.update.refresh")}
              </button>
            ) : null}
          </div>
        </div>

        <h2 className="eyebrow mt-5.5 mb-2">{t("profile.section.offline")}</h2>
        {offlineStorage}

        <h2 className="eyebrow mt-5.5 mb-2">{t("profile.language")}</h2>
        <div className="lang-group" role="group" aria-label={t("profile.language")}>
          {LANGUAGES.map((code) => (
            <button
              key={code}
              type="button"
              className="lang-btn"
              aria-pressed={language === code}
              onClick={() => {
                void i18n.changeLanguage(code)
              }}
            >
              {code}
            </button>
          ))}
        </div>

        {student.isAdmin ? (
          <Link to="/admin" className="btn secondary block mt-5.5">
            {t("profile.admin")}
          </Link>
        ) : null}

        <button
          ref={signOutTrigger}
          type="button"
          className="btn secondary block mt-5.5"
          onClick={() => {
            setConfirmOpen(true)
          }}
        >
          <Icon name="logout" /> {t("profile.signOut")}
        </button>
      </main>

      <BottomSheet
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("profile.signOutConfirm.title")}
        closeLabel={t("pwa.sheet.close")}
        returnFocusRef={signOutTrigger}
      >
        <p>{t("profile.signOutConfirm.body")}</p>
        <div className="btnrow">
          <button type="button" className="btn danger" onClick={onSignOut}>
            {t("profile.signOut")}
          </button>
          <button
            type="button"
            className="btn secondary"
            onClick={() => {
              setConfirmOpen(false)
            }}
          >
            {t("profile.signOutConfirm.cancel")}
          </button>
        </div>
      </BottomSheet>
    </div>
  )
}

export function ProfileRouteError(): JSX.Element {
  const { t } = useTranslation("runner")

  return (
    <div className="device-page">
      <main className="center-main">
        <div className="device-card max-w-xl">
          <p role="alert">{t("profile.error")}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a href="/profile" className="btn sm">
              {t("library.errorRetry")}
            </a>
            <a
              href={SIGN_IN_PATH}
              className="btn sm secondary"
              onClick={() => {
                signOut()
              }}
            >
              {t("menu.signOut")}
            </a>
          </div>
        </div>
      </main>
    </div>
  )
}

export function loadProfile(): Promise<Student> {
  return getCurrentStudent()
}

export const Route = createFileRoute("/profile")({
  loader: loadProfile,
  errorComponent: ProfileRouteError,
  component: RouteComponent,
})

function RouteComponent() {
  const { t } = useTranslation("runner")
  const student = Route.useLoaderData()
  const pwa = useSyncExternalStore(pwaStore.subscribe, pwaStore.getSnapshot)
  const [reminderState, setReminderState] = useState<ReminderState>("unsupported")
  const [busy, setBusy] = useState(false)
  const [installKind, setInstallKind] = useState<"ios" | "manual" | null>(null)
  const installTrigger = useRef<HTMLElement>(null)

  useEffect(() => {
    let active = true

    void reminders.state().then((state) => {
      if (active) {
        setReminderState(state)
      }
    })

    return () => {
      active = false
    }
  }, [])

  async function handleInstall(): Promise<void> {
    const step = await startInstall()

    if (step === "accepted") {
      toastStore.show(t("toast.installed"), "check")
    } else if (step === "show-ios" || step === "show-manual") {
      setInstallKind(step === "show-ios" ? "ios" : "manual")
    }
  }

  async function handleToggle(next: boolean): Promise<void> {
    setBusy(true)

    try {
      const state = await (next ? reminders.enable() : reminders.disable())

      setReminderState(state)
      toastStore.show(
        t(
          state === "on"
            ? "toast.remindersOn"
            : state === "denied"
              ? "toast.remindersBlocked"
              : "toast.remindersOff",
        ),
        "bell",
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <ProfileScreen
        student={student}
        pwa={pwa}
        version={APP_VERSION}
        reminders={{
          state: reminderState,
          busy,
          onToggle: (next) => {
            void handleToggle(next)
          },
        }}
        offlineStorage={<OfflineStorageList items={[]} onRemove={() => undefined} />}
        onInstall={() => {
          void handleInstall()
        }}
        onRefresh={() => {
          void pwaStore.applyUpdate()
        }}
        onSignOut={() => {
          signOut()
          globalThis.location.assign(SIGN_IN_PATH)
        }}
      />
      <InstallSheet
        open={installKind !== null}
        onOpenChange={(open) => {
          if (!open) {
            setInstallKind(null)
          }
        }}
        kind={installKind ?? "manual"}
        returnFocusRef={installTrigger}
        onConfirm={() => {
          pwaStore.markInstalled()
          setInstallKind(null)
          toastStore.show(t("toast.installed"), "check")
        }}
      />
    </>
  )
}
```

Run: `pnpm --filter @pp/app exec vitest run src/pages/profile.test.tsx`
Expected: PASS. The sign-out test clicks "Sign out" twice by design (the page button, then the sheet's destructive button); if `getAllByRole(...).at(-1)` hits the page button instead, query within `screen.getByRole("dialog")` using `within(...)` — assert on the confirmation, not on DOM order.

- [ ] **Step 6: Regenerate the route tree and verify**

The TanStack router plugin rewrites `src/route.gen.ts` when Vite runs.

Run: `pnpm --filter @pp/app build && git diff --stat packages/app/src/route.gen.ts && grep -c "ProfileRouteImport\|/profile" packages/app/src/route.gen.ts`
Expected: `route.gen.ts` changed; `/profile` present (count ≥ 2). If the file is unchanged, the plugin did not see `pages/profile.tsx` — confirm the file path is exactly `packages/app/src/pages/profile.tsx` (the `routesDirectory` in `vite.config.ts` is `./src/pages`).

- [ ] **Step 7: Gates, browser check, commit**

Run: `pnpm --filter @pp/app test && pnpm --filter @pp/app typecheck && pnpm lint:frontend && pnpm lint:i18n && pnpm exec oxlint packages/app && pnpm exec prettier --write packages/app/src`
Expected: all green.

Browser check (`pnpm --filter @pp/app dev`, `http://localhost:3000/profile`, 390 × 844): compare against the prototype's Profile tab — avatar 52 px, three-row App list, "Saved for offline" empty list, sign-out confirmation sheet sliding from the bottom with a scrim, Escape closes it and focus returns to the Sign out button, tab bar shows Profile as current.

```bash
git add packages/app/src
git commit -m "feat(app): Profile route — install, reminders, version, saved tests, language, admin link, sign-out confirm"
```

---

### Task 7: Library restyle (greeting, filter, cards, skeleton, install slot, direct start)

Prototype source: `vLibrary`, `testCard`, `banners`, the `.seg`, `.card`, `.chip`, `.btn`, `.sk` CSS. Real source: `packages/app/src/pages/index.tsx` (`LibraryScreen`, `loadLibrary`, `Route`), `lib/testCardState.ts` (`testCardActions`), `pages/tests.$slug.tsx` (`sectionRulesPath`, firstSection reducer — to be shared).

**Behaviour preserved:** `loadLibrary` (catalog + `/me`), pagination ("Show more tests"), `testCardActions` rules, summary stats, error component (restyled in Task 8). **Behaviour changed (prototype parity):** Start / Try again no longer link to the brief screen; they start the attempt and go straight to the first section's rules (matrix row 11); other tests' Start is disabled while one test is in progress ("Finish X first").

**Files:**
- Create: `packages/app/scripts/add-locale-keys.mjs` (shared by every later task)
- Create: `packages/app/src/lib/start-test.ts`, `packages/app/src/lib/start-test.test.ts`
- Create: `packages/app/src/lib/library-state.ts`, `packages/app/src/lib/library-state.test.ts`
- Create: `packages/app/src/components/LibraryTestCard.tsx`, `packages/app/src/components/LibraryTestCard.test.tsx`
- Create: `packages/app/src/components/LibraryFilter.tsx`, `packages/app/src/components/LibraryFilter.test.tsx`
- Create: `packages/app/src/components/LibrarySkeleton.tsx`
- Modify: `packages/app/src/pages/index.tsx`, `packages/app/src/pages/index.test.tsx`
- Modify: `packages/app/src/pages/tests.$slug.tsx` (import the shared helpers; behaviour unchanged)
- Modify: `packages/app/src/index.css` (append the shared `m-*` screen vocabulary to `@layer components`)
- Modify: `packages/app/src/locales/{de,en,es,fr,it,ja}/runner.json` (via the script)

**Interfaces:**
- Consumes (Part A, spec §6): `pwaStore` (`getSnapshot(): PwaSnapshot`, `subscribe`, `promptInstall()`, `markInstalled()`, `dismissInstall()`), `InstallCard` from `components/Banners.tsx` (props `{ onInstall: () => void; onDismiss: () => void }`), `InstallSheet` from `components/InstallSheet.tsx` (props `{ open: boolean; onOpenChange: (open: boolean) => void; platform: PwaPlatform; onConfirm: () => void }` — see Part notes: this is an extension of the spec §6 contract that Part A Task 4 must provide), `Icon` from `components/Icon.tsx` (props `{ name: IconName; className?: string }`; names `home clock user check x minus download back grid headphones play wifioff share plus bell chev trash book calc refresh logout more lock cloud alert`, `aria-hidden`).
- Produces:
  - `lib/library-state.ts`: `type LibraryFilterValue = "all" | "todo" | "done"`; `matchesFilter(test: TestCard, filter: LibraryFilterValue): boolean`; `waitingCount(tests: readonly TestCard[]): number`; `blockingTest(tests: readonly TestCard[]): TestCard | undefined`.
  - `lib/start-test.ts`: `sectionRulesPath(attempt: AttemptStart, sectionId: string): string`; `firstSectionOf(brief: TestBrief): TestBrief["sections"][number] | undefined`; `startTestAndRulesPath(slug: string): Promise<string>` (rejects when the brief has no sections, without calling `startAttempt`).
  - `components/LibraryTestCard.tsx`: `LibraryTestCard(props: LibraryTestCardProps)` with `{ test: TestCard; highlighted: boolean; starting: boolean; disabledReason: string | null; onStart: (test: TestCard) => void; extras?: ReactNode }`.
  - `components/LibraryFilter.tsx`: `LibraryFilter({ value, onChange })` where `value: LibraryFilterValue`.
  - `components/LibrarySkeleton.tsx`: `LibrarySkeleton()` (three `.m-skeleton` cards, `role="status"`, `aria-busy`).
  - `LibraryScreenProps` gains optional `navigate?: (path: string) => void` (default `window.location.assign`), `renderCardExtras?: (test: TestCard) => ReactNode` and `startDisabledReason?: (test: TestCard) => string | null` — Part C Task 16 uses the last two for the offline download controls and the offline Start gate.
  - CSS classes (all later Part B tasks reuse them): `m-page m-appbar m-brand m-avatar m-iconbtn m-body m-title m-sub m-eyebrow m-btn m-reason m-card m-stack m-row m-meta m-chips m-chip m-actions m-seg m-notice m-skeleton m-stats m-actionbar m-ticon`.

- [ ] **Step 1: Add the shared locale-patch script**

  Create `packages/app/scripts/add-locale-keys.mjs`:

  ```js
  // Merges a { locale: { key: value } } patch into src/locales/<locale>/<namespace>.json
  // for every locale, so the six files can never drift apart.
  import { readFileSync, writeFileSync } from "node:fs"
  import { dirname, join } from "node:path"
  import { fileURLToPath } from "node:url"

  const LOCALES = ["de", "en", "es", "fr", "it", "ja"]
  const [namespace, patchPath] = process.argv.slice(2)

  if (!namespace || !patchPath) {
    console.error("usage: node add-locale-keys.mjs <namespace> <patch.json>")
    process.exit(2)
  }

  const patch = JSON.parse(readFileSync(patchPath, "utf8"))
  const missing = LOCALES.filter((locale) => !(locale in patch))

  if (missing.length > 0) {
    console.error(`patch is missing locales: ${missing.join(", ")}`)
    process.exit(1)
  }

  const root = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "src",
    "locales",
  )

  for (const locale of LOCALES) {
    const file = join(root, locale, `${namespace}.json`)
    const current = JSON.parse(readFileSync(file, "utf8"))

    writeFileSync(
      file,
      `${JSON.stringify({ ...current, ...patch[locale] }, null, 2)}\n`,
    )
  }
  ```

  Locale rule used by every task: English, German, Spanish, French and Italian use `_one`/`_other` for counted strings; Japanese uses the bare key (see `ja/runner.json` `library.waiting`). The parity test strips the suffix, so each locale must carry the idiomatic form.

- [ ] **Step 2: Add the Task 7 strings**

  ```bash
  PATCH="$(mktemp)" && cat > "$PATCH" <<'EOF'
  {
    "en": {
      "library.filter.label": "Filter tests",
      "library.filter.all": "All",
      "library.filter.todo": "To do",
      "library.filter.done": "Done",
      "library.caughtUp": "You're all caught up.",
      "library.statusInProgress": "In progress · {{section}}",
      "library.statusBest": "Best {{percentage}}%",
      "library.blockedByActive": "Finish {{title}} first.",
      "library.filterEmpty": "Nothing here yet.",
      "library.skeletonLabel": "Loading tests"
    },
    "de": {
      "library.filter.label": "Tests filtern",
      "library.filter.all": "Alle",
      "library.filter.todo": "Offen",
      "library.filter.done": "Erledigt",
      "library.caughtUp": "Du bist auf dem neuesten Stand.",
      "library.statusInProgress": "Läuft · {{section}}",
      "library.statusBest": "Beste {{percentage}} %",
      "library.blockedByActive": "Beende zuerst {{title}}.",
      "library.filterEmpty": "Hier ist noch nichts.",
      "library.skeletonLabel": "Tests werden geladen"
    },
    "es": {
      "library.filter.label": "Filtrar pruebas",
      "library.filter.all": "Todas",
      "library.filter.todo": "Pendientes",
      "library.filter.done": "Hechas",
      "library.caughtUp": "¡Estás al día!",
      "library.statusInProgress": "En curso · {{section}}",
      "library.statusBest": "Mejor {{percentage}} %",
      "library.blockedByActive": "Termina primero {{title}}.",
      "library.filterEmpty": "Aquí todavía no hay nada.",
      "library.skeletonLabel": "Cargando pruebas"
    },
    "fr": {
      "library.filter.label": "Filtrer les tests",
      "library.filter.all": "Tous",
      "library.filter.todo": "À faire",
      "library.filter.done": "Terminés",
      "library.caughtUp": "Tu es à jour.",
      "library.statusInProgress": "En cours · {{section}}",
      "library.statusBest": "Meilleur {{percentage}} %",
      "library.blockedByActive": "Termine d’abord {{title}}.",
      "library.filterEmpty": "Rien ici pour le moment.",
      "library.skeletonLabel": "Chargement des tests"
    },
    "it": {
      "library.filter.label": "Filtra i test",
      "library.filter.all": "Tutti",
      "library.filter.todo": "Da fare",
      "library.filter.done": "Fatti",
      "library.caughtUp": "Sei in pari con tutto.",
      "library.statusInProgress": "In corso · {{section}}",
      "library.statusBest": "Migliore {{percentage}}%",
      "library.blockedByActive": "Finisci prima {{title}}.",
      "library.filterEmpty": "Qui non c’è ancora niente.",
      "library.skeletonLabel": "Caricamento dei test"
    },
    "ja": {
      "library.filter.label": "テストを絞り込む",
      "library.filter.all": "すべて",
      "library.filter.todo": "これから",
      "library.filter.done": "終わった",
      "library.caughtUp": "全部終わりました。",
      "library.statusInProgress": "途中 · {{section}}",
      "library.statusBest": "ベスト {{percentage}}%",
      "library.blockedByActive": "先に「{{title}}」を終わらせましょう。",
      "library.filterEmpty": "まだありません。",
      "library.skeletonLabel": "テストを読み込み中"
    }
  }
  EOF
  node packages/app/scripts/add-locale-keys.mjs runner "$PATCH" && pnpm --filter @pp/app test src/locales
  ```

  Expected: `locale-parity.test.ts` passes (all six locales carry the ten new keys).

- [ ] **Step 3: Write the failing pure-logic tests**

  `packages/app/src/lib/library-state.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest"
  import type { TestCard } from "./api-types.js"
  import { blockingTest, matchesFilter, waitingCount } from "./library-state.js"

  const base: TestCard = {
    id: "t",
    slug: "t",
    title: "T",
    level: "primary-step-1",
    durationSeconds: 1200,
    sections: [{ type: "listening", questionCount: 4 }],
    inProgressAttemptId: null,
    attemptCount: 0,
    bestAttempt: null,
  }
  const fresh = { ...base, id: "fresh" }
  const finished = { ...base, id: "finished", attemptCount: 2 }
  const running = {
    ...base,
    id: "running",
    attemptCount: 1,
    inProgressAttemptId: "a1",
  }

  describe("library-state", () => {
    it("filters like the prototype: todo = never finished or in progress, done = any finished attempt", () => {
      expect(matchesFilter(fresh, "todo")).toBe(true)
      expect(matchesFilter(finished, "todo")).toBe(false)
      expect(matchesFilter(running, "todo")).toBe(true)
      expect(matchesFilter(fresh, "done")).toBe(false)
      expect(matchesFilter(finished, "done")).toBe(true)
      expect(matchesFilter(running, "done")).toBe(true)
      expect(matchesFilter(finished, "all")).toBe(true)
    })

    it("counts only tests with no attempts as waiting", () => {
      expect(waitingCount([fresh, finished, running])).toBe(1)
      expect(waitingCount([])).toBe(0)
    })

    it("finds the one test that is in progress", () => {
      expect(blockingTest([fresh, running, finished])?.id).toBe("running")
      expect(blockingTest([fresh, finished])).toBeUndefined()
    })
  })
  ```

  `packages/app/src/lib/start-test.test.ts`:

  ```ts
  import { beforeEach, describe, expect, it, vi } from "vitest"
  import type { AttemptStart, TestBrief } from "./api-types.js"
  import { startAttempt } from "./attempts-api.js"
  import { getTest } from "./catalog-api.js"
  import { startTestAndRulesPath } from "./start-test.js"

  vi.mock("./attempts-api.js", () => ({ startAttempt: vi.fn() }))
  vi.mock("./catalog-api.js", () => ({ getTest: vi.fn() }))

  const brief = {
    id: "t",
    slug: "practice-3",
    title: "Practice Test 3",
    level: "primary-step-1",
    durationSeconds: 1320,
    attemptCount: 0,
    inProgressAttemptId: null,
    sections: [
      { id: "s2", ordinal: 2, type: "reading", title: "Reading" },
      { id: "s1", ordinal: 1, type: "listening", title: "Listening" },
    ],
  } as unknown as TestBrief
  const attempt = {
    id: "a1",
    attemptNumber: 1,
    status: "in_progress",
    finalizedPriorAttempt: null,
  } as unknown as AttemptStart

  describe("startTestAndRulesPath", () => {
    beforeEach(() => {
      vi.mocked(getTest).mockReset()
      vi.mocked(startAttempt).mockReset()
    })

    it("starts the attempt and returns the rules path of the lowest-ordinal section", async () => {
      vi.mocked(getTest).mockResolvedValue(brief)
      vi.mocked(startAttempt).mockResolvedValue(attempt)

      await expect(startTestAndRulesPath("practice-3")).resolves.toBe(
        "/attempts/a1/sections/s1/rules",
      )
      expect(startAttempt).toHaveBeenCalledWith("practice-3")
    })

    it("carries a finalizedPriorAttempt notice in the search string", async () => {
      vi.mocked(getTest).mockResolvedValue(brief)
      vi.mocked(startAttempt).mockResolvedValue({
        ...attempt,
        finalizedPriorAttempt: {
          id: "old",
          status: "expired",
          submittedAt: "2026-11-01T10:00:00.000Z",
          resultUrl: "/attempts/old/result",
        },
      })

      const path = await startTestAndRulesPath("practice-3")

      expect(path.startsWith("/attempts/a1/sections/s1/rules?")).toBe(true)
      expect(path).toContain("finalizedPriorAttempt")
    })

    it("refuses a test with no sections without creating an attempt", async () => {
      vi.mocked(getTest).mockResolvedValue({ ...brief, sections: [] })

      await expect(startTestAndRulesPath("practice-3")).rejects.toThrow(
        "no sections",
      )
      expect(startAttempt).not.toHaveBeenCalled()
    })
  })
  ```

- [ ] **Step 4: Run them to confirm RED**

  Run: `pnpm --filter @pp/app test src/lib/library-state.test.ts src/lib/start-test.test.ts`
  Expected: FAIL — `Failed to resolve import "./library-state.js"` / `"./start-test.js"`.

- [ ] **Step 5: Implement the two lib modules and share them with the brief screen**

  `packages/app/src/lib/library-state.ts`:

  ```ts
  import type { TestCard } from "./api-types.js"

  export type LibraryFilterValue = "all" | "todo" | "done"

  /** Prototype `vLibrary`: `done` = has a finished attempt; `todo` = never attempted, or in progress. */
  export function matchesFilter(
    test: TestCard,
    filter: LibraryFilterValue,
  ): boolean {
    if (filter === "done") {
      return test.attemptCount > 0
    }

    if (filter === "todo") {
      return test.attemptCount === 0 || test.inProgressAttemptId !== null
    }

    return true
  }

  export function waitingCount(tests: readonly TestCard[]): number {
    return tests.filter((test) => test.attemptCount === 0).length
  }

  export function blockingTest(tests: readonly TestCard[]): TestCard | undefined {
    return tests.find((test) => test.inProgressAttemptId !== null)
  }
  ```

  `packages/app/src/lib/start-test.ts`:

  ```ts
  import { defaultStringifySearch } from "@tanstack/react-router"
  import type { AttemptStart, TestBrief } from "./api-types.js"
  import { startAttempt } from "./attempts-api.js"
  import { getTest } from "./catalog-api.js"

  export function sectionRulesPath(
    attempt: AttemptStart,
    sectionId: string,
  ): string {
    const search = attempt.finalizedPriorAttempt
      ? defaultStringifySearch({
          finalizedPriorAttempt: attempt.finalizedPriorAttempt,
        })
      : ""

    return `/attempts/${attempt.id}/sections/${sectionId}/rules${search}`
  }

  export function firstSectionOf(
    brief: TestBrief,
  ): TestBrief["sections"][number] | undefined {
    return brief.sections.reduce<TestBrief["sections"][number] | undefined>(
      (first, section) =>
        !first || section.ordinal < first.ordinal ? section : first,
      undefined,
    )
  }

  /** Library "Start": brief (for the first section id) → POST /attempts → rules path. */
  export async function startTestAndRulesPath(slug: string): Promise<string> {
    const brief = await getTest(slug)
    const first = firstSectionOf(brief)

    if (!first) {
      throw new Error(`test ${slug} has no sections`)
    }

    const attempt = await startAttempt(slug)

    return sectionRulesPath(attempt, first.id)
  }
  ```

  In `packages/app/src/pages/tests.$slug.tsx`: delete the local `sectionRulesPath` function and the `defaultStringifySearch` import; replace the `const firstSection = brief.sections.reduce<…>(…)` expression with `const firstSection = firstSectionOf(brief)`; and add `import { firstSectionOf, sectionRulesPath } from "../lib/start-test.js"`. Change the router import to `import { createFileRoute } from "@tanstack/react-router"`.

- [ ] **Step 6: Run to confirm GREEN, including the untouched brief tests**

  Run: `pnpm --filter @pp/app test src/lib/library-state.test.ts src/lib/start-test.test.ts "src/pages/tests.\$slug.test.tsx"`
  Expected: PASS (brief behaviour unchanged).

- [ ] **Step 7: Write the failing component tests**

  `packages/app/src/components/LibraryTestCard.test.tsx` (uses the existing `renderWithRouter` helper, whose route tree includes `/attempts/$attemptId/run` and `/result`):

  ```tsx
  import { cleanup, screen } from "@testing-library/react"
  import userEvent from "@testing-library/user-event"
  import { afterEach, describe, expect, it, vi } from "vitest"
  import "../i18n.js"
  import type { TestCard } from "../lib/api-types.js"
  import { renderWithRouter } from "../test/renderWithRouter.js"
  import { LibraryTestCard } from "./LibraryTestCard.js"

  const fresh: TestCard = {
    id: "t3",
    slug: "practice-3",
    title: "Practice Test 3",
    level: "primary-step-1",
    durationSeconds: 1320,
    sections: [
      { type: "listening", questionCount: 4 },
      { type: "reading", questionCount: 4 },
    ],
    inProgressAttemptId: null,
    attemptCount: 0,
    bestAttempt: null,
  }
  const finished: TestCard = {
    ...fresh,
    attemptCount: 2,
    bestAttempt: {
      attemptId: "a2",
      submittedAt: "2026-11-18T17:05:00.000Z",
      pointsEarned: 7,
      pointsPossible: 8,
      percentage: 87.5,
    },
  }
  const running: TestCard = { ...fresh, inProgressAttemptId: "a9", attemptCount: 1 }

  const props = {
    highlighted: false,
    starting: false,
    disabledReason: null,
    onStart: vi.fn(),
  }

  describe("LibraryTestCard", () => {
    afterEach(() => {
      cleanup()
      props.onStart.mockReset()
    })

    it("names the article by its title and lists step, sections and minutes", () => {
      renderWithRouter(<LibraryTestCard {...props} test={fresh} />)

      const card = screen.getByRole("article", { name: "Practice Test 3" })

      expect(card).toHaveTextContent("Step 1 · Listening 4 · Reading 4 · 22 minutes")
    })

    it("starts a fresh test through onStart, as a button", async () => {
      const user = userEvent.setup()

      renderWithRouter(<LibraryTestCard {...props} test={fresh} />)
      await user.click(screen.getByRole("button", { name: "Start test" }))

      expect(props.onStart).toHaveBeenCalledWith(fresh)
    })

    it("offers See result (a link) and Try again for a finished test, with a Best chip", () => {
      renderWithRouter(<LibraryTestCard {...props} test={finished} />)

      expect(screen.getByRole("link", { name: "See result" })).toHaveAttribute(
        "href",
        "/attempts/a2/result",
      )
      expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled()
      expect(screen.getByText("Best 88%")).toBeInTheDocument()
    })

    it("offers only Continue (a link to the runner) and an In progress chip when running", () => {
      renderWithRouter(<LibraryTestCard {...props} test={running} highlighted />)

      expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute(
        "href",
        "/attempts/a9/run",
      )
      expect(screen.queryByRole("button", { name: "Start test" })).toBeNull()
      expect(screen.getByText("In progress · Listening")).toBeInTheDocument()
    })

    it("disables Start with the reason attached when another test is running", () => {
      renderWithRouter(
        <LibraryTestCard
          {...props}
          test={fresh}
          disabledReason="Finish Practice Test 9 first."
        />,
      )

      const start = screen.getByRole("button", { name: "Start test" })

      expect(start).toBeDisabled()
      expect(start).toHaveAccessibleDescription("Finish Practice Test 9 first.")
    })

    it("shows a busy Start while starting and ignores further taps", () => {
      renderWithRouter(<LibraryTestCard {...props} test={fresh} starting />)

      const start = screen.getByRole("button", { name: "Starting…" })

      expect(start).toBeDisabled()
      expect(start).toHaveAttribute("aria-busy", "true")
    })

    it("renders extras (Part C download controls) below the actions", () => {
      renderWithRouter(
        <LibraryTestCard {...props} test={fresh} extras={<p>extras slot</p>} />,
      )

      expect(screen.getByText("extras slot")).toBeInTheDocument()
    })
  })
  ```

  `packages/app/src/components/LibraryFilter.test.tsx`:

  ```tsx
  import { cleanup, render, screen } from "@testing-library/react"
  import userEvent from "@testing-library/user-event"
  import { afterEach, describe, expect, it, vi } from "vitest"
  import "../i18n.js"
  import { LibraryFilter } from "./LibraryFilter.js"

  describe("LibraryFilter", () => {
    afterEach(cleanup)

    it("is a labelled group whose current choice is aria-pressed", () => {
      render(<LibraryFilter value="todo" onChange={vi.fn()} />)

      expect(screen.getByRole("group", { name: "Filter tests" })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "To do" })).toHaveAttribute("aria-pressed", "true")
      expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "false")
    })

    it("reports the chosen filter", async () => {
      const onChange = vi.fn()

      render(<LibraryFilter value="all" onChange={onChange} />)
      await userEvent.setup().click(screen.getByRole("button", { name: "Done" }))

      expect(onChange).toHaveBeenCalledWith("done")
    })
  })
  ```

- [ ] **Step 8: Run to confirm RED**

  Run: `pnpm --filter @pp/app test src/components/LibraryTestCard.test.tsx src/components/LibraryFilter.test.tsx`
  Expected: FAIL — modules not found.

- [ ] **Step 9: Add the shared CSS vocabulary**

  Append inside the `@layer components { … }` block of `packages/app/src/index.css` (before its closing `}`), these rules. They use only the existing `@theme` tokens; later Part B tasks add their own screen-specific rules next to them.

  ```css
  /* ───── Mobile screen vocabulary — docs/prototype/pwa-mobile.html ───── */
  .m-page {
    display: flex;
    min-height: calc(
      100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom)
    );
    flex-direction: column;
    background: var(--color-surface);
    color: var(--color-ink);
  }
  .m-appbar {
    display: flex;
    min-height: 56px;
    align-items: center;
    gap: 10px;
    border-bottom: 1px solid var(--color-line);
    background: var(--color-paper);
    padding: 8px 14px;
  }
  .m-brand {
    color: var(--color-teal);
    font-size: 17px;
    font-weight: 800;
  }
  .m-avatar {
    display: grid;
    width: 32px;
    height: 32px;
    place-items: center;
    border-radius: 50%;
    background: var(--color-teal);
    color: #fff;
    font-size: 14px;
    font-weight: 800;
  }
  .m-iconbtn {
    display: grid;
    width: 44px;
    height: 44px;
    place-items: center;
    border: 0;
    border-radius: 12px;
    background: transparent;
    color: var(--color-ink);
    cursor: pointer;
    touch-action: manipulation;
  }
  .m-body {
    flex: 1 1 auto;
    padding: 18px 16px 24px;
  }
  .m-title {
    margin: 0;
    font-size: 24px;
    font-weight: 800;
    line-height: 1.2;
  }
  .m-title:focus {
    outline: none;
  }
  .m-sub {
    margin: 4px 0 0;
    color: var(--color-ink-2);
    font-size: 15px;
  }
  .m-eyebrow {
    color: var(--color-ink-2);
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.07em;
    text-transform: uppercase;
  }
  .m-btn {
    display: inline-flex;
    min-height: 48px;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border: 2px solid var(--color-teal);
    border-radius: 14px;
    background: var(--color-teal);
    padding: 10px 18px;
    color: #fff;
    cursor: pointer;
    font-size: 16px;
    font-weight: 800;
    text-align: center;
    text-decoration: none;
    touch-action: manipulation;
  }
  .m-btn:hover {
    filter: brightness(0.94);
  }
  .m-btn[data-variant="secondary"] {
    background: var(--color-paper);
    color: var(--color-teal);
  }
  .m-btn[data-variant="ghost"] {
    border-color: transparent;
    background: transparent;
    color: var(--color-teal);
  }
  .m-btn[data-variant="danger"] {
    border-color: var(--color-bad);
    background: var(--color-bad);
  }
  .m-btn[data-size="sm"] {
    min-height: 44px;
    padding: 6px 14px;
    font-size: 14px;
  }
  .m-btn[data-block="true"] {
    width: 100%;
  }
  .m-btn:disabled,
  .m-btn[aria-disabled="true"] {
    border-color: #e8edf1;
    background: #e8edf1;
    color: #5d6a76;
    cursor: not-allowed;
    filter: none;
  }
  .m-btn[aria-busy="true"]::after {
    content: "";
    width: 16px;
    height: 16px;
    border: 3px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: m-spin 0.8s linear infinite;
  }
  @keyframes m-spin {
    to {
      transform: rotate(360deg);
    }
  }
  .m-reason {
    margin-top: 6px;
    color: var(--color-ink-2);
    font-size: 13px;
  }
  .m-card {
    border: 1.5px solid var(--color-line);
    border-radius: 16px;
    background: var(--color-paper);
    padding: 14px;
  }
  .m-card[data-highlight="true"] {
    border-color: var(--color-teal);
  }
  .m-stack > * + * {
    margin-top: 12px;
  }
  .m-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .m-row[data-align="start"] {
    align-items: flex-start;
  }
  .m-meta {
    margin-top: 2px;
    color: var(--color-ink-2);
    font-size: 13.5px;
  }
  .m-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }
  .m-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: 1px solid var(--color-line);
    border-radius: 999px;
    background: var(--color-surface);
    padding: 3px 10px;
    color: var(--color-ink-2);
    font-size: 12.5px;
    font-weight: 800;
  }
  .m-chip[data-tone="teal"] {
    border-color: transparent;
    background: var(--color-teal-bg);
    color: #0b5a63;
  }
  .m-chip[data-tone="good"] {
    border-color: transparent;
    background: var(--color-good-bg);
    color: #1f7a43;
  }
  .m-chip[data-tone="bad"] {
    border-color: transparent;
    background: var(--color-bad-bg);
    color: #b53a34;
  }
  .m-chip[data-tone="warn"] {
    border-color: transparent;
    background: #fdf3df;
    color: #7a4d00;
  }
  .m-chip[data-tone="clay"] {
    border-color: transparent;
    background: var(--color-clay-bg);
    color: var(--color-clay);
  }
  .m-ticon {
    display: grid;
    width: 44px;
    height: 44px;
    flex: none;
    place-items: center;
    border-radius: 12px;
    background: var(--color-teal-bg);
    color: var(--color-teal);
  }
  .m-ticon[data-kind="math"] {
    background: var(--color-clay-bg);
    color: var(--color-clay);
  }
  .m-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
  }
  .m-seg {
    display: flex;
    gap: 6px;
    margin: 16px 0 12px;
  }
  .m-seg > button {
    min-height: 44px;
    flex: 1;
    border: 1.5px solid var(--color-line);
    border-radius: 12px;
    background: var(--color-paper);
    color: var(--color-ink-2);
    cursor: pointer;
    font-weight: 800;
  }
  .m-seg > button[aria-pressed="true"] {
    border-color: var(--color-teal);
    background: var(--color-teal);
    color: #fff;
  }
  .m-notice {
    margin-top: 12px;
    border-radius: 12px;
    background: #fdf3df;
    padding: 10px 12px;
    color: #5c3a00;
    font-size: 14px;
    font-weight: 700;
  }
  .m-skeleton {
    height: 96px;
    border-radius: 16px;
    background: linear-gradient(90deg, #e6ecf1 25%, #f0f4f7 50%, #e6ecf1 75%);
    background-size: 200% 100%;
    animation: m-shimmer 1.2s linear infinite;
  }
  @keyframes m-shimmer {
    to {
      background-position: -200% 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .m-skeleton {
      animation: none;
    }
    .m-btn[aria-busy="true"]::after {
      animation-duration: 2s;
    }
  }
  .m-stats {
    display: flex;
    gap: 28px;
    margin: 18px 0 0;
  }
  .m-stats dt {
    color: var(--color-ink-2);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.07em;
    text-transform: uppercase;
  }
  .m-stats dd {
    margin: 0;
    font-size: 20px;
    font-variant-numeric: tabular-nums;
    font-weight: 800;
  }
  .m-actionbar {
    display: flex;
    align-items: center;
    gap: 10px;
    border-top: 1px solid var(--color-line);
    background: var(--color-paper);
    padding: 10px 14px;
  }
  .m-actionbar > .m-btn {
    flex: 1;
  }
  ```

- [ ] **Step 10: Implement `LibraryFilter`, `LibrarySkeleton`, `LibraryTestCard`**

  `packages/app/src/components/LibraryFilter.tsx`:

  ```tsx
  import { useTranslation } from "react-i18next"
  import type { LibraryFilterValue } from "../lib/library-state.js"

  const CHOICES: readonly LibraryFilterValue[] = ["all", "todo", "done"]

  export interface LibraryFilterProps {
    readonly value: LibraryFilterValue
    readonly onChange: (value: LibraryFilterValue) => void
  }

  export function LibraryFilter({ value, onChange }: LibraryFilterProps) {
    const { t } = useTranslation("runner")

    return (
      <div role="group" aria-label={t("library.filter.label")} className="m-seg">
        {CHOICES.map((choice) => (
          <button
            key={choice}
            type="button"
            aria-pressed={value === choice}
            onClick={() => {
              onChange(choice)
            }}
          >
            {t(`library.filter.${choice}`)}
          </button>
        ))}
      </div>
    )
  }
  ```

  `packages/app/src/components/LibrarySkeleton.tsx`:

  ```tsx
  import { useTranslation } from "react-i18next"

  export function LibrarySkeleton() {
    const { t } = useTranslation("runner")

    return (
      <div role="status" aria-busy="true" className="m-stack">
        <span className="sr-only">{t("library.skeletonLabel")}</span>
        <div className="m-skeleton" />
        <div className="m-skeleton" />
        <div className="m-skeleton" />
      </div>
    )
  }
  ```

  `packages/app/src/components/LibraryTestCard.tsx`:

  ```tsx
  import { Link } from "@tanstack/react-router"
  import type { ReactNode } from "react"
  import { useTranslation } from "react-i18next"
  import type { TestCard } from "../lib/api-types.js"
  import { testCardActions } from "../lib/testCardState.js"
  import { Icon } from "./Icon.js"

  export interface LibraryTestCardProps {
    readonly test: TestCard
    readonly highlighted: boolean
    readonly starting: boolean
    /** Already-translated reason Start is unavailable, or null. */
    readonly disabledReason: string | null
    readonly onStart: (test: TestCard) => void
    /** Slot below the actions (Part C: "Save offline" control / "Available offline" chip). */
    readonly extras?: ReactNode
  }

  export function LibraryTestCard({
    test,
    highlighted,
    starting,
    disabledReason,
    onStart,
    extras,
  }: LibraryTestCardProps) {
    const { t } = useTranslation("runner")
    const titleId = `test-card-${test.id}`
    const reasonId = `test-card-reason-${test.id}`
    const isMath = test.sections.length === 1 && test.sections[0]?.type === "math"
    const running = test.inProgressAttemptId !== null
    const sectionLabels = test.sections.map((section) =>
      t("library.sectionCount", {
        section: t(`library.section.${section.type}`),
        count: section.questionCount,
      }),
    )
    const currentSection = test.sections[0]?.type ?? "listening"
    const startLabel = t(
      test.attemptCount === 0 ? "library.action.start" : "library.action.tryAgain",
    )

    return (
      <article
        aria-labelledby={titleId}
        className="m-card"
        data-highlight={highlighted}
      >
        <div className="m-row" data-align="start">
          <span className="m-ticon" data-kind={isMath ? "math" : "audio"}>
            <Icon name={isMath ? "calc" : "headphones"} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[16.5px] font-extrabold">
              {test.title}
            </h2>
            <p className="m-meta">
              {[
                t(test.level === "primary-step-1" ? "library.step.1" : "library.step.2"),
                ...sectionLabels,
                t("library.durationMinutes", {
                  count: Math.round(test.durationSeconds / 60),
                }),
              ].join(" · ")}
            </p>
            {running || test.bestAttempt ? (
              <div className="m-chips">
                {running ? (
                  <span className="m-chip" data-tone="clay">
                    {t("library.statusInProgress", {
                      section: t(`library.section.${currentSection}`),
                    })}
                  </span>
                ) : null}
                {test.bestAttempt ? (
                  <span className="m-chip" data-tone="teal">
                    {t("library.statusBest", {
                      percentage: Math.round(test.bestAttempt.percentage),
                    })}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="m-actions">
          {testCardActions(test).map((action) => {
            switch (action.kind) {
              case "continue":
                return (
                  <Link
                    key="continue"
                    to="/attempts/$attemptId/run"
                    params={{ attemptId: action.attemptId }}
                    className="m-btn"
                  >
                    {t("library.action.continue")}
                  </Link>
                )

              case "seeResult":
                return (
                  <Link
                    key="seeResult"
                    to="/attempts/$attemptId/result"
                    params={{ attemptId: action.attemptId }}
                    className="m-btn"
                    data-variant="secondary"
                  >
                    {t("library.action.seeResult")}
                  </Link>
                )

              case "start":
              case "tryAgain":
                return (
                  <button
                    key={action.kind}
                    type="button"
                    className="m-btn"
                    data-variant={action.kind === "tryAgain" ? "secondary" : undefined}
                    disabled={starting || disabledReason !== null}
                    aria-busy={starting}
                    aria-describedby={disabledReason ? reasonId : undefined}
                    onClick={() => {
                      onStart(test)
                    }}
                  >
                    {starting ? t("brief.starting") : startLabel}
                  </button>
                )
            }
          })}
        </div>
        {disabledReason ? (
          <p id={reasonId} className="m-reason">
            {disabledReason}
          </p>
        ) : null}
        {extras}
      </article>
    )
  }
  ```

  Note: `currentSection` shows the test's first section type as the in-progress chip's section name; the page cannot know the live section from `TestCard` (the runner knows it). This matches the prototype's chip closely enough and is called out in Part notes.

- [ ] **Step 11: Run component tests to confirm GREEN**

  Run: `pnpm --filter @pp/app test src/components/LibraryTestCard.test.tsx src/components/LibraryFilter.test.tsx`
  Expected: PASS. (If `Icon` is missing, Part A Task 4 has not landed — stop and resolve per Part notes; do not recreate it here.)

- [ ] **Step 12: Write the failing page tests**

  In `packages/app/src/pages/index.test.tsx` add, inside `describe("test library page", …)` (the file's `renderLibrary` helper already builds the router; extend its mock list at the top of the file):

  ```tsx
  vi.mock("../lib/start-test.js", () => ({ startTestAndRulesPath: vi.fn() }))
  vi.mock("../lib/pwa/pwa-store.js", () => {
    const snapshot = {
      standalone: false,
      canPromptInstall: true,
      platform: "android",
      installDismissed: false,
      updateReady: false,
    }

    return {
      pwaStore: {
        subscribe: () => () => undefined,
        getSnapshot: () => snapshot,
        promptInstall: vi.fn().mockResolvedValue("accepted"),
        markInstalled: vi.fn(),
        dismissInstall: vi.fn(),
      },
    }
  })
  ```

  and these tests (import `startTestAndRulesPath` from `../lib/start-test.js` and `pwaStore` from `../lib/pwa/pwa-store.js`):

  ```tsx
  it("says you are all caught up when every test has an attempt", async () => {
    await renderLibrary({
      ...initialPage,
      tests: [{ ...finishedTest, attemptCount: 2 }],
    })

    expect(screen.getByText("You're all caught up.")).toBeInTheDocument()
  })

  it("filters the list with the All / To do / Done segmented control", async () => {
    const user = userEvent.setup()

    await renderLibrary()

    await user.click(screen.getByRole("button", { name: "Done" }))
    expect(screen.queryByRole("article", { name: freshTest.title })).toBeNull()
    expect(screen.getByRole("article", { name: finishedTest.title })).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "To do" }))
    expect(screen.getByRole("article", { name: freshTest.title })).toBeInTheDocument()
    expect(screen.queryByRole("article", { name: finishedTest.title })).toBeNull()
  })

  it("shows 'Nothing here yet.' when a filter matches no test", async () => {
    const user = userEvent.setup()

    await renderLibrary({ ...initialPage, tests: [freshTest] })
    await user.click(screen.getByRole("button", { name: "Done" }))

    expect(screen.getByRole("status")).toHaveTextContent("Nothing here yet.")
  })

  it("disables Start on other tests while one is in progress and says why", async () => {
    await renderLibrary()

    const start = within(
      screen.getByRole("article", { name: freshTest.title }),
    ).getByRole("button", { name: "Start test" })

    expect(start).toBeDisabled()
    expect(start).toHaveAccessibleDescription(`Finish ${activeTest.title} first.`)
  })

  it("starts a test without visiting the brief: busy label, then navigates to the rules path", async () => {
    const user = userEvent.setup()
    const navigate = vi.fn()

    vi.mocked(startTestAndRulesPath).mockResolvedValue("/attempts/a1/sections/s1/rules")
    await renderLibraryWith({ initialPage: { ...initialPage, tests: [freshTest] }, student: tom, navigate })
    await user.click(screen.getByRole("button", { name: "Start test" }))

    expect(startTestAndRulesPath).toHaveBeenCalledWith(freshTest.slug)
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith("/attempts/a1/sections/s1/rules")
    })
  })

  it("keeps the card usable and shows an alert when starting fails", async () => {
    const user = userEvent.setup()

    vi.mocked(startTestAndRulesPath).mockRejectedValue(new Error("boom"))
    await renderLibraryWith({ initialPage: { ...initialPage, tests: [freshTest] }, student: tom, navigate: vi.fn() })
    await user.click(screen.getByRole("button", { name: "Start test" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The test could not be started. Please try again.",
    )
    expect(screen.getByRole("button", { name: "Start test" })).toBeEnabled()
  })

  it("offers the install card and prompts through pwaStore", async () => {
    const user = userEvent.setup()

    await renderLibrary()
    await user.click(screen.getByRole("button", { name: /install/i }))

    expect(pwaStore.promptInstall).toHaveBeenCalled()
  })
  ```

  Add `waitFor` to the testing-library import, and add `renderLibraryWith` — a copy of `renderLibrary` whose route component renders `<LibraryScreen {...props} />` for an arbitrary props object (so `navigate`, `renderCardExtras` and `startDisabledReason` can be passed). Refactor `renderLibrary(page, student)` to call `renderLibraryWith({ initialPage: page, student })`.

- [ ] **Step 13: Run to confirm RED**

  Run: `pnpm --filter @pp/app test src/pages/index.test.tsx`
  Expected: the seven new tests FAIL (no filter group, no `Icon`, Start still an `<a>`); several existing assertions also fail — handled in Step 15.

- [ ] **Step 14: Implement the new `LibraryScreen`**

  In `packages/app/src/pages/index.tsx` replace the imports, the whole `LibraryScreen` (and delete `CardActionLink`, `TestLibraryCard`, `primaryActionClass`, `secondaryActionClass`; `loadLibrary`, `LibraryRouteError`, `isNoAccess` stay for Task 8). New top of file and `LibraryScreen`:

  ```tsx
  import { Link, createFileRoute } from "@tanstack/react-router"
  import { useState, useSyncExternalStore, type ReactNode } from "react"
  import { useTranslation } from "react-i18next"
  import { InstallCard } from "../components/Banners.js"
  import { InstallSheet } from "../components/InstallSheet.js"
  import { LibraryFilter } from "../components/LibraryFilter.js"
  import { LibrarySkeleton } from "../components/LibrarySkeleton.js"
  import { LibraryTestCard } from "../components/LibraryTestCard.js"
  import { ApiError } from "../lib/api-client.js"
  import type { Student, TestCard, TestCatalogPage } from "../lib/api-types.js"
  import { listTests } from "../lib/catalog-api.js"
  import {
    blockingTest,
    matchesFilter,
    waitingCount,
    type LibraryFilterValue,
  } from "../lib/library-state.js"
  import { pwaStore } from "../lib/pwa/pwa-store.js"
  import { getCurrentStudent } from "../lib/session-api.js"
  import { signOut } from "../lib/auth.js"
  import { SIGN_IN_PATH } from "../lib/authPaths.js"
  import { startTestAndRulesPath } from "../lib/start-test.js"

  export interface LibraryScreenProps {
    readonly initialPage: TestCatalogPage
    readonly student: Student | null
    readonly navigate?: (path: string) => void
    readonly renderCardExtras?: (test: TestCard) => ReactNode
    readonly startDisabledReason?: (test: TestCard) => string | null
  }

  const assign = (path: string): void => {
    window.location.assign(path)
  }

  export function LibraryScreen({
    initialPage,
    student,
    navigate = assign,
    renderCardExtras,
    startDisabledReason,
  }: LibraryScreenProps) {
    const { i18n, t } = useTranslation("runner")
    const [tests, setTests] = useState(initialPage.tests)
    const [nextCursor, setNextCursor] = useState(initialPage.nextCursor)
    const [loading, setLoading] = useState(false)
    const [loadMoreFailed, setLoadMoreFailed] = useState(false)
    const [filter, setFilter] = useState<LibraryFilterValue>("all")
    const [startingId, setStartingId] = useState<string | null>(null)
    const [startFailed, setStartFailed] = useState(false)
    const [installSheetOpen, setInstallSheetOpen] = useState(false)
    const pwa = useSyncExternalStore(
      pwaStore.subscribe,
      pwaStore.getSnapshot,
      pwaStore.getSnapshot,
    )
    const numberFormatter = new Intl.NumberFormat(i18n.language, {
      maximumFractionDigits: 2,
    })
    const blocker = blockingTest(tests)
    const waiting = waitingCount(tests)
    const visible = tests.filter((test) => matchesFilter(test, filter))

    async function loadMore() {
      if (nextCursor === null || loading) {
        return
      }

      setLoading(true)
      setLoadMoreFailed(false)

      try {
        const page = await listTests(nextCursor)
        setTests((current) => [...current, ...page.tests])
        setNextCursor(page.nextCursor)
      } catch {
        setLoadMoreFailed(true)
      } finally {
        setLoading(false)
      }
    }

    function handleStart(test: TestCard): void {
      if (startingId !== null) {
        return
      }

      setStartingId(test.id)
      setStartFailed(false)

      startTestAndRulesPath(test.slug)
        .then(navigate)
        .catch(() => {
          setStartingId(null)
          setStartFailed(true)
        })
    }

    function handleInstall(): void {
      if (pwa.platform === "ios" || !pwa.canPromptInstall) {
        setInstallSheetOpen(true)

        return
      }

      void pwaStore.promptInstall()
    }

    function reasonFor(test: TestCard): string | null {
      if (test.inProgressAttemptId === null && blocker) {
        return t("library.blockedByActive", { title: blocker.title })
      }

      return startDisabledReason?.(test) ?? null
    }

    const showInstall = !pwa.standalone && !pwa.installDismissed

    return (
      <div className="m-page">
        <header className="m-appbar">
          <span className="m-brand">{t("library.brand")}</span>
          <span className="grow" />
          {student ? (
            <span aria-hidden="true" className="m-avatar">
              {student.displayName[0]}
            </span>
          ) : null}
        </header>

        <main className="m-body">
          <h1 className="m-title" tabIndex={-1} data-page-title>
            {student
              ? t("library.greeting.named", { name: student.displayName })
              : t("library.greeting.anonymous")}
          </h1>
          <p className="m-sub">
            {waiting === 0
              ? t("library.caughtUp")
              : t("library.waiting", { count: waiting })}
          </p>

          {showInstall ? (
            <InstallCard
              onInstall={handleInstall}
              onDismiss={() => {
                pwaStore.dismissInstall()
              }}
            />
          ) : null}

          <LibraryFilter value={filter} onChange={setFilter} />

          {visible.length === 0 ? (
            <p
              role="status"
              className="m-card text-ink-2 border-dashed py-8 text-center font-bold"
            >
              {tests.length === 0 ? t("library.empty") : t("library.filterEmpty")}
            </p>
          ) : (
            <div className="m-stack">
              {visible.map((test) => (
                <LibraryTestCard
                  key={test.id}
                  test={test}
                  highlighted={
                    test.inProgressAttemptId !== null || test.attemptCount === 0
                  }
                  starting={startingId === test.id}
                  disabledReason={reasonFor(test)}
                  onStart={handleStart}
                  extras={renderCardExtras?.(test)}
                />
              ))}
            </div>
          )}

          {nextCursor !== null ? (
            <button
              type="button"
              className="m-btn mt-3"
              data-variant="secondary"
              data-block="true"
              disabled={loading}
              aria-busy={loading}
              onClick={loadMore}
            >
              {t("library.showMore")}
            </button>
          ) : null}
          {loadMoreFailed ? (
            <p role="alert" className="text-bad mt-3 text-sm font-semibold">
              {t("library.loadMoreError")}
            </p>
          ) : null}
          {startFailed ? (
            <p role="alert" className="text-bad mt-3 text-sm font-semibold">
              {t("brief.startError")}
            </p>
          ) : null}

          <dl className="m-stats">
            <div>
              <dt>{t("library.summary.attempts")}</dt>
              <dd>{initialPage.summary.attemptCount}</dd>
            </div>
            <div>
              <dt>{t("library.summary.average")}</dt>
              <dd>
                {t("library.percentage", {
                  percentage: numberFormatter.format(initialPage.summary.averagePct),
                })}
              </dd>
            </div>
            <div>
              <dt>{t("library.summary.best")}</dt>
              <dd>
                {t("library.percentage", {
                  percentage: numberFormatter.format(initialPage.summary.bestPct),
                })}
              </dd>
            </div>
          </dl>
        </main>

        <InstallSheet
          open={installSheetOpen}
          onOpenChange={setInstallSheetOpen}
          platform={pwa.platform}
          onConfirm={() => {
            setInstallSheetOpen(false)
            pwaStore.markInstalled()
          }}
        />
      </div>
    )
  }

  /** Route pending view: the page chrome with the prototype's skeleton cards. */
  export function LibraryPending() {
    const { t } = useTranslation("runner")

    return (
      <div className="m-page">
        <header className="m-appbar">
          <span className="m-brand">{t("library.brand")}</span>
        </header>
        <main className="m-body">
          <LibrarySkeleton />
        </main>
      </div>
    )
  }
  ```

  The history link (`library.allAttempts`) is dropped: the tab bar (Task 4) now owns that navigation. Update `Route`:

  ```tsx
  export const Route = createFileRoute("/")({
    loader: loadLibrary,
    pendingComponent: LibraryPending,
    pendingMs: 150,
    errorComponent: LibraryRouteError,
    component: RouteComponent,
  })
  ```

  (`Link` is still imported by Task 8's error screen only if needed; remove the import if oxlint reports it unused.)

- [ ] **Step 15: Update the existing assertions that pinned the old markup**

  Run `pnpm --filter @pp/app test src/pages/index.test.tsx` and update exactly these (every other test in the file must pass untouched):

  - `uses the device app bar and prototype-width main for the library` — rename to `uses the mobile app bar and body for the library`; replace its class assertions with `expect(screen.getByRole("banner")).toHaveClass("m-appbar")` and `expect(screen.getByRole("main")).toHaveClass("m-body")`.
  - `renders card metadata and both directions of every action rule` — Start / Try again are now `button`s, not `link`s to `/tests/<slug>`: replace `getByRole("link", { name: "Start test" })` style queries with `getByRole("button", …)`; "Continue" and "See result" stay links. Metadata strings now come from one `·`-joined line (`Step 1 · Listening 20 · Reading 20 · 50 minutes`); assert on `toHaveTextContent` of the article.
  - `loads the catalog and profile together…` — the subtitle for the three-test fixture is now `You have one test waiting.` (only `freshTest` has `attemptCount === 0`).
  - `renders a real empty state and no pagination control` — unchanged text (`No practice tests are available yet.`), still `role="status"`.
  - Any assertion for the `All attempts` link: delete it (navigation moved to the tab bar, Task 4).

  Then run the whole file again.
  Expected: PASS.

- [ ] **Step 16: Verify gates and commit**

  ```bash
  pnpm exec prettier --write packages/app/scripts/add-locale-keys.mjs packages/app/src/lib/start-test.ts packages/app/src/lib/start-test.test.ts packages/app/src/lib/library-state.ts packages/app/src/lib/library-state.test.ts packages/app/src/components/Library*.tsx packages/app/src/pages/index.tsx packages/app/src/pages/index.test.tsx "packages/app/src/pages/tests.\$slug.tsx" packages/app/src/index.css packages/app/src/locales
  pnpm --filter @pp/app typecheck && pnpm lint:i18n && pnpm exec oxlint packages/app/src && pnpm lint:frontend && pnpm --filter @pp/app test
  ```

  Expected: all green (`lint:frontend` may report only the pre-existing baseline violations — do not move code to "fix" them).

  ```bash
  git add packages/app/scripts packages/app/src
  git commit -m "feat(app): mobile library with filter, direct start and install slot"
  ```

---

### Task 8: Sign-in and no-access restyle

Prototype source: `vSignin`, `vNoAccess`, `.hero`, `.logo`, `.alert`. Real source: `pages/sign-in.tsx` (`SignInScreen`, `Route`), `pages/index.tsx` (`LibraryRouteError`, `isNoAccess`) and their tests. Most recent commit (`a18c7a1`) already gave the no-access state a Sign out; this task only changes presentation.

**Files:**
- Modify: `packages/app/src/pages/sign-in.tsx`, `packages/app/src/pages/sign-in.test.tsx`
- Modify: `packages/app/src/pages/index.tsx` (`LibraryRouteError` markup only), `packages/app/src/pages/index.test.tsx`
- Modify: `packages/app/src/index.css` (append `m-hero`, `m-logo`, `m-alert`)

**Interfaces:**
- Consumes: Task 7 CSS (`m-btn`, `m-sub`, `m-title`), `Icon` (`logout`, `lock`).
- Produces: CSS classes `m-hero` (centred full-height column on paper), `m-logo` (84 px rounded teal tile, `data-tone="clay"` variant), `m-alert` (bad-tone alert box). `SignInScreenProps` and `LibraryRouteErrorProps` are unchanged.

- [ ] **Step 1: Write the failing tests**

  In `packages/app/src/pages/sign-in.test.tsx` replace the test `uses the centered device sign-in hierarchy and a provider-neutral secondary button` with:

  ```tsx
  it("uses the mobile hero: logo tile, title focus target, full-width primary button", () => {
    const { container } = render(
      <SignInScreen onSignIn={vi.fn()} starting={false} />,
    )

    expect(container.querySelector(".m-hero")).not.toBeNull()
    expect(container.querySelector(".m-logo")).toHaveAttribute("aria-hidden", "true")
    expect(
      screen.getByRole("heading", { level: 1, name: "Primary Practice" }),
    ).toHaveAttribute("tabindex", "-1")

    const button = screen.getByRole("button", { name: "Sign in" })

    expect(button).toHaveClass("m-btn")
    expect(button).toHaveAttribute("data-block", "true")
  })

  it("shows the failure as an alert and leaves the button usable", () => {
    render(<SignInScreen onSignIn={vi.fn()} starting={false} failed />)

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Sign-in could not start. Please try again.",
    )
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled()
  })
  ```

  (Keep the file's existing imports; add `screen`/`render` if missing.) In `packages/app/src/pages/index.test.tsx`, add to the `LibraryRouteError` tests:

  ```tsx
  it("renders the no-access state as a hero with a lock tile and Sign out", () => {
    const { container } = render(
      <LibraryRouteError
        error={
          new ApiError({
            type: "student_not_provisioned",
            title: "No access",
            status: 404,
          })
        }
      />,
    )

    expect(container.querySelector(".m-hero")).not.toBeNull()
    expect(
      screen.getByText("This account does not have access to Quiz yet."),
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Sign out" })).toHaveAttribute(
      "href",
      "/sign-in",
    )
    expect(screen.queryByRole("link", { name: "Try again" })).toBeNull()
  })
  ```


- [ ] **Step 2: Run to confirm RED**

  Run: `pnpm --filter @pp/app test src/pages/sign-in.test.tsx src/pages/index.test.tsx`
  Expected: FAIL — no `.m-hero`.

- [ ] **Step 3: Add the CSS**

  Append to `@layer components` in `packages/app/src/index.css`:

  ```css
  .m-hero {
    display: flex;
    min-height: calc(
      100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom)
    );
    flex: 1;
    flex-direction: column;
    justify-content: center;
    gap: 14px;
    background: var(--color-paper);
    padding: 32px 24px;
    text-align: center;
  }
  .m-hero > * {
    margin-inline: auto;
    width: 100%;
    max-width: 360px;
  }
  .m-logo {
    display: grid;
    width: 84px;
    height: 84px;
    place-items: center;
    border-radius: 24px;
    background: var(--color-teal);
    box-shadow: 0 8px 20px rgb(15 110 120 / 0.3);
    color: #fff;
    font-size: 40px;
    font-weight: 800;
  }
  .m-logo[data-tone="clay"] {
    background: var(--color-clay);
    box-shadow: none;
  }
  .m-hero .m-title {
    font-size: 28px;
  }
  .m-alert {
    border-radius: 12px;
    background: var(--color-bad-bg);
    padding: 10px 12px;
    color: #b53a34;
    font-size: 14px;
    font-weight: 700;
    text-align: left;
  }
  ```

  `.m-logo` is declared after `.m-hero > *`, so its fixed 84 px width wins over the 100 % width.

- [ ] **Step 4: Implement `SignInScreen`**

  Replace the returned JSX of `SignInScreen` in `packages/app/src/pages/sign-in.tsx`:

  ```tsx
  return (
    <div className="m-page">
      <main className="m-hero">
        <div className="m-logo" aria-hidden="true">
          P
        </div>
        <h1 className="m-title" tabIndex={-1} data-page-title>
          {t("library.brand")}
        </h1>
        <p className="m-sub">{t("signIn.subtitle")}</p>
        {failed ? (
          <p role="alert" className="m-alert">
            {t("signIn.error")}
          </p>
        ) : null}
        <button
          type="button"
          className="m-btn"
          data-block="true"
          disabled={starting}
          aria-busy={starting}
          onClick={onSignIn}
        >
          {t(starting ? "signIn.starting" : "signIn.button")}
        </button>
        <p className="m-reason">{t("signIn.reassurance")}</p>
      </main>
    </div>
  )
  ```


- [ ] **Step 5: Implement the restyled `LibraryRouteError`**

  Replace the returned JSX of `LibraryRouteError` (keep `unauthorized`, `noAccess`, `message` logic and the `signOut()` click handler exactly):

  ```tsx
  return (
    <div className="m-page">
      <main className="m-hero">
        <div className="m-logo" data-tone="clay" aria-hidden="true">
          <Icon name="lock" />
        </div>
        <h1 className="m-title" tabIndex={-1} data-page-title role="alert">
          {t(message)}
        </h1>
        {noAccess ? (
          <p className="m-sub">{t("library.noAccess.detail")}</p>
        ) : null}
        {unauthorized || noAccess ? null : (
          <a href="/" className="m-btn" data-block="true">
            {t("library.errorRetry")}
          </a>
        )}
        <a
          href={SIGN_IN_PATH}
          className="m-btn"
          data-variant={unauthorized || noAccess ? undefined : "secondary"}
          data-block="true"
          onClick={() => {
            signOut()
          }}
        >
          <Icon name="logout" /> {t("menu.signOut")}
        </a>
      </main>
    </div>
  )
  ```

  Add `import { Icon } from "../components/Icon.js"` (Task 7 already added the other imports).

- [ ] **Step 6: Run to confirm GREEN, then the rest of both files**

  Run: `pnpm --filter @pp/app test src/pages/sign-in.test.tsx src/pages/index.test.tsx`
  Expected: PASS. The existing assertions in `renders the sign-in error only for a 401`, `renders the generic catalog error for a non-401`, `offers Try again and Sign out on the generic error` and `clears the stored session when Sign out is chosen` query by role/text and must pass unchanged; if one pins `getByRole("alert")` to the old `<p>`, point it at the new `h1[role=alert]` (same text).

- [ ] **Step 7: Verify gates and commit**

  ```bash
  pnpm exec prettier --write packages/app/src/pages/sign-in.tsx packages/app/src/pages/sign-in.test.tsx packages/app/src/pages/index.tsx packages/app/src/pages/index.test.tsx packages/app/src/index.css
  pnpm --filter @pp/app typecheck && pnpm lint:i18n && pnpm exec oxlint packages/app/src && pnpm --filter @pp/app test src/pages
  git add packages/app/src
  git commit -m "feat(app): mobile sign-in and no-access hero screens"
  ```

---

### Task 9: Section rules restyle and "I'm ready" busy state

Prototype source: `vRules` (eyebrow, h1 "Before you begin: {section}", sub with question count/minutes/section position, `.rules` list with icons, clock note, action bar with Leave + I'm ready that shows "Starting…" busy). Real source: `pages/attempts.$attemptId.sections.$sectionId.rules.tsx` (`SectionRulesScreen`, `loadSectionRulesData`, `searchSchema`, `Route`) and its test. All enter/expiry/refusal logic is preserved verbatim.

**Files:**
- Modify: `packages/app/src/pages/attempts.$attemptId.sections.$sectionId.rules.tsx`
- Modify: `packages/app/src/pages/attempts.$attemptId.sections.$sectionId.rules.test.tsx`
- Modify: `packages/app/src/index.css` (append `m-rules`)
- Modify: `packages/app/src/locales/*/runner.json` (via script)

**Interfaces:**
- Consumes: Task 7 CSS/script, `Icon` (`headphones`, `check`, `book`, `calc`).
- Produces: `SectionRulesScreenProps` gains `sectionNumber: number` and `sectionTotal: number`; `loadSectionRulesData` additionally returns them (`sectionNumber = envelope.sections.findIndex(id) + 1`, `sectionTotal = envelope.sections.length`). CSS `m-rules` (list of instruction rows).

- [ ] **Step 1: Add the strings**

  ```bash
  PATCH="$(mktemp)" && cat > "$PATCH" <<'EOF'
  {
    "en": {
      "sectionRules.heading": "Before you begin: {{section}}",
      "sectionRules.sectionPosition": "Section {{current}} of {{total}}",
      "sectionRules.clockNoteFirst": "The clock starts when you tap I'm ready and keeps running if you leave.",
      "sectionRules.clockNoteNext": "The clock starts when you tap I'm ready.",
      "sectionRules.leave": "Leave",
      "sectionRules.starting": "Starting…"
    },
    "de": {
      "sectionRules.heading": "Bevor du anfängst: {{section}}",
      "sectionRules.sectionPosition": "Teil {{current}} von {{total}}",
      "sectionRules.clockNoteFirst": "Die Uhr startet, wenn du auf „Ich bin bereit“ tippst, und läuft weiter, wenn du gehst.",
      "sectionRules.clockNoteNext": "Die Uhr startet, wenn du auf „Ich bin bereit“ tippst.",
      "sectionRules.leave": "Verlassen",
      "sectionRules.starting": "Startet…"
    },
    "es": {
      "sectionRules.heading": "Antes de empezar: {{section}}",
      "sectionRules.sectionPosition": "Parte {{current}} de {{total}}",
      "sectionRules.clockNoteFirst": "El reloj empieza cuando tocas «Estoy listo» y sigue corriendo si te vas.",
      "sectionRules.clockNoteNext": "El reloj empieza cuando tocas «Estoy listo».",
      "sectionRules.leave": "Salir",
      "sectionRules.starting": "Empezando…"
    },
    "fr": {
      "sectionRules.heading": "Avant de commencer : {{section}}",
      "sectionRules.sectionPosition": "Partie {{current}} sur {{total}}",
      "sectionRules.clockNoteFirst": "Le chrono démarre quand tu touches « Je suis prêt » et continue si tu pars.",
      "sectionRules.clockNoteNext": "Le chrono démarre quand tu touches « Je suis prêt ».",
      "sectionRules.leave": "Quitter",
      "sectionRules.starting": "Démarrage…"
    },
    "it": {
      "sectionRules.heading": "Prima di iniziare: {{section}}",
      "sectionRules.sectionPosition": "Parte {{current}} di {{total}}",
      "sectionRules.clockNoteFirst": "Il timer parte quando tocchi «Sono pronto» e continua anche se esci.",
      "sectionRules.clockNoteNext": "Il timer parte quando tocchi «Sono pronto».",
      "sectionRules.leave": "Esci",
      "sectionRules.starting": "Avvio…"
    },
    "ja": {
      "sectionRules.heading": "はじめる前に：{{section}}",
      "sectionRules.sectionPosition": "{{total}}つ中{{current}}つ目",
      "sectionRules.clockNoteFirst": "「準備ができました」をタップすると時間が始まり、離れても時間は進みます。",
      "sectionRules.clockNoteNext": "「準備ができました」をタップすると時間が始まります。",
      "sectionRules.leave": "離れる",
      "sectionRules.starting": "開始中…"
    }
  }
  EOF
  node packages/app/scripts/add-locale-keys.mjs runner "$PATCH" && pnpm --filter @pp/app test src/locales
  ```

  Expected: PASS.

- [ ] **Step 2: Write the failing tests**

  In `…rules.test.tsx` add (use the file's existing `baseProps`-style fixture; if it has none, copy the props object from `renders the section title, question count, duration…` into a `const props` at the top and spread it):

  ```tsx
  it("heads the screen 'Before you begin: <section>' and shows the section position", () => {
    render(<SectionRulesScreen {...props} sectionNumber={2} sectionTotal={2} />)

    expect(
      screen.getByRole("heading", { level: 1, name: "Before you begin: Reading" }),
    ).toHaveAttribute("tabindex", "-1")
    expect(screen.getByText(/Section 2 of 2/)).toBeInTheDocument()
  })

  it("explains the clock: first section says it keeps running, later sections do not", () => {
    const { rerender } = render(
      <SectionRulesScreen {...props} sectionNumber={1} sectionTotal={2} />,
    )

    expect(
      screen.getByText("The clock starts when you tap I'm ready and keeps running if you leave."),
    ).toBeInTheDocument()

    rerender(<SectionRulesScreen {...props} sectionNumber={2} sectionTotal={2} />)

    expect(
      screen.getByText("The clock starts when you tap I'm ready."),
    ).toBeInTheDocument()
  })

  it("renders every instruction as a row in a list", () => {
    render(<SectionRulesScreen {...props} sectionNumber={1} sectionTotal={1} />)

    expect(
      within(screen.getByRole("list")).getAllByRole("listitem"),
    ).toHaveLength(props.instructions.length)
  })

  it("offers a Leave link back to the library", () => {
    render(<SectionRulesScreen {...props} sectionNumber={1} sectionTotal={1} />)

    expect(screen.getByRole("link", { name: "Leave" })).toHaveAttribute("href", "/")
  })

  it("shows 'Starting…' and disables I'm ready while the enter call is in flight", async () => {
    vi.mocked(enterSection).mockReturnValue(new Promise(() => undefined))
    render(<SectionRulesScreen {...props} sectionNumber={1} sectionTotal={1} />)

    await userEvent.setup().click(screen.getByTestId("ready-button"))

    const button = screen.getByTestId("ready-button")

    expect(button).toHaveTextContent("Starting…")
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute("aria-busy", "true")
  })
  ```

  Also extend `loadSectionRulesData`'s existing test (`loads the section intro from the canonical runner envelope…`) with `expect(data.sectionNumber).toBe(<index+1 of its section>)` and `expect(data.sectionTotal).toBe(<envelope.sections.length>)` using that test's own envelope fixture. Add `within` to the testing-library import.

- [ ] **Step 3: Run to confirm RED**

  Run: `pnpm --filter @pp/app test "src/pages/attempts.\$attemptId.sections.\$sectionId.rules.test.tsx"`
  Expected: FAIL (props unknown / heading text).

- [ ] **Step 4: Add the CSS**

  Append to `@layer components`:

  ```css
  .m-rules {
    display: grid;
    gap: 10px;
    margin: 14px 0 0;
    padding: 0;
    list-style: none;
  }
  .m-rules li {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    border: 1.5px solid var(--color-line);
    border-radius: 14px;
    background: var(--color-paper);
    padding: 12px 14px;
    font-weight: 700;
  }
  .m-rules svg {
    margin-top: 1px;
    color: var(--color-clay);
  }
  ```

- [ ] **Step 5: Implement**

  In `SectionRulesScreenProps` add `readonly sectionNumber: number` and `readonly sectionTotal: number`, destructure them in `SectionRulesScreen`, and in `loadSectionRulesData` add to the returned object:

  ```ts
  sectionNumber:
    envelope.sections.findIndex((candidate) => candidate.id === sectionId) + 1,
  sectionTotal: envelope.sections.length,
  ```

  Replace the main (non-expired) return of `SectionRulesScreen` with the prototype's `vRules` layout. The expired return keeps its logic but uses `m-page`/`m-hero`:

  ```tsx
  if (
    outcome.status === "sectionExpired" ||
    outcome.status === "attemptExpired"
  ) {
    return (
      <div className="m-page">
        <main className="m-hero">
          <div className="m-logo" data-tone="clay" aria-hidden="true">
            <Icon name="clock" />
          </div>
          <h1 className="m-title" tabIndex={-1} data-page-title>
            {t("sectionRules.expired.title")}
          </h1>
          <p className="m-sub">
            {outcome.status === "attemptExpired"
              ? t("sectionRules.expired.attemptMessage")
              : t("sectionRules.expired.sectionMessage")}
          </p>
          {outcome.status === "attemptExpired" && outcome.resultUrl ? (
            <a href={outcome.resultUrl} className="m-btn" data-block="true">
              {t("sectionRules.expired.viewResult")}
            </a>
          ) : null}
        </main>
      </div>
    )
  }

  const entering = outcome.status === "entering"

  return (
    <div className="m-page">
      <header className="m-appbar">
        <a href="/" className="m-iconbtn" aria-label={t("sectionRules.leave")}>
          <Icon name="back" />
        </a>
        <span className="m-brand">{t("library.brand")}</span>
        <span className="grow" />
        <span
          className={`section-chip section-chip--${sectionType}`}
          data-section-type={sectionType}
        >
          {t(`runner.sectionChip.${sectionType}`)}
        </span>
      </header>
      <main className="m-body">
        <p className="m-eyebrow">
          {t("sectionRules.attemptEyebrow", { testTitle, number: attemptNumber })}
        </p>
        <h1 className="m-title mt-1" tabIndex={-1} data-page-title>
          {t("sectionRules.heading", {
            section: t(`runner.sectionChip.${sectionType}`),
          })}
        </h1>
        <p className="m-sub">
          {t("sectionRules.questionDuration", {
            count: questionCount,
            minutes: durationMinutes,
          })}
          {sectionTotal > 1
            ? ` · ${t("sectionRules.sectionPosition", {
                current: sectionNumber,
                total: sectionTotal,
              })}`
            : null}
        </p>
        {finalizedPriorAttempt ? (
          <p className="m-notice">
            {t("sectionRules.finalizedPriorAttempt.notice")}{" "}
            <a
              href={finalizedPriorAttempt.resultUrl}
              className="text-ink underline underline-offset-4"
            >
              {t("sectionRules.finalizedPriorAttempt.viewLink")}
            </a>
          </p>
        ) : null}
        <ul className="m-rules">
          {instructions.map((instruction) => (
            <li key={instruction}>
              <Icon name={sectionType === "listening" ? "headphones" : "check"} />
              <span>{instruction}</span>
            </li>
          ))}
        </ul>
        {outcome.status === "refused" ? (
          <p role="alert" className="m-alert mt-3">
            {refusalMessage(outcome.problem.type, t)}
          </p>
        ) : null}
        <p className="m-reason mt-3.5">
          {t(
            sectionNumber <= 1
              ? "sectionRules.clockNoteFirst"
              : "sectionRules.clockNoteNext",
          )}
        </p>
      </main>
      <div className="m-actionbar">
        <a href="/" className="m-btn" data-variant="secondary" style={{ flex: "0 0 auto" }}>
          {t("sectionRules.leave")}
        </a>
        <button
          type="button"
          className="m-btn"
          data-testid="ready-button"
          onClick={handleReady}
          disabled={entering}
          aria-busy={entering}
        >
          {t(entering ? "sectionRules.starting" : "sectionRules.readyButton")}
        </button>
      </div>
    </div>
  )
  ```

  Add `import { Icon } from "../components/Icon.js"`. The header's back arrow and the "Leave" action both go to `/` (the library), matching `vRules`. The existing `section-chip` rules are reused for the chip.

- [ ] **Step 6: Run to confirm GREEN; fix pinned assertions**

  Run the same command. Expected: new tests PASS. Existing tests that pinned old markup to update, by name:
  - `uses the centered device rules layout and a semantic section chip` — replace `.center-main`/`.device-card` class assertions with `.m-body` and `.m-rules`; keep the `data-section-type` chip assertion.
  - `renders the section title, question count, duration, untimed notice, and authoritative attempt number` — the h1 text is now `Before you begin: <Section chip label>`; assert the section title text no longer as the heading but keep the eyebrow (`Practice … · Attempt N`) and the `22 minutes`-style sub assertions.
  - `disables the ready button while the enter call is in flight…` — the label is now `Starting…`; keep the disabled and POST-count assertions.
  Every `enterSection`, expiry, refusal and `resultUrl` safety test must pass unchanged.

- [ ] **Step 7: Verify gates and commit**

  ```bash
  pnpm exec prettier --write "packages/app/src/pages/attempts.\$attemptId.sections.\$sectionId.rules.tsx" "packages/app/src/pages/attempts.\$attemptId.sections.\$sectionId.rules.test.tsx" packages/app/src/index.css packages/app/src/locales
  pnpm --filter @pp/app typecheck && pnpm lint:i18n && pnpm exec oxlint packages/app/src && pnpm --filter @pp/app test
  git add packages/app/src
  git commit -m "feat(app): mobile section rules screen with busy I'm-ready"
  ```

---

### Task 10: Run chrome — top bar, action bar, menu / navigator / finish-section sheets

Prototype source: `vRun` (top bar: ⋯ menu, section chip, save chip, timer chip, progress bar; bottom bar: Previous, navigator `n/N`, Next / Finish X / Hand in), `navSheet`, the finish-section confirm sheet, the "Menu" sheet. Real source: `pages/attempts.$attemptId.run.tsx` (`RunScreen`, `RunnerPanel`, the `<header>`/`<footer>`/`AppMenu`/`QuestionNavigator` JSX at the end of the component), `components/QuestionNavigator.tsx`, `lib/navigator-state.ts` (unchanged), `components/SaveState.tsx` (unchanged here; Task 13).

**Behaviour preserved:** durable queue, `FlushController`, server-authoritative countdown + zero-touch refetch, `setPosition`/`finishSection`/`claimPlay` handling and every expiry branch, `handleNavigatorNavigate`'s server-backed disabled rule, the `data-panel` attribute on the shell, modal inertness of landmarks. **Behaviour changed (prototype parity):** the last question's primary button is now "Finish <Section>" (opens a confirm sheet) or "Hand in" (last section) instead of a card above the footer; the ghost "Hand in" footer button on every question is gone; the left drawer `AppMenu` is replaced by a Menu bottom sheet containing only "Leave test"; progress is per section (`answered/section total`), not per test.

**Files:**
- Create: `packages/app/src/components/RunTopBar.tsx`, `RunTopBar.test.tsx`
- Create: `packages/app/src/components/RunActionBar.tsx`, `RunActionBar.test.tsx`
- Create: `packages/app/src/components/FinishSectionSheet.tsx`, `FinishSectionSheet.test.tsx`
- Create: `packages/app/src/components/RunMenuSheet.tsx`, `RunMenuSheet.test.tsx`
- Modify: `packages/app/src/components/QuestionNavigator.tsx`, `QuestionNavigator.test.tsx`
- Modify: `packages/app/src/pages/attempts.$attemptId.run.tsx`, `attempts.$attemptId.run.test.tsx`
- Modify: `packages/app/src/index.css` (run-chrome rules; restyle `.np-cell` / `.np-key`)
- Modify: `packages/app/src/locales/*/runner.json` (via `scripts/add-locale-keys.mjs`)

**Interfaces:**
- Consumes: Part A `BottomSheet` (`{ open; onOpenChange; title; closeLabel; returnFocusRef?; children }`), `OfflineBanner` (`{ variant: "browsing" | "in-test"; pendingCount: number }`), `Icon`; existing `SaveState`/`SaveStateProps`, `formatCountdown(remainingMs: number): string`, `NavigatorSource`/`buildNavigatorGroups`, Task 7's `m-*` CSS and locale script.
- Produces:
  - `RunTopBar({ sectionType: SectionType; saveState: SaveStateProps; remainingMs: number | null; answered: number; total: number; menuExpanded: boolean; menuTriggerRef?: RefObject<HTMLButtonElement | null>; onOpenMenu: () => void })` — renders `<header class="m-runtop">`.
  - `RunActionBar({ showPrevious: boolean; onPrevious: () => void; answered: number; total: number; navigatorExpanded: boolean; navigatorTriggerRef?: RefObject<HTMLButtonElement | null>; onOpenNavigator: () => void; primary: { kind: "next" | "finish" | "handIn"; label: string; disabled: boolean } | null; onPrimary: () => void })` — renders `<footer class="m-actionbar">`.
  - `FinishSectionSheet({ open; onOpenChange; sectionLabel: string; blankCount: number; busy: boolean; failed: boolean; onConfirm: () => void; returnFocusRef? })`.
  - `RunMenuSheet({ open; onOpenChange; clockStarted: boolean; onLeave: () => void; returnFocusRef? })`.
  - `QuestionNavigatorProps` loses `onOpenMenu`; rest unchanged. Statuses carry words in each cell's `aria-label`.
  - `RunnerPanel = "menu" | "navigator" | "finish" | null` (module-private).

- [ ] **Step 1: Add the strings**

  ```bash
  PATCH="$(mktemp)" && cat > "$PATCH" <<'EOF'
  {
    "en": {
      "runner.finishSectionButton": "Finish {{section}}",
      "runner.finishSectionTitle": "Finish {{section}}?",
      "runner.finishSectionBlank_one": "{{count}} question is still blank. You cannot come back to this section.",
      "runner.finishSectionBlank_other": "{{count}} questions are still blank. You cannot come back to this section.",
      "runner.finishSectionNoBlank": "You cannot come back to this section.",
      "runner.backToTest": "Back to the test",
      "runner.oneMinuteLeft": "One minute left.",
      "runner.sectionProgress": "Section progress",
      "navigator.sectionFinished": "{{section}} · finished",
      "navigator.sectionNotStarted": "{{section}} · not started",
      "navigator.questionLabelWithStatus": "Question {{ordinal}}, {{status}}",
      "navigator.statusCurrent": "you are here",
      "navigator.statusAnswered": "answered",
      "navigator.statusBlank": "not answered",
      "navigator.statusLeftBlank": "left blank",
      "navigator.statusCorrect": "correct",
      "navigator.statusIncorrect": "wrong"
    },
    "de": {
      "runner.finishSectionButton": "{{section}} beenden",
      "runner.finishSectionTitle": "{{section}} beenden?",
      "runner.finishSectionBlank_one": "{{count}} Frage ist noch leer. Du kannst nicht zu diesem Teil zurückkehren.",
      "runner.finishSectionBlank_other": "{{count}} Fragen sind noch leer. Du kannst nicht zu diesem Teil zurückkehren.",
      "runner.finishSectionNoBlank": "Du kannst nicht zu diesem Teil zurückkehren.",
      "runner.backToTest": "Zurück zum Test",
      "runner.oneMinuteLeft": "Noch eine Minute.",
      "runner.sectionProgress": "Fortschritt im Teil",
      "navigator.sectionFinished": "{{section}} · beendet",
      "navigator.sectionNotStarted": "{{section}} · noch nicht begonnen",
      "navigator.questionLabelWithStatus": "Frage {{ordinal}}, {{status}}",
      "navigator.statusCurrent": "du bist hier",
      "navigator.statusAnswered": "beantwortet",
      "navigator.statusBlank": "nicht beantwortet",
      "navigator.statusLeftBlank": "leer gelassen",
      "navigator.statusCorrect": "richtig",
      "navigator.statusIncorrect": "falsch"
    },
    "es": {
      "runner.finishSectionButton": "Terminar {{section}}",
      "runner.finishSectionTitle": "¿Terminar {{section}}?",
      "runner.finishSectionBlank_one": "Queda {{count}} pregunta en blanco. No podrás volver a esta sección.",
      "runner.finishSectionBlank_other": "Quedan {{count}} preguntas en blanco. No podrás volver a esta sección.",
      "runner.finishSectionNoBlank": "No podrás volver a esta sección.",
      "runner.backToTest": "Volver a la prueba",
      "runner.oneMinuteLeft": "Queda un minuto.",
      "runner.sectionProgress": "Progreso de la sección",
      "navigator.sectionFinished": "{{section}} · terminada",
      "navigator.sectionNotStarted": "{{section}} · sin empezar",
      "navigator.questionLabelWithStatus": "Pregunta {{ordinal}}, {{status}}",
      "navigator.statusCurrent": "estás aquí",
      "navigator.statusAnswered": "respondida",
      "navigator.statusBlank": "sin responder",
      "navigator.statusLeftBlank": "en blanco",
      "navigator.statusCorrect": "correcta",
      "navigator.statusIncorrect": "incorrecta"
    },
    "fr": {
      "runner.finishSectionButton": "Terminer {{section}}",
      "runner.finishSectionTitle": "Terminer {{section}} ?",
      "runner.finishSectionBlank_one": "{{count}} question est encore vide. Tu ne pourras pas revenir à cette partie.",
      "runner.finishSectionBlank_other": "{{count}} questions sont encore vides. Tu ne pourras pas revenir à cette partie.",
      "runner.finishSectionNoBlank": "Tu ne pourras pas revenir à cette partie.",
      "runner.backToTest": "Retour au test",
      "runner.oneMinuteLeft": "Il reste une minute.",
      "runner.sectionProgress": "Progression de la partie",
      "navigator.sectionFinished": "{{section}} · terminée",
      "navigator.sectionNotStarted": "{{section}} · pas commencée",
      "navigator.questionLabelWithStatus": "Question {{ordinal}}, {{status}}",
      "navigator.statusCurrent": "tu es ici",
      "navigator.statusAnswered": "réponse donnée",
      "navigator.statusBlank": "sans réponse",
      "navigator.statusLeftBlank": "laissée vide",
      "navigator.statusCorrect": "juste",
      "navigator.statusIncorrect": "fausse"
    },
    "it": {
      "runner.finishSectionButton": "Termina {{section}}",
      "runner.finishSectionTitle": "Terminare {{section}}?",
      "runner.finishSectionBlank_one": "{{count}} domanda è ancora vuota. Non potrai tornare a questa parte.",
      "runner.finishSectionBlank_other": "{{count}} domande sono ancora vuote. Non potrai tornare a questa parte.",
      "runner.finishSectionNoBlank": "Non potrai tornare a questa parte.",
      "runner.backToTest": "Torna al test",
      "runner.oneMinuteLeft": "Manca un minuto.",
      "runner.sectionProgress": "Avanzamento della parte",
      "navigator.sectionFinished": "{{section}} · finita",
      "navigator.sectionNotStarted": "{{section}} · non iniziata",
      "navigator.questionLabelWithStatus": "Domanda {{ordinal}}, {{status}}",
      "navigator.statusCurrent": "sei qui",
      "navigator.statusAnswered": "con risposta",
      "navigator.statusBlank": "senza risposta",
      "navigator.statusLeftBlank": "lasciata vuota",
      "navigator.statusCorrect": "corretta",
      "navigator.statusIncorrect": "sbagliata"
    },
    "ja": {
      "runner.finishSectionButton": "{{section}}を終える",
      "runner.finishSectionTitle": "{{section}}を終えますか？",
      "runner.finishSectionBlank": "{{count}}問がまだ空欄です。このセクションには戻れません。",
      "runner.finishSectionNoBlank": "このセクションには戻れません。",
      "runner.backToTest": "テストに戻る",
      "runner.oneMinuteLeft": "あと1分です。",
      "runner.sectionProgress": "セクションの進み具合",
      "navigator.sectionFinished": "{{section}} · 終了",
      "navigator.sectionNotStarted": "{{section}} · 未開始",
      "navigator.questionLabelWithStatus": "問題{{ordinal}}、{{status}}",
      "navigator.statusCurrent": "いまここ",
      "navigator.statusAnswered": "解答済み",
      "navigator.statusBlank": "未解答",
      "navigator.statusLeftBlank": "空欄",
      "navigator.statusCorrect": "正解",
      "navigator.statusIncorrect": "不正解"
    }
  }
  EOF
  node packages/app/scripts/add-locale-keys.mjs runner "$PATCH" && pnpm --filter @pp/app test src/locales
  ```

  Expected: PASS.

- [ ] **Step 2: Write the failing component tests**

  `packages/app/src/components/RunTopBar.test.tsx`:

  ```tsx
  import { cleanup, render, screen } from "@testing-library/react"
  import userEvent from "@testing-library/user-event"
  import { afterEach, describe, expect, it, vi } from "vitest"
  import "../i18n.js"
  import { RunTopBar } from "./RunTopBar.js"

  const props = {
    sectionType: "listening" as const,
    saveState: { state: "saved" as const },
    remainingMs: 125_000,
    answered: 1,
    total: 4,
    menuExpanded: false,
    onOpenMenu: vi.fn(),
  }

  describe("RunTopBar", () => {
    afterEach(() => {
      cleanup()
      props.onOpenMenu.mockReset()
    })

    it("shows the section chip, save state and a labelled timer", () => {
      render(<RunTopBar {...props} />)

      expect(screen.getByText("Listening")).toHaveClass("section-chip")
      expect(screen.getByText("Saved")).toBeInTheDocument()
      expect(screen.getByRole("timer", { name: "Time remaining" })).toHaveTextContent("02:05")
    })

    it("marks the timer low at one minute and announces it once", () => {
      render(<RunTopBar {...props} remainingMs={59_000} />)

      expect(screen.getByRole("timer", { name: "Time remaining" })).toHaveAttribute("data-low", "true")
      expect(screen.getByText("One minute left.")).toBeInTheDocument()
    })

    it("is not low with exactly 61 seconds left", () => {
      render(<RunTopBar {...props} remainingMs={61_000} />)

      expect(screen.getByRole("timer", { name: "Time remaining" })).not.toHaveAttribute("data-low")
      expect(screen.queryByText("One minute left.")).toBeNull()
    })

    it("omits the timer before the clock has started", () => {
      render(<RunTopBar {...props} remainingMs={null} />)

      expect(screen.queryByRole("timer")).toBeNull()
    })

    it("reports section progress through a labelled progressbar", () => {
      render(<RunTopBar {...props} />)

      const bar = screen.getByRole("progressbar", { name: "Section progress" })

      expect(bar).toHaveAttribute("aria-valuenow", "1")
      expect(bar).toHaveAttribute("aria-valuemax", "4")
    })

    it("opens the menu from a 44px-class icon button with the Open menu label", async () => {
      render(<RunTopBar {...props} />)

      await userEvent.setup().click(screen.getByRole("button", { name: "Open menu" }))

      expect(props.onOpenMenu).toHaveBeenCalledOnce()
    })
  })
  ```

  `packages/app/src/components/RunActionBar.test.tsx`:

  ```tsx
  import { cleanup, render, screen } from "@testing-library/react"
  import userEvent from "@testing-library/user-event"
  import { afterEach, describe, expect, it, vi } from "vitest"
  import "../i18n.js"
  import { RunActionBar } from "./RunActionBar.js"

  const handlers = {
    onPrevious: vi.fn(),
    onOpenNavigator: vi.fn(),
    onPrimary: vi.fn(),
  }
  const props = {
    showPrevious: true,
    answered: 2,
    total: 4,
    navigatorExpanded: false,
    primary: { kind: "next" as const, label: "Next", disabled: false },
    ...handlers,
  }

  describe("RunActionBar", () => {
    afterEach(() => {
      cleanup()
      Object.values(handlers).forEach((handler) => handler.mockReset())
    })

    it("renders Previous only when asked and the navigator with n/N", () => {
      const { rerender } = render(<RunActionBar {...props} />)

      expect(screen.getByRole("button", { name: "Previous" })).toBeInTheDocument()
      expect(
        screen.getByRole("button", { name: "Open the question navigator" }),
      ).toHaveTextContent("2/4")

      rerender(<RunActionBar {...props} showPrevious={false} />)
      expect(screen.queryByRole("button", { name: "Previous" })).toBeNull()
    })

    it("fires the primary action and shows its label", async () => {
      render(<RunActionBar {...props} primary={{ kind: "finish", label: "Finish Listening", disabled: false }} />)

      await userEvent.setup().click(screen.getByRole("button", { name: "Finish Listening" }))

      expect(handlers.onPrimary).toHaveBeenCalledOnce()
    })

    it("disables the primary action while a transition is busy", () => {
      render(<RunActionBar {...props} primary={{ kind: "finish", label: "Finish Listening", disabled: true }} />)

      expect(screen.getByRole("button", { name: "Finish Listening" })).toBeDisabled()
    })

    it("renders no primary or previous action once the section has expired", () => {
      render(<RunActionBar {...props} showPrevious={false} primary={null} />)

      expect(screen.queryByRole("button", { name: "Next" })).toBeNull()
      expect(screen.queryByRole("button", { name: "Previous" })).toBeNull()
      expect(screen.getByRole("button", { name: "Open the question navigator" })).toBeInTheDocument()
    })
  })
  ```

  `packages/app/src/components/FinishSectionSheet.test.tsx`:

  ```tsx
  import { cleanup, render, screen, within } from "@testing-library/react"
  import userEvent from "@testing-library/user-event"
  import { afterEach, describe, expect, it, vi } from "vitest"
  import "../i18n.js"
  import { FinishSectionSheet } from "./FinishSectionSheet.js"

  const base = {
    open: true,
    onOpenChange: vi.fn(),
    sectionLabel: "Listening",
    blankCount: 0,
    busy: false,
    failed: false,
    onConfirm: vi.fn(),
  }

  describe("FinishSectionSheet", () => {
    afterEach(() => {
      cleanup()
      base.onConfirm.mockReset()
      base.onOpenChange.mockReset()
    })

    it("asks to finish the named section and says it cannot be revisited", () => {
      render(<FinishSectionSheet {...base} />)

      const dialog = screen.getByRole("dialog", { name: "Finish Listening?" })

      expect(within(dialog).getByText("You cannot come back to this section.")).toBeInTheDocument()
    })

    it("counts blank questions, singular and plural", () => {
      const { rerender } = render(<FinishSectionSheet {...base} blankCount={1} />)

      expect(screen.getByText("1 question is still blank. You cannot come back to this section.")).toBeInTheDocument()

      rerender(<FinishSectionSheet {...base} blankCount={3} />)
      expect(screen.getByText("3 questions are still blank. You cannot come back to this section.")).toBeInTheDocument()
    })

    it("confirms with a busy button and can be dismissed with Keep working", async () => {
      const user = userEvent.setup()
      const { rerender } = render(<FinishSectionSheet {...base} />)
      const dialog = screen.getByRole("dialog")

      await user.click(within(dialog).getByRole("button", { name: "Finish Listening" }))
      expect(base.onConfirm).toHaveBeenCalledOnce()

      await user.click(within(dialog).getByRole("button", { name: "Keep working" }))
      expect(base.onOpenChange).toHaveBeenCalledWith(false)

      rerender(<FinishSectionSheet {...base} busy />)
      expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Finish Listening" })).toBeDisabled()
    })

    it("shows the transition failure as an alert and keeps the sheet usable", () => {
      render(<FinishSectionSheet {...base} failed />)

      expect(screen.getByRole("alert")).toHaveTextContent(
        "The next section could not be opened. Your answers are still safe on this device. Try again.",
      )
      expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Finish Listening" })).toBeEnabled()
    })
  })
  ```

  `packages/app/src/components/RunMenuSheet.test.tsx`:

  ```tsx
  import { cleanup, render, screen, within } from "@testing-library/react"
  import userEvent from "@testing-library/user-event"
  import { afterEach, describe, expect, it, vi } from "vitest"
  import "../i18n.js"
  import { RunMenuSheet } from "./RunMenuSheet.js"

  const base = { open: true, onOpenChange: vi.fn(), clockStarted: true, onLeave: vi.fn() }

  describe("RunMenuSheet", () => {
    afterEach(() => {
      cleanup()
      base.onLeave.mockReset()
      base.onOpenChange.mockReset()
    })

    it("is a dialog named Menu with the running-clock note", () => {
      render(<RunMenuSheet {...base} />)

      const dialog = screen.getByRole("dialog", { name: "Menu" })

      expect(within(dialog).getByText("The clock keeps running while you are away.")).toBeInTheDocument()
    })

    it("uses the not-started note before the clock begins", () => {
      render(<RunMenuSheet {...base} clockStarted={false} />)

      expect(screen.getByText("Nothing has started yet. The clock begins when you tap I'm ready.")).toBeInTheDocument()
    })

    it("leaves the test or goes back to it", async () => {
      const user = userEvent.setup()

      render(<RunMenuSheet {...base} />)
      await user.click(screen.getByRole("button", { name: "Leave test" }))
      expect(base.onLeave).toHaveBeenCalledOnce()

      await user.click(screen.getByRole("button", { name: "Back to the test" }))
      expect(base.onOpenChange).toHaveBeenCalledWith(false)
    })
  })
  ```

- [ ] **Step 3: Run to confirm RED**

  Run: `pnpm --filter @pp/app test src/components/RunTopBar.test.tsx src/components/RunActionBar.test.tsx src/components/FinishSectionSheet.test.tsx src/components/RunMenuSheet.test.tsx`
  Expected: FAIL — modules not found.

- [ ] **Step 4: Add the run-chrome CSS and restyle the navigator cells**

  Append to `@layer components` in `index.css`:

  ```css
  .m-runtop {
    position: sticky;
    top: 0;
    z-index: 40;
    border-bottom: 1px solid var(--color-line);
    background: var(--color-paper);
    padding: 6px 10px 0;
  }
  .m-runtop .m-row {
    min-height: 48px;
    gap: 8px;
  }
  .m-timer {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border-radius: 10px;
    background: var(--color-surface);
    padding: 4px 10px;
    font-family: var(--font-mono);
    font-size: 17px;
    font-weight: 600;
  }
  .m-timer[data-low="true"] {
    background: var(--color-bad-bg);
    color: #b53a34;
  }
  .m-progress {
    height: 5px;
    margin: 4px -10px 0;
    background: var(--color-line);
  }
  .m-progress > i {
    display: block;
    height: 100%;
    background: var(--color-teal);
    transition: width 0.25s;
  }
  .m-actionbar[data-sticky="true"] {
    position: sticky;
    bottom: 0;
    z-index: 40;
  }
  .m-run-body {
    padding-top: 12px;
  }
  .m-sheet-actions {
    display: grid;
    gap: 10px;
    margin-top: 14px;
  }
  ```

  Replace the existing `.np-cell`, `.np-cell:hover:not(:disabled)`, `.np-cell:disabled`, `.np-cell[data-status=…]` (all five) and `.np-key[...]` rules with:

  ```css
  .np-cell {
    position: relative;
    display: grid;
    min-height: 52px;
    place-items: center;
    border: 2px solid var(--color-line);
    border-radius: 12px;
    background: var(--color-paper);
    color: var(--color-ink);
    cursor: pointer;
    font: inherit;
    font-size: 16px;
    font-variant-numeric: tabular-nums;
    font-weight: 800;
    touch-action: manipulation;
  }
  .np-cell:disabled {
    cursor: default;
    opacity: 0.8;
  }
  .np-cell[data-status="answered"] {
    border-color: var(--color-teal);
    background: var(--color-teal);
    color: #fff;
  }
  .np-cell[data-status="current"] {
    border-color: var(--color-clay);
    box-shadow: 0 0 0 3px var(--color-clay-bg);
    color: var(--color-clay);
  }
  .np-cell[data-status="correct"] {
    border-color: var(--color-good);
    background: var(--color-good-bg);
    color: #1f7a43;
  }
  .np-cell[data-status="incorrect"] {
    border-color: var(--color-bad);
    background: var(--color-bad-bg);
    color: #b53a34;
  }
  .np-cell[data-status="blank"] {
    border-style: dashed;
  }
  .np-mark {
    position: absolute;
    top: 1px;
    right: 4px;
    font-size: 10px;
  }
  .np-key {
    display: inline-block;
    width: 14px;
    height: 14px;
    border: 2px solid var(--color-line);
    border-radius: 5px;
  }
  .np-key[data-status="answered"] {
    border-color: var(--color-teal);
    background: var(--color-teal);
  }
  .np-key[data-status="current"] {
    border-color: var(--color-clay);
  }
  .np-key[data-status="correct"] {
    border-color: var(--color-good);
    background: var(--color-good-bg);
  }
  .np-key[data-status="incorrect"] {
    border-color: var(--color-bad);
    background: var(--color-bad-bg);
  }
  .np-key[data-status="blank"] {
    border-style: dashed;
  }
  ```

- [ ] **Step 5: Implement the four components**

  `packages/app/src/components/RunTopBar.tsx`:

  ```tsx
  import type { RefObject } from "react"
  import { useTranslation } from "react-i18next"
  import type { SectionType } from "../lib/api-types.js"
  import { formatCountdown } from "../lib/countdown.js"
  import { Icon } from "./Icon.js"
  import { SaveState, type SaveStateProps } from "./SaveState.js"

  const LOW_MS = 60_000

  export interface RunTopBarProps {
    readonly sectionType: SectionType
    readonly saveState: SaveStateProps
    readonly remainingMs: number | null
    readonly answered: number
    readonly total: number
    readonly menuExpanded: boolean
    readonly menuTriggerRef?: RefObject<HTMLButtonElement | null>
    readonly onOpenMenu: () => void
  }

  export function RunTopBar({
    sectionType,
    saveState,
    remainingMs,
    answered,
    total,
    menuExpanded,
    menuTriggerRef,
    onOpenMenu,
  }: RunTopBarProps) {
    const { t } = useTranslation("runner")
    const low = remainingMs !== null && remainingMs <= LOW_MS
    const announceLow = remainingMs !== null && remainingMs > 0 && low

    return (
      <header className="m-runtop">
        <div className="m-row">
          <button
            ref={menuTriggerRef}
            type="button"
            aria-label={t("menu.openLabel")}
            aria-expanded={menuExpanded}
            aria-haspopup="dialog"
            className="m-iconbtn runner-panel-trigger runner-menu-trigger"
            onClick={onOpenMenu}
          >
            <Icon name="more" />
          </button>
          <span
            className={`section-chip section-chip--${sectionType}`}
            data-section={sectionType}
          >
            {t(`runner.sectionChip.${sectionType}`)}
          </span>
          <span className="grow" />
          <SaveState {...saveState} />
          {remainingMs !== null ? (
            <span
              role="timer"
              aria-label={t("runner.timeRemaining")}
              className="m-timer"
              data-low={low ? "true" : undefined}
            >
              {low ? <Icon name="clock" className="size-4" /> : null}
              <span>{formatCountdown(remainingMs)}</span>
            </span>
          ) : null}
        </div>
        <div
          role="progressbar"
          aria-label={t("runner.sectionProgress")}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={answered}
          className="m-progress"
        >
          <i style={{ width: `${total > 0 ? (100 * answered) / total : 0}%` }} />
        </div>
        <p role="status" className="sr-only">
          {announceLow ? t("runner.oneMinuteLeft") : ""}
        </p>
      </header>
    )
  }
  ```

  `packages/app/src/components/RunActionBar.tsx`:

  ```tsx
  import type { RefObject } from "react"
  import { useTranslation } from "react-i18next"
  import { Icon } from "./Icon.js"

  export interface RunPrimaryAction {
    readonly kind: "next" | "finish" | "handIn"
    readonly label: string
    readonly disabled: boolean
  }

  export interface RunActionBarProps {
    readonly showPrevious: boolean
    readonly onPrevious: () => void
    readonly answered: number
    readonly total: number
    readonly navigatorExpanded: boolean
    readonly navigatorTriggerRef?: RefObject<HTMLButtonElement | null>
    readonly onOpenNavigator: () => void
    readonly primary: RunPrimaryAction | null
    readonly onPrimary: () => void
  }

  export function RunActionBar({
    showPrevious,
    onPrevious,
    answered,
    total,
    navigatorExpanded,
    navigatorTriggerRef,
    onOpenNavigator,
    primary,
    onPrimary,
  }: RunActionBarProps) {
    const { t } = useTranslation("runner")

    return (
      <footer className="m-actionbar" data-sticky="true">
        {showPrevious ? (
          <button
            type="button"
            className="m-btn"
            data-variant="secondary"
            aria-label={t("runner.previous")}
            style={{ flex: "0 0 56px" }}
            onClick={onPrevious}
          >
            <Icon name="back" />
          </button>
        ) : null}
        <button
          ref={navigatorTriggerRef}
          type="button"
          aria-label={t("navigator.openLabel")}
          aria-expanded={navigatorExpanded}
          aria-haspopup="dialog"
          className="m-btn nav-toggle runner-panel-trigger runner-navigator-trigger"
          data-variant="secondary"
          style={{ flex: "0 0 auto" }}
          onClick={onOpenNavigator}
        >
          <Icon name="grid" />
          <span>
            {answered}/{total}
          </span>
        </button>
        {primary ? (
          <button
            type="button"
            className="m-btn"
            data-kind={primary.kind}
            disabled={primary.disabled}
            onClick={onPrimary}
          >
            {primary.label}
          </button>
        ) : null}
      </footer>
    )
  }
  ```

  `packages/app/src/components/FinishSectionSheet.tsx`:

  ```tsx
  import type { RefObject } from "react"
  import { useTranslation } from "react-i18next"
  import { BottomSheet } from "./BottomSheet.js"

  export interface FinishSectionSheetProps {
    readonly open: boolean
    readonly onOpenChange: (open: boolean) => void
    readonly sectionLabel: string
    readonly blankCount: number
    readonly busy: boolean
    readonly failed: boolean
    readonly onConfirm: () => void
    readonly returnFocusRef?: RefObject<HTMLElement | null>
  }

  export function FinishSectionSheet({
    open,
    onOpenChange,
    sectionLabel,
    blankCount,
    busy,
    failed,
    onConfirm,
    returnFocusRef,
  }: FinishSectionSheetProps) {
    const { t } = useTranslation("runner")

    return (
      <BottomSheet
        open={open}
        onOpenChange={onOpenChange}
        title={t("runner.finishSectionTitle", { section: sectionLabel })}
        closeLabel={t("menu.closeLabel")}
        returnFocusRef={returnFocusRef}
      >
        <p>
          {blankCount > 0
            ? t("runner.finishSectionBlank", { count: blankCount })
            : t("runner.finishSectionNoBlank")}
        </p>
        {failed ? (
          <p role="alert" className="m-alert mt-3">
            {t("runner.sectionTransitionError")}
          </p>
        ) : null}
        <div className="m-sheet-actions">
          <button
            type="button"
            className="m-btn"
            disabled={busy}
            aria-busy={busy}
            onClick={onConfirm}
          >
            {t("runner.finishSectionButton", { section: sectionLabel })}
          </button>
          <button
            type="button"
            className="m-btn"
            data-variant="secondary"
            onClick={() => {
              onOpenChange(false)
            }}
          >
            {t("handIn.keepWorking")}
          </button>
        </div>
      </BottomSheet>
    )
  }
  ```

  `packages/app/src/components/RunMenuSheet.tsx`:

  ```tsx
  import type { RefObject } from "react"
  import { useTranslation } from "react-i18next"
  import { BottomSheet } from "./BottomSheet.js"

  export interface RunMenuSheetProps {
    readonly open: boolean
    readonly onOpenChange: (open: boolean) => void
    /** `envelope.expiresAt !== null` — the clock does not start with the attempt. */
    readonly clockStarted: boolean
    readonly onLeave: () => void
    readonly returnFocusRef?: RefObject<HTMLElement | null>
  }

  export function RunMenuSheet({
    open,
    onOpenChange,
    clockStarted,
    onLeave,
    returnFocusRef,
  }: RunMenuSheetProps) {
    const { t } = useTranslation("runner")

    return (
      <BottomSheet
        open={open}
        onOpenChange={onOpenChange}
        title={t("menu.title")}
        closeLabel={t("menu.closeLabel")}
        returnFocusRef={returnFocusRef}
      >
        <p className="m-reason">
          {t(
            clockStarted
              ? "menu.leaveTestNoteRunning"
              : "menu.leaveTestNoteBeforeStart",
          )}
        </p>
        <div className="m-sheet-actions">
          <button
            type="button"
            className="m-btn"
            data-variant="secondary"
            onClick={onLeave}
          >
            {t("menu.leaveTest")}
          </button>
          <button
            type="button"
            className="m-btn"
            data-variant="ghost"
            onClick={() => {
              onOpenChange(false)
            }}
          >
            {t("runner.backToTest")}
          </button>
        </div>
      </BottomSheet>
    )
  }
  ```

- [ ] **Step 6: Run the component tests to confirm GREEN**

  Run: `pnpm --filter @pp/app test src/components/RunTopBar.test.tsx src/components/RunActionBar.test.tsx src/components/FinishSectionSheet.test.tsx src/components/RunMenuSheet.test.tsx`
  Expected: PASS.

- [ ] **Step 7: Write the failing navigator tests**

  In `packages/app/src/components/QuestionNavigator.test.tsx` add (reuse the file's existing `runnerSource`/`reviewSource` fixtures — if they are not named that, use whatever the file's runner-mode and review-mode `NavigatorSource` constants are called; the tests below only rely on two sections where the first is `closed` and the second `open`, free navigation, and a review source):

  ```tsx
  it("is a bottom sheet named Questions with the per-section answered count", () => {
    render(<QuestionNavigator open onOpenChange={vi.fn()} source={runnerSource} answeredCount={2} totalCount={4} onNavigate={vi.fn()} />)

    expect(screen.getByRole("dialog", { name: "Questions" })).toBeInTheDocument()
    expect(screen.getByText("2 of 4 answered")).toBeInTheDocument()
  })

  it("labels each section with its progress state", () => {
    render(<QuestionNavigator open onOpenChange={vi.fn()} source={runnerSource} answeredCount={0} totalCount={4} onNavigate={vi.fn()} />)

    expect(screen.getByRole("heading", { name: "Listening · finished" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Reading" })).toBeInTheDocument()
  })

  it("puts the status in words in every cell's accessible name", () => {
    render(<QuestionNavigator open onOpenChange={vi.fn()} source={runnerSource} answeredCount={1} totalCount={4} onNavigate={vi.fn()} />)

    expect(screen.getByRole("button", { name: /^Question 3, you are here$/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^Question 4, not answered$/ })).toBeInTheDocument()
  })

  it("shows ✓ / ✕ / – marks beside review outcomes and names them in words", () => {
    render(<QuestionNavigator open onOpenChange={vi.fn()} source={reviewSource} answeredCount={2} totalCount={3} onNavigate={vi.fn()} />)

    expect(screen.getByRole("button", { name: /correct$/ })).toHaveTextContent("✓")
    expect(screen.getByRole("button", { name: /wrong$/ })).toHaveTextContent("✕")
    expect(screen.getByRole("button", { name: /left blank$/ })).toHaveTextContent("–")
  })
  ```

  (Use ordinals that exist in the fixtures; the regexes above encode "current question is ordinal 3, next is 4" — adapt the digits to the fixture's actual ordinals, not the words.)

- [ ] **Step 8: Run to confirm RED**

  Run: `pnpm --filter @pp/app test src/components/QuestionNavigator.test.tsx`
  Expected: new tests FAIL (still a DeviceSheet; labels `Question 3`).

- [ ] **Step 9: Rewrite `QuestionNavigator` on `BottomSheet`**

  Replace `packages/app/src/components/QuestionNavigator.tsx` imports and component (keep `LEGEND_LABEL_KEY` and `SECTION_LABEL_KEY` exactly as they are):

  ```tsx
  import type { JSX, RefObject } from "react"
  import { useTranslation } from "react-i18next"
  import {
    buildNavigatorGroups,
    type NavigatorCellStatus,
    type NavigatorSource,
    type SectionKind,
  } from "../lib/navigator-state.js"
  import { BottomSheet } from "./BottomSheet.js"

  const STATUS_WORD_KEY = {
    current: "navigator.statusCurrent",
    answered: "navigator.statusAnswered",
    blank: "navigator.statusBlank",
    correct: "navigator.statusCorrect",
    incorrect: "navigator.statusIncorrect",
  } as const satisfies Record<NavigatorCellStatus, string>

  const REVIEW_MARK: Partial<Record<NavigatorCellStatus, string>> = {
    correct: "✓",
    incorrect: "✕",
    blank: "–",
  }

  export interface QuestionNavigatorProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    source: NavigatorSource
    answeredCount: number
    totalCount: number
    onNavigate: (sectionId: string, questionId: string) => void
    returnFocusRef?: RefObject<HTMLElement | null>
  }

  export function QuestionNavigator({
    open,
    onOpenChange,
    source,
    answeredCount,
    totalCount,
    onNavigate,
    returnFocusRef,
  }: QuestionNavigatorProps): JSX.Element {
    const { t } = useTranslation("runner")
    const groups = buildNavigatorGroups(source)
    const review = source.mode === "review"

    return (
      <BottomSheet
        open={open}
        onOpenChange={onOpenChange}
        title={review ? t("navigator.reviewTitle") : t("navigator.title")}
        closeLabel={t("navigator.closeLabel")}
        returnFocusRef={returnFocusRef}
      >
        <p className="m-reason" style={{ marginTop: 0 }}>
          {review
            ? t("navigator.reviewSubtitle")
            : t("navigator.progressSubtitle", {
                answered: answeredCount,
                total: totalCount,
              })}
        </p>
        <div className="question-panel-groups">
          {groups.map((group) => {
            const label = t(SECTION_LABEL_KEY[group.sectionType])
            const status = source.sections.find(
              (section) => section.id === group.sectionId,
            )?.status
            let heading = label

            if (!review && status === "closed") {
              heading = t("navigator.sectionFinished", { section: label })
            } else if (!review && status === "pending") {
              heading = t("navigator.sectionNotStarted", { section: label })
            }

            return (
              <section key={group.sectionId} className="question-group">
                <h3 id={`question-group-${group.sectionId}`}>{heading}</h3>
                <div
                  role="group"
                  aria-label={t("navigator.questionGridLabel", {
                    section: label,
                  })}
                  className="question-grid"
                  style={{
                    gridTemplateColumns: "repeat(auto-fill, minmax(52px, 1fr))",
                  }}
                >
                  {group.cells.map((cell) => {
                    const word =
                      review && cell.status === "blank"
                        ? t("navigator.statusLeftBlank")
                        : t(STATUS_WORD_KEY[cell.status])

                    return (
                      <button
                        key={cell.questionId}
                        type="button"
                        disabled={cell.disabled}
                        aria-current={cell.status === "current" ? "true" : undefined}
                        aria-label={t("navigator.questionLabelWithStatus", {
                          ordinal: cell.ordinal,
                          status: word,
                        })}
                        data-status={cell.status}
                        className="np-cell"
                        onClick={() => {
                          onNavigate(group.sectionId, cell.questionId)
                        }}
                      >
                        {cell.ordinal}
                        {review ? (
                          <span className="np-mark" aria-hidden="true">
                            {REVIEW_MARK[cell.status]}
                          </span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
        <ul aria-label={t("navigator.legendLabel")} className="question-legend">
          {(review
            ? (["correct", "incorrect", "blank"] as const)
            : (["answered", "current", "blank"] as const)
          ).map((status) => (
            <li key={status} className="flex items-center gap-1.5">
              <span aria-hidden="true" data-status={status} className="np-key" />
              {t(LEGEND_LABEL_KEY[status])}
            </li>
          ))}
        </ul>
        {!review && source.sections.some((s) => s.navigation === "forward_only") ? (
          <p className="question-panel-note">{t("navigator.forwardOnlyNote")}</p>
        ) : null}
      </BottomSheet>
    )
  }
  ```

  Keep the file's existing `LEGEND_LABEL_KEY` and `SECTION_LABEL_KEY` constants between the imports and the new interface. `DeviceSheet` is no longer imported here.

- [ ] **Step 10: Run to confirm GREEN, then fix the navigator assertions that pinned the old sheet**

  Run: `pnpm --filter @pp/app test src/components/QuestionNavigator.test.tsx`
  The new tests pass. Existing assertions to update, by name of what they pin:
  - any `toHaveClass("question-panel")` / `data-side="right"` / `device-sheet-content` check → replace with `expect(screen.getByRole("dialog", { name: "Questions" })).toBeInTheDocument()`;
  - the test that clicks the `Open menu` switch button inside the navigator (the `onOpenMenu` prop) → delete it (the prop no longer exists);
  - cell lookups by `{ name: "Question 7" }` → `{ name: /^Question 7,/ }`.
  Expected afterwards: PASS.

- [ ] **Step 11: Rewire `RunScreen`**

  In `packages/app/src/pages/attempts.$attemptId.run.tsx`:

  1. Imports: remove `AppMenu`, `type MenuStudent`, `SaveState` (keep `type SaveStateProps`), `formatCountdown`, `Card/CardContent/CardHeader/CardTitle/Button` only if `RunRouteError` stops using them (it still does — keep). Add:
     ```tsx
     import { FinishSectionSheet } from "../components/FinishSectionSheet.js"
     import { RunActionBar, type RunPrimaryAction } from "../components/RunActionBar.js"
     import { RunMenuSheet } from "../components/RunMenuSheet.js"
     import { RunTopBar } from "../components/RunTopBar.js"
     ```
     `OfflineBanner` and `QuestionNavigator` imports stay.
  2. `student?: MenuStudent` in `RunScreenProps` becomes `student?: { displayName: string; email: string }` (unused by the screen now; the loader still returns it) and is **not** destructured. Delete the `AppMenu`/`MenuStudent` import.
  3. `type RunnerPanel = "menu" | "navigator" | "finish" | null`.
  4. Delete `previousPanelRef` and the `useEffect` that refocuses the trigger when `panel` closes — the menu and navigator sheets now restore focus through `returnFocusRef` (`menuTriggerRef`, `navigatorTriggerRef`).
  5. Add, next to the other effects, focus management for question changes (skipped on first render):
     ```tsx
     const firstQuestionRender = useRef(true)

     useEffect(() => {
       if (firstQuestionRender.current) {
         firstQuestionRender.current = false

         return
       }

       document.querySelector<HTMLElement>("[data-qtitle]")?.focus({ preventScroll: true })
     }, [currentQuestionId])
     ```
  6. After `const { question, stimulus } = currentEntry` add:
     ```tsx
     const answeredInSection = entries.filter(
       (entry) => (responses.get(entry.question.id)?.length ?? 0) > 0,
     ).length
     const sectionLabel = t(`runner.sectionChip.${section.type}`)
     ```
  7. Replace everything from the line `return (\n    <div className="device-page runner-shell"` to the end of `RunScreen` with:
     ```tsx
     let primary: RunPrimaryAction | null = null

     if (!expired) {
       if (nextEntry) {
         primary = { kind: "next", label: t("runner.next"), disabled: false }
       } else if (nextSection) {
         primary = {
           kind: "finish",
           label: t("runner.finishSectionButton", { section: sectionLabel }),
           disabled: finishingSection,
         }
       } else {
         primary = { kind: "handIn", label: t("runner.handIn"), disabled: false }
       }
     }

     const handlePrimary = (): void => {
       if (nextEntry) {
         handleNext()
       } else if (nextSection) {
         setPanel("finish")
       } else {
         navigate(`/attempts/${attemptId}/hand-in`)
       }
     }

     const closePanel =
       (which: Exclude<RunnerPanel, null>) =>
       (next: boolean): void => {
         // A delayed dismiss from one sheet must not clobber a newer one.
         if (!next) {
           setPanel((current) => (current === which ? null : current))
         }
       }

     return (
       <div className="m-page runner-shell" data-panel={panel ?? undefined}>
         <RunTopBar
           sectionType={section.type}
           saveState={saveState}
           remainingMs={remainingMs}
           answered={answeredInSection}
           total={entries.length}
           menuExpanded={panel === "menu"}
           menuTriggerRef={menuTriggerRef}
           onOpenMenu={() => {
             setPanel((current) => (current === "menu" ? null : "menu"))
           }}
         />

         <main className="m-body m-run-body">
           {retryableFlushFailure && saveState.state === "pending" ? (
             <OfflineBanner variant="in-test" pendingCount={saveState.pendingCount} />
           ) : null}

           {runner}

           {sectionTransitionFailed && panel !== "finish" ? (
             <p role="alert" className="m-alert mt-3">
               {t("runner.sectionTransitionError")}
             </p>
           ) : null}
         </main>

         <RunActionBar
           showPrevious={!expired && previousEntry !== undefined}
           onPrevious={handlePrevious}
           answered={answeredInSection}
           total={entries.length}
           navigatorExpanded={panel === "navigator"}
           navigatorTriggerRef={navigatorTriggerRef}
           onOpenNavigator={() => {
             setPanel((current) => (current === "navigator" ? null : "navigator"))
           }}
           primary={primary}
           onPrimary={handlePrimary}
         />

         <RunMenuSheet
           open={panel === "menu"}
           onOpenChange={closePanel("menu")}
           // The clock does not start with the attempt: openapi.yaml says
           // `startedAt`/`expiresAt` stay null until the first section entry.
           clockStarted={envelope.expiresAt !== null}
           onLeave={() => {
             navigate("/")
           }}
           returnFocusRef={menuTriggerRef}
         />
         <FinishSectionSheet
           open={panel === "finish"}
           onOpenChange={closePanel("finish")}
           sectionLabel={sectionLabel}
           blankCount={entries.length - answeredInSection}
           busy={finishingSection}
           failed={sectionTransitionFailed}
           onConfirm={handleFinishSection}
         />
         <QuestionNavigator
           open={panel === "navigator"}
           onOpenChange={closePanel("navigator")}
           source={navigatorSource}
           answeredCount={answeredInSection}
           totalCount={entries.length}
           returnFocusRef={navigatorTriggerRef}
           onNavigate={handleNavigatorNavigate}
         />
       </div>
     )
     ```
     `FinishSectionSheet` gets no `returnFocusRef`: the primary button lives in `RunActionBar`, and `BottomSheet` returns focus to the element that was focused when it opened.
  8. `handleFinishSection` already navigates away on success; on `section_expired` it calls `setExpired(...)` — add `setPanel(null)` there and in the generic failure branch leave the sheet open (its `failed` alert is the feedback).
  9. `handleNavigatorNavigate` keeps its existing `setPanel(null)`.

- [ ] **Step 12: Write the new run-screen tests**

  Add to `describe("runner panels", …)` in `attempts.$attemptId.run.test.tsx`. They reuse the file's own fixtures: `listeningEnvelope` (one section), `sectionBoundaryEnvelope` (listening, current question is its last, next section `section-reading`) and `readingEnvelope` (final section):

  ```tsx
  it("offers Finish <Section> on the last question of a non-final section and confirms in a sheet", async () => {
    const user = userEvent.setup()

    mockSetPosition.mockResolvedValue(undefined)
    mockFinishSection.mockImplementation(finishWithAppliedRemainder)
    const { navigate } = renderRunScreen(sectionBoundaryEnvelope)

    await user.click(screen.getByRole("button", { name: "Finish Listening" }))

    const dialog = screen.getByRole("dialog", { name: "Finish Listening?" })

    expect(within(dialog).getByText(/You cannot come back to this section\./)).toBeInTheDocument()
    expect(mockFinishSection).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole("button", { name: "Finish Listening" }))

    await waitFor(finishWasCalled)
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith("/attempts/attempt-1/sections/section-reading/rules")
    })
  })

  it("offers Hand in on the last question of the last section and goes to the hand-in route", async () => {
    const user = userEvent.setup()
    const { navigate } = renderRunScreen({ ...readingEnvelope, currentQuestionId: "q-r4" })

    await user.click(screen.getByRole("button", { name: "Hand in" }))

    expect(navigate).toHaveBeenCalledWith("/attempts/attempt-1/hand-in")
  })

  it("has no Hand in button before the last question", () => {
    renderRunScreen()

    expect(screen.queryByRole("button", { name: "Hand in" })).toBeNull()
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument()
  })

  it("leaves the test from the Menu sheet", async () => {
    const user = userEvent.setup()
    const { navigate } = renderRunScreen()

    await user.click(screen.getByRole("button", { name: "Open menu" }))
    await user.click(within(screen.getByRole("dialog", { name: "Menu" })).getByRole("button", { name: "Leave test" }))

    expect(navigate).toHaveBeenCalledWith("/")
  })

  it("shows per-section progress in the action bar and top bar", () => {
    renderRunScreen()

    expect(screen.getByRole("button", { name: "Open the question navigator" })).toHaveTextContent("0/2")
    expect(screen.getByRole("progressbar", { name: "Section progress" })).toHaveAttribute("aria-valuemax", "2")
  })
  ```

  `waitFor` is already imported by the file.

- [ ] **Step 13: Run to confirm RED, then update the old assertions**

  Run: `pnpm --filter @pp/app test "src/pages/attempts.\$attemptId.run.test.tsx"`
  Update exactly these existing tests (every other test must pass untouched):
  - `switches directly between modal panels using controls inside the active sheet` — **delete** (the Menu sheet no longer contains an "Open the question navigator" button and the navigator no longer contains "Open menu"). Replace with:
    ```tsx
    it("keeps exactly one modal panel open at a time", async () => {
      renderRunScreen()
      const runner = screen.getByRole("main").parentElement

      await userEvent.click(screen.getByRole("button", { name: "Open menu" }))
      expect(runner).toHaveAttribute("data-panel", "menu")
      expect(screen.getAllByRole("dialog")).toHaveLength(1)

      await userEvent.keyboard("{Escape}")
      await userEvent.click(screen.getByRole("button", { name: "Open the question navigator" }))
      expect(runner).toHaveAttribute("data-panel", "navigator")
      expect(screen.getAllByRole("dialog")).toHaveLength(1)
    })
    ```
  - Tests that assert `toHaveClass("app-bar", "z-[40]")` → `toHaveClass("m-runtop")` on `screen.getByRole("banner")`.
  - The test asserting `toHaveClass("device-main", "runner-main")` → `toHaveClass("m-body", "m-run-body")`.
  - The test asserting the timer has class `text-ink-2` → `expect(screen.getByLabelText("Time remaining")).not.toHaveAttribute("data-low")`; any test asserting an amber/low class at < 5 min → use a countdown ≤ 60 s and `toHaveAttribute("data-low", "true")`.
  - Tests that click `"Continue to Reading"` (four): replace with two steps — click `getByRole("button", { name: "Finish Listening" })`, then click `within(screen.getByRole("dialog", { name: "Finish Listening?" })).getByRole("button", { name: "Finish Listening" })`.
  - The test that clicks `"Finish test"`: click `"Hand in"` instead (action bar, last question of the last section).
  - The three tests that click the footer `"Hand in"` on an arbitrary question: first advance to the last question with `Next` clicks (awaiting `mockSetPosition`), then click `"Hand in"`.
  - In `describe("section boundary")`: `offers the next section only on the current section's last question` — query `"Finish Listening"` instead of `"Continue to Reading"` (both the absent and the present assertion); `finishes with an immediately tapped answer…` — after tapping "School", click `"Finish Listening"` then the dialog's `"Finish Listening"` button (as above); `offers hand-in instead of a nonexistent next section…` — `queryByRole("button", { name: /^Finish / })` must be absent and the click target is `"Hand in"` (was `"Finish test"`).
  - The pip-strip test (`renders the pip/progress strip from questionCount…`) still passes in this task (the runners are untouched until Task 11); leave it.
  Run again. Expected: PASS.

- [ ] **Step 14: Verify gates and commit**

  ```bash
  pnpm exec prettier --write packages/app/src/components/Run*.tsx packages/app/src/components/FinishSectionSheet*.tsx packages/app/src/components/QuestionNavigator*.tsx "packages/app/src/pages/attempts.\$attemptId.run.tsx" "packages/app/src/pages/attempts.\$attemptId.run.test.tsx" packages/app/src/index.css packages/app/src/locales
  pnpm --filter @pp/app typecheck && pnpm lint:i18n && pnpm exec oxlint packages/app/src && pnpm lint:frontend && pnpm --filter @pp/app test
  git add packages/app/src
  git commit -m "feat(app): mobile runner chrome with action bar and bottom sheets"
  ```

---

### Task 11: Run question surfaces — listening card, passage, lettered choices

Prototype source: `vRun` media/choices (`.audio` card with `Play recording → Playing… → Played`, bar, plays-left hint, locked-until-played, failure; `details.passage`; `.choice` + `.letter`; multi-select hint; `.qmeta`, `.qtitle`). Real source: `components/ListeningRunner.tsx`, `ReadingRunner.tsx`, `QuestionMedia.tsx`, `ChoiceList.tsx`, `pages/attempts.$attemptId.run.tsx` (`playState`, `handleAudioEnded`, `handleAudioError`, `pips`, `displayStimulus`), `pages/attempts.$attemptId.review.tsx` (`ReviewChoiceList` dot only).

**Decisions (flagged in Part notes):** the prototype's "answers locked until played" is implemented for **capped audio** only (a stimulus with `playsUsed` / `maxPlays`); it unlocks when the recording has been played (`playsUsed > 0` and nothing is playing) **or when the recording failed to load** (the prototype would leave the student unable to answer). The pip strip is removed (progress lives in `RunTopBar`). Section-relative numbering replaces `ordinal / questionCount`.

**Files:**
- Modify: `components/ListeningRunner.tsx`, `ListeningRunner.test.tsx`
- Modify: `components/ReadingRunner.tsx`, `ReadingRunner.test.tsx`
- Modify: `components/QuestionMedia.tsx`, `QuestionMedia.test.tsx`
- Modify: `components/ChoiceList.tsx`, `ChoiceList.test.tsx`
- Modify: `pages/attempts.$attemptId.run.tsx`, `attempts.$attemptId.run.test.tsx`
- Modify: `pages/attempts.$attemptId.review.tsx` (letter in `ReviewChoiceList` only)
- Modify: `index.css` (restyle `.choice`, `.choice-dot`, `.question-prompt`, `.audio-box`, `.play-button`, `.passage`; add `m-passage`, `m-qmeta`, `m-eq`)
- Modify: `locales/*/runner.json`

**Interfaces:**
- Consumes: Task 10 (`RunTopBar` owns the progress bar), Task 7 CSS/script, `Icon`.
- Produces:
  - `ListeningRunnerProps`: removes `questionCount`, `pips`; adds `positionInSection: number`, `sectionQuestionCount: number`, `audioProgress: number` (0–1) and `onAudioProgress: (fraction: number) => void`. `QuestionPip` export is deleted.
  - `ReadingRunnerProps`: removes `questionCount`, `pips`; adds `sectionType: "reading" | "math"`, `positionInSection: number`, `sectionQuestionCount: number`.
  - `QuestionMediaProps`: adds optional `audioFailed?: boolean`, `progress?: number`.
  - `ChoiceListProps`: adds optional `lockedMessage?: string` (replaces the hard-coded "Answer locked" line when provided).

- [ ] **Step 1: Add the strings**

  ```bash
  PATCH="$(mktemp)" && cat > "$PATCH" <<'EOF'
  {
    "en": {
      "runner.sectionQuestionCount": "{{section}} · Question {{current}} of {{total}}",
      "listening.playing": "Playing…",
      "listening.played": "Played",
      "listening.noPlaysLeft": "No plays left",
      "listening.playsLeftHint_one": "{{count}} play left. It cannot be paused.",
      "listening.playsLeftHint_other": "{{count}} plays left. They cannot be paused.",
      "listening.answerNow": "Answer now. You cannot come back to this question.",
      "listening.unlockHint": "Play the recording to unlock the answers.",
      "listening.recordingLabel": "Recording"
    },
    "de": {
      "runner.sectionQuestionCount": "{{section}} · Frage {{current}} von {{total}}",
      "listening.playing": "Wird abgespielt…",
      "listening.played": "Abgespielt",
      "listening.noPlaysLeft": "Keine Wiedergabe übrig",
      "listening.playsLeftHint_one": "Noch {{count}} Wiedergabe. Sie kann nicht pausiert werden.",
      "listening.playsLeftHint_other": "Noch {{count}} Wiedergaben. Sie können nicht pausiert werden.",
      "listening.answerNow": "Antworte jetzt. Du kannst nicht zu dieser Frage zurückkehren.",
      "listening.unlockHint": "Spiele die Aufnahme ab, um die Antworten freizuschalten.",
      "listening.recordingLabel": "Aufnahme"
    },
    "es": {
      "runner.sectionQuestionCount": "{{section}} · Pregunta {{current}} de {{total}}",
      "listening.playing": "Reproduciendo…",
      "listening.played": "Reproducida",
      "listening.noPlaysLeft": "No quedan reproducciones",
      "listening.playsLeftHint_one": "Queda {{count}} reproducción. No se puede pausar.",
      "listening.playsLeftHint_other": "Quedan {{count}} reproducciones. No se pueden pausar.",
      "listening.answerNow": "Responde ahora. No podrás volver a esta pregunta.",
      "listening.unlockHint": "Reproduce la grabación para desbloquear las respuestas.",
      "listening.recordingLabel": "Grabación"
    },
    "fr": {
      "runner.sectionQuestionCount": "{{section}} · Question {{current}} sur {{total}}",
      "listening.playing": "Lecture en cours…",
      "listening.played": "Écoutée",
      "listening.noPlaysLeft": "Plus d’écoute",
      "listening.playsLeftHint_one": "{{count}} écoute restante. On ne peut pas la mettre en pause.",
      "listening.playsLeftHint_other": "{{count}} écoutes restantes. On ne peut pas les mettre en pause.",
      "listening.answerNow": "Réponds maintenant. Tu ne pourras pas revenir à cette question.",
      "listening.unlockHint": "Écoute l’enregistrement pour débloquer les réponses.",
      "listening.recordingLabel": "Enregistrement"
    },
    "it": {
      "runner.sectionQuestionCount": "{{section}} · Domanda {{current}} di {{total}}",
      "listening.playing": "In riproduzione…",
      "listening.played": "Riprodotta",
      "listening.noPlaysLeft": "Nessun ascolto rimasto",
      "listening.playsLeftHint_one": "{{count}} ascolto rimasto. Non si può mettere in pausa.",
      "listening.playsLeftHint_other": "{{count}} ascolti rimasti. Non si possono mettere in pausa.",
      "listening.answerNow": "Rispondi ora. Non potrai tornare a questa domanda.",
      "listening.unlockHint": "Ascolta la registrazione per sbloccare le risposte.",
      "listening.recordingLabel": "Registrazione"
    },
    "ja": {
      "runner.sectionQuestionCount": "{{section}} · 問題{{current}}／{{total}}",
      "listening.playing": "再生中…",
      "listening.played": "再生しました",
      "listening.noPlaysLeft": "再生できません",
      "listening.playsLeftHint": "残り{{count}}回再生できます。一時停止はできません。",
      "listening.answerNow": "いま答えましょう。この問題には戻れません。",
      "listening.unlockHint": "録音を再生すると答えが選べます。",
      "listening.recordingLabel": "録音"
    }
  }
  EOF
  node packages/app/scripts/add-locale-keys.mjs runner "$PATCH" && pnpm --filter @pp/app test src/locales
  ```

  Expected: PASS.

- [ ] **Step 2: Write the failing component tests**

  Append to `QuestionMedia.test.tsx` (the file already defines `cappedAudio`, `passage`, `openImage`):

  ```tsx
  describe("QuestionMedia audio card", () => {
    afterEach(cleanup)

    it("offers Play recording with the plays-left hint and an empty bar", () => {
      render(<QuestionMedia stimulus={cappedAudio} onClaimPlay={vi.fn()} playing={false} progress={0} />)

      expect(screen.getByRole("button", { name: "Play recording" })).toBeEnabled()
      expect(screen.getByText("2 plays left. They cannot be paused.")).toBeInTheDocument()
      expect(screen.getByTestId("audio-progress")).toHaveStyle({ width: "0%" })
    })

    it("shows a disabled Playing… state with the no-pause rule while the clip plays", () => {
      render(<QuestionMedia stimulus={{ ...cappedAudio, playsUsed: 1 }} onClaimPlay={vi.fn()} playing progress={0.4} />)

      const button = screen.getByRole("button", { name: "Playing…" })

      expect(button).toBeDisabled()
      expect(screen.getByText("You cannot pause or rewind.")).toBeInTheDocument()
      expect(screen.getByTestId("audio-progress")).toHaveStyle({ width: "40%" })
    })

    it("shows Played with the answer-now hint once the last play is spent", () => {
      render(<QuestionMedia stimulus={{ ...cappedAudio, maxPlays: 1, playsUsed: 1 }} onClaimPlay={vi.fn()} playing={false} progress={1} />)

      expect(screen.getByRole("button", { name: "Played" })).toBeDisabled()
      expect(screen.getByText("Answer now. You cannot come back to this question.")).toBeInTheDocument()
    })

    it("says No plays left when loading failed and nothing remains, and offers a retry when plays remain", () => {
      const { rerender } = render(
        <QuestionMedia stimulus={{ ...cappedAudio, maxPlays: 1, playsUsed: 1 }} onClaimPlay={vi.fn()} playing={false} audioFailed />,
      )

      expect(screen.getByRole("button", { name: "No plays left" })).toBeDisabled()

      rerender(<QuestionMedia stimulus={{ ...cappedAudio, playsUsed: 1 }} onClaimPlay={vi.fn()} playing={false} audioFailed />)
      expect(screen.getByRole("button", { name: "Play recording" })).toBeEnabled()
    })

    it("keeps the legacy audio-box and play-button hooks", () => {
      render(<QuestionMedia stimulus={cappedAudio} onClaimPlay={vi.fn()} playing={false} />)

      expect(screen.getByRole("button", { name: "Play recording" })).toHaveClass("play-button")
      expect(screen.getByRole("region", { name: "Recording" })).toHaveClass("audio-box")
    })
  })
  ```

  Append to `ChoiceList.test.tsx`:

  ```tsx
  it("renders an aria-hidden letter badge inside each radio and keeps the accessible name", () => {
    render(<ChoiceList choices={choices} questionType="single_choice" selectedIds={[]} onSelect={vi.fn()} locked={false} />)

    const radio = screen.getByRole("radio", { name: "A cat" })

    expect(radio.querySelector('[aria-hidden="true"]')).toHaveTextContent("B")
  })

  it("shows the caller's lockedMessage instead of the section-lock line", () => {
    render(<ChoiceList choices={choices} questionType="single_choice" selectedIds={[]} onSelect={vi.fn()} locked lockedMessage="Play the recording to unlock the answers." />)

    expect(screen.getByText("Play the recording to unlock the answers.")).toBeInTheDocument()
    expect(screen.queryByText("Answer locked — this section does not allow changes.")).toBeNull()
  })
  ```

  (`choices` is the file's existing two-choice fixture — `A dog`, `A cat`; if it is named differently, use that name.)

  Append to `ListeningRunner.test.tsx` (it has `baseProps`; update `baseProps` first: remove `questionCount`/`pips`, add `positionInSection: 1`, `sectionQuestionCount: 4`, `audioProgress: 0`, `onAudioProgress: vi.fn()`, and delete the `pips` constant and every test that asserts `question-pip`):

  ```tsx
  it("shows the section-relative question position", () => {
    render(<ListeningRunner {...baseProps} positionInSection={2} sectionQuestionCount={4} />)

    expect(screen.getByText("Listening · Question 2 of 4")).toBeInTheDocument()
  })

  it("locks the answers with an explanation until the recording has been played", () => {
    render(<ListeningRunner {...baseProps} />)

    expect(screen.getByRole("radio", { name: "A dog" })).toBeDisabled()
    expect(screen.getByText("Play the recording to unlock the answers.")).toBeInTheDocument()
  })

  it("keeps answers locked while the clip is playing and unlocks them after it ends", () => {
    const { rerender } = render(
      <ListeningRunner {...baseProps} stimulus={{ ...cappedAudio, playsUsed: 1 }} audioSrc="/api/media/a.mp3" />,
    )

    expect(screen.getByRole("radio", { name: "A dog" })).toBeDisabled()

    rerender(<ListeningRunner {...baseProps} stimulus={{ ...cappedAudio, playsUsed: 1 }} audioSrc={null} />)
    expect(screen.getByRole("radio", { name: "A dog" })).toBeEnabled()
  })

  it("unlocks the answers when the recording failed to load, so the student is never stuck", () => {
    render(<ListeningRunner {...baseProps} stimulus={{ ...cappedAudio, playsUsed: 1 }} audioFailed />)

    expect(screen.getByRole("radio", { name: "A dog" })).toBeEnabled()
  })

  it("does not gate answers when the question has no audio stimulus", () => {
    render(<ListeningRunner {...baseProps} stimulus={undefined} />)

    expect(screen.getByRole("radio", { name: "A dog" })).toBeEnabled()
  })

  it("reports playback progress from the audio element", () => {
    const onAudioProgress = vi.fn()

    render(<ListeningRunner {...baseProps} stimulus={{ ...cappedAudio, playsUsed: 1 }} audioSrc="/api/media/a.mp3" onAudioProgress={onAudioProgress} />)

    const audio = screen.getByTestId("audio-player") as HTMLAudioElement

    Object.defineProperty(audio, "duration", { value: 10, configurable: true })
    Object.defineProperty(audio, "currentTime", { value: 4, configurable: true })
    fireEvent.timeUpdate(audio)

    expect(onAudioProgress).toHaveBeenCalledWith(0.4)
  })

  it("makes the prompt a focus target heading", () => {
    render(<ListeningRunner {...baseProps} />)

    expect(screen.getByRole("heading", { level: 1, name: "What did the boy see?" })).toHaveAttribute("tabindex", "-1")
  })
  ```

  Update `ReadingRunner.test.tsx`: in its base props remove `questionCount`/`pips`, add `sectionType: "reading"`, `positionInSection: 1`, `sectionQuestionCount: 4`; delete the pip tests; add:

  ```tsx
  it("wraps the passage in a details panel titled with its question range, open on the first question of the group", () => {
    render(<ReadingRunner {...baseProps} stimulus={passageStimulus} passageOrdinal={1} passageFirstOrdinal={5} passageLastOrdinal={6} question={{ ...question, ordinal: 5 }} />)

    const details = screen.getByText("Passage 1 · questions 5–6").closest("details")

    expect(details).toHaveClass("m-passage")
    expect(details).toHaveAttribute("open")
  })

  it("starts the passage collapsed on later questions of the same passage", () => {
    render(<ReadingRunner {...baseProps} stimulus={passageStimulus} passageOrdinal={1} passageFirstOrdinal={5} passageLastOrdinal={6} question={{ ...question, ordinal: 6 }} />)

    expect(screen.getByText("Passage 1 · questions 5–6").closest("details")).not.toHaveAttribute("open")
  })

  it("shows the section label and position for math, with no passage panel", () => {
    render(<ReadingRunner {...baseProps} sectionType="math" stimulus={undefined} passageOrdinal={null} positionInSection={2} sectionQuestionCount={3} />)

    expect(screen.getByText("Math · Question 2 of 3")).toBeInTheDocument()
    expect(document.querySelector("details")).toBeNull()
  })
  ```

  (`passageStimulus` = the file's existing passage `OpenStimulusWire` fixture, or define `{ id: "s", type: "passage", maxPlays: null, bodyText: "Once upon a time…" }`.)

- [ ] **Step 3: Run to confirm RED**

  Run: `pnpm --filter @pp/app test src/components/QuestionMedia.test.tsx src/components/ChoiceList.test.tsx src/components/ListeningRunner.test.tsx src/components/ReadingRunner.test.tsx`
  Expected: FAIL (new props/markup missing; type errors count as failures under `tsc`, run `typecheck` later).

- [ ] **Step 4: Restyle the legacy classes**

  In `index.css` replace the bodies of these existing rules (names stay so ChoiceList/Review/QuestionMedia tests that assert them keep passing):

  ```css
  .choice {
    position: relative;
    display: flex;
    width: 100%;
    min-height: 60px;
    align-items: center;
    gap: 12px;
    border: 2px solid var(--color-line);
    border-radius: 16px;
    background: var(--color-paper);
    padding: 10px 14px;
    color: var(--color-ink);
    cursor: pointer;
    font: inherit;
    font-size: 17px;
    font-weight: 700;
    text-align: left;
    touch-action: manipulation;
  }
  .choice:hover {
    border-color: var(--color-teal);
  }
  .choice:has([data-state="checked"]) {
    border-color: var(--color-teal);
    background: var(--color-teal-bg);
  }
  .choice:has(:focus-visible) {
    outline: 3px solid var(--color-teal);
    outline-offset: 2px;
  }
  .choice:has(:disabled),
  .choice[data-locked="true"] {
    background: #f1f4f6;
    cursor: not-allowed;
    opacity: 0.7;
  }
  .choice[data-locked="true"]:hover,
  .choice:has(:disabled):hover {
    border-color: var(--color-line);
  }
  .choice-dot {
    display: grid;
    width: 32px;
    height: 32px;
    flex: none;
    place-items: center;
    border: 1.5px solid var(--color-line);
    border-radius: 50%;
    background: var(--color-surface);
    color: var(--color-ink);
    font-size: 14px;
    font-weight: 800;
  }
  .choice-dot[data-state="checked"] {
    border-color: var(--color-teal);
    background: var(--color-teal);
    color: #fff;
  }
  .question-prompt {
    margin: 2px 0 4px;
    font-size: 20px;
    font-weight: 800;
    line-height: 1.3;
  }
  .question-prompt:focus {
    outline: none;
  }
  .audio-box {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
    border: 1.5px solid var(--color-line);
    border-radius: 16px;
    background: var(--color-paper);
    padding: 16px;
    text-align: center;
  }
  .play-button {
    display: inline-flex;
    min-height: 48px;
    align-items: center;
    justify-content: center;
    gap: 10px;
    border: 2px solid var(--color-teal);
    border-radius: 14px;
    background: var(--color-teal);
    color: #fff;
    cursor: pointer;
    font-size: 16px;
    font-weight: 800;
    touch-action: manipulation;
  }
  .play-button:disabled {
    border-color: #e8edf1;
    background: #e8edf1;
    color: #5d6a76;
    cursor: not-allowed;
  }
  ```

  Delete the old `.choice[data-locked="true"]`, `.choice[data-locked="true"]:hover` and `.choice-dot[data-state="checked"]` blocks that these replace (do not leave two definitions), keep the `data-verdict` rules. Then append:

  ```css
  .m-qmeta {
    margin: 0 0 8px;
    color: var(--color-ink-2);
    font-size: 13px;
    font-weight: 800;
  }
  .m-bar {
    height: 10px;
    margin: 12px 0 6px;
    overflow: hidden;
    border-radius: 9px;
    background: var(--color-line);
  }
  .m-bar > i {
    display: block;
    height: 100%;
    background: var(--color-clay);
  }
  .m-eq {
    display: inline-flex;
    height: 16px;
    align-items: flex-end;
    gap: 3px;
  }
  .m-eq > b {
    width: 4px;
    height: 8px;
    border-radius: 2px;
    background: currentColor;
    animation: m-eq 0.8s ease-in-out infinite;
  }
  .m-eq > b:nth-child(2) {
    animation-delay: 0.2s;
  }
  .m-eq > b:nth-child(3) {
    animation-delay: 0.4s;
  }
  @keyframes m-eq {
    50% {
      height: 16px;
    }
  }
  .m-passage {
    margin-bottom: 14px;
    border: 1.5px solid var(--color-line);
    border-radius: 16px;
    background: var(--color-paper);
  }
  .m-passage > summary {
    display: flex;
    min-height: 48px;
    cursor: pointer;
    align-items: center;
    gap: 8px;
    padding: 0 14px;
    font-weight: 800;
    list-style: none;
  }
  .m-passage > summary::-webkit-details-marker {
    display: none;
  }
  .m-passage .passage {
    max-height: none;
    border: 0;
    border-radius: 0;
    background: transparent;
    padding: 0 14px 14px;
    font-size: 17px;
    line-height: 1.6;
  }
  ```

  (the existing `prefers-reduced-motion` base rule already collapses `.m-eq` animation durations.)

- [ ] **Step 5: Implement `ChoiceList` letters and `lockedMessage`**

  In `ChoiceList.tsx`: add `lockedMessage?: string` to `ChoiceListProps`; thread it through `MultiChoiceList`/`SingleChoiceList` (they take `Omit<ChoiceListProps, "questionType">`, so it arrives automatically); replace both `{locked ? <p>{t("listening.answerLocked")}</p> : null}` with:

  ```tsx
  {locked ? <p className="m-hint">{lockedMessage ?? t("listening.answerLocked")}</p> : null}
  ```

  Replace each item body so the letter badge sits inside the Radix control, hidden from the accessibility tree (the label text stays the accessible name):

  ```tsx
  const LETTERS = "ABCDEFGH"
  ```

  Single: replace the `.map((choice) => …)` with `.map((choice, index) => …)` and

  ```tsx
  <RadioGroup.Item value={choice.id} className="choice-dot rounded-full">
    <span aria-hidden="true">{LETTERS[index]}</span>
  </RadioGroup.Item>
  ```

  (remove `RadioGroup.Indicator`). Multi: `.map((choice, index) => …)` and

  ```tsx
  <Checkbox.Root
    checked={selectedIds.includes(choice.id)}
    onCheckedChange={() => {
      onSelect(choice.id)
    }}
    disabled={locked}
    className="choice-dot rounded-full"
  >
    <span aria-hidden="true">{LETTERS[index]}</span>
  </Checkbox.Root>
  ```

  (remove `Checkbox.Indicator`). Give the multi hint paragraph `className="text-ink-2 m-hint mb-2 text-sm"` (keeps the `text-ink-2` class the existing test asserts). Add the style for the hint in CSS: `.m-hint { margin: 0 0 10px; color: var(--color-ink-2); font-size: 14px; }`.

  In `pages/attempts.$attemptId.review.tsx`, `ReviewChoiceList`: change `{choices.map((choice) => (` to `{choices.map((choice, index) => (` and render the letter in the dot: `<span aria-hidden="true" className="choice-dot rounded-full" data-state=…>{"ABCDEFGH"[index]}</span>`.

- [ ] **Step 6: Implement `QuestionMedia`'s audio card**

  In `QuestionMedia.tsx`: extend props with `audioFailed?: boolean` and `progress?: number`, add imports for `Icon`, and extract the two duplicated audio buttons into one internal component used by both the `audio` and `mixed`-audio branches:

  ```tsx
  function AudioCard({
    stimulus,
    onClaimPlay,
    playing,
    audioFailed,
    progress,
    className,
  }: {
    readonly stimulus: CappedStimulusWire | OpenStimulusWire
    readonly onClaimPlay: () => Promise<void>
    readonly playing: boolean
    readonly audioFailed: boolean
    readonly progress: number
    readonly className: string
  }) {
    const { t } = useTranslation("runner")
    const maxPlays = stimulus.maxPlays
    const playsUsed = "playsUsed" in stimulus ? stimulus.playsUsed : 0
    const exhausted = maxPlays !== null && playsUsed >= maxPlays
    const left = maxPlays !== null ? Math.max(0, maxPlays - playsUsed) : null
    const spentAndClean = exhausted && !audioFailed && !playing
    let label = t("listening.playButton")
    let hint: string | null = null

    if (playing) {
      label = t("listening.playing")
      hint = t("listening.rule.noPauseRewind")
    } else if (audioFailed && exhausted) {
      label = t("listening.noPlaysLeft")
    } else if (spentAndClean) {
      label = t("listening.played")
      hint = t("listening.answerNow")
    } else if (!audioFailed && left !== null) {
      hint = t("listening.playsLeftHint", { count: left })
    }

    const handlePlay = (): void => {
      onClaimPlay().catch(() => {
        // Handled by the caller -- see the component doc comment.
      })
    }

    return (
      <section
        role="region"
        aria-label={t("listening.recordingLabel")}
        className={className}
      >
        <button
          type="button"
          className="play-button"
          onClick={handlePlay}
          disabled={playing || exhausted}
        >
          {playing ? (
            <span className="m-eq" aria-hidden="true">
              <b />
              <b />
              <b />
            </span>
          ) : exhausted ? null : (
            <Icon name="play" />
          )}
          {label}
        </button>
        <div className="m-bar" aria-hidden="true">
          <i
            data-testid="audio-progress"
            style={{ width: `${Math.round(Math.min(1, Math.max(0, spentAndClean ? 1 : progress)) * 100)}%` }}
          />
        </div>
        {hint ? <p className="m-reason" style={{ margin: 0 }}>{hint}</p> : null}
      </section>
    )
  }
  ```

  Use it in the `stimulus.type === "audio"` branch as `<AudioCard … className="audio-box" />` and in the `mixed` branch (when `mediaKind === "audio"`) as `<AudioCard … className="audio-box mt-3" />`. Add `import type { CappedStimulusWire, OpenStimulusWire, StimulusWire } from "../lib/api-types.js"`, and default `audioFailed = false`, `progress = 0` in the component signature. Leave the passage/image/mixed-passage branches untouched.

- [ ] **Step 7: Implement `ListeningRunner` and `ReadingRunner`**

  `ListeningRunner.tsx` — delete `QuestionPip`, `QuestionPipState`, `questionPipState` and `pips`/`questionCount` props; add the new props from **Interfaces**; compute:

  ```tsx
  const playsUsed =
    stimulus !== undefined && "playsUsed" in stimulus ? stimulus.playsUsed : 0
  const hasAudio =
    stimulus !== undefined &&
    "playsUsed" in stimulus &&
    (stimulus.type === "audio" ||
      (stimulus.type === "mixed" && stimulus.mediaKind === "audio"))
  const playing = audioSrc !== null
  const heard = !hasAudio || audioFailed || (playsUsed > 0 && !playing)
  ```

  Replace the question-count/pip header with:

  ```tsx
  <p className="m-qmeta">
    {t("runner.sectionQuestionCount", {
      section: t("runner.sectionChip.listening"),
      current: positionInSection,
      total: sectionQuestionCount,
    })}
  </p>
  ```

  Pass to `QuestionMedia`: `audioFailed={audioFailed}` and `progress={audioProgress}`; on the `<audio>` element add `onTimeUpdate={(event) => { const { currentTime, duration } = event.currentTarget; if (duration > 0) { onAudioProgress(currentTime / duration) } }}`. Replace the prompt with `<h1 className="question-prompt" tabIndex={-1} data-qtitle>{question.prompt}</h1>` and `ChoiceList` props `locked={locked || !heard}` and `lockedMessage={!locked && !heard ? t("listening.unlockHint") : undefined}`. Keep the `audioFailed` alert and the `saveFailed` alert unchanged.

  `ReadingRunner.tsx` — delete the pip code; add `sectionType`, `positionInSection`, `sectionQuestionCount`; header:

  ```tsx
  <p className="m-qmeta">
    {t("runner.sectionQuestionCount", {
      section: t(`runner.sectionChip.${sectionType}`),
      current: positionInSection,
      total: sectionQuestionCount,
    })}
  </p>
  ```

  Replace the `QuestionMedia` block with a details wrapper when there is a passage question range:

  ```tsx
  {stimulus && passageOrdinal !== null ? (
    <details
      key={question.id}
      className="m-passage"
      open={question.ordinal === passageFirstOrdinal}
    >
      <summary>
        <Icon name="book" />
        {t("reading.passageQuestions", {
          passageNumber: passageOrdinal,
          first: passageFirstOrdinal,
          last: passageLastOrdinal,
        })}
      </summary>
      <QuestionMedia stimulus={stimulus} onClaimPlay={() => Promise.resolve()} playing={false} />
    </details>
  ) : stimulus ? (
    <QuestionMedia stimulus={stimulus} onClaimPlay={() => Promise.resolve()} playing={false} />
  ) : null}
  ```

  and the prompt becomes `<h1 className="question-prompt" tabIndex={-1} data-qtitle>…</h1>` (keep the `MathContent` branch). Import `Icon`.

- [ ] **Step 8: Run component tests to confirm GREEN**

  Run: `pnpm --filter @pp/app test src/components/QuestionMedia.test.tsx src/components/ChoiceList.test.tsx src/components/ListeningRunner.test.tsx src/components/ReadingRunner.test.tsx`
  Expected: PASS. Existing assertions that pinned old markup — update by name: `ChoiceList` `radio.toHaveClass("choice-dot")` and `closest("label")).toHaveClass("choice")` still hold; the `QuestionMedia` test `renders a passage's bodyText in the passage region` still holds (`.passage` class kept); `.audio-box` assertions hold for the card; any test asserting the old `Select all that apply.` class set still holds (`text-ink-2` kept).

- [ ] **Step 9: Rewire `RunScreen`**

  In `attempts.$attemptId.run.tsx`:
  - Add state `const [audioProgress, setAudioProgress] = useState(0)`; reset it to `0` inside `handleClaimPlay` right after `setPlayState({ status: "granted", … })`, inside `handleAudioEnded`, `handleAudioError`, and in the `setPlayState({ status: "idle" })` calls inside `moveToQuestion`/`handleNavigatorNavigate` `.then(...)` blocks (`setAudioProgress(0)` next to each).
  - Delete the `pips` array. Compute `const positionInSection = currentIndex + 1` and `const sectionQuestionCount = entries.length`.
  - `ListeningRunner` props: remove `questionCount`/`pips`, add `positionInSection`, `sectionQuestionCount`, `audioProgress={audioProgress}`, `onAudioProgress={setAudioProgress}`.
  - `ReadingRunner` props: remove `questionCount`/`pips`, add `sectionType={section.type}` (inside the `section.type === "reading" || "math"` branch TypeScript narrows it to `"reading" | "math"`), `positionInSection`, `sectionQuestionCount`.

- [ ] **Step 10: Update the run-screen tests and un-skip**

  Run: `pnpm --filter @pp/app test "src/pages/attempts.\$attemptId.run.test.tsx"`
  Update by name:
  - Replace the pip-strip test `renders the pip/progress strip from questionCount and the section's own question ordinals, read-only` with:
    ```tsx
    it("shows the section-relative position and no pip strip", () => {
      renderRunScreen()

      expect(screen.getByText("Listening · Question 1 of 2")).toBeInTheDocument()
      expect(screen.queryByTestId("question-pip")).toBeNull()
    })
    ```
  - Every listening test that selects an answer *without* playing first now finds the radios disabled. Add `const playedAudio: CappedStimulusWire = { ...cappedAudio, playsUsed: 1 }` next to `cappedAudio` and use it as the `stimulus` of the envelopes in the describe blocks `"offline durability end to end"`, `"reload recovery (B3)…"` and `"section boundary"`, in the `multiChoiceEnvelope` and `sectionBoundaryEnvelope` fixtures, and in `listeningEnvelope`-based tests whose purpose is answering, saving or navigating (not playback) — for those, spread it in per test: `{ ...listeningEnvelope, sections: [{ ...listeningEnvelope.sections[0], groups: [{ ...listeningEnvelope.sections[0].groups[0], stimulus: playedAudio }] }] }`. Tests about playback (`"a failed audio load recovers, honestly"`, `"a claimPlay 410…"`, the `Play recording` tests) keep `cappedAudio` (`playsUsed: 0`).
  - `allVisibleRadiosAreEnabled` — callers that expect enabled radios after a play must first let the mocked audio end (`fireEvent.ended(screen.getByTestId("audio-player"))`) so `playsUsed > 0` and `audioSrc === null`.
  - Add:
    ```tsx
    it("keeps answers locked until the recording has played, then unlocks them", async () => {
      const user = userEvent.setup()

      mockClaimPlay.mockResolvedValue({ stimulusId: "stim-1", playsUsed: 1, playsRemaining: 1, mediaUrl: "/api/media/a.mp3", urlExpiresAt: "2026-08-27T09:05:00.000Z" })
      renderRunScreen()

      expect(screen.getByRole("radio", { name: "A dog" })).toBeDisabled()

      await user.click(screen.getByRole("button", { name: "Play recording" }))
      expect(await screen.findByRole("button", { name: "Playing…" })).toBeDisabled()
      expect(screen.getByRole("radio", { name: "A dog" })).toBeDisabled()

      fireEvent.ended(screen.getByTestId("audio-player"))

      expect(await screen.findByRole("radio", { name: "A dog" })).toBeEnabled()
    })

    it("moves focus to the question heading after Next", async () => {
      const user = userEvent.setup()

      mockSetPosition.mockResolvedValue(undefined)
      renderRunScreen(readingOnlyEnvelope)

      await user.click(screen.getByRole("button", { name: "Next" }))

      await waitFor(() => {
        expect(document.activeElement).toHaveAttribute("data-qtitle")
      })
    })
    ```
    (`readingOnlyEnvelope` is the reading-section fixture already used by `describe("reading section", …)`; reuse its name.)
  Run again. Expected: PASS.

- [ ] **Step 11: Verify gates and commit**

  ```bash
  pnpm exec prettier --write packages/app/src/components packages/app/src/pages/attempts.\$attemptId.run.tsx packages/app/src/pages/attempts.\$attemptId.run.test.tsx packages/app/src/pages/attempts.\$attemptId.review.tsx packages/app/src/index.css packages/app/src/locales
  pnpm --filter @pp/app typecheck && pnpm lint:i18n && pnpm exec oxlint packages/app/src && pnpm lint:frontend && pnpm --filter @pp/app test
  git add packages/app/src
  git commit -m "feat(app): mobile question surfaces with audio card, passage panel and lettered choices"
  ```

---

### Task 12: Hand-in and time-up restyle (tiles, offline gate, shared time-up view, section time-up)

Prototype source: `vHandin` (tiles, blank notice, minutes-left line, offline-disabled reason, busy "Handing in…", Keep working), `vTimeup` (section variant "Continue to <next>", attempt variant with Answered / Left blank tiles and See your result). Real source: `pages/attempts.$attemptId.hand-in.tsx` (`HandInScreen`, `Outcome`, the `attemptExpired` branch), `pages/attempts.$attemptId.time-up.tsx` (`TimeUpScreen`), `pages/attempts.$attemptId.run.tsx` (`expired` state, `ListeningExpiredState`/`ReadingExpiredState`).

**Behaviour preserved:** the live remainder read (`buildSubmitRemainder`), `reconcileFinalFlush`, 200/201 handling, `attempt_expired` → result summary fetch, `nothing_answered`, generic error, `pendingSync` notice, never disabling Hand in on queue state (Defect B4). **Added:** Hand in is disabled with a reason while `networkStore` says offline (spec D6, matrix row 31). **Section expiry** in the runner now renders the prototype's time-up screen with a "Continue to <next section>" action instead of a bare inline message.

**Files:**
- Create: `packages/app/src/components/TimeUpView.tsx`, `TimeUpView.test.tsx`
- Modify: `packages/app/src/pages/attempts.$attemptId.hand-in.tsx`, `attempts.$attemptId.hand-in.test.tsx`
- Modify: `packages/app/src/pages/attempts.$attemptId.time-up.tsx`, `attempts.$attemptId.time-up.test.tsx`
- Modify: `packages/app/src/pages/attempts.$attemptId.run.tsx`, `attempts.$attemptId.run.test.tsx`
- Modify: `packages/app/src/index.css` (`m-tiles`, `m-tile`)
- Modify: `packages/app/src/locales/*/runner.json`

**Interfaces:**
- Consumes: Part A `networkStore` (`getSnapshot(): { readonly online: boolean }`, `subscribe`, `setOnlineForTests(online: boolean)`), `Icon`, Task 7 CSS.
- Produces:
  - `TimeUpView(props: TimeUpViewProps)`; `TimeUpViewProps = { heading: string; message: string; messageRole?: "status" | "alert"; title?: string; summary: { answered: number; blank: number } | null; action: { kind: "link"; href: string; label: string } | { kind: "button"; label: string; onClick: () => void } | null }`. Renders `m-page` with a `m-appbar` (`title` or the app brand, plus a low timer chip `00:00` labelled `timeUp.clockLabel`), a centred clay clock tile, `h1[data-page-title]`, the message, the optional tiles, and a `m-actionbar`.
  - CSS `m-tiles` (2-column grid) and `m-tile` (label before value in the DOM, value shown on top via `column-reverse`, so a screen reader reads "Answered 38").
  - `SectionTimeUp` behaviour inside `RunScreen` (no new export): when `expired?.kind === "section"` and a next section exists, `RunScreen` returns `TimeUpView` whose button navigates to `/attempts/${attemptId}/sections/${nextSection.id}/rules`.

- [ ] **Step 1: Add the strings**

  ```bash
  PATCH="$(mktemp)" && cat > "$PATCH" <<'EOF'
  {
    "en": {
      "handIn.offlineBlocked": "Handing in needs a connection. Your answers are safe on this phone — reconnect and try again.",
      "handIn.handingIn": "Handing in…"
    },
    "de": {
      "handIn.offlineBlocked": "Zum Abgeben brauchst du eine Verbindung. Deine Antworten sind sicher auf diesem Gerät – verbinde dich wieder und versuche es erneut.",
      "handIn.handingIn": "Wird abgegeben…"
    },
    "es": {
      "handIn.offlineBlocked": "Para entregar necesitas conexión. Tus respuestas están a salvo en este teléfono: vuelve a conectarte e inténtalo de nuevo.",
      "handIn.handingIn": "Entregando…"
    },
    "fr": {
      "handIn.offlineBlocked": "Pour rendre ton test, il faut une connexion. Tes réponses sont en sécurité sur ce téléphone : reconnecte-toi et réessaie.",
      "handIn.handingIn": "Envoi en cours…"
    },
    "it": {
      "handIn.offlineBlocked": "Per consegnare serve una connessione. Le tue risposte sono al sicuro su questo telefono: riconnettiti e riprova.",
      "handIn.handingIn": "Consegna in corso…"
    },
    "ja": {
      "handIn.offlineBlocked": "提出にはインターネット接続が必要です。解答はこの端末に安全に保存されています。接続してからもう一度お試しください。",
      "handIn.handingIn": "提出中…"
    }
  }
  EOF
  node packages/app/scripts/add-locale-keys.mjs runner "$PATCH" && pnpm --filter @pp/app test src/locales
  ```

  Expected: PASS.

- [ ] **Step 2: Write the failing `TimeUpView` tests**

  `packages/app/src/components/TimeUpView.test.tsx`:

  ```tsx
  import { cleanup, render, screen } from "@testing-library/react"
  import userEvent from "@testing-library/user-event"
  import { afterEach, describe, expect, it, vi } from "vitest"
  import "../i18n.js"
  import { TimeUpView } from "./TimeUpView.js"

  describe("TimeUpView", () => {
    afterEach(cleanup)

    it("renders the heading, message, a low clock and the tiles with label before value", () => {
      render(
        <TimeUpView
          heading="Time is up"
          message="Your test was handed in automatically."
          summary={{ answered: 38, blank: 2 }}
          action={{ kind: "link", href: "/attempts/a/result", label: "See your result" }}
        />,
      )

      expect(screen.getByRole("heading", { level: 1, name: "Time is up" })).toHaveAttribute("tabindex", "-1")
      expect(screen.getByRole("timer", { name: "Time remaining" })).toHaveTextContent("00:00")
      expect(screen.getByText("Answered").nextSibling).toHaveTextContent("38")
      expect(screen.getByText("Left blank").nextSibling).toHaveTextContent("2")
      expect(screen.getByRole("link", { name: "See your result" })).toHaveAttribute("href", "/attempts/a/result")
    })

    it("omits the tiles when there is no summary and can announce the message as an alert", () => {
      render(<TimeUpView heading="Time's up" message="This section's time ran out." messageRole="alert" summary={null} action={null} />)

      expect(screen.getByRole("alert")).toHaveTextContent("This section's time ran out.")
      expect(screen.queryByText("Answered")).toBeNull()
    })

    it("runs a button action", async () => {
      const onClick = vi.fn()

      render(<TimeUpView heading="Time's up" message="m" summary={null} action={{ kind: "button", label: "Continue to Reading", onClick }} />)
      await userEvent.setup().click(screen.getByRole("button", { name: "Continue to Reading" }))

      expect(onClick).toHaveBeenCalledOnce()
    })
  })
  ```

- [ ] **Step 3: Run to confirm RED**

  Run: `pnpm --filter @pp/app test src/components/TimeUpView.test.tsx`
  Expected: FAIL — `TimeUpView` not found.

- [ ] **Step 4: Add CSS and implement `TimeUpView`**

  Append to `@layer components`:

  ```css
  .m-tiles {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-top: 16px;
  }
  .m-tile {
    display: flex;
    flex-direction: column-reverse;
    border: 1.5px solid var(--color-line);
    border-radius: 16px;
    background: var(--color-paper);
    padding: 14px;
    text-align: center;
  }
  .m-tile > b {
    font-size: 30px;
    font-variant-numeric: tabular-nums;
    font-weight: 800;
  }
  .m-tile > span {
    color: var(--color-ink-2);
    font-size: 13px;
    font-weight: 700;
  }
  .m-tile[data-tone="warn"] > b {
    color: var(--color-clay);
  }
  ```

  `packages/app/src/components/TimeUpView.tsx`:

  ```tsx
  import { useTranslation } from "react-i18next"
  import { Icon } from "./Icon.js"

  export type TimeUpAction =
    | { readonly kind: "link"; readonly href: string; readonly label: string }
    | { readonly kind: "button"; readonly label: string; readonly onClick: () => void }

  export interface TimeUpViewProps {
    readonly heading: string
    readonly message: string
    readonly messageRole?: "status" | "alert"
    readonly title?: string
    readonly summary: { readonly answered: number; readonly blank: number } | null
    readonly action: TimeUpAction | null
  }

  export function TimeUpView({
    heading,
    message,
    messageRole = "status",
    title,
    summary,
    action,
  }: TimeUpViewProps) {
    const { t } = useTranslation("runner")

    return (
      <div className="m-page">
        <header className="m-appbar">
          <span className="m-brand truncate">{title ?? t("library.brand")}</span>
          <span className="grow" />
          <span
            role="timer"
            aria-label={t("timeUp.clockLabel")}
            className="m-timer"
            data-low="true"
          >
            <Icon name="clock" className="size-4" />
            <span>00:00</span>
          </span>
        </header>
        <main className="m-body text-center">
          <div className="m-logo mx-auto my-5" data-tone="clay" aria-hidden="true">
            <Icon name="clock" className="size-9" />
          </div>
          <h1 className="m-title" tabIndex={-1} data-page-title>
            {heading}
          </h1>
          <p className="m-sub" role={messageRole}>
            {message}
          </p>
          {summary ? (
            <div className="m-tiles">
              <div className="m-tile">
                <span>{t("timeUp.answered")}</span>
                <b>{summary.answered}</b>
              </div>
              <div className="m-tile">
                <span>{t("timeUp.leftBlank")}</span>
                <b>{summary.blank}</b>
              </div>
            </div>
          ) : null}
        </main>
        {action ? (
          <div className="m-actionbar">
            {action.kind === "link" ? (
              <a href={action.href} className="m-btn">
                {action.label}
              </a>
            ) : (
              <button type="button" className="m-btn" onClick={action.onClick}>
                {action.label}
              </button>
            )}
          </div>
        ) : null}
      </div>
    )
  }
  ```

  The clay logo reuses `m-logo` from Task 8 (`data-tone="clay"`); the `.m-hero > *` width rules do not apply because the tile sits in `m-body`.

- [ ] **Step 5: Run to confirm GREEN**

  Run: `pnpm --filter @pp/app test src/components/TimeUpView.test.tsx`
  Expected: PASS.

- [ ] **Step 6: Write the failing page tests**

  In `attempts.$attemptId.time-up.test.tsx` replace the test `uses the time-up screen hierarchy for the finalized answer summary` with:

  ```tsx
  it("renders the shared time-up view with a low clock and tiles", () => {
    render(
      <TimeUpScreen
        data={{
          testTitle: "Practice Test 04",
          answeredCount: 38,
          unansweredCount: 2,
          resultUrl: "/attempts/attempt-1/result",
        }}
      />,
    )

    expect(screen.getByText("Practice Test 04").closest("header")).toHaveClass("m-appbar")
    expect(screen.getByLabelText("Time remaining")).toHaveAttribute("data-low", "true")
    expect(screen.getByText("Answered").nextSibling).toHaveTextContent("38")
    expect(screen.getByRole("link", { name: "See your result" })).toHaveClass("m-btn")
  })
  ```

  In `attempts.$attemptId.hand-in.test.tsx` replace `uses the confirmation-screen hierarchy for live answer counts` with:

  ```tsx
  it("shows answered and not-answered tiles, the blank list and the minutes left", async () => {
    const queue = await AnswerQueue.open(DB_NAME)

    try {
      render(<HandInScreen attemptId="attempt-1" envelope={baseEnvelope} queue={queue} navigate={vi.fn()} />)

      expect(screen.getByRole("heading", { level: 1, name: "Hand in your test?" })).toHaveAttribute("tabindex", "-1")
      expect(screen.getByText("Answered").nextSibling).toHaveTextContent("38")
      expect(screen.getByText("Not answered").nextSibling).toHaveTextContent("2")
      expect(screen.getByText(/Questions 12, 31 are still blank/)).toHaveClass("m-notice")
      expect(screen.getByText("You have 30 minutes left if you want to go back.")).toBeInTheDocument()
      expect(screen.getByTestId("hand-in-button").closest("footer")).toHaveClass("m-actionbar")
    } finally {
      await queue.close()
    }
  })

  it("disables Hand in with the offline reason, and re-enables it when back online", async () => {
    const queue = await AnswerQueue.open(DB_NAME)

    try {
      render(<HandInScreen attemptId="attempt-1" envelope={baseEnvelope} queue={queue} navigate={vi.fn()} />)

      act(() => {
        networkStore.setOnlineForTests(false)
      })

      expect(screen.getByTestId("hand-in-button")).toBeDisabled()
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Handing in needs a connection. Your answers are safe on this phone — reconnect and try again.",
      )

      act(() => {
        networkStore.setOnlineForTests(true)
      })

      expect(screen.getByTestId("hand-in-button")).toBeEnabled()
    } finally {
      networkStore.setOnlineForTests(true)
      await queue.close()
    }
  })

  it("shows 'Handing in…' with aria-busy while the submit is in flight", async () => {
    const queue = await AnswerQueue.open(DB_NAME)

    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockReturnValue(new Promise(() => undefined)))

    try {
      render(<HandInScreen attemptId="attempt-1" envelope={baseEnvelope} queue={queue} navigate={vi.fn()} />)
      await userEvent.setup().click(screen.getByTestId("hand-in-button"))

      expect(screen.getByTestId("hand-in-button")).toHaveTextContent("Handing in…")
      expect(screen.getByTestId("hand-in-button")).toHaveAttribute("aria-busy", "true")
    } finally {
      await queue.close()
    }
  })
  ```

  Add `act` to the testing-library import and `import { networkStore } from "../lib/network.js"`. (`/api/attempts/attempt-1/submit` goes through `apiFetch`, which uses `fetch`; the never-settling stub keeps the call in flight. If the file's other submit tests mock `../lib/attempts-api.js` instead, use `vi.mocked(submitAttempt).mockReturnValue(new Promise(() => undefined))` — follow whichever the file already does in `calls submit with the drained remainder…`.)

  In `attempts.$attemptId.run.test.tsx`, in `describe("a claimPlay 410 surfaces an actionable expired state, not silence")` add:

  ```tsx
  it("shows the time-up view with a Continue button when a section expires and another follows", async () => {
    const user = userEvent.setup()

    mockClaimPlay.mockRejectedValue(
      new ApiError({ type: "section_expired", title: "Section expired", status: 410 }),
    )
    const { navigate } = renderRunScreen(sectionBoundaryEnvelope)

    await user.click(screen.getByRole("button", { name: "Play recording" }))

    expect(await screen.findByRole("heading", { name: "Time's up" })).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("This section's time ran out.")

    await user.click(screen.getByRole("button", { name: "Continue to Reading" }))

    expect(navigate).toHaveBeenCalledWith("/attempts/attempt-1/sections/section-reading/rules")
  })
  ```

- [ ] **Step 7: Run to confirm RED**

  Run: `pnpm --filter @pp/app test "src/pages/attempts.\$attemptId.hand-in.test.tsx" "src/pages/attempts.\$attemptId.time-up.test.tsx" "src/pages/attempts.\$attemptId.run.test.tsx"`
  Expected: the new/replaced tests FAIL.

- [ ] **Step 8: Implement `TimeUpScreen`**

  In `time-up.tsx`, replace the component body:

  ```tsx
  export function TimeUpScreen({ data }: TimeUpScreenProps) {
    const { t } = useTranslation("runner")
    const parsedResultUrl = sameOriginPath.safeParse(data.resultUrl)

    return (
      <TimeUpView
        title={data.testTitle}
        heading={t("timeUp.title")}
        message={t("timeUp.message")}
        summary={{ answered: data.answeredCount, blank: data.unansweredCount }}
        action={
          parsedResultUrl.success
            ? { kind: "link", href: parsedResultUrl.data, label: t("timeUp.seeResult") }
            : null
        }
      />
    )
  }
  ```

  and `import { TimeUpView } from "../components/TimeUpView.js"`.

- [ ] **Step 9: Implement `HandInScreen`**

  In `hand-in.tsx`: add imports `useSyncExternalStore` (from `react`), `Icon`, `TimeUpView`, `networkStore`; inside the component (with the other hooks, before any return):

  ```tsx
  const { online } = useSyncExternalStore(
    networkStore.subscribe,
    networkStore.getSnapshot,
    networkStore.getSnapshot,
  )
  ```

  Replace the `attemptExpired` return with:

  ```tsx
  if (outcome.status === "attemptExpired") {
    return (
      <TimeUpView
        title={envelope.testTitle}
        heading={t("sectionRules.expired.title")}
        message={t("sectionRules.expired.attemptMessage")}
        summary={
          outcome.summary
            ? { answered: outcome.summary.answeredCount, blank: outcome.summary.unansweredCount }
            : null
        }
        action={
          outcome.resultUrl
            ? { kind: "link", href: outcome.resultUrl, label: t("sectionRules.expired.viewResult") }
            : null
        }
      />
    )
  }
  ```

  Replace the main return (keep `unansweredCount`, `minutesLeft`; `disabled` becomes `outcome.status === "submitting" || !online`):

  ```tsx
  const submitting = outcome.status === "submitting"
  const disabled = submitting || !online

  return (
    <div className="m-page">
      <header className="m-appbar">
        <span className="m-brand truncate">{envelope.testTitle}</span>
      </header>
      <main className="m-body">
        <h1 className="m-title" tabIndex={-1} data-page-title>
          {t("handIn.title")}
        </h1>
        <p className="m-sub">{t("handIn.subtitle")}</p>
        <div className="m-tiles">
          <div className="m-tile">
            <span>{t("handIn.answered")}</span>
            <b>{envelope.answeredCount}</b>
          </div>
          <div className="m-tile" data-tone={unansweredCount > 0 ? "warn" : undefined}>
            <span>{t("handIn.notAnswered")}</span>
            <b>{unansweredCount}</b>
          </div>
        </div>
        {unansweredCount > 0 ? (
          <p className="m-notice" role="status">
            {t("handIn.notice.blankQuestions", {
              count: unansweredCount,
              list: envelope.unansweredOrdinals.join(", "),
            })}
          </p>
        ) : null}
        {minutesLeft !== null ? (
          <p className="m-reason mt-3">
            {t("handIn.notice.timeLeft", { count: minutesLeft, minutes: minutesLeft })}
          </p>
        ) : null}
        {pendingCount !== null && pendingCount > 0 ? (
          <p role="status" className="m-notice">
            {t("handIn.pendingSync")}
          </p>
        ) : null}
        {!online ? (
          <p role="alert" className="m-notice">
            <Icon name="wifioff" className="mr-1.5 inline size-4 align-text-bottom" />
            {t("handIn.offlineBlocked")}
          </p>
        ) : null}
        {outcome.status === "nothingAnswered" ? (
          <div className="mt-3.5">
            <p role="alert" className="text-bad text-sm font-semibold">
              {t("handIn.error.nothingAnswered.title")}
            </p>
            <p className="m-sub">{t("handIn.error.nothingAnswered.message")}</p>
          </div>
        ) : null}
        {outcome.status === "error" ? (
          <p role="alert" className="m-alert mt-3.5">
            {t("sectionRules.error.generic")}
          </p>
        ) : null}
      </main>
      <footer className="m-actionbar" style={{ flexDirection: "column", alignItems: "stretch" }}>
        <button
          type="button"
          className="m-btn"
          data-variant="danger"
          data-testid="hand-in-button"
          onClick={handleSubmit}
          disabled={disabled}
          aria-busy={submitting}
        >
          {t(submitting ? "handIn.handingIn" : "runner.handIn")}
        </button>
        <button
          type="button"
          className="m-btn"
          data-variant="secondary"
          disabled={submitting}
          onClick={handleKeepWorking}
        >
          {t("handIn.keepWorking")}
        </button>
      </footer>
    </div>
  )
  ```

  Remove the now-unused `<header>…timer…</header>` markup and the Card/Button imports only if `HandInRouteError` no longer uses them (it still does — keep).

- [ ] **Step 10: Implement section time-up in `RunScreen`**

  In `run.tsx` add `import { TimeUpView } from "../components/TimeUpView.js"`. After `const nextSection = envelope.sections.at(sectionIndex + 1)` and before the final `return (`, insert:

  ```tsx
  if (expired?.kind === "section" && nextSection) {
    return (
      <TimeUpView
        title={envelope.testTitle}
        heading={t("sectionRules.expired.title")}
        message={t("sectionRules.expired.sectionMessage")}
        messageRole="alert"
        summary={null}
        action={{
          kind: "button",
          label: t("runner.continueToSection", {
            section: t(`runner.sectionChip.${nextSection.type}`),
          }),
          onClick: () => {
            navigate(`/attempts/${attemptId}/sections/${nextSection.id}/rules`)
          },
        }}
      />
    )
  }
  ```

  (The last section's expiry never reaches here: the server answers `attempt_expired`, which already routes to `/time-up`.)

- [ ] **Step 11: Run to confirm GREEN and fix pinned assertions**

  Run the three test files. Update, by name, anything else that fails:
  - hand-in: any test selecting `.summary-row`, `device-card`, `device-footer`, `notice` (class), or the old `timer timer-low` header on the expired branch — switch to roles/text (`getByText("Answered").nextSibling`), `m-actionbar`, `m-notice`, and `getByLabelText("Time remaining")`.
  - `renders the time-up screen, not an error toast, when submit responds 410` and `uses the finalized result counts when a queued answer is accepted as submit expires` — the counts are now tiles; assert `getByText("Answered").nextSibling` / `getByText("Left blank").nextSibling`.
  - run: tests of the inline expired message (`ListeningRunner`/`ReadingRunner` `expired` prop) remain valid for the **last-section / attempt** cases; for the **section + next section** case they now see the time-up view (assert the heading `Time's up`).
  Expected: PASS.

- [ ] **Step 12: Verify gates and commit**

  ```bash
  pnpm exec prettier --write packages/app/src/components/TimeUpView*.tsx "packages/app/src/pages/attempts.\$attemptId.hand-in.tsx" "packages/app/src/pages/attempts.\$attemptId.hand-in.test.tsx" "packages/app/src/pages/attempts.\$attemptId.time-up.tsx" "packages/app/src/pages/attempts.\$attemptId.time-up.test.tsx" "packages/app/src/pages/attempts.\$attemptId.run.tsx" "packages/app/src/pages/attempts.\$attemptId.run.test.tsx" packages/app/src/index.css packages/app/src/locales
  pnpm --filter @pp/app typecheck && pnpm lint:i18n && pnpm exec oxlint packages/app/src && pnpm lint:frontend && pnpm --filter @pp/app test
  git add packages/app/src
  git commit -m "feat(app): mobile hand-in and time-up screens with offline gate"
  ```

---

### Task 13: Result, Review, History restyle and save-state / offline parity

Prototype source: `vResult` (ring, headline band, personal-best chip, summary, per-section breakdown, practice notice, Back to library / Review answers), `vReview` (position + outcome chip, passage, prompt, tagged choices, explanation, Previous / Jump / Next), `vHistory` (cards: title, date, status chip, score, Review / Result), `saveChip`, `banners`. Real source: `pages/attempts.$attemptId.result.tsx` (`ResultScreen`), `…review.tsx` (`ReviewScreen`, `ReviewChoiceList`, `ReviewStimulusView`, `navigatorSource`), `pages/history.tsx` (`HistoryScreen`), `components/SaveState.tsx`, `pages/attempts.$attemptId.run.tsx` (`applyFlushResult`, banner), `components/AppMenu.tsx` + `DeviceSheet.tsx` (deleted here — last consumers go away).

**Behaviour preserved:** result/review/history loaders and redirects (409 → run), pagination and its errors, review stimulus rendering (audio replay controls, SVG/URL images, `MathContent`), `ReviewChoiceMarker` semantics, the queue/flush machinery. **Changed (parity):** per-section result bars become breakdown rows; history table becomes cards (per-section score columns are dropped, as in the prototype); review addressable by `?q=<n>`; "Waiting to send: N" chip copy; toast "Back online — N answers sent."; offline banner shows whenever `networkStore` is offline during a run.

**Files:**
- Modify: `packages/app/src/pages/attempts.$attemptId.result.tsx`, `…result.test.tsx`
- Modify: `packages/app/src/pages/attempts.$attemptId.review.tsx`, `…review.test.tsx`
- Modify: `packages/app/src/pages/history.tsx`, `history.test.tsx`
- Modify: `packages/app/src/components/SaveState.tsx`, `SaveState.test.tsx`
- Modify: `packages/app/src/pages/attempts.$attemptId.run.tsx`, `…run.test.tsx`
- Delete: `packages/app/src/components/AppMenu.tsx`, `AppMenu.test.tsx`, `DeviceSheet.tsx`
- Modify: `packages/app/src/index.css` (score ring size, `m-save`, `m-hint`; delete the drawer/sheet rules)
- Modify: `packages/app/src/locales/*/runner.json`

**Interfaces:**
- Consumes: Task 10 `QuestionNavigator` (BottomSheet, review mode), Task 7 CSS, Part A `toastStore.show(message: string, icon?: ToastIcon)`, `networkStore`, `OfflineBanner` (`{ variant; pendingCount }`), `Icon`.
- Produces: `ReviewScreenProps` gains `initialOrdinal?: number` (1-based, clamped); `reviewSearchSchema = z.object({ q: z.coerce.number().int().min(1).catch(1) })` exported from the review route file; `HistoryScreenProps` keeps `student?` but no longer reads it; `SaveState` markup `span.save-state.m-save[data-state]` with an `Icon`.

- [ ] **Step 1: Add the strings**

  ```bash
  PATCH="$(mktemp)" && cat > "$PATCH" <<'EOF'
  {
    "en": {
      "result.headlineGood": "Good effort!",
      "result.headlineKeepGoing": "Keep practising!",
      "history.resultLink": "Result",
      "runner.saveState.pendingShort": "Waiting to send: {{count}}",
      "runner.saveState.backOnline_one": "Back online — {{count}} answer sent.",
      "runner.saveState.backOnline_other": "Back online — {{count}} answers sent."
    },
    "de": {
      "result.headlineGood": "Gute Leistung!",
      "result.headlineKeepGoing": "Übe weiter!",
      "history.resultLink": "Ergebnis",
      "runner.saveState.pendingShort": "Noch zu senden: {{count}}",
      "runner.saveState.backOnline_one": "Wieder online — {{count}} Antwort gesendet.",
      "runner.saveState.backOnline_other": "Wieder online — {{count}} Antworten gesendet."
    },
    "es": {
      "result.headlineGood": "¡Buen esfuerzo!",
      "result.headlineKeepGoing": "¡Sigue practicando!",
      "history.resultLink": "Resultado",
      "runner.saveState.pendingShort": "Pendiente de enviar: {{count}}",
      "runner.saveState.backOnline_one": "Conexión recuperada — {{count}} respuesta enviada.",
      "runner.saveState.backOnline_other": "Conexión recuperada — {{count}} respuestas enviadas."
    },
    "fr": {
      "result.headlineGood": "Bel effort !",
      "result.headlineKeepGoing": "Continue de t’entraîner !",
      "history.resultLink": "Résultat",
      "runner.saveState.pendingShort": "En attente d’envoi : {{count}}",
      "runner.saveState.backOnline_one": "De retour en ligne — {{count}} réponse envoyée.",
      "runner.saveState.backOnline_other": "De retour en ligne — {{count}} réponses envoyées."
    },
    "it": {
      "result.headlineGood": "Bell’impegno!",
      "result.headlineKeepGoing": "Continua a esercitarti!",
      "history.resultLink": "Risultato",
      "runner.saveState.pendingShort": "In attesa di invio: {{count}}",
      "runner.saveState.backOnline_one": "Di nuovo online — {{count}} risposta inviata.",
      "runner.saveState.backOnline_other": "Di nuovo online — {{count}} risposte inviate."
    },
    "ja": {
      "result.headlineGood": "よくがんばりました！",
      "result.headlineKeepGoing": "もっと練習しましょう！",
      "history.resultLink": "結果",
      "runner.saveState.pendingShort": "送信待ち：{{count}}件",
      "runner.saveState.backOnline": "オンラインに戻りました — {{count}}件の解答を送信しました。"
    }
  }
  EOF
  node packages/app/scripts/add-locale-keys.mjs runner "$PATCH" && pnpm --filter @pp/app test src/locales
  ```

  Expected: PASS.

#### Part 1 — SaveState chip and run-screen offline parity

- [ ] **Step 2: Write the failing tests**

  Replace the first test in `SaveState.test.tsx` (`renders saving, saved, and pending as three visibly distinct states`) with:

  ```tsx
  it("renders saving, saved, pending and failed as four distinct states with an icon each", () => {
    const { rerender, container } = render(<SaveState state="saving" />)

    expect(screen.getByRole("status")).toHaveTextContent("Saving…")
    expect(container.querySelector("svg")).not.toBeNull()

    rerender(<SaveState state="saved" />)
    expect(screen.getByRole("status")).toHaveTextContent("Saved")

    rerender(<SaveState state="pending" pendingCount={3} />)
    expect(screen.getByRole("status")).toHaveTextContent("Waiting to send: 3")
    expect(screen.getByRole("status")).not.toHaveTextContent("Saved")

    rerender(<SaveState state="failed" />)
    expect(screen.getByRole("status")).toHaveTextContent("Did not save")
  })
  ```

  and keep `exposes the prototype save-state treatment…` (it still asserts the `save-state` class and `data-state`). In `attempts.$attemptId.run.test.tsx` add (imports: `import { toastStore } from "../lib/toast.js"`, `import { networkStore } from "../lib/network.js"`):

  ```tsx
  it("shows the in-test offline banner whenever the network store says offline, even with nothing queued", () => {
    renderRunScreen()

    act(() => {
      networkStore.setOnlineForTests(false)
    })

    expect(screen.getByTestId("offline-banner")).toHaveAttribute("data-variant", "in-test")

    act(() => {
      networkStore.setOnlineForTests(true)
    })

    expect(screen.queryByTestId("offline-banner")).not.toBeInTheDocument()
  })
  ```

  and, in `describe("offline durability end to end")`, at the point where the existing test calls `offlineBannerIsGone()` after the queue drains, append:

  ```tsx
  expect(toastStore.getSnapshot()?.message).toBe("Back online — 3 answers sent.")
  ```

  (the existing test queues three answers — `offlineBannerHasThreePending` — so the count is 3).

- [ ] **Step 3: Run to confirm RED**

  Run: `pnpm --filter @pp/app test src/components/SaveState.test.tsx "src/pages/attempts.\$attemptId.run.test.tsx"`
  Expected: the new assertions FAIL.

- [ ] **Step 4: Implement**

  CSS (append; `m-hint` was added in Task 11 — do not duplicate):

  ```css
  .m-save {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--color-ink-2);
    font-size: 12.5px;
    font-weight: 800;
  }
  .m-save[data-state="pending"] {
    color: #7a4d00;
  }
  .m-save[data-state="failed"] {
    color: #b53a34;
  }
  ```

  `packages/app/src/components/SaveState.tsx` — replace everything after the `SaveStateProps` type:

  ```tsx
  import { useTranslation } from "react-i18next"
  import { Icon, type IconName } from "./Icon.js"

  const ICON: Record<SaveStateProps["state"], IconName> = {
    saved: "check",
    saving: "refresh",
    pending: "wifioff",
    failed: "alert",
  }

  export function SaveState(props: SaveStateProps) {
    const { t } = useTranslation("runner")
    const label =
      props.state === "pending"
        ? t("runner.saveState.pendingShort", { count: props.pendingCount })
        : t(`runner.saveState.${props.state}`)

    return (
      <span
        role="status"
        aria-live="polite"
        data-state={props.state}
        className="save-state m-save"
      >
        <Icon name={ICON[props.state]} className="size-4" />
        {label}
      </span>
    )
  }
  ```

  (Keep the `SaveStateProps` type export; remove `colorsFor`/`StateColors`. If Part A's `Icon` does not export `IconName`, import the type it does export — it is the union of the names listed in Task 7's Interfaces.)

  `run.tsx`:
  1. Imports: `useSyncExternalStore` (add to the `react` import), `import { networkStore } from "../lib/network.js"`, `import { toastStore } from "../lib/toast.js"`.
  2. With the other hooks at the top of `RunScreen` (before the early `return null`s):
     ```tsx
     const { online } = useSyncExternalStore(
       networkStore.subscribe,
       networkStore.getSnapshot,
       networkStore.getSnapshot,
     )
     const lastPendingRef = useRef(0)
     ```
  3. In `applyFlushResult`, replace the settle section:
     ```tsx
     if (result.saveState.status === "pending") {
       lastPendingRef.current = result.saveState.pendingCount
       setSaveState({
         state: "pending",
         pendingCount: result.saveState.pendingCount,
       })

       return
     }

     if (result.saveState.status === "saved" && lastPendingRef.current > 0) {
       toastStore.show(
         t("runner.saveState.backOnline", { count: lastPendingRef.current }),
         "cloud",
       )
       lastPendingRef.current = 0
     }

     setSaveState({ state: result.saveState.status })
     ```
  4. Replace the banner condition in the JSX:
     ```tsx
     {!online || (retryableFlushFailure && saveState.state === "pending") ? (
       <OfflineBanner
         variant="in-test"
         pendingCount={saveState.state === "pending" ? saveState.pendingCount : 0}
       />
     ) : null}
     ```

- [ ] **Step 5: Run to confirm GREEN**

  Run: `pnpm --filter @pp/app test src/components/SaveState.test.tsx "src/pages/attempts.\$attemptId.run.test.tsx"`
  Expected: PASS (all prior run tests stay green; `offlineBannerHasThreePending` still reads `Waiting to be sent: 3` from the banner, not the chip).

#### Part 2 — Result

- [ ] **Step 6: Write the failing tests**

  In `result.test.tsx` replace the tests that pin `device-main`, `device-footer`, `score-bar` and per-section `progressbar` with the following (use the file's existing `AttemptResult` fixture — name it `result` here; the fixture must have at least two sections, a listening and a reading one):

  ```tsx
  it("uses the mobile result layout: ring, headline band, summary and a breakdown row per section", () => {
    render(<ResultScreen result={{ ...result, score: { ...result.score, percentage: 88, isPersonalBest: false } }} />)

    expect(screen.getByRole("heading", { level: 1, name: "Well done!" })).toHaveAttribute("tabindex", "-1")
    expect(screen.getByTestId("score-ring")).toBeInTheDocument()

    const rows = screen.getAllByTestId("breakdown-row")

    expect(rows).toHaveLength(result.score.sections.length)
    expect(rows[0]).toHaveTextContent(result.score.sections[0].title)
  })

  it.each([
    [88, "Well done!"],
    [80, "Well done!"],
    [79, "Good effort!"],
    [50, "Good effort!"],
    [49, "Keep practising!"],
  ])("headlines %i%% as %s", (percentage, headline) => {
    render(<ResultScreen result={{ ...result, score: { ...result.score, percentage } }} />)

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(headline)
  })

  it("shows the personal-best chip only when the score is a personal best", () => {
    const { rerender } = render(<ResultScreen result={{ ...result, score: { ...result.score, isPersonalBest: true } }} />)

    expect(screen.getByText("Your best score so far.")).toBeInTheDocument()

    rerender(<ResultScreen result={{ ...result, score: { ...result.score, isPersonalBest: false } }} />)
    expect(screen.queryByText("Your best score so far.")).toBeNull()
  })

  it("marks a result that ended on the clock", () => {
    render(<ResultScreen result={{ ...result, status: "expired" }} />)

    expect(screen.getByText(/Time ran out/)).toBeInTheDocument()
  })

  it("offers Back to library and Review answers in the action bar", () => {
    render(<ResultScreen result={result} />)

    expect(screen.getByRole("link", { name: "Review answers →" }).closest("footer")).toHaveClass("m-actionbar")
    expect(screen.getByRole("link", { name: "Back to library" })).toHaveAttribute("href", "/")
  })
  ```

  (`ResultScreen` renders a router `Link`; wrap renders in the file's existing router helper if its current tests do — copy their wrapper.)

- [ ] **Step 7: Run to confirm RED**

  Run: `pnpm --filter @pp/app test "src/pages/attempts.\$attemptId.result.test.tsx"`
  Expected: FAIL.

- [ ] **Step 8: Implement `ResultScreen`**

  In `result.tsx` delete `scorePercentage` and `sectionBarColour`; add `import { Icon, type IconName } from "../components/Icon.js"` and:

  ```tsx
  const SECTION_ICON: Record<AttemptSectionScore["type"], IconName> = {
    listening: "headphones",
    reading: "book",
    math: "calc",
    vocabulary: "book",
    grammar: "book",
  }

  function headlineKey(percentage: number): string {
    if (percentage >= 80) {
      return "result.headline"
    }

    return percentage >= 50 ? "result.headlineGood" : "result.headlineKeepGoing"
  }
  ```

  Replace the returned JSX of `ResultScreen` (keep the `percentage`, `ringPercentage`, `ringStyle` consts):

  ```tsx
  return (
    <div className="m-page">
      <header className="m-appbar">
        <Link to="/" className="m-iconbtn" aria-label={t("result.backToLibrary")}>
          <Icon name="back" />
        </Link>
        <span className="m-brand">{t("result.scoreLabel")}</span>
      </header>

      <main className="m-body text-center">
        <p className="m-eyebrow">
          {result.test.title}
          {result.status === "expired" ? ` · ${t("history.status.expired")}` : ""}
        </p>
        <h1 className="m-title mt-1" tabIndex={-1} data-page-title>
          {t(headlineKey(score.percentage))}
        </h1>
        <div
          data-testid="score-ring"
          className="score-ring mx-auto my-3"
          style={ringStyle}
          aria-label={t("result.scoreLabel")}
        >
          <div>
            <div className="leading-tight">
              <p className="text-ink text-[38px] font-extrabold tabular-nums">
                {t("result.percentage", { percentage })}
              </p>
              <p className="text-ink-2 text-[13px] font-bold tabular-nums">
                {t("result.fraction", {
                  earned: score.pointsEarned,
                  possible: score.pointsPossible,
                })}
              </p>
            </div>
          </div>
        </div>
        {score.isPersonalBest ? (
          <p>
            <span className="m-chip" data-tone="good">
              <Icon name="check" className="size-4" /> {t("result.personalBest")}
            </span>
          </p>
        ) : null}
        <p className="m-sub mt-2">
          {t("result.summary", {
            answered: score.answered,
            correct: score.correct,
            incorrect: score.incorrect,
            unanswered: score.unanswered,
          })}
        </p>
        <div className="mt-3.5 grid gap-2 text-left">
          {score.sections.map((section) => (
            <div
              key={`${section.type}-${section.title}`}
              data-testid="breakdown-row"
              data-section-type={section.type}
              className="m-card flex items-center gap-2.5 py-2.5 font-bold"
            >
              <Icon name={SECTION_ICON[section.type]} />
              <span>{section.title}</span>
              <span className="ml-auto tabular-nums">
                {t("result.fraction", {
                  earned: section.pointsEarned,
                  possible: section.pointsPossible,
                })}
              </span>
            </div>
          ))}
        </div>
        <p className="m-reason mt-3.5">
          {t("result.practiceNotice", {
            title: result.test.title,
            version: result.test.version,
          })}
        </p>
      </main>

      <footer className="m-actionbar">
        <Link className="m-btn" data-variant="secondary" to="/">
          {t("result.backToLibrary")}
        </Link>
        <a className="m-btn" href={`/attempts/${result.attemptId}/review`}>
          {t("result.reviewAnswers")}
        </a>
      </footer>
    </div>
  )
  ```

  CSS: in the existing `.score-ring` rule change `width: 118px` to `width: 170px`. Remove the unused `.score-bar` rules only if `grep -rn "score-bar" packages/app/src` shows no other user.

- [ ] **Step 9: Run to confirm GREEN; fix pinned assertions**

  Run: `pnpm --filter @pp/app test "src/pages/attempts.\$attemptId.result.test.tsx"`. Update, by name, tests still pinning `device-main`, `device-footer`, `progressbar` roles per section or `score-bar`: replace with the `breakdown-row` / `m-actionbar` queries above. The `loadResult` redirect tests, error component tests, and `score-ring` `aria-label` tests stay untouched.
  Expected: PASS.

#### Part 3 — Review

- [ ] **Step 10: Write the failing tests**

  In `review.test.tsx` add (use the file's existing `ReviewPayload` fixture — called `review` below — which must hold at least three items; adjust ordinals if different):

  ```tsx
  it("starts on the question named by initialOrdinal and clamps out-of-range values", () => {
    const { rerender } = render(<ReviewScreen review={review} initialOrdinal={2} />)

    expect(screen.getByText(`Question 2 of ${review.items.length}`)).toBeInTheDocument()

    rerender(<ReviewScreen review={review} initialOrdinal={999} />)
    expect(screen.getByText(`Question ${review.items.length} of ${review.items.length}`)).toBeInTheDocument()
  })

  it("keeps ?q= in the address bar in step with the question shown", async () => {
    const user = userEvent.setup()

    render(<ReviewScreen review={review} />)
    await user.click(screen.getByRole("button", { name: "Next" }))

    expect(new URL(window.location.href).searchParams.get("q")).toBe("2")
  })

  it("disables Previous on the first question and Next on the last", async () => {
    const user = userEvent.setup()

    render(<ReviewScreen review={review} />)
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled()

    await user.click(screen.getByRole("button", { name: "Jump to a question" }))
    const dialog = screen.getByRole("dialog", { name: "Jump to a question" })

    await user.click(within(dialog).getAllByRole("button", { name: /^Question \d+,/ }).at(-1) as HTMLElement)
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled()
  })

  it("renders lettered choices with their verdict tags and an outcome chip with an icon", () => {
    render(<ReviewScreen review={review} />)

    const chip = screen.getByText(/Correct|Wrong|Left blank/)

    expect(chip.closest(".m-chip")).not.toBeNull()
    expect(within(screen.getByRole("list", { name: "Answer choices" })).getAllByRole("listitem")[0]).toHaveTextContent(/^A/)
  })

  it("moves focus to the question heading after navigating", async () => {
    const user = userEvent.setup()

    render(<ReviewScreen review={review} />)
    await user.click(screen.getByRole("button", { name: "Next" }))

    expect(document.activeElement).toHaveAttribute("data-qtitle")
  })

  it("validates the q search param: junk falls back to 1", () => {
    expect(reviewSearchSchema.parse({ q: "abc" }).q).toBe(1)
    expect(reviewSearchSchema.parse({ q: "0" }).q).toBe(1)
    expect(reviewSearchSchema.parse({ q: "3" }).q).toBe(3)
    expect(reviewSearchSchema.parse({}).q).toBe(1)
  })
  ```

  Import `reviewSearchSchema` from the route file, and `within`/`userEvent` if absent.

- [ ] **Step 11: Run to confirm RED**

  Run: `pnpm --filter @pp/app test "src/pages/attempts.\$attemptId.review.test.tsx"`
  Expected: FAIL.

- [ ] **Step 12: Implement `ReviewScreen`**

  In `review.tsx`: delete `outcomeClasses`; add imports `useEffect`, `z` from `zod`, `Icon`; add

  ```tsx
  export const reviewSearchSchema = z.object({
    q: z.coerce.number().int().min(1).catch(1),
  })

  const OUTCOME_CHIP: Record<
    ReviewItem["outcome"],
    { readonly tone: "good" | "bad" | "warn"; readonly icon: "check" | "x" | "minus" }
  > = {
    correct: { tone: "good", icon: "check" },
    incorrect: { tone: "bad", icon: "x" },
    unanswered: { tone: "warn", icon: "minus" },
  }

  function clampIndex(index: number, length: number): number {
    return Math.min(Math.max(index, 0), Math.max(length - 1, 0))
  }
  ```

  Change the props and the top of the component:

  ```tsx
  export interface ReviewScreenProps {
    readonly review: ReviewPayload
    readonly initialOrdinal?: number
  }

  export function ReviewScreen({ review, initialOrdinal = 1 }: ReviewScreenProps) {
    const { t } = useTranslation("runner")
    const [currentIndex, setCurrentIndex] = useState(() =>
      clampIndex(initialOrdinal - 1, review.items.length),
    )
    const [navigatorOpen, setNavigatorOpen] = useState(false)
    const navigatorTriggerRef = useRef<HTMLButtonElement>(null)
    const firstRender = useRef(true)

    useEffect(() => {
      const url = new URL(window.location.href)

      url.searchParams.set("q", String(currentIndex + 1))
      window.history.replaceState(window.history.state, "", url)

      if (firstRender.current) {
        firstRender.current = false

        return
      }

      document.querySelector<HTMLElement>("[data-qtitle]")?.focus({ preventScroll: true })
    }, [currentIndex])
    ```

  Empty state:

  ```tsx
  if (review.items.length === 0) {
    return (
      <div className="m-page">
        <main className="m-hero">
          <p role="status" className="m-card">
            {t("review.empty")}
          </p>
        </main>
      </div>
    )
  }
  ```

  Main return (keep `current`, `sectionKey` is no longer shown but `reviewSectionType` still feeds `navigatorSource`; keep `source`, `atFirst`, `atLast`):

  ```tsx
  const chip = OUTCOME_CHIP[current.outcome]

  return (
    <div className="m-page">
      <header className="m-appbar">
        <a href={`/attempts/${review.attemptId}/result`} className="m-iconbtn" aria-label={t("review.backToResult")}>
          <Icon name="back" />
        </a>
        <span className="m-brand">{t("review.title")}</span>
      </header>

      <main className="m-body">
        <div className="m-row mb-2 justify-between">
          <span className="m-qmeta" style={{ margin: 0 }}>
            {t("runner.questionCount", { current: currentIndex + 1, total: review.items.length })}
          </span>
          <span className="m-chip" data-tone={chip.tone} data-verdict={current.outcome}>
            <Icon name={chip.icon} className="size-4" />
            {t(`review.outcome.${current.outcome}`)}
          </span>
        </div>

        {current.stimulus ? <ReviewStimulusView stimulus={current.stimulus} /> : null}

        <h1 className="question-prompt" tabIndex={-1} data-qtitle data-page-title>
          {current.promptBlocks?.length ? <MathContent blocks={current.promptBlocks} /> : current.prompt}
        </h1>
        {current.outcome === "unanswered" ? (
          <p className="m-notice" role="status">
            {t("review.leftBlankNotice", { ordinal: current.ordinal })}
          </p>
        ) : null}
        <ReviewChoiceList choices={current.choices} />
        {current.solutionBlocks?.length ? (
          <section className="mt-3.5 rounded-[14px] bg-teal-bg px-3.5 py-3">
            <h2 className="text-teal text-xs font-extrabold tracking-[0.07em] uppercase">
              {t("review.workedSolution")}
            </h2>
            <MathContent blocks={current.solutionBlocks} />
          </section>
        ) : null}
      </main>

      <footer className="m-actionbar" data-sticky="true">
        <button
          type="button"
          className="m-btn"
          data-variant="secondary"
          aria-label={t("runner.previous")}
          style={{ flex: "0 0 56px" }}
          disabled={atFirst}
          onClick={() => {
            setCurrentIndex((index) => index - 1)
          }}
        >
          <Icon name="back" />
        </button>
        <button
          ref={navigatorTriggerRef}
          type="button"
          aria-expanded={navigatorOpen}
          aria-haspopup="dialog"
          aria-label={t("review.jumpToQuestion")}
          className="m-btn"
          data-variant="secondary"
          style={{ flex: "0 0 auto" }}
          onClick={() => {
            setNavigatorOpen((open) => !open)
          }}
        >
          <Icon name="grid" />
          <span>{t("review.jumpToQuestion")}</span>
        </button>
        <button
          type="button"
          className="m-btn"
          disabled={atLast}
          onClick={() => {
            setCurrentIndex((index) => index + 1)
          }}
        >
          {t("runner.next")}
        </button>
      </footer>

      <QuestionNavigator
        open={navigatorOpen}
        onOpenChange={setNavigatorOpen}
        source={source}
        answeredCount={source.answeredQuestionIds.size}
        totalCount={review.items.length}
        returnFocusRef={navigatorTriggerRef}
        onNavigate={(_sectionId, questionId) => {
          const nextIndex = review.items.findIndex((item) => item.questionId === questionId)

          if (nextIndex >= 0) {
            setCurrentIndex(nextIndex)
          }

          setNavigatorOpen(false)
        }}
      />
    </div>
  )
  ```

  Wire the search param into the route:

  ```tsx
  export const Route = createFileRoute("/attempts/$attemptId/review")({
    validateSearch: reviewSearchSchema,
    loader: ({ params }) => loadReview(params.attemptId),
    errorComponent: ReviewRouteError,
    component: RouteComponent,
  })

  function RouteComponent() {
    const review = Route.useLoaderData()
    const { q } = Route.useSearch()

    return <ReviewScreen review={review} initialOrdinal={q} />
  }
  ```

  `ReviewChoiceList`'s `li.choice` already carries `data-verdict`; `ReviewChoiceMarker` already prints "Your answer · correct/incorrect" / "Correct answer" as text beside the icon — add an icon there: wrap the marker text as `<span className="inline-flex items-center gap-1 text-xs font-bold …"><Icon name="check"|"x" className="size-3.5" />{label}</span>` (check for correct/selected-correct, x for selected-incorrect) so colour is never the only signal.

- [ ] **Step 13: Run to confirm GREEN; fix pinned assertions**

  Run: `pnpm --filter @pp/app test "src/pages/attempts.\$attemptId.review.test.tsx"`. Update, by name, assertions that pinned: `device-footer`, `sticky bottom-0 z-10`, `nav-toggle` classes, the old section chip in the header (`section-chip--…` in the app bar), `question-count`, and the `Back to result` link inside the footer (it is now the app bar's back icon, same accessible name — `getByRole("link", { name: "← Back to result" })` still matches). Tests of stimulus rendering, markers, `MathContent`, loader redirects and error component stay green.
  Expected: PASS.

#### Part 4 — History, and removal of the drawer

- [ ] **Step 14: Write the failing tests**

  In `history.test.tsx`, port the table-pinned tests. The fixture below is self-contained; reuse the file's existing `AttemptHistoryRow` factory if it has one:

  ```tsx
  // The API returns newest first, and the screen renders in that order.
  const rows = [
    { id: "a2", test: { title: "Practice Test 2" }, submittedAt: "2026-11-18T17:05:00.000Z", status: "submitted" as const, pointsEarned: 7, pointsPossible: 8, percentage: 87.5, sections: [] },
    { id: "a1", test: { title: "Practice Test 2" }, submittedAt: "2026-11-14T16:40:00.000Z", status: "expired" as const, pointsEarned: 4, pointsPossible: 8, percentage: 50, sections: [] },
  ]

  it("renders each attempt as a card: title, date, status chip with an icon, score and actions", async () => {
    await renderHistory({ attempts: rows, nextCursor: null })

    const cards = screen.getAllByRole("listitem")

    expect(cards).toHaveLength(2)
    expect(within(cards[0]).getByText("Practice Test 2")).toBeInTheDocument()
    expect(within(cards[0]).getByText("Handed in").closest(".m-chip")).toHaveAttribute("data-tone", "good")
    expect(within(cards[1]).getByText("Time ran out").closest(".m-chip")).toHaveAttribute("data-tone", "warn")
    expect(within(cards[0]).getByText("87.5%")).toBeInTheDocument()
    expect(within(cards[0]).getByRole("link", { name: "Review" })).toHaveAttribute("href", "/attempts/a2/review")
    expect(within(cards[0]).getByRole("link", { name: "Result" })).toHaveAttribute("href", "/attempts/a2/result")
  })

  it("has no table and no drawer trigger any more", async () => {
    await renderHistory({ attempts: rows, nextCursor: null })

    expect(screen.queryByRole("table")).toBeNull()
    expect(screen.queryByRole("button", { name: "Open menu" })).toBeNull()
  })
  ```

  (`renderHistory(page)` is the file's existing helper that renders `HistoryScreen` inside a router; if it also passes `student`, keep passing it — the prop is ignored. The prototype's client-side date sort is unnecessary because the server already orders attempts newest first.)

- [ ] **Step 15: Run to confirm RED**

  Run: `pnpm --filter @pp/app test src/pages/history.test.tsx`
  Expected: FAIL (still a table with a drawer trigger).

- [ ] **Step 16: Implement `HistoryScreen` and delete the drawer**

  In `history.tsx`: delete `AppMenu`, `signOut`, `useNavigate`, the menu state/refs/effect, `goToLibrary`, `closeHistoryMenu`, `handleSignOut`, `fraction`, `scoreBand`, `sectionTypesIn`, `sectionTitles` and the `SectionType` import; keep `loadHistory`, `HistoryData`, pagination state and `loadMore`. Props: `HistoryScreenProps { initialPage; student?: Student | null }` (destructure only `initialPage`). Add `Icon`. Returned JSX:

  ```tsx
  return (
    <div className="m-page">
      <header className="m-appbar">
        <span className="m-brand">{t("history.brand")}</span>
      </header>

      <main className="m-body">
        <h1 id="history-title" className="m-title" tabIndex={-1} data-page-title>
          {t("history.title")}
        </h1>
        <p className="m-sub">{t("history.subtitle")}</p>

        {attempts.length === 0 ? (
          <p role="status" className="m-card text-ink-2 mt-5 border-dashed py-8 text-center font-bold">
            {t("history.empty")}
          </p>
        ) : (
          <ul aria-labelledby="history-title" className="m-stack mt-4 list-none p-0">
            {attempts.map((attempt) => (
              <li key={attempt.id} className="m-card">
                <div className="m-row" data-align="start">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-[16.5px] font-extrabold">{attempt.test.title}</h2>
                    <p className="m-meta">
                      <time dateTime={attempt.submittedAt}>
                        {dateFormatter.format(new Date(attempt.submittedAt))}
                      </time>
                    </p>
                    <div className="m-chips">
                      <span
                        className="m-chip"
                        data-tone={attempt.status === "expired" ? "warn" : "good"}
                        data-ended={attempt.status}
                      >
                        <Icon name={attempt.status === "expired" ? "clock" : "check"} className="size-4" />
                        {t(`history.status.${attempt.status}`)}
                      </span>
                    </div>
                  </div>
                  <b className="text-2xl tabular-nums">
                    {t("history.percentage", {
                      percentage: numberFormatter.format(attempt.percentage),
                    })}
                  </b>
                </div>
                <div className="m-actions">
                  <a className="m-btn" data-size="sm" data-variant="secondary" href={`/attempts/${attempt.id}/review`}>
                    {t("history.review")}
                  </a>
                  <a className="m-btn" data-size="sm" data-variant="ghost" href={`/attempts/${attempt.id}/result`}>
                    {t("history.resultLink")}
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          className="m-btn mt-3"
          data-variant="secondary"
          data-block="true"
          disabled={nextCursor === null || loading}
          aria-busy={loading}
          onClick={loadMore}
        >
          {t(nextCursor === null ? "history.noOlderAttempts" : "history.loadMore")}
        </button>
        {loadMoreFailed ? (
          <p role="alert" className="text-bad mt-3 text-sm font-semibold">
            {t("history.loadMoreError")}
          </p>
        ) : null}
      </main>
    </div>
  )
  ```

  Delete the drawer: `git rm packages/app/src/components/AppMenu.tsx packages/app/src/components/AppMenu.test.tsx packages/app/src/components/DeviceSheet.tsx`, then confirm nothing imports them: `grep -rn "AppMenu\|DeviceSheet" packages/app/src` must print nothing (Part A's Profile does not use them). In `index.css` delete every rule whose selector starts with `.device-sheet`, `.device-drawer` or `.device-language-button`, plus the three selectors `.question-panel` (the shadow/colour rule that groups it with `.device-drawer-panel`), `.question-panel [data-slot="dialog-title"]` and `.question-panel [data-slot="dialog-description"]`. Keep `.question-panel-groups`, `.question-group`, `.question-grid`, `.question-legend`, `.question-panel-note` — the navigator still uses them. Keep the `menu.*` locale keys (the parity test requires `runner:menu.primaryNavigation`).

- [ ] **Step 17: Run the whole app suite to confirm GREEN**

  Run: `pnpm --filter @pp/app test`
  Expected: PASS. History tests that remain from the old file (`loadHistory`, pagination `Load more` / `No older attempts`, `Older attempts could not be loaded`, empty state, route error) must pass unchanged.

- [ ] **Step 18: Publish the queued-answer count to the shell (feeds Part A's browsing banner)**

  Part A's `AppLayout` shows "Waiting to be sent: N" on non-attempt routes from `pendingCountStore` (`lib/pending-count.ts`: `subscribe`, `getSnapshot(): number`, `set(count: number)`). Nothing feeds it yet. In `attempts.$attemptId.run.test.tsx`, inside the existing `describe("offline durability end to end")` test, add `import { pendingCountStore } from "../lib/pending-count.js"` and, right after the point where the three queued answers make the in-test banner show "3" pending (`offlineBannerHasThreePending`), append:

  ```tsx
  expect(pendingCountStore.getSnapshot()).toBe(3)
  ```

  and right after `offlineBannerIsGone()` (queue drained) append:

  ```tsx
  expect(pendingCountStore.getSnapshot()).toBe(0)
  ```

  Run `pnpm --filter @pp/app test "src/pages/attempts.\$attemptId.run.test.tsx"` — Expected: those two assertions FAIL (store stays 0).

  In `RunScreen` (`attempts.$attemptId.run.tsx`), import `pendingCountStore` from `"../lib/pending-count.js"` and add, next to the other `useEffect`s:

  ```tsx
  useEffect(() => {
    pendingCountStore.set(
      saveState.state === "pending" ? saveState.pendingCount : 0,
    )
  }, [saveState])
  ```

  The value deliberately survives leaving the run screen (the library's banner must keep saying N while answers are still queued); the next flush result overwrites it. Re-run the same file — Expected: PASS.

- [ ] **Step 19: Move focus to the page title on every route change**

  Every restyled page `h1` carries `tabIndex={-1}` and `data-page-title` (Tasks 7–13); nothing focuses it yet. Create `packages/app/test/usePageTitleFocus.test.tsx`:

  ```tsx
  import { render } from "@testing-library/react"
  import { describe, expect, it } from "vitest"
  import { usePageTitleFocus } from "../src/lib/usePageTitleFocus.js"

  function Harness({ pathname, withTitle }: { pathname: string; withTitle: boolean }) {
    usePageTitleFocus(pathname)

    return withTitle ? <h1 tabIndex={-1} data-page-title>Title</h1> : <p>No title yet</p>
  }

  describe("usePageTitleFocus", () => {
    it("focuses the page title when the resolved pathname changes", () => {
      const { rerender } = render(<Harness pathname="/" withTitle />)
      expect(document.activeElement).toHaveTextContent("Title")

      ;(document.activeElement as HTMLElement).blur()
      rerender(<Harness pathname="/history" withTitle />)
      expect(document.activeElement).toHaveTextContent("Title")
    })

    it("does not steal focus when the pathname is unchanged", () => {
      const { rerender } = render(<Harness pathname="/" withTitle />)
      const button = document.createElement("button")
      document.body.appendChild(button)
      button.focus()
      rerender(<Harness pathname="/" withTitle />)
      expect(document.activeElement).toBe(button)
      button.remove()
    })

    it("does nothing when the page has no title element", () => {
      expect(() => render(<Harness pathname="/x" withTitle={false} />)).not.toThrow()
    })
  })
  ```

  Run `pnpm --filter @pp/app exec vitest run test/usePageTitleFocus.test.tsx` — Expected: FAIL (module missing). Create `packages/app/src/lib/usePageTitleFocus.ts`:

  ```ts
  import { useEffect } from "react"

  /**
   * Route changes are announced to assistive tech by moving focus to the new
   * page's `h1` (`data-page-title`, `tabIndex={-1}`). Pass the RESOLVED pathname
   * (loaders finished) so the title exists when the effect runs.
   */
  export function usePageTitleFocus(pathname: string): void {
    useEffect(() => {
      document
        .querySelector<HTMLElement>("[data-page-title]")
        ?.focus({ preventScroll: true })
    }, [pathname])
  }
  ```

  Re-run — Expected: PASS. Then in `pages/layout.tsx`, inside `AppLayout` (re-read the file first; keep Task 4's existing JSX), add:

  ```tsx
  import { useRouterState } from "@tanstack/react-router"
  import { usePageTitleFocus } from "../lib/usePageTitleFocus.js"

  // inside AppLayout, before the return:
  const resolvedPathname = useRouterState({
    select: (state) => state.resolvedLocation?.pathname ?? "",
  })
  usePageTitleFocus(resolvedPathname)
  ```

  Run `pnpm --filter @pp/app exec vitest run src/pages/layout.test.tsx` — Expected: PASS (adjust only if a layout test asserted the initially focused element).

- [ ] **Step 20: Verify gates and commit**

  ```bash
  pnpm exec prettier --write packages/app/src/pages packages/app/src/components packages/app/src/index.css packages/app/src/locales
  pnpm --filter @pp/app typecheck && pnpm lint:i18n && pnpm exec oxlint packages/app/src && pnpm lint:frontend && pnpm --filter @pp/app test
  git add -A packages/app/src
  git commit -m "feat(app): mobile result, review and history screens with save-state parity"
  ```

  Then run the build once so the generated route tree picks up the review route's `validateSearch`: `pnpm --filter @pp/app build`; if `packages/app/src/route.gen.ts` changed, `git add packages/app/src/route.gen.ts && git commit -m "chore(app): regenerate route tree"`.

### Task 14: Server — `GET /api/tests/:slug/offline-bundle`

**What this builds.** One authenticated endpoint that returns everything the app needs to *run* a test with no network: the brief sections (title, rules, navigation, playback, instructions) merged with the runner content (groups, stimuli, questions, choices — **never** `isCorrect`), plus a media manifest with byte sizes and download URLs. Capped listening audio gets a short-lived signed URL (same HMAC scheme as `POST /play`, so `MediaController` needs no change); uncapped media gets its plain `/api/media/<file>` URL. It also adds `testVersionId` and `mediaBytes` to catalog cards so the library can show "Save offline · N MB" and tell when a saved copy is stale (spec D5, "Update saved copy").

**Files:**
- Create: `packages/db/src/repositories/offline-bundle.repository.ts`
- Modify: `packages/db/src/index.ts` (export `loadOfflineBundle`, `OfflineBundleRow`, `OfflineBundleSectionRow`, `OfflineMediaRow`)
- Modify: `packages/db/src/repositories/catalog.repository.ts` (`TestCardRow.testVersionId`)
- Create: `packages/db/test/offline-bundle-repository.test.ts`
- Create: `packages/db/test/catalog-card-version.test.ts`
- Modify: `packages/server/src/catalog/catalog.service.ts`, `packages/server/src/catalog/catalog.controller.ts`
- Create: `packages/server/test/helpers/offline-fixture.ts` (reused by Task 18)
- Create: `packages/server/test/offline-bundle.e2e.test.ts`
- Modify: `docs/api/openapi.yaml`

**Interfaces:**
- Consumes: `loadTestBrief(db, { slug, studentId })` (`catalog.repository.ts`), `loadForRunner(db, versionId, attemptId | null)` (`test-version.repository.ts` — already accepts `null`, no attempt needed), `signMediaUrl(filename, expiresAt, secret)` (`server/src/media/media-signing.ts`), `CLOCK` token, `loadServerConfig().mediaSigningSecret`.
- Produces (db):
  ```ts
  export interface OfflineMediaRow { key: string; stimulusId: string; kind: "audio" | "image"; mimeType: string; bytes: number; capped: boolean }
  export interface OfflineBundleSectionRow extends TestBriefRow["sections"][number] { groups: RunnerSection["groups"] }
  export interface OfflineBundleRow { slug: string; testVersionId: string; version: number; title: string; level: TestBriefRow["level"]; durationSeconds: number; sections: OfflineBundleSectionRow[]; media: OfflineMediaRow[]; totalBytes: number }
  export function loadOfflineBundle(db: PgQueryable, input: { slug: string; studentId: string }): Promise<OfflineBundleRow | null>
  ```
- Produces (wire, mirrored by Task 15's client type): `OfflineBundle = Omit<OfflineBundleRow, "media"> & { media: Array<OfflineMediaRow & { url: string }>; urlsExpireAt: string }`.
- Produces (test helper): `seedOfflineFixture(app: TestApp, slug: string): Promise<OfflineFixture>` (shape below).

- [ ] **Step 1: Write the failing repository test**

Create `packages/db/test/offline-bundle-repository.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { loadOfflineBundle } from "../src/repositories/offline-bundle.repository.js"
import { withDatabase } from "./helpers/database.js"
import { seedPublishedTest } from "./helpers/fixtures.js"

describe("loadOfflineBundle", () => {
  it("merges brief sections with runner groups and lists media", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const bundle = await loadOfflineBundle(pool, {
        slug: f.slug,
        studentId: f.studentId,
      })

      if (!bundle) {
        throw new Error("expected a bundle")
      }

      expect(bundle.version).toBe(1)
      expect(bundle.testVersionId).toBe(f.versionId)
      expect(bundle.sections.map((s) => s.id)).toEqual([
        f.listeningSectionId,
        f.readingSectionId,
      ])

      const [listening, reading] = bundle.sections

      expect(listening.playback).toEqual({
        maxPlays: 1,
        allowPause: false,
        allowSeek: false,
      })
      expect(listening.instructions).toEqual(["Put your headphones on now."])
      expect(listening.groups[0]?.questions).toHaveLength(1)
      expect(reading.groups[0]?.stimulus?.type).toBe("passage")
      expect(bundle.media).toEqual([
        {
          key: "l07.mp3",
          stimulusId: f.cappedStimulusId,
          kind: "audio",
          mimeType: "audio/mpeg",
          bytes: 123456,
          capped: true,
        },
      ])
      expect(bundle.totalBytes).toBe(123456)
    })
  })

  it("never carries an answer key", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const bundle = await loadOfflineBundle(pool, {
        slug: f.slug,
        studentId: f.studentId,
      })
      const json = JSON.stringify(bundle)

      expect(json).not.toContain("isCorrect")
      expect(json).not.toContain("is_correct")
    })
  })

  it("returns null for an unknown slug", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)

      await expect(
        loadOfflineBundle(pool, { slug: "nope", studentId: f.studentId }),
      ).resolves.toBeNull()
    })
  })
})
```

Create `packages/db/test/catalog-card-version.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { listPublishedTests } from "../src/repositories/catalog.repository.js"
import { withDatabase } from "./helpers/database.js"
import { seedPublishedTest } from "./helpers/fixtures.js"

describe("catalog cards", () => {
  it("carry the published testVersionId and the media size for the Save offline label", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const page = await listPublishedTests(pool, {
        studentId: f.studentId,
        limit: 10,
        cursor: null,
      })

      expect(page.tests[0]?.testVersionId).toBe(f.versionId)
      expect(page.tests[0]?.mediaBytes).toBe(123456)
    })
  })
})
```

- [ ] **Step 2: Run both to verify they fail**

Run: `pnpm --filter @pp/db exec vitest run test/offline-bundle-repository.test.ts test/catalog-card-version.test.ts`
Expected: FAIL — `Cannot find module '../src/repositories/offline-bundle.repository.js'` and `testVersionId` is `undefined`.

- [ ] **Step 3: Implement the repository**

Create `packages/db/src/repositories/offline-bundle.repository.ts`:

```ts
import type { PgQueryable } from "@liam-workspace/node-postgres"
import type { RunnerSection } from "@pp/common"
import { loadTestBrief, type TestBriefRow } from "./catalog.repository.js"
import { loadForRunner } from "./test-version.repository.js"

export interface OfflineMediaRow {
  key: string
  stimulusId: string
  kind: "audio" | "image"
  mimeType: string
  bytes: number
  capped: boolean
}

export interface OfflineBundleSectionRow extends TestBriefRow["sections"][number] {
  groups: RunnerSection["groups"]
}

export interface OfflineBundleRow {
  slug: string
  testVersionId: string
  version: number
  title: string
  level: TestBriefRow["level"]
  durationSeconds: number
  sections: OfflineBundleSectionRow[]
  media: OfflineMediaRow[]
  totalBytes: number
}

interface VersionDbRow {
  id: string
  version: number
}

interface MediaDbRow {
  filename: string
  kind: "audio" | "image"
  mime_type: string
  // node-postgres returns bigint as a string.
  byte_size: string
  stimulus_id: string
  effective_max_plays: number | null
}

const VERSION_QUERY = `
  SELECT tv.id, tv.version
    FROM test t
    JOIN test_version tv ON tv.id = t.current_version_id AND tv.published_at IS NOT NULL
   WHERE t.slug = $1
`

// DISTINCT ON (st.id): a stimulus can back more than one question group, and
// the manifest lists each stimulus's media exactly once. The effective cap is
// the same COALESCE `isFilenameCapped` and `claimPlay` use, so "capped" here
// can never disagree with what the media route will demand a signature for.
const MEDIA_QUERY = `
  SELECT DISTINCT ON (st.id)
         ma.filename, ma.kind::text AS kind, ma.mime_type, ma.byte_size,
         st.id AS stimulus_id,
         COALESCE(st.max_plays, ts.default_max_plays) AS effective_max_plays
    FROM stimulus st
    JOIN media_asset ma ON ma.id = st.media_asset_id
    JOIN question_group qg ON qg.stimulus_id = st.id
    JOIN test_section ts ON ts.id = qg.test_section_id
   WHERE st.test_version_id = $1
   ORDER BY st.id
`

/**
 * Everything needed to RUN a test with no network. Content comes from
 * `loadForRunner` (which omits `isCorrect` by construction and, for a capped
 * stimulus, any `mediaUrl`); section rules come from `loadTestBrief` so the
 * rules screen offline reads exactly what it reads online. Returns null for a
 * slug that does not exist or whose current version is unpublished -- the two
 * are deliberately indistinguishable (same rule as `loadTestBrief`).
 */
export async function loadOfflineBundle(
  db: PgQueryable,
  input: { slug: string; studentId: string },
): Promise<OfflineBundleRow | null> {
  const brief = await loadTestBrief(db, input)

  if (!brief) {
    return null
  }

  const { rows: versionRows } = await db.query<VersionDbRow>(VERSION_QUERY, [
    input.slug,
  ])

  if (versionRows.length === 0) {
    return null
  }

  const [version] = versionRows
  const [content, mediaResult] = await Promise.all([
    loadForRunner(db, version.id, null),
    db.query<MediaDbRow>(MEDIA_QUERY, [version.id]),
  ])
  const groupsBySection = new Map<string, RunnerSection["groups"]>(
    content.map((section) => [section.id, section.groups]),
  )
  const media: OfflineMediaRow[] = mediaResult.rows.map((row) => ({
    key: row.filename,
    stimulusId: row.stimulus_id,
    kind: row.kind,
    mimeType: row.mime_type,
    bytes: Number(row.byte_size),
    capped: row.effective_max_plays !== null,
  }))

  return {
    slug: brief.slug,
    testVersionId: version.id,
    version: version.version,
    title: brief.title,
    level: brief.level,
    durationSeconds: brief.durationSeconds,
    sections: brief.sections.map((section) => ({
      ...section,
      groups: groupsBySection.get(section.id) ?? [],
    })),
    media,
    totalBytes: media.reduce((sum, item) => sum + item.bytes, 0),
  }
}
```

In `packages/db/src/index.ts` add the import next to the other repository imports and the export beside `loadTestBrief`:

```ts
import {
  loadOfflineBundle,
  type OfflineBundleRow,
  type OfflineBundleSectionRow,
  type OfflineMediaRow,
} from "./repositories/offline-bundle.repository.js"
// ...
export type { OfflineBundleRow, OfflineBundleSectionRow, OfflineMediaRow }
// ... and add `loadOfflineBundle,` to the big `export { ... }` list
```

In `catalog.repository.ts`: add `testVersionId: string` and `mediaBytes: number` to `TestCardRow`; add `version_id: string` and `media_bytes: string` to `CatalogPageDbRow`; add this lateral join beside the other `LEFT JOIN LATERAL` blocks (before the final `ORDER BY`) and select `page.version_id, mb.media_bytes` in the final `SELECT`:

```sql
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(ma.byte_size), 0) AS media_bytes
        FROM (
          SELECT DISTINCT st.media_asset_id
            FROM stimulus st
           WHERE st.test_version_id = page.version_id
             AND st.media_asset_id IS NOT NULL
        ) s
        JOIN media_asset ma ON ma.id = s.media_asset_id
    ) mb ON true
```

and map both in `toTestCard`: `testVersionId: row.version_id, mediaBytes: Number(row.media_bytes)` (`sum(bigint)` returns a numeric string).

- [ ] **Step 4: Run the db tests to verify they pass**

Run: `pnpm --filter @pp/db exec vitest run test/offline-bundle-repository.test.ts test/catalog-card-version.test.ts test/catalog-repository.test.ts`
Expected: PASS. If `catalog-repository.test.ts` has a whole-card `toEqual`, add `testVersionId: expect.any(String), mediaBytes: expect.any(Number)` to that expectation (the only legitimate reason to edit an existing test here).

- [ ] **Step 5: Write the server fixture helper**

Create `packages/server/test/helpers/offline-fixture.ts` (Task 18 reuses it; ids are looked up after import so tests never hard-code uuids):

```ts
import type { PgPool } from "@liam-workspace/node-postgres"
import { testDocumentSchema } from "@pp/common"
import { randomUUID } from "node:crypto"
import request from "supertest"
import type { App } from "supertest/types.js"
import { REQUEST_POOL } from "../../src/database/tokens.js"
import type { TestApp } from "./app.js"

export interface FixtureQuestion {
  id: string
  /** Ordered by choice ordinal; index 0 is the correct one. */
  choiceIds: string[]
}

export interface OfflineFixture {
  slug: string
  versionId: string
  mediaFilename: string
  listening: {
    sectionId: string
    stimulusId: string
    questions: FixtureQuestion[]
  }
  reading: { sectionId: string; questions: FixtureQuestion[] }
}

function question(key: string, prompt: string, labels: [string, string]) {
  return {
    questionKey: key,
    prompt,
    type: "single_choice" as const,
    points: 1,
    choices: [
      { label: labels[0], isCorrect: true },
      { label: labels[1], isCorrect: false },
    ],
  }
}

/**
 * Imports and publishes a two-section test: a forward-only listening section
 * (one capped audio stimulus, maxPlays 1, two questions, 600 s) and a free
 * reading section (one passage, one question, 600 s). Total 1200 s.
 */
export async function seedOfflineFixture(
  app: TestApp,
  slug: string,
): Promise<OfflineFixture> {
  const pool = app.get<PgPool>(REQUEST_POOL)
  const mediaFilename = `${slug}.mp3`

  await pool.query(
    `INSERT INTO media_asset (id, kind, filename, mime_type, byte_size, checksum)
     VALUES ($1, 'audio', $2, 'audio/mpeg', 2048, $3)`,
    [randomUUID(), mediaFilename, `checksum-${slug}`],
  )

  const doc = testDocumentSchema.parse({
    title: `Offline ${slug}`,
    slug,
    level: "primary-step-1",
    durationSeconds: 1200,
    sections: [
      {
        title: "Listening",
        type: "listening",
        durationSeconds: 600,
        navigation: "forward_only",
        allowAnswerChange: false,
        playback: { maxPlays: 1, allowPause: false, allowSeek: false },
        instructions: ["Put your headphones on now."],
        groups: [
          {
            stimulus: { type: "audio", mediaFilename, maxPlays: 1 },
            questions: [
              question("l1", "Where is the bag?", ["Bench", "Desk"]),
              question("l2", "What time is it?", ["8:30", "9:00"]),
            ],
          },
        ],
      },
      {
        title: "Reading",
        type: "reading",
        durationSeconds: 600,
        navigation: "free",
        allowAnswerChange: true,
        playback: null,
        instructions: [],
        groups: [
          {
            stimulus: {
              type: "passage",
              title: "Tom's garden",
              bodyText: "Tom has a small garden.",
            },
            questions: [question("r1", "What does Tom have?", ["A garden", "A boat"])],
          },
        ],
      },
    ],
  })

  const adminToken = await app.mint({
    sub: `offline-fixture-admin-${slug}`,
    email: "admin@example.com",
    isAdmin: true,
  })
  const imported = await request(app.http.getHttpServer() as App)
    .post("/api/admin/tests/import")
    .set("Authorization", `Bearer ${adminToken}`)
    .send(doc)
    .expect(201)
  const { testId } = imported.body as { testId: string }

  await request(app.http.getHttpServer() as App)
    .post(`/api/admin/tests/${testId}/publish`)
    .set("Authorization", `Bearer ${adminToken}`)
    .expect(200)

  const { rows: sections } = await pool.query<{
    id: string
    type: string
    version_id: string
  }>(
    `SELECT ts.id, ts.type::text AS type, tv.id AS version_id
       FROM test_section ts
       JOIN test_version tv ON tv.id = ts.test_version_id
       JOIN test t ON t.id = tv.test_id
      WHERE t.slug = $1
      ORDER BY ts.ordinal`,
    [slug],
  )
  const { rows: stimuli } = await pool.query<{ id: string }>(
    `SELECT st.id FROM stimulus st
       JOIN test_version tv ON tv.id = st.test_version_id
       JOIN test t ON t.id = tv.test_id
      WHERE t.slug = $1 AND st.media_asset_id IS NOT NULL`,
    [slug],
  )

  async function questionsOf(sectionId: string): Promise<FixtureQuestion[]> {
    const { rows } = await pool.query<{ id: string; choice_ids: string[] }>(
      `SELECT q.id,
              array_agg(c.id ORDER BY c.ordinal) AS choice_ids
         FROM question q
         JOIN question_group qg ON qg.id = q.question_group_id
         JOIN choice c ON c.question_id = q.id
        WHERE qg.test_section_id = $1
        GROUP BY q.id, q.ordinal
        ORDER BY q.ordinal`,
      [sectionId],
    )

    return rows.map((row) => ({ id: row.id, choiceIds: row.choice_ids }))
  }

  const listeningRow = sections.find((s) => s.type === "listening")
  const readingRow = sections.find((s) => s.type === "reading")
  const stimulusRow = stimuli.at(0)

  if (!listeningRow || !readingRow || !stimulusRow) {
    throw new Error("offline fixture import did not produce the expected rows")
  }

  return {
    slug,
    versionId: listeningRow.version_id,
    mediaFilename,
    listening: {
      sectionId: listeningRow.id,
      stimulusId: stimulusRow.id,
      questions: await questionsOf(listeningRow.id),
    },
    reading: {
      sectionId: readingRow.id,
      questions: await questionsOf(readingRow.id),
    },
  }
}
```

- [ ] **Step 6: Write the failing e2e test**

Create `packages/server/test/offline-bundle.e2e.test.ts`:

```ts
import request from "supertest"
import type { App } from "supertest/types.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { verifyMediaSignature } from "../src/media/media-signing.js"
import { createTestApp, type TestApp } from "./helpers/app.js"
import { seedOfflineFixture } from "./helpers/offline-fixture.js"

const NOW = new Date("2026-11-22T12:00:00.000Z")
const SECRET = "test-media-signing-secret"

interface BundleBody {
  slug: string
  testVersionId: string
  version: number
  sections: Array<{
    id: string
    playback: { maxPlays: number | null } | null
    groups: Array<{ questions: Array<{ choices: Array<Record<string, unknown>> }> }>
  }>
  media: Array<{
    key: string
    stimulusId: string
    capped: boolean
    bytes: number
    url: string
  }>
  totalBytes: number
  urlsExpireAt: string
}

describe("GET /tests/:slug/offline-bundle", () => {
  let app: TestApp | undefined = undefined

  beforeAll(async () => {
    app = await createTestApp({ now: NOW })
  })

  afterAll(async () => {
    await app?.close()
  })

  function ready(): TestApp {
    if (!app) {
      throw new Error("Application failed to initialize")
    }

    return app
  }

  async function studentToken(a: TestApp, sub: string): Promise<string> {
    const token = await a.mint({ sub, email: "kid@example.com" })

    await request(a.http.getHttpServer() as App)
      .post("/api/session")
      .set("Authorization", `Bearer ${token}`)
      .expect(201)

    return token
  }

  it("returns content without answer keys, and signs capped audio for download", async () => {
    const a = ready()
    const fx = await seedOfflineFixture(a, "bundle-happy")
    const token = await studentToken(a, "bundle-student-1")
    const res = await request(a.http.getHttpServer() as App)
      .get("/api/tests/bundle-happy/offline-bundle")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
    const body = res.body as BundleBody

    expect(body.testVersionId).toBe(fx.versionId)
    expect(body.sections).toHaveLength(2)
    expect(body.sections[0]?.playback?.maxPlays).toBe(1)
    expect(JSON.stringify(body)).not.toContain("isCorrect")
    expect(body.totalBytes).toBe(2048)

    const [media] = body.media

    expect(media?.key).toBe(fx.mediaFilename)
    expect(media?.capped).toBe(true)

    const url = new URL(media?.url ?? "", "http://x")

    expect(url.pathname).toBe(`/api/media/${fx.mediaFilename}`)
    expect(
      verifyMediaSignature(
        fx.mediaFilename,
        url.searchParams.get("exp") ?? undefined,
        url.searchParams.get("sig") ?? undefined,
        SECRET,
        NOW,
      ),
    ).toBe(true)
    expect(Date.parse(body.urlsExpireAt)).toBeGreaterThan(NOW.getTime())
  })

  it("404s for an unknown slug and 401s without a token", async () => {
    const a = ready()
    const token = await studentToken(a, "bundle-student-2")

    await request(a.http.getHttpServer() as App)
      .get("/api/tests/does-not-exist/offline-bundle")
      .set("Authorization", `Bearer ${token}`)
      .expect(404)
    await request(a.http.getHttpServer() as App)
      .get("/api/tests/bundle-happy/offline-bundle")
      .expect(401)
  })
})
```

- [ ] **Step 7: Run it to verify it fails**

Run: `pnpm --filter @pp/server exec vitest run test/offline-bundle.e2e.test.ts`
Expected: FAIL — first test gets 404 (`Cannot GET`-style not-found from `/tests/:slug/offline-bundle` falling through to `:slug`'s sibling) rather than 200.

- [ ] **Step 8: Implement service and controller**

In `packages/server/src/catalog/catalog.service.ts`:

```ts
import type { Clock } from "@pp/common"
import { loadOfflineBundle, type OfflineBundleRow } from "@pp/db"
import { loadServerConfig } from "../config.js"
import { CLOCK } from "../database/tokens.js"
import { signMediaUrl } from "../media/media-signing.js"
// (keep the existing imports)

/** A saved test may be ~20 MB on a slow phone connection: give the download room. */
const BUNDLE_URL_TTL_MS = 30 * 60 * 1000

export interface OfflineBundleView extends Omit<OfflineBundleRow, "media"> {
  media: Array<OfflineBundleRow["media"][number] & { url: string }>
  urlsExpireAt: string
}
```

Change the constructor to `constructor(@Inject(REQUEST_POOL) private readonly pool: PgPool, @Inject(CLOCK) private readonly clock: Clock) {}` and add:

```ts
  async getOfflineBundle(
    subjectClaim: string,
    slug: string,
  ): Promise<OfflineBundleView> {
    const student = await findStudentBySubject(this.pool, subjectClaim)

    if (!student) {
      throw new ProblemException({
        type: "student_not_provisioned",
        title: "No student profile exists for this token.",
        status: HttpStatus.NOT_FOUND,
      })
    }

    const row = await loadOfflineBundle(this.pool, {
      slug,
      studentId: student.id,
    })

    if (!row) {
      throw new ProblemException({
        type: "test_not_found",
        title: "No such resource, or it is not published.",
        status: HttpStatus.NOT_FOUND,
      })
    }

    const expiresAt = new Date(this.clock.now().getTime() + BUNDLE_URL_TTL_MS)
    const { mediaSigningSecret } = loadServerConfig()

    return {
      ...row,
      media: row.media.map((item) => ({
        ...item,
        // Capped audio is only reachable with a signature; sign it for the
        // download window. Uncapped media is served unsigned by MediaController.
        url: item.capped
          ? signMediaUrl(item.key, expiresAt, mediaSigningSecret)
          : `/api/media/${item.key}`,
      })),
      urlsExpireAt: expiresAt.toISOString(),
    }
  }
```

In `catalog.controller.ts` add (import `OfflineBundleView` from the service):

```ts
  @Get(":slug/offline-bundle")
  getOfflineBundle(
    @CurrentStudent() claims: JwtClaims,
    @Param("slug") slug: string,
  ): Promise<OfflineBundleView> {
    return this.catalog.getOfflineBundle(subjectOf(claims), slug)
  }
```

`CLOCK` is provided by the global `DatabaseModule` (`AttemptsService` injects it the same way), so `CatalogModule` needs no import change.

- [ ] **Step 9: Run the e2e test to verify it passes**

Run: `pnpm --filter @pp/server exec vitest run test/offline-bundle.e2e.test.ts test/catalog.e2e.test.ts`
Expected: PASS. If `catalog.e2e.test.ts` has a whole-card `toEqual`, add `testVersionId: expect.any(String), mediaBytes: expect.any(Number)`.

- [ ] **Step 10: Document the contract**

In `docs/api/openapi.yaml`, directly after the `/tests/{slug}` path block (before `# ── Attempt ──`) add:

```yaml
  /tests/{slug}/offline-bundle:
    get:
      tags: [Catalog]
      operationId: getOfflineBundle
      summary: Everything needed to run a test with no network
      description: |
        Section rules plus the full runner content (groups, stimuli, questions, choices) and a
        media manifest. Never carries an answer key. Capped listening audio is listed with a
        short-lived signed URL valid only for downloading; uncapped media carries its plain URL.
        The client stores the bytes and enforces the play cap locally; the server audits play
        counts when the journal is synced (`POST /attempts/offline-sync`).
      parameters:
        - { $ref: "#/components/parameters/Slug" }
      responses:
        "200":
          description: The offline bundle.
          content:
            application/json:
              schema: { $ref: "#/components/schemas/OfflineBundle" }
        "401": { $ref: "#/components/responses/Unauthorized" }
        "404": { $ref: "#/components/responses/NotFound" }
```

In `components.schemas` add `testVersionId: { type: string }` and `mediaBytes: { type: integer, description: Total bytes of media a saved copy downloads. }` to `TestCard.properties` and both names to its `required` list, then add (next to `TestBrief`):

```yaml
    OfflineMedia:
      type: object
      required: [key, stimulusId, kind, mimeType, bytes, capped, url]
      properties:
        key: { type: string, description: Stable cache key (the media filename). }
        stimulusId: { type: string }
        kind: { $ref: "#/components/schemas/MediaKind" }
        mimeType: { type: string }
        bytes: { type: integer }
        capped: { type: boolean, description: True when the stimulus has a play cap. }
        url: { type: string }

    OfflineBundle:
      type: object
      required:
        [slug, testVersionId, version, title, level, durationSeconds, sections, media, totalBytes, urlsExpireAt]
      properties:
        slug: { type: string }
        testVersionId: { type: string }
        version: { type: integer }
        title: { type: string }
        level: { $ref: "#/components/schemas/StudentLevel" }
        durationSeconds: { type: integer }
        sections:
          type: array
          items:
            allOf:
              - $ref: "#/components/schemas/TestBriefSection"
              - type: object
                required: [groups]
                properties:
                  groups:
                    type: array
                    items: { $ref: "#/components/schemas/QuestionGroup" }
        media:
          type: array
          items: { $ref: "#/components/schemas/OfflineMedia" }
        totalBytes: { type: integer }
        urlsExpireAt: { type: string, format: date-time }
```

`TestBrief.sections.items` is currently an inline object. Extract it to a named schema `TestBriefSection` (move the inline object under `components.schemas.TestBriefSection` and replace the inline body with `items: { $ref: "#/components/schemas/TestBriefSection" }`) so the `allOf` above resolves.

- [ ] **Step 11: Lint the contract and typecheck**

Run: `pnpm lint:api && pnpm --filter @pp/server exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 12: Commit**

```bash
git add packages/db packages/server docs/api/openapi.yaml
git commit -m "feat(server): add offline bundle endpoint and card testVersionId"
```

---

### Task 15: Client — offline store (IndexedDB bundle + Cache Storage media)

**Files:**
- Modify: `packages/app/src/lib/api-types.ts` (add `OfflineMedia`, `OfflineBundleSection`, `OfflineBundle`; add `testVersionId: string` to `TestCard`)
- Create: `packages/app/src/lib/offline/offline-api.ts`
- Create: `packages/app/src/lib/offline/offline-store.ts`
- Create: `packages/app/test/helpers/bundle-fixture.ts` (reused by Tasks 19–22)
- Test: `packages/app/test/offline-store.test.ts`

**Interfaces:**
- Consumes: `apiFetch` (`lib/api-client.ts`); `OfflineBundle` wire shape from Task 14.
- Produces (the spec §6 contract plus three binding extensions — `getMediaBlob`, `snapshot`/`whenReady`, `list` used by Task 21):
  ```ts
  export interface OfflineTestRecord { readonly slug: string; readonly testVersionId: string; readonly version: number; readonly title: string; readonly level: StudentLevel; readonly totalBytes: number; readonly savedAt: string }
  export interface DownloadProgress { readonly doneBytes: number; readonly totalBytes: number }
  export interface OfflineStore {
    list(): Promise<OfflineTestRecord[]>
    snapshot(): readonly OfflineTestRecord[]          // sync, reference-stable between changes (useSyncExternalStore)
    whenReady(): Promise<void>                        // resolves once `snapshot()` reflects IndexedDB
    has(slug: string): Promise<boolean>
    getBundle(slug: string): Promise<OfflineBundle | null>
    getMediaBlob(key: string): Promise<Blob | null>
    download(slug: string, opts: { onProgress(p: DownloadProgress): void; signal: AbortSignal }): Promise<OfflineTestRecord>
    remove(slug: string): Promise<void>
    removeAll(): Promise<void>
    subscribe(listener: () => void): () => void
  }
  export function createOfflineStore(deps: OfflineStoreDeps): OfflineStore
  export const offlineStore: OfflineStore
  export class OfflineDownloadError extends Error {}
  ```

- [ ] **Step 1: Add the types**

Append to `packages/app/src/lib/api-types.ts` (after `RunnerEnvelope`):

```ts
export interface OfflineMedia {
  key: string
  stimulusId: string
  kind: "audio" | "image"
  mimeType: string
  bytes: number
  capped: boolean
  url: string
}

// A brief section plus its runner content. Everything that is per-attempt
// state on `RunnerSection` (status, completedAt, expiresAt) is absent: a bundle
// is content, an attempt is state.
export interface OfflineBundleSection
  extends Omit<RunnerSection, "status" | "completedAt" | "expiresAt"> {
  ordinal: number
  playback: PlaybackRules | null
}

export interface OfflineBundle {
  slug: string
  testVersionId: string
  version: number
  title: string
  level: StudentLevel
  durationSeconds: number
  sections: OfflineBundleSection[]
  media: OfflineMedia[]
  totalBytes: number
  urlsExpireAt: string
}
```

Add `testVersionId: string` and `mediaBytes: number` to the existing `TestCard` interface.

Create `packages/app/src/lib/offline/offline-api.ts`:

```ts
import { apiFetch } from "../api-client.js"
import type { OfflineBundle } from "../api-types.js"

export function getOfflineBundle(slug: string): Promise<OfflineBundle> {
  return apiFetch<OfflineBundle>(
    `/tests/${encodeURIComponent(slug)}/offline-bundle`,
  )
}
```

- [ ] **Step 2: Write the shared bundle fixture**

Create `packages/app/test/helpers/bundle-fixture.ts`:

```ts
import type { OfflineBundle } from "../../src/lib/api-types.js"

/** Two sections: forward-only listening (capped audio `l1.mp3`, 2 questions) and free reading (1 question). */
export function makeBundle(overrides: Partial<OfflineBundle> = {}): OfflineBundle {
  return {
    slug: "practice-3",
    testVersionId: "ver-1",
    version: 1,
    title: "Practice Test 3",
    level: "primary-step-1",
    durationSeconds: 1200,
    sections: [
      {
        id: "sec-l",
        ordinal: 1,
        type: "listening",
        title: "Listening",
        questionCount: 2,
        durationSeconds: 600,
        instructions: ["Put your headphones on now."],
        navigation: "forward_only",
        allowAnswerChange: false,
        playback: { maxPlays: 1, allowPause: false, allowSeek: false },
        groups: [
          {
            id: "g-l",
            stimulus: {
              id: "st-l",
              type: "audio",
              maxPlays: 1,
              playsUsed: 0,
              allowPause: false,
              allowSeek: false,
            },
            questions: [
              {
                id: "q-l1",
                ordinal: 1,
                type: "single_choice",
                prompt: "Where is the bag?",
                choices: [
                  { id: "c-l1a", label: "Bench" },
                  { id: "c-l1b", label: "Desk" },
                ],
              },
              {
                id: "q-l2",
                ordinal: 2,
                type: "single_choice",
                prompt: "What time is it?",
                choices: [
                  { id: "c-l2a", label: "8:30" },
                  { id: "c-l2b", label: "9:00" },
                ],
              },
            ],
          },
        ],
      },
      {
        id: "sec-r",
        ordinal: 2,
        type: "reading",
        title: "Reading",
        questionCount: 1,
        durationSeconds: 600,
        instructions: [],
        navigation: "free",
        allowAnswerChange: true,
        playback: null,
        groups: [
          {
            id: "g-r",
            stimulus: {
              id: "st-r",
              type: "passage",
              title: "Tom's garden",
              bodyText: "Tom has a small garden.",
              maxPlays: null,
            },
            questions: [
              {
                id: "q-r1",
                ordinal: 3,
                type: "single_choice",
                prompt: "What does Tom have?",
                choices: [
                  { id: "c-r1a", label: "A garden" },
                  { id: "c-r1b", label: "A boat" },
                ],
              },
            ],
          },
        ],
      },
    ],
    media: [
      {
        key: "l1.mp3",
        stimulusId: "st-l",
        kind: "audio",
        mimeType: "audio/mpeg",
        bytes: 6,
        capped: true,
        url: "/api/media/l1.mp3?exp=1&sig=aa",
      },
    ],
    totalBytes: 6,
    urlsExpireAt: "2026-11-22T12:30:00.000Z",
    ...overrides,
  }
}
```

- [ ] **Step 3: Write the failing store tests**

Create `packages/app/test/offline-store.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { OfflineBundle } from "../src/lib/api-types.js"
import {
  createOfflineStore,
  type OfflineCache,
  type OfflineStoreDeps,
} from "../src/lib/offline/offline-store.js"
import { makeBundle } from "./helpers/bundle-fixture.js"

class FakeCache implements OfflineCache {
  readonly entries = new Map<string, Response>()

  put(key: string, response: Response): Promise<void> {
    this.entries.set(key, response)

    return Promise.resolve()
  }

  match(key: string): Promise<Response | undefined> {
    return Promise.resolve(this.entries.get(key)?.clone())
  }

  delete(key: string): Promise<boolean> {
    return Promise.resolve(this.entries.delete(key))
  }
}

function twoChunkResponse(): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
        controller.enqueue(new Uint8Array([4, 5, 6]))
        controller.close()
      },
    }),
  )
}

let dbCounter = 0

function build(
  bundle: OfflineBundle,
  overrides: Partial<OfflineStoreDeps> = {},
): { store: ReturnType<typeof createOfflineStore>; cache: FakeCache } {
  const cache = new FakeCache()
  dbCounter += 1
  const store = createOfflineStore({
    dbName: `pp-offline-test-${dbCounter}`,
    cacheName: "pp-offline-media-test",
    fetchBundle: () => Promise.resolve(bundle),
    fetchMedia: () => Promise.resolve(twoChunkResponse()),
    cacheStorage: { open: () => Promise.resolve(cache) },
    now: () => new Date("2026-11-22T12:00:00.000Z"),
    ...overrides,
  })

  return { store, cache }
}

const NEVER_ABORTED = new AbortController().signal

describe("offlineStore", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("downloads media with byte-weighted progress, then records the bundle", async () => {
    const { store, cache } = build(makeBundle())
    const seen: number[] = []

    const record = await store.download("practice-3", {
      signal: NEVER_ABORTED,
      onProgress: (p) => seen.push(p.doneBytes / p.totalBytes),
    })

    expect(seen.at(-1)).toBe(1)
    expect([...seen].sort((a, b) => a - b)).toEqual(seen)
    expect(record).toMatchObject({
      slug: "practice-3",
      testVersionId: "ver-1",
      totalBytes: 6,
    })
    expect(await store.has("practice-3")).toBe(true)
    expect((await store.getBundle("practice-3"))?.title).toBe("Practice Test 3")
    expect(cache.entries.size).toBe(1)
    expect((await store.getMediaBlob("l1.mp3"))?.size).toBe(6)
  })

  it("leaves nothing behind when aborted mid-download", async () => {
    const { store, cache } = build(makeBundle())
    const controller = new AbortController()

    await expect(
      store.download("practice-3", {
        signal: controller.signal,
        onProgress: () => controller.abort(),
      }),
    ).rejects.toMatchObject({ name: "AbortError" })

    expect(await store.has("practice-3")).toBe(false)
    expect(cache.entries.size).toBe(0)
  })

  it("cleans up and throws OfflineDownloadError on a failed media response", async () => {
    const { store, cache } = build(makeBundle(), {
      fetchMedia: () => Promise.resolve(new Response("nope", { status: 403 })),
    })

    await expect(
      store.download("practice-3", {
        signal: NEVER_ABORTED,
        onProgress: () => {},
      }),
    ).rejects.toThrow("media l1.mp3 returned 403")
    expect(await store.has("practice-3")).toBe(false)
    expect(cache.entries.size).toBe(0)
  })

  it("remove drops unshared media but keeps media another saved test still uses", async () => {
    const shared = makeBundle()
    const other = makeBundle({
      slug: "practice-4",
      testVersionId: "ver-2",
      title: "Practice Test 4",
    })
    const { store, cache } = build(shared, {
      fetchBundle: (slug) => Promise.resolve(slug === "practice-3" ? shared : other),
    })
    const opts = { signal: NEVER_ABORTED, onProgress: () => {} }

    await store.download("practice-3", opts)
    await store.download("practice-4", opts)
    await store.remove("practice-3")

    expect(await store.has("practice-3")).toBe(false)
    expect(cache.entries.size).toBe(1)

    await store.remove("practice-4")

    expect(cache.entries.size).toBe(0)
  })

  it("keeps snapshot() reference-stable until something changes, and notifies subscribers", async () => {
    const { store } = build(makeBundle())
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    await store.whenReady()

    const before = store.snapshot()

    expect(store.snapshot()).toBe(before)

    await store.download("practice-3", {
      signal: NEVER_ABORTED,
      onProgress: () => {},
    })

    expect(listener).toHaveBeenCalled()
    expect(store.snapshot()).not.toBe(before)
    expect(store.snapshot().map((r) => r.slug)).toEqual(["practice-3"])
    unsubscribe()
  })

  it("removeAll empties the store and the media cache", async () => {
    const { store, cache } = build(makeBundle())

    await store.download("practice-3", {
      signal: NEVER_ABORTED,
      onProgress: () => {},
    })
    await store.removeAll()

    expect(await store.list()).toEqual([])
    expect(cache.entries.size).toBe(0)
  })
})
```

- [ ] **Step 4: Run to verify it fails**

Run: `pnpm --filter @pp/app exec vitest run test/offline-store.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/offline/offline-store.js'`.

- [ ] **Step 5: Implement the store**

Create `packages/app/src/lib/offline/offline-store.ts`:

```ts
import type { OfflineBundle, StudentLevel } from "../api-types.js"
import { getOfflineBundle } from "./offline-api.js"

export interface OfflineTestRecord {
  readonly slug: string
  readonly testVersionId: string
  readonly version: number
  readonly title: string
  readonly level: StudentLevel
  readonly totalBytes: number
  readonly savedAt: string
}

export interface DownloadProgress {
  readonly doneBytes: number
  readonly totalBytes: number
}

/** The slice of the Cache Storage API this module needs, so tests can fake it. */
export interface OfflineCache {
  put(key: string, response: Response): Promise<void>
  match(key: string): Promise<Response | undefined>
  delete(key: string): Promise<boolean>
}

export interface OfflineStoreDeps {
  readonly dbName: string
  readonly cacheName: string
  readonly fetchBundle: (slug: string) => Promise<OfflineBundle>
  readonly fetchMedia: (url: string, signal: AbortSignal) => Promise<Response>
  readonly cacheStorage: { open(name: string): Promise<OfflineCache> }
  readonly now: () => Date
}

export interface OfflineStore {
  list(): Promise<OfflineTestRecord[]>
  snapshot(): readonly OfflineTestRecord[]
  whenReady(): Promise<void>
  has(slug: string): Promise<boolean>
  getBundle(slug: string): Promise<OfflineBundle | null>
  getMediaBlob(key: string): Promise<Blob | null>
  download(
    slug: string,
    opts: { onProgress(p: DownloadProgress): void; signal: AbortSignal },
  ): Promise<OfflineTestRecord>
  remove(slug: string): Promise<void>
  removeAll(): Promise<void>
  subscribe(listener: () => void): () => void
}

export class OfflineDownloadError extends Error {}

const TESTS_STORE = "tests"
// Cache Storage keys must be absolute URLs in Node-based tests and are free
// strings in browsers; a reserved .invalid origin can never collide with a
// real request the service worker might see.
const MEDIA_ORIGIN = "https://offline.invalid/media/"

interface StoredTest {
  readonly slug: string
  readonly record: OfflineTestRecord
  readonly bundle: OfflineBundle
}

const mediaKey = (key: string): string => `${MEDIA_ORIGIN}${encodeURIComponent(key)}`

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"))
  })
}

function openDb(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1)

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(TESTS_STORE)) {
        request.result.createObjectStore(TESTS_STORE, { keyPath: "slug" })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB open failed"))
  })
}

function abortError(): DOMException {
  return new DOMException("The download was aborted", "AbortError")
}

export function createOfflineStore(deps: OfflineStoreDeps): OfflineStore {
  const dbPromise = openDb(deps.dbName)
  const listeners = new Set<() => void>()
  const inflight = new Map<string, Promise<OfflineTestRecord>>()
  let current: readonly OfflineTestRecord[] = []

  async function readAll(): Promise<StoredTest[]> {
    const db = await dbPromise

    return promisify(
      db.transaction(TESTS_STORE).objectStore(TESTS_STORE).getAll() as IDBRequest<
        StoredTest[]
      >,
    )
  }

  async function refresh(): Promise<void> {
    const stored = await readAll()

    current = stored
      .map((item) => item.record)
      .sort((a, b) => a.title.localeCompare(b.title))
    listeners.forEach((listener) => listener())
  }

  const ready = refresh()

  async function removeKeys(keys: Iterable<string>): Promise<void> {
    const cache = await deps.cacheStorage.open(deps.cacheName)

    for (const key of keys) {
      // eslint-disable-next-line no-await-in-loop
      await cache.delete(mediaKey(key))
    }
  }

  async function streamIntoCache(
    cache: OfflineCache,
    item: OfflineBundle["media"][number],
    signal: AbortSignal,
    onBytes: (n: number) => void,
  ): Promise<void> {
    const response = await deps.fetchMedia(item.url, signal)

    if (!response.ok || !response.body) {
      throw new OfflineDownloadError(
        `media ${item.key} returned ${response.status}`,
      )
    }

    const reader = response.body.getReader()
    const chunks: BlobPart[] = []

    for (;;) {
      signal.throwIfAborted()
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      chunks.push(value as BlobPart)
      onBytes(value.byteLength)
    }

    await cache.put(
      mediaKey(item.key),
      new Response(new Blob(chunks, { type: item.mimeType }), {
        headers: { "content-type": item.mimeType },
      }),
    )
  }

  async function runDownload(
    slug: string,
    opts: { onProgress(p: DownloadProgress): void; signal: AbortSignal },
  ): Promise<OfflineTestRecord> {
    const bundle = await deps.fetchBundle(slug)
    const cache = await deps.cacheStorage.open(deps.cacheName)
    const written: string[] = []
    let doneBytes = 0

    try {
      for (const item of bundle.media) {
        // eslint-disable-next-line no-await-in-loop
        await streamIntoCache(cache, item, opts.signal, (n) => {
          doneBytes += n
          opts.onProgress({ doneBytes, totalBytes: bundle.totalBytes })
          opts.signal.throwIfAborted()
        })
        written.push(item.key)
      }

      opts.signal.throwIfAborted()
    } catch (error) {
      // Only remove keys this run wrote AND no other saved test references.
      const others = (await readAll()).filter((s) => s.slug !== slug)
      const shared = new Set(others.flatMap((s) => s.bundle.media.map((m) => m.key)))

      await removeKeys(written.filter((key) => !shared.has(key)))

      if (error instanceof DOMException && error.name === "AbortError") {
        throw error
      }

      if (opts.signal.aborted) {
        throw abortError()
      }

      throw error
    }

    const record: OfflineTestRecord = {
      slug: bundle.slug,
      testVersionId: bundle.testVersionId,
      version: bundle.version,
      title: bundle.title,
      level: bundle.level,
      totalBytes: bundle.totalBytes,
      savedAt: deps.now().toISOString(),
    }
    const db = await dbPromise
    const tx = db.transaction(TESTS_STORE, "readwrite")

    tx.objectStore(TESTS_STORE).put({ slug: bundle.slug, record, bundle })
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"))
    })
    await refresh()

    return record
  }

  return {
    async list() {
      await ready

      return [...current]
    },
    snapshot: () => current,
    whenReady: () => ready,
    async has(slug) {
      await ready

      return current.some((record) => record.slug === slug)
    },
    async getBundle(slug) {
      const db = await dbPromise
      const stored = await promisify(
        db.transaction(TESTS_STORE).objectStore(TESTS_STORE).get(slug) as IDBRequest<
          StoredTest | undefined
        >,
      )

      return stored?.bundle ?? null
    },
    async getMediaBlob(key) {
      const cache = await deps.cacheStorage.open(deps.cacheName)
      const response = await cache.match(mediaKey(key))

      return response ? response.blob() : null
    },
    download(slug, opts) {
      const existing = inflight.get(slug)

      if (existing) {
        return existing
      }

      const run = runDownload(slug, opts).finally(() => {
        inflight.delete(slug)
      })

      inflight.set(slug, run)

      return run
    },
    async remove(slug) {
      const all = await readAll()
      const target = all.find((s) => s.slug === slug)

      if (!target) {
        return
      }

      const stillUsed = new Set(
        all
          .filter((s) => s.slug !== slug)
          .flatMap((s) => s.bundle.media.map((m) => m.key)),
      )
      const db = await dbPromise
      const tx = db.transaction(TESTS_STORE, "readwrite")

      tx.objectStore(TESTS_STORE).delete(slug)
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB delete failed"))
      })
      await removeKeys(
        target.bundle.media.map((m) => m.key).filter((key) => !stillUsed.has(key)),
      )
      await refresh()
    },
    async removeAll() {
      const all = await readAll()
      const db = await dbPromise
      const tx = db.transaction(TESTS_STORE, "readwrite")

      tx.objectStore(TESTS_STORE).clear()
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB clear failed"))
      })
      await removeKeys(all.flatMap((s) => s.bundle.media.map((m) => m.key)))
      await refresh()
    },
    subscribe(listener) {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** The app-wide instance. Never constructed during SSR/tests: it opens IndexedDB. */
let instance: OfflineStore | undefined

function getInstance(): OfflineStore {
  instance ??= createOfflineStore({
    dbName: "pp-offline",
    cacheName: "pp-offline-media-v1",
    fetchBundle: getOfflineBundle,
    fetchMedia: (url, signal) => fetch(url, { signal }),
    cacheStorage: caches,
    now: () => new Date(),
  })

  return instance
}

// A lazy facade: `offlineStore.x` forwards to the real instance, created on
// first use. Keeps module import side-effect free (tests, SSR, lint).
export const offlineStore: OfflineStore = {
  list: () => getInstance().list(),
  snapshot: () => getInstance().snapshot(),
  whenReady: () => getInstance().whenReady(),
  has: (slug) => getInstance().has(slug),
  getBundle: (slug) => getInstance().getBundle(slug),
  getMediaBlob: (key) => getInstance().getMediaBlob(key),
  download: (slug, opts) => getInstance().download(slug, opts),
  remove: (slug) => getInstance().remove(slug),
  removeAll: () => getInstance().removeAll(),
  subscribe: (listener) => getInstance().subscribe(listener),
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm --filter @pp/app exec vitest run test/offline-store.test.ts && pnpm --filter @pp/app exec tsc --noEmit`
Expected: 5 tests PASS, typecheck clean. (If `value as BlobPart` trips `no-unnecessary-type-assertion`, keep it: `Uint8Array<ArrayBufferLike>` is not assignable to `BlobPart` under TS 6.)

- [ ] **Step 7: Wire sign-out purge (spec D8)**

`offlineStore.removeAll()` must run when `purgeClientCaches()` (Task 2, `lib/pwa/purge.ts`) runs. Re-read `lib/pwa/purge.ts` first. Add `await offlineStore.removeAll().catch(() => {})` to its list of purge steps (import `offlineStore` from `../offline/offline-store.js`), and extend Task 2's purge test with:

```ts
it("also clears saved offline tests", async () => {
  const removeAll = vi.spyOn(offlineStore, "removeAll").mockResolvedValue()

  await purgeClientCaches()

  expect(removeAll).toHaveBeenCalledOnce()
})
```

Run: `pnpm --filter @pp/app exec vitest run test/purge.test.ts` (use the file name Task 2 created — `ls packages/app/test | grep -i purge`).
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/app
git commit -m "feat(app): add offline store for saved tests and media"
```

---

### Task 16: Library and Profile — save-offline UI and offline gating

**What this builds.** The prototype's `testCard` download row (`dlStart`): **none → "Save offline · N MB" button; saving → "Saving… N%" status; ready → "Available offline" chip; disabled while offline**; Start disabled offline unless the test is saved (with the reason text under the button); Profile's "Saved for offline" list with Remove and a toast. All new copy lives under `offline.*` in `runner.json` for all six locales.

**Files:**
- Create: `packages/app/src/lib/offline/start-gate.ts` + `packages/app/test/start-gate.test.ts`
- Create: `packages/app/src/lib/offline/use-offline.ts` + `packages/app/test/use-offline.test.tsx`
- Create: `packages/app/src/components/SaveOfflineControl.tsx` + `.test.tsx`
- Create: `packages/app/src/components/OfflineStorageList.tsx` + `.test.tsx`
- Modify: `packages/app/src/pages/index.tsx` (library card — Part B owns the markup; re-read the file first)
- Modify: `packages/app/src/pages/profile.tsx` (Task 6 created it; re-read first)
- Modify: `packages/app/src/locales/{en,de,es,fr,it,ja}/runner.json`

**Interfaces:**
- Consumes: `offlineStore` (Task 15); `networkStore.getSnapshot().online` / `.subscribe` (Task 3); `toastStore.show(message, icon)` (Task 4); `TestCard.testVersionId` (Task 14/15).
- Produces:
  ```ts
  // lib/offline/start-gate.ts
  export type StartGate =
    | { readonly enabled: true }
    | { readonly enabled: false; readonly reason: "needs-connection" | "finish-active-first" }
  export function startGate(input: {
    online: boolean
    saved: boolean
    /** True when this card's attempt is in progress AND its local state exists on this device. */
    continuableLocally: boolean
    isContinue: boolean
    activeOtherTitle: string | null
  }): StartGate

  // lib/offline/use-offline.ts
  export interface OfflineLibraryApi {
    readonly saved: ReadonlyMap<string, OfflineTestRecord>
    readonly progressPercent: ReadonlyMap<string, number>
    readonly online: boolean
    save(slug: string, title: string): void
    remove(slug: string, title: string): void
  }
  export function useOfflineLibrary(): OfflineLibraryApi

  // components/SaveOfflineControl.tsx  (stateless)
  export type SaveOfflineState =
    | { readonly kind: "none" }
    | { readonly kind: "saving"; readonly percent: number }
    | { readonly kind: "ready"; readonly stale: boolean }
  export interface SaveOfflineControlProps { readonly title: string; readonly sizeMb: number; readonly state: SaveOfflineState; readonly online: boolean; readonly onSave: () => void }

  // components/OfflineStorageList.tsx  (stateless)
  export interface OfflineStorageItem { readonly slug: string; readonly title: string; readonly levelLabel: string; readonly sizeMb: number }
  export interface OfflineStorageListProps { readonly items: readonly OfflineStorageItem[]; readonly onRemove: (slug: string, title: string) => void }
  ```

- [ ] **Step 1: Add the locale keys first (the components' tests need them)**

Confirm there are no existing top-level `offline.` keys (the existing ones are `runner.offline.*`):
Run: `grep -c '^  "offline\.' packages/app/src/locales/en/runner.json`
Expected: `0`.

Append these keys inside the top-level object of each `packages/app/src/locales/<lang>/runner.json` (add a comma after the previous last entry). English:

```json
  "offline.save": "Save offline · {{size}}",
  "offline.saveLabel": "Save {{title}} for offline use",
  "offline.saving": "Saving… {{percent}}%",
  "offline.available": "Available offline",
  "offline.updateSaved": "Update saved copy",
  "offline.needsConnection": "Needs a connection. Save it for offline use while you're online.",
  "offline.finishFirst": "Finish {{title}} first.",
  "offline.saved": "{{title}} is saved for offline use.",
  "offline.removed": "{{title}} removed from this phone.",
  "offline.removeLabel": "Remove {{title}} from this phone",
  "offline.paused": "Save paused — you're offline. Try again when connected.",
  "offline.saveFailed": "Couldn't save {{title}}. Try again.",
  "offline.storage.title": "Saved for offline",
  "offline.storage.empty": "Nothing saved yet. Use “Save offline” on a test while you're online.",
  "offline.storage.row": "{{level}} · {{size}}",
  "offline.sizeMb": "{{count}} MB"
```

German (`de`):

```json
  "offline.save": "Offline speichern · {{size}}",
  "offline.saveLabel": "{{title}} für die Offline-Nutzung speichern",
  "offline.saving": "Wird gespeichert… {{percent}} %",
  "offline.available": "Offline verfügbar",
  "offline.updateSaved": "Gespeicherte Kopie aktualisieren",
  "offline.needsConnection": "Benötigt eine Verbindung. Speichere den Test für die Offline-Nutzung, solange du online bist.",
  "offline.finishFirst": "Beende zuerst {{title}}.",
  "offline.saved": "{{title}} ist für die Offline-Nutzung gespeichert.",
  "offline.removed": "{{title}} wurde von diesem Telefon entfernt.",
  "offline.removeLabel": "{{title}} von diesem Telefon entfernen",
  "offline.paused": "Speichern pausiert – du bist offline. Versuche es erneut, wenn du verbunden bist.",
  "offline.saveFailed": "{{title}} konnte nicht gespeichert werden. Versuche es erneut.",
  "offline.storage.title": "Für Offline gespeichert",
  "offline.storage.empty": "Noch nichts gespeichert. Nutze „Offline speichern“ bei einem Test, solange du online bist.",
  "offline.storage.row": "{{level}} · {{size}}",
  "offline.sizeMb": "{{count}} MB"
```

Spanish (`es`):

```json
  "offline.save": "Guardar sin conexión · {{size}}",
  "offline.saveLabel": "Guardar {{title}} para usarlo sin conexión",
  "offline.saving": "Guardando… {{percent}} %",
  "offline.available": "Disponible sin conexión",
  "offline.updateSaved": "Actualizar la copia guardada",
  "offline.needsConnection": "Necesita conexión. Guárdalo para usarlo sin conexión mientras estás en línea.",
  "offline.finishFirst": "Termina primero {{title}}.",
  "offline.saved": "{{title}} está guardado para usarlo sin conexión.",
  "offline.removed": "{{title}} se eliminó de este teléfono.",
  "offline.removeLabel": "Eliminar {{title}} de este teléfono",
  "offline.paused": "Guardado en pausa: estás sin conexión. Inténtalo de nuevo cuando te conectes.",
  "offline.saveFailed": "No se pudo guardar {{title}}. Inténtalo de nuevo.",
  "offline.storage.title": "Guardado sin conexión",
  "offline.storage.empty": "Aún no hay nada guardado. Usa «Guardar sin conexión» en una prueba mientras estés en línea.",
  "offline.storage.row": "{{level}} · {{size}}",
  "offline.sizeMb": "{{count}} MB"
```

French (`fr`):

```json
  "offline.save": "Enregistrer hors ligne · {{size}}",
  "offline.saveLabel": "Enregistrer {{title}} pour une utilisation hors ligne",
  "offline.saving": "Enregistrement… {{percent}} %",
  "offline.available": "Disponible hors ligne",
  "offline.updateSaved": "Mettre à jour la copie enregistrée",
  "offline.needsConnection": "Nécessite une connexion. Enregistre-le pour l'utiliser hors ligne tant que tu es en ligne.",
  "offline.finishFirst": "Termine d'abord {{title}}.",
  "offline.saved": "{{title}} est enregistré pour une utilisation hors ligne.",
  "offline.removed": "{{title}} a été supprimé de ce téléphone.",
  "offline.removeLabel": "Supprimer {{title}} de ce téléphone",
  "offline.paused": "Enregistrement en pause : tu es hors ligne. Réessaie une fois connecté.",
  "offline.saveFailed": "Impossible d'enregistrer {{title}}. Réessaie.",
  "offline.storage.title": "Enregistré hors ligne",
  "offline.storage.empty": "Rien d'enregistré pour l'instant. Utilise « Enregistrer hors ligne » sur un test tant que tu es en ligne.",
  "offline.storage.row": "{{level}} · {{size}}",
  "offline.sizeMb": "{{count}} Mo"
```

Italian (`it`):

```json
  "offline.save": "Salva offline · {{size}}",
  "offline.saveLabel": "Salva {{title}} per l'uso offline",
  "offline.saving": "Salvataggio… {{percent}}%",
  "offline.available": "Disponibile offline",
  "offline.updateSaved": "Aggiorna la copia salvata",
  "offline.needsConnection": "Serve una connessione. Salvalo per l'uso offline mentre sei online.",
  "offline.finishFirst": "Prima finisci {{title}}.",
  "offline.saved": "{{title}} è salvato per l'uso offline.",
  "offline.removed": "{{title}} rimosso da questo telefono.",
  "offline.removeLabel": "Rimuovi {{title}} da questo telefono",
  "offline.paused": "Salvataggio in pausa: sei offline. Riprova quando sei connesso.",
  "offline.saveFailed": "Impossibile salvare {{title}}. Riprova.",
  "offline.storage.title": "Salvato offline",
  "offline.storage.empty": "Ancora niente di salvato. Usa «Salva offline» su un test mentre sei online.",
  "offline.storage.row": "{{level}} · {{size}}",
  "offline.sizeMb": "{{count}} MB"
```

Japanese (`ja`):

```json
  "offline.save": "オフライン用に保存 · {{size}}",
  "offline.saveLabel": "{{title}} をオフライン用に保存",
  "offline.saving": "保存中… {{percent}}%",
  "offline.available": "オフラインで利用可能",
  "offline.updateSaved": "保存したコピーを更新",
  "offline.needsConnection": "接続が必要です。オンラインのうちにオフライン用に保存してください。",
  "offline.finishFirst": "先に {{title}} を終えてください。",
  "offline.saved": "{{title}} をオフライン用に保存しました。",
  "offline.removed": "{{title}} をこの端末から削除しました。",
  "offline.removeLabel": "{{title}} をこの端末から削除",
  "offline.paused": "保存を一時停止しました。オフラインです。接続したらもう一度お試しください。",
  "offline.saveFailed": "{{title}} を保存できませんでした。もう一度お試しください。",
  "offline.storage.title": "オフライン用に保存済み",
  "offline.storage.empty": "まだ何も保存されていません。オンラインのうちにテストの「オフライン用に保存」を使ってください。",
  "offline.storage.row": "{{level}} · {{size}}",
  "offline.sizeMb": "{{count}} MB"
```

Run: `pnpm --filter @pp/app exec vitest run src/locales/locale-parity.test.ts`
Expected: PASS (all six locales have identical keys).

- [ ] **Step 2: Write the failing `startGate` test**

Create `packages/app/test/start-gate.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { startGate } from "../src/lib/offline/start-gate.js"

const base = {
  online: true,
  saved: false,
  continuableLocally: false,
  isContinue: false,
  activeOtherTitle: null,
}

describe("startGate", () => {
  it("allows everything while online", () => {
    expect(startGate(base)).toEqual({ enabled: true })
  })

  it("blocks a different test while another attempt is active, even online", () => {
    expect(startGate({ ...base, activeOtherTitle: "Practice Test 3" })).toEqual({
      enabled: false,
      reason: "finish-active-first",
    })
  })

  it("offline: an unsaved test needs a connection", () => {
    expect(startGate({ ...base, online: false })).toEqual({
      enabled: false,
      reason: "needs-connection",
    })
  })

  it("offline: a saved test can start", () => {
    expect(startGate({ ...base, online: false, saved: true })).toEqual({
      enabled: true,
    })
  })

  it("offline: Continue needs local state on this device, saved or not", () => {
    expect(
      startGate({ ...base, online: false, isContinue: true, saved: true }),
    ).toEqual({ enabled: false, reason: "needs-connection" })
    expect(
      startGate({
        ...base,
        online: false,
        isContinue: true,
        continuableLocally: true,
      }),
    ).toEqual({ enabled: true })
  })
})
```

- [ ] **Step 3: Run it (fails), implement, run it (passes)**

Run: `pnpm --filter @pp/app exec vitest run test/start-gate.test.ts` — Expected: FAIL (module missing).

Create `packages/app/src/lib/offline/start-gate.ts`:

```ts
export type StartGate =
  | { readonly enabled: true }
  | {
      readonly enabled: false
      readonly reason: "needs-connection" | "finish-active-first"
    }

export interface StartGateInput {
  readonly online: boolean
  readonly saved: boolean
  readonly continuableLocally: boolean
  readonly isContinue: boolean
  readonly activeOtherTitle: string | null
}

/**
 * The prototype's `testCard` rule, as a pure function. Order matters: the
 * "one active attempt" rule applies online and offline; the connection rule
 * only bites offline. Continue has its own offline rule because resuming
 * needs the attempt's local state, which only exists if this device loaded it.
 */
export function startGate(input: StartGateInput): StartGate {
  if (!input.isContinue && input.activeOtherTitle !== null) {
    return { enabled: false, reason: "finish-active-first" }
  }

  if (input.online) {
    return { enabled: true }
  }

  const allowedOffline = input.isContinue
    ? input.continuableLocally
    : input.saved

  return allowedOffline
    ? { enabled: true }
    : { enabled: false, reason: "needs-connection" }
}
```

Run again — Expected: PASS.

- [ ] **Step 4: Write the failing component tests**

Create `packages/app/src/components/SaveOfflineControl.test.tsx` (match the i18n harness the sibling `SaveState.test.tsx` uses — re-read it and copy its `I18nextProvider`/`createInstance` setup into a local `renderWithI18n` helper; the assertions below are what matter):

```tsx
import { fireEvent, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { SaveOfflineControl } from "./SaveOfflineControl.js"
import { renderWithI18n } from "../test/renderWithI18n.js"

describe("SaveOfflineControl", () => {
  it("none: shows a labelled Save button that calls onSave", () => {
    const onSave = vi.fn()

    renderWithI18n(
      <SaveOfflineControl title="Practice Test 3" sizeMb={18} state={{ kind: "none" }} online onSave={onSave} />,
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Save Practice Test 3 for offline use" }),
    )

    expect(onSave).toHaveBeenCalledOnce()
    expect(screen.getByText("Save offline · 18 MB")).toBeInTheDocument()
  })

  it("none + offline: the button is disabled", () => {
    renderWithI18n(
      <SaveOfflineControl title="T" sizeMb={1} state={{ kind: "none" }} online={false} onSave={() => {}} />,
    )

    expect(screen.getByRole("button")).toBeDisabled()
  })

  it("saving: a status with the percentage and no button", () => {
    renderWithI18n(
      <SaveOfflineControl title="T" sizeMb={1} state={{ kind: "saving", percent: 40 }} online onSave={() => {}} />,
    )

    expect(screen.getByRole("status")).toHaveTextContent("Saving… 40%")
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("ready: shows Available offline; stale adds Update saved copy", () => {
    const onSave = vi.fn()
    const { rerender } = renderWithI18n(
      <SaveOfflineControl title="T" sizeMb={1} state={{ kind: "ready", stale: false }} online onSave={onSave} />,
    )

    expect(screen.getByText("Available offline")).toBeInTheDocument()
    expect(screen.queryByRole("button")).toBeNull()

    rerender(
      <SaveOfflineControl title="T" sizeMb={1} state={{ kind: "ready", stale: true }} online onSave={onSave} />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Update saved copy" }))

    expect(onSave).toHaveBeenCalledOnce()
  })
})
```

Create `packages/app/src/components/OfflineStorageList.test.tsx`:

```tsx
import { fireEvent, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { OfflineStorageList } from "./OfflineStorageList.js"
import { renderWithI18n } from "../test/renderWithI18n.js"

describe("OfflineStorageList", () => {
  it("shows the empty hint when nothing is saved", () => {
    renderWithI18n(<OfflineStorageList items={[]} onRemove={() => {}} />)

    expect(screen.getByText(/Nothing saved yet/u)).toBeInTheDocument()
  })

  it("lists each saved test with size and a labelled Remove button", () => {
    const onRemove = vi.fn()

    renderWithI18n(
      <OfflineStorageList
        items={[{ slug: "p3", title: "Practice Test 3", levelLabel: "Step 1", sizeMb: 18 }]}
        onRemove={onRemove}
      />,
    )

    expect(screen.getByText("Step 1 · 18 MB")).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Practice Test 3 from this phone" }),
    )

    expect(onRemove).toHaveBeenCalledWith("p3", "Practice Test 3")
  })
})
```

If `src/test/renderWithI18n.tsx` does not exist yet, create it from the harness in `SaveState.test.tsx` (an i18next instance loading `locales/en/runner.json` under namespace `runner`, wrapped in `I18nextProvider`, exposing `render`'s `rerender`).

- [ ] **Step 5: Run (fail), implement the components, run (pass)**

Run: `pnpm --filter @pp/app exec vitest run src/components/SaveOfflineControl.test.tsx src/components/OfflineStorageList.test.tsx` — Expected: FAIL (modules missing).

Create `packages/app/src/components/SaveOfflineControl.tsx`:

```tsx
import { useTranslation } from "react-i18next"

export type SaveOfflineState =
  | { readonly kind: "none" }
  | { readonly kind: "saving"; readonly percent: number }
  | { readonly kind: "ready"; readonly stale: boolean }

export interface SaveOfflineControlProps {
  readonly title: string
  readonly sizeMb: number
  readonly state: SaveOfflineState
  readonly online: boolean
  readonly onSave: () => void
}

const CHIP =
  "inline-flex min-h-8 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-extrabold"

export function SaveOfflineControl({
  title,
  sizeMb,
  state,
  online,
  onSave,
}: SaveOfflineControlProps) {
  const { t } = useTranslation("runner")

  if (state.kind === "saving") {
    return (
      <span role="status" className={`${CHIP} bg-teal-bg text-teal`}>
        {t("offline.saving", { percent: state.percent })}
      </span>
    )
  }

  if (state.kind === "ready") {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <span className={`${CHIP} bg-good-bg text-good`}>
          <span aria-hidden="true">✓</span> {t("offline.available")}
        </span>
        {state.stale ? (
          <button
            type="button"
            className="device-button"
            data-variant="secondary"
            disabled={!online}
            onClick={onSave}
          >
            {t("offline.updateSaved")}
          </button>
        ) : null}
      </span>
    )
  }

  return (
    <button
      type="button"
      className="device-button"
      data-variant="secondary"
      aria-label={t("offline.saveLabel", { title })}
      disabled={!online}
      onClick={onSave}
    >
      {t("offline.save", { size: t("offline.sizeMb", { count: sizeMb }) })}
    </button>
  )
}
```

Create `packages/app/src/components/OfflineStorageList.tsx`:

```tsx
import { useTranslation } from "react-i18next"

export interface OfflineStorageItem {
  readonly slug: string
  readonly title: string
  readonly levelLabel: string
  readonly sizeMb: number
}

export interface OfflineStorageListProps {
  readonly items: readonly OfflineStorageItem[]
  readonly onRemove: (slug: string, title: string) => void
}

export function OfflineStorageList({ items, onRemove }: OfflineStorageListProps) {
  const { t } = useTranslation("runner")

  if (items.length === 0) {
    return <p className="text-ink-2 text-sm font-semibold">{t("offline.storage.empty")}</p>
  }

  return (
    <ul className="m-0 list-none divide-y divide-line p-0">
      {items.map((item) => (
        <li key={item.slug} className="flex min-h-[60px] items-center gap-3 py-2">
          <div className="min-w-0 flex-1">
            <b className="text-ink block truncate font-extrabold">{item.title}</b>
            <span className="text-ink-2 text-[13px] font-semibold">
              {t("offline.storage.row", {
                level: item.levelLabel,
                size: t("offline.sizeMb", { count: item.sizeMb }),
              })}
            </span>
          </div>
          <button
            type="button"
            className="grid size-11 place-items-center rounded-xl"
            aria-label={t("offline.removeLabel", { title: item.title })}
            onClick={() => onRemove(item.slug, item.title)}
          >
            <span aria-hidden="true">🗑</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
```

Run again — Expected: PASS. Then `pnpm lint:i18n` — Expected: no new findings.

- [ ] **Step 6: Write the failing hook test**

Create `packages/app/test/use-offline.test.tsx`:

```tsx
import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { networkStore } from "../src/lib/network.js"
import { toastStore } from "../src/lib/toast.js"
import { offlineStore } from "../src/lib/offline/offline-store.js"
import { useOfflineLibrary } from "../src/lib/offline/use-offline.js"

describe("useOfflineLibrary", () => {
  beforeEach(() => {
    networkStore.setOnlineForTests(true)
    vi.restoreAllMocks()
    vi.spyOn(offlineStore, "snapshot").mockReturnValue([])
    vi.spyOn(offlineStore, "subscribe").mockReturnValue(() => {})
  })

  it("reports byte-weighted progress while saving and toasts when done", async () => {
    vi.spyOn(offlineStore, "download").mockImplementation((slug, { onProgress }) => {
      onProgress({ doneBytes: 3, totalBytes: 6 })

      return Promise.resolve({
        slug,
        testVersionId: "v1",
        version: 1,
        title: "Practice Test 3",
        level: "primary-step-1",
        totalBytes: 6,
        savedAt: "2026-11-22T12:00:00.000Z",
      })
    })
    const show = vi.spyOn(toastStore, "show")
    const { result } = renderHook(() => useOfflineLibrary())

    act(() => result.current.save("practice-3", "Practice Test 3"))

    await waitFor(() => expect(show).toHaveBeenCalled())
    expect(show.mock.calls[0]?.[1]).toBe("cloud")
    expect(result.current.progressPercent.has("practice-3")).toBe(false)
  })

  it("aborts in-flight saves when the network drops and says the save is paused", async () => {
    let seenSignal: AbortSignal | undefined

    vi.spyOn(offlineStore, "download").mockImplementation(
      (_slug, { signal }) =>
        new Promise((_resolve, reject) => {
          seenSignal = signal
          signal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          )
        }),
    )
    const show = vi.spyOn(toastStore, "show")
    const { result } = renderHook(() => useOfflineLibrary())

    act(() => result.current.save("practice-3", "Practice Test 3"))
    act(() => networkStore.setOnlineForTests(false))

    await waitFor(() => expect(seenSignal?.aborted).toBe(true))
    await waitFor(() => expect(show).toHaveBeenCalled())
    expect(show.mock.calls[0]?.[1]).toBe("wifioff")
  })

  it("remove calls the store and toasts", async () => {
    const remove = vi.spyOn(offlineStore, "remove").mockResolvedValue()
    const show = vi.spyOn(toastStore, "show")
    const { result } = renderHook(() => useOfflineLibrary())

    act(() => result.current.remove("practice-3", "Practice Test 3"))

    await waitFor(() => expect(remove).toHaveBeenCalledWith("practice-3"))
    await waitFor(() => expect(show).toHaveBeenCalledWith(expect.any(String), "trash"))
  })
})
```

- [ ] **Step 7: Run (fail), implement the hook, run (pass)**

Run: `pnpm --filter @pp/app exec vitest run test/use-offline.test.tsx` — Expected: FAIL (module missing).

Create `packages/app/src/lib/offline/use-offline.ts`:

```ts
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import i18n from "../../i18n.js"
import { networkStore } from "../network.js"
import { toastStore } from "../toast.js"
import { offlineStore, type OfflineTestRecord } from "./offline-store.js"

export interface OfflineLibraryApi {
  readonly saved: ReadonlyMap<string, OfflineTestRecord>
  readonly progressPercent: ReadonlyMap<string, number>
  readonly online: boolean
  save(slug: string, title: string): void
  remove(slug: string, title: string): void
}

const isAbort = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "AbortError"

/**
 * Page-level state for the library and profile screens (components/ stay
 * stateless). Saves are aborted when the network drops -- the prototype's
 * "Save paused" behaviour -- and the toast copy comes from the i18n catalogue.
 */
export function useOfflineLibrary(): OfflineLibraryApi {
  const records = useSyncExternalStore(
    offlineStore.subscribe,
    offlineStore.snapshot,
    offlineStore.snapshot,
  )
  const online = useSyncExternalStore(
    networkStore.subscribe,
    () => networkStore.getSnapshot().online,
    () => true,
  )
  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(new Map())
  const controllers = useRef(new Map<string, AbortController>())

  useEffect(() => {
    if (!online) {
      controllers.current.forEach((controller) => controller.abort())
    }
  }, [online])

  const save = useCallback((slug: string, title: string): void => {
    if (controllers.current.has(slug)) {
      return
    }

    const controller = new AbortController()

    controllers.current.set(slug, controller)
    setProgress((prev) => new Map(prev).set(slug, 0))

    void offlineStore
      .download(slug, {
        signal: controller.signal,
        onProgress: ({ doneBytes, totalBytes }) => {
          const percent = Math.min(100, Math.round((100 * doneBytes) / totalBytes))

          setProgress((prev) => new Map(prev).set(slug, percent))
        },
      })
      .then(() => {
        toastStore.show(i18n.t("runner:offline.saved", { title }), "cloud")
      })
      .catch((error: unknown) => {
        if (isAbort(error)) {
          toastStore.show(i18n.t("runner:offline.paused"), "wifioff")

          return
        }

        toastStore.show(i18n.t("runner:offline.saveFailed", { title }), "wifioff")
      })
      .finally(() => {
        controllers.current.delete(slug)
        setProgress((prev) => {
          const next = new Map(prev)

          next.delete(slug)

          return next
        })
      })
  }, [])

  const remove = useCallback((slug: string, title: string): void => {
    void offlineStore.remove(slug).then(() => {
      toastStore.show(i18n.t("runner:offline.removed", { title }), "trash")
    })
  }, [])

  const saved = useMemo(
    () => new Map(records.map((record) => [record.slug, record])),
    [records],
  )

  return { saved, progressPercent: progress, online, save, remove }
}
```

Run again — Expected: 3 tests PASS.

- [ ] **Step 8: Integrate into the library card**

Re-read `packages/app/src/pages/index.tsx` (Part B restyled it; the card is `TestLibraryCard`/`testCard`-equivalent and the Start control is a button calling `handleStart`). Make these changes, anchored on those symbols:

1. `LibraryScreenProps` gains `readonly offline?: OfflineLibraryApi`. In `RouteComponent` (the file's route component), call `const offline = useOfflineLibrary()` and pass it down. Inside `LibraryScreen`, `const offlineApi = offline ?? DEFAULT_OFFLINE` where `DEFAULT_OFFLINE` is a constant `{ saved: new Map(), progressPercent: new Map(), online: true, save: () => {}, remove: () => {} }` — existing tests that render `LibraryScreen` without the prop keep passing.
2. In the card, below the action row, render (hide it when `test.inProgressAttemptId !== null` — the prototype hides the download row on the in-progress card):
   ```tsx
   <SaveOfflineControl
     title={test.title}
     sizeMb={Math.max(1, Math.round(test.mediaBytes / 1_048_576))}
     online={offlineApi.online}
     state={offlineStateFor(test, offlineApi)}
     onSave={() => offlineApi.save(test.slug, test.title)}
   />
   ```
   with `offlineStateFor(test, api)` defined next to the card: `progressPercent.has(slug)` → `{ kind: "saving", percent }`; `saved.has(slug)` → `{ kind: "ready", stale: saved.get(slug).testVersionId !== test.testVersionId }`; otherwise `{ kind: "none" }`. Update the page's existing card fixtures in `index.test.tsx` with `testVersionId` and `mediaBytes` (TypeScript will list every literal that needs them).
3. Gate the Start/Continue/Try-again button with `startGate({ online, saved: offlineApi.saved.has(test.slug), continuableLocally: false, isContinue: test.inProgressAttemptId !== null, activeOtherTitle })` where `activeOtherTitle` is the title of the card that has `inProgressAttemptId` when it is a different card (the prototype's "Finish X first"). Task 21 replaces `continuableLocally: false` with the real local-state lookup. When `gate.enabled === false` set `disabled` and `aria-describedby="reason-<id>"` and render `<p id="reason-<id>" className="reason">` with `t("offline.needsConnection")` or `t("offline.finishFirst", { title })`.
4. Add tests to `pages/index.test.tsx` (copy the nearest existing `LibraryScreen` test's setup; the new assertions):
   ```tsx
   it("offline: an unsaved test's Start is disabled with the reason", () => {
     renderLibrary({ offline: { ...fakeOffline, online: false } })

     const start = screen.getByRole("button", { name: /start test/i })

     expect(start).toBeDisabled()
     expect(screen.getByText(/Needs a connection/u)).toBeInTheDocument()
   })

   it("offline: a saved test can still start", () => {
     renderLibrary({
       offline: {
         ...fakeOffline,
         online: false,
         saved: new Map([["practice-3", savedRecord]]),
       },
     })

     expect(screen.getByRole("button", { name: /start test/i })).toBeEnabled()
     expect(screen.getByText("Available offline")).toBeInTheDocument()
   })

   it("saving shows the percentage and no save button for that card", () => {
     renderLibrary({
       offline: { ...fakeOffline, progressPercent: new Map([["practice-3", 40]]) },
     })

     expect(screen.getByRole("status", { name: "" })).toHaveTextContent("Saving… 40%")
   })
   ```
   where `renderLibrary`, `fakeOffline`, `savedRecord` are small local helpers at the top of the test file (`fakeOffline` = the `DEFAULT_OFFLINE` shape; `savedRecord` an `OfflineTestRecord` whose `slug` equals the fixture card's slug — read the file's existing card fixture and reuse its slug/title).

- [ ] **Step 9: Integrate into Profile**

Re-read `packages/app/src/pages/profile.tsx`. Replace the "Saved for offline" block (Task 6 left a `data-testid="offline-storage-placeholder"` element or an empty list) with:

```tsx
<OfflineStorageList
  items={[...offline.saved.values()].map((record) => ({
    slug: record.slug,
    title: record.title,
    levelLabel: t(record.level === "primary-step-1" ? "library.step.1" : "library.step.2"),
    sizeMb: Math.max(1, Math.round(record.totalBytes / 1_048_576)),
  }))}
  onRemove={offline.remove}
/>
```

with `const offline = useOfflineLibrary()` in `ProfileScreen`'s route component (pass it as an optional prop like the library, default to the empty API). Add to `profile.test.tsx`: a saved record renders its title and `Step 1 · 1 MB`; clicking Remove calls `remove("practice-3", "Practice Test 3")`.

- [ ] **Step 10: Run the affected suites and gates**

Run:
```
pnpm --filter @pp/app exec vitest run src/pages/index.test.tsx src/pages/profile.test.tsx src/components test/use-offline.test.tsx test/start-gate.test.ts src/locales
pnpm --filter @pp/app exec tsc --noEmit && pnpm lint && pnpm format
```
Expected: all PASS; `lint:i18n` and `lint:frontend` report no new findings (hooks live in `lib/` and `pages/`, components stay stateless).

- [ ] **Step 11: Commit**

```bash
git add packages/app
git commit -m "feat(app): save tests offline from the library and manage them in profile"
```


---

### Task 17: Server — migration 1016 and the offline journal validator

**What this builds.** The schema and the *pure* rules for replaying a client journal (spec D6), with exhaustive unit tests, before any HTTP exists. Three design corrections to the spec are applied here (also listed in "Part notes"):

1. **The client-minted UUID *is* the server `attempt.id`** (no `client_attempt_id` column). Routes, the answer queue and results keep working across sync with no id remapping, and idempotency falls out of the primary key.
2. **Answers are journal events** (`type: "answer"`). Replay must interleave answers with `position` events in the order they happened; otherwise a forward-only section rejects every earlier-question answer as `navigation_locked` once the replayed position has moved on.
3. **Time is normalised by clock skew**: `effectiveAt = clientAt + (receivedAt − clientSentAt)`. A phone whose clock is 10 minutes fast must not have its whole attempt rejected as "from the future". The whole-attempt deadline (`first enter + test_version.duration_seconds`) is enforced alongside the per-section deadline — the spec named only the latter.

**Files:**
- Create: `packages/db/migrations/1016_offline_attempts.cjs`
- Modify: `docs/db/schema.sql` (the schema doc is the declared source of truth; keep it in step)
- Create: `packages/db/src/repositories/offline-journal.repository.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/test/offline-journal-repository.test.ts`
- Create: `packages/server/src/attempts/offline-sync-request.schema.ts`
- Create: `packages/server/src/attempts/offline-journal.validator.ts`
- Test: `packages/server/test/offline-journal-validator.test.ts`

**Interfaces:**
- Consumes: `attempt.repository.ts`'s `finalizeExpiredAttempt(db, { attemptId, now })`; `isPastDeadline` from `@pp/common`.
- Produces (db, exported from `@pp/db`):
  ```ts
  export function getJournalCursor(db: PgQueryable, attemptId: string): Promise<number>          // 0 when none
  export function advanceJournalCursor(db: PgQueryable, attemptId: string, eventSeq: number): Promise<void>  // never goes backwards
  export type CreateOfflineAttemptOutcome = { kind: "created" } | { kind: "exists" } | { kind: "conflict" } | { kind: "version_unavailable" }
  export function createOfflineAttempt(db: PgQueryable, input: { attemptId: string; studentId: string; testVersionId: string; slug: string; now: Date }): Promise<CreateOfflineAttemptOutcome>
  export interface JournalContextRows {
    versionDurationSeconds: number
    sections: Array<{ id: string; ordinal: number; durationSeconds: number; navigation: "free" | "forward_only"; allowAnswerChange: boolean }>
    stimuli: Array<{ id: string; sectionId: string; maxPlays: number | null }>   // media-backed stimuli only
    questions: Array<{ id: string; sectionId: string; ordinal: number }>
    playsUsed: Array<{ stimulusId: string; playCount: number }>
    sectionStates: Array<{ sectionId: string; enteredAt: Date; expiresAt: Date; completedAt: Date | null }>
    attemptStartedAt: Date | null
    attemptExpiresAt: Date | null
  }
  export function loadJournalContext(db: PgQueryable, input: { attemptId: string | null; testVersionId: string }): Promise<JournalContextRows>
  ```
- Produces (server):
  ```ts
  // offline-sync-request.schema.ts
  export type OfflineJournalEvent = z.infer<typeof OfflineJournalEventSchema>
  export class OfflineSyncRequestDto { static readonly schema; attemptId: string; clientSentAt: string; events: OfflineJournalEvent[] }
  // offline-journal.validator.ts
  export type Disposition = { kind: "apply" } | { kind: "late" } | { kind: "rejected"; reason: string }
  export interface PlannedEvent { readonly event: OfflineJournalEvent; readonly effectiveAt: Date; readonly disposition: Disposition }
  export type JournalValidation =
    | { readonly ok: true; readonly planned: readonly PlannedEvent[] }
    | { readonly ok: false; readonly code: "offline_journal_invalid" | "offline_play_cap_exceeded"; readonly reason: string; readonly eventSeq: number | null }
  export function validateJournal(events: readonly OfflineJournalEvent[], ctx: JournalContext): JournalValidation
  ```

- [ ] **Step 1: Write the migration**

Create `packages/db/migrations/1016_offline_attempts.cjs`:

```js
/* eslint-disable camelcase, typescript/no-unsafe-call, typescript/no-unsafe-member-access */
exports.shorthands = undefined

exports.up = (pgm) => {
  pgm.sql(`
-- Where an attempt came from. 'offline' attempts were started with no network
-- and adopted at sync time: attempt.id IS the client-minted uuid, so an
-- offline attempt's routes and answer queue never need remapping.
ALTER TABLE attempt
    ADD COLUMN origin text NOT NULL DEFAULT 'server',
    ADD CONSTRAINT attempt_origin_known CHECK (origin IN ('server', 'offline'));

-- Idempotency for POST /attempts/offline-sync: the highest journal eventSeq
-- already applied to this attempt. Events at or below it are never replayed,
-- so a retried or overlapping sync cannot double-count a play or an answer.
CREATE TABLE offline_journal_cursor (
    attempt_id      uuid PRIMARY KEY REFERENCES attempt (id) ON DELETE CASCADE,
    last_event_seq  integer     NOT NULL,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT journal_cursor_non_negative CHECK (last_event_seq >= 0)
);
  `)
}

exports.down = (pgm) => {
  pgm.sql(`
DROP TABLE offline_journal_cursor;
ALTER TABLE attempt DROP CONSTRAINT attempt_origin_known,
                    DROP COLUMN origin;
  `)
}
```

In `docs/db/schema.sql`, add to `CREATE TABLE attempt`, immediately after `status attempt_status NOT NULL DEFAULT 'in_progress',`:

```sql
    -- Where the attempt came from. 'offline' = started with no network and
    -- adopted at sync time; attempt.id is then the client-minted uuid.
    origin           text           NOT NULL DEFAULT 'server',
```

and in that table's constraint list `CONSTRAINT attempt_origin_known CHECK (origin IN ('server', 'offline')),`; then add, after the `attempt_section` table:

```sql
-- The highest offline-journal eventSeq already applied to an attempt.
CREATE TABLE offline_journal_cursor (
    attempt_id      uuid PRIMARY KEY REFERENCES attempt (id) ON DELETE CASCADE,
    last_event_seq  integer     NOT NULL,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT journal_cursor_non_negative CHECK (last_event_seq >= 0)
);
```

- [ ] **Step 2: Write the failing repository test**

Create `packages/db/test/offline-journal-repository.test.ts`:

```ts
import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  advanceJournalCursor,
  createOfflineAttempt,
  getJournalCursor,
  loadJournalContext,
} from "../src/repositories/offline-journal.repository.js"
import { withDatabase } from "./helpers/database.js"
import { seedPublishedTest } from "./helpers/fixtures.js"

const NOW = new Date("2026-11-22T12:00:00.000Z")

describe("createOfflineAttempt", () => {
  it("adopts the client uuid, marks origin offline and uses the claimed time", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const attemptId = randomUUID()
      const outcome = await createOfflineAttempt(pool, {
        attemptId,
        studentId: f.studentId,
        testVersionId: f.versionId,
        slug: f.slug,
        now: NOW,
      })
      const { rows } = await pool.query<{ origin: string; status: string; created_at: Date }>(
        "SELECT origin, status, created_at FROM attempt WHERE id = $1",
        [attemptId],
      )

      expect(outcome).toEqual({ kind: "created" })
      expect(rows[0]).toMatchObject({ origin: "offline", status: "in_progress" })
      expect(rows[0]?.created_at.toISOString()).toBe(NOW.toISOString())
    })
  })

  it("is idempotent for the same attempt id", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const input = {
        attemptId: randomUUID(),
        studentId: f.studentId,
        testVersionId: f.versionId,
        slug: f.slug,
        now: NOW,
      }

      await createOfflineAttempt(pool, input)

      await expect(createOfflineAttempt(pool, input)).resolves.toEqual({ kind: "exists" })
    })
  })

  it("conflicts with a live timed attempt for the same student and version", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)

      await pool.query(
        `INSERT INTO attempt (student_id, test_version_id, status, started_at, expires_at)
         VALUES ($1, $2, 'in_progress', $3, $4)`,
        [f.studentId, f.versionId, new Date(NOW.getTime() - 60_000), new Date(NOW.getTime() + 600_000)],
      )

      await expect(
        createOfflineAttempt(pool, {
          attemptId: randomUUID(),
          studentId: f.studentId,
          testVersionId: f.versionId,
          slug: f.slug,
          now: NOW,
        }),
      ).resolves.toEqual({ kind: "conflict" })
    })
  })

  it("finalizes an expired active attempt and then creates the offline one", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO attempt (student_id, test_version_id, status, started_at, expires_at)
         VALUES ($1, $2, 'in_progress', $3, $4) RETURNING id`,
        [f.studentId, f.versionId, new Date("2026-11-22T10:00:00Z"), new Date("2026-11-22T10:50:00Z")],
      )
      const outcome = await createOfflineAttempt(pool, {
        attemptId: randomUUID(),
        studentId: f.studentId,
        testVersionId: f.versionId,
        slug: f.slug,
        now: NOW,
      })
      const old = await pool.query<{ status: string }>(
        "SELECT status FROM attempt WHERE id = $1",
        [rows[0]?.id],
      )

      expect(outcome).toEqual({ kind: "created" })
      expect(old.rows[0]?.status).toBe("expired")
    })
  })

  it("refuses a version that does not match the slug or is unpublished", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)

      await expect(
        createOfflineAttempt(pool, {
          attemptId: randomUUID(),
          studentId: f.studentId,
          testVersionId: f.versionId,
          slug: "some-other-test",
          now: NOW,
        }),
      ).resolves.toEqual({ kind: "version_unavailable" })
    })
  })
})

describe("journal cursor", () => {
  it("starts at 0, advances, and never goes backwards", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const attemptId = randomUUID()

      await createOfflineAttempt(pool, {
        attemptId,
        studentId: f.studentId,
        testVersionId: f.versionId,
        slug: f.slug,
        now: NOW,
      })

      expect(await getJournalCursor(pool, attemptId)).toBe(0)

      await advanceJournalCursor(pool, attemptId, 3)
      await advanceJournalCursor(pool, attemptId, 2)

      expect(await getJournalCursor(pool, attemptId)).toBe(3)
    })
  })
})

describe("loadJournalContext", () => {
  it("returns the version's sections, media stimuli, questions and the attempt's progress", async () => {
    await withDatabase(async (pool) => {
      const f = await seedPublishedTest(pool)
      const attemptId = randomUUID()

      await createOfflineAttempt(pool, {
        attemptId,
        studentId: f.studentId,
        testVersionId: f.versionId,
        slug: f.slug,
        now: NOW,
      })

      const fresh = await loadJournalContext(pool, { attemptId: null, testVersionId: f.versionId })
      const withAttempt = await loadJournalContext(pool, { attemptId, testVersionId: f.versionId })

      expect(fresh.versionDurationSeconds).toBe(3000)
      expect(fresh.sections.map((s) => s.id)).toEqual([f.listeningSectionId, f.readingSectionId])
      expect(fresh.sections[0]).toMatchObject({ navigation: "forward_only", allowAnswerChange: false, durationSeconds: 1500 })
      expect(fresh.stimuli).toEqual([{ id: f.cappedStimulusId, sectionId: f.listeningSectionId, maxPlays: 1 }])
      expect(fresh.questions).toHaveLength(2)
      expect(fresh.playsUsed).toEqual([])
      expect(withAttempt.attemptStartedAt).toBeNull()
      expect(withAttempt.sectionStates).toEqual([])
    })
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @pp/db exec vitest run test/offline-journal-repository.test.ts`
Expected: FAIL — `Cannot find module '../src/repositories/offline-journal.repository.js'`.

- [ ] **Step 4: Implement the repository**

Create `packages/db/src/repositories/offline-journal.repository.ts`:

```ts
import {
  withTransaction,
  type PgQueryable,
} from "@liam-workspace/node-postgres"
import { isPastDeadline } from "@pp/common"
import type pg from "pg"
import { finalizeExpiredAttempt } from "./attempt.repository.js"

export async function getJournalCursor(
  db: PgQueryable,
  attemptId: string,
): Promise<number> {
  const { rows } = await db.query<{ last_event_seq: number }>(
    "SELECT last_event_seq FROM offline_journal_cursor WHERE attempt_id = $1",
    [attemptId],
  )

  return rows.length === 0 ? 0 : rows[0].last_event_seq
}

/** GREATEST keeps the cursor monotonic even if two syncs ever interleave. */
export async function advanceJournalCursor(
  db: PgQueryable,
  attemptId: string,
  eventSeq: number,
): Promise<void> {
  await db.query(
    `INSERT INTO offline_journal_cursor (attempt_id, last_event_seq)
     VALUES ($1, $2)
     ON CONFLICT (attempt_id) DO UPDATE
        SET last_event_seq = GREATEST(offline_journal_cursor.last_event_seq, EXCLUDED.last_event_seq),
            updated_at = now()`,
    [attemptId, eventSeq],
  )
}

export type CreateOfflineAttemptOutcome =
  | { kind: "created" }
  | { kind: "exists" }
  | { kind: "conflict" }
  | { kind: "version_unavailable" }

/**
 * The offline counterpart of `startOrResumeAttempt`. It deliberately does NOT
 * resume: an offline `start` event describes a NEW attempt, and silently
 * applying its journal to a different, already-running attempt would corrupt
 * both. A live (not past its deadline) attempt for the same student and
 * version is therefore a `conflict`; a stale one is finalized first, exactly
 * as `startOrResumeAttempt` does.
 *
 * The row is created at the CLAIMED time (`now`), never the request time.
 * `ON CONFLICT DO NOTHING` without a target absorbs both the primary key and
 * the `attempt_one_active` partial unique index, so a lost race is a plain
 * zero-row result rather than a statement error that would poison the
 * enclosing transaction.
 */
export function createOfflineAttempt(
  db: PgQueryable,
  input: {
    attemptId: string
    studentId: string
    testVersionId: string
    slug: string
    now: Date
  },
): Promise<CreateOfflineAttemptOutcome> {
  return withTransaction(db as pg.Pool, async (tx) => {
    const { rows: versions } = await tx.query(
      `SELECT 1
         FROM test_version tv
         JOIN test t ON t.id = tv.test_id
        WHERE tv.id = $1 AND t.slug = $2 AND tv.published_at IS NOT NULL`,
      [input.testVersionId, input.slug],
    )

    if (versions.length === 0) {
      return { kind: "version_unavailable" }
    }

    const { rows: existing } = await tx.query(
      "SELECT 1 FROM attempt WHERE id = $1",
      [input.attemptId],
    )

    if (existing.length > 0) {
      return { kind: "exists" }
    }

    const { rows: active } = await tx.query<{
      id: string
      expires_at: Date | null
    }>(
      `SELECT id, expires_at FROM attempt
        WHERE student_id = $1 AND test_version_id = $2 AND status = 'in_progress'
        FOR UPDATE`,
      [input.studentId, input.testVersionId],
    )

    if (active.length > 0) {
      const [live] = active

      if (!isPastDeadline(live.expires_at, input.now)) {
        return { kind: "conflict" }
      }

      await finalizeExpiredAttempt(tx, { attemptId: live.id, now: input.now })
    }

    const { rows: created } = await tx.query(
      `INSERT INTO attempt (id, student_id, test_version_id, status, origin, created_at)
       VALUES ($1, $2, $3, 'in_progress', 'offline', $4)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [input.attemptId, input.studentId, input.testVersionId, input.now],
    )

    return created.length === 0 ? { kind: "conflict" } : { kind: "created" }
  })
}

export interface JournalContextRows {
  versionDurationSeconds: number
  sections: Array<{
    id: string
    ordinal: number
    durationSeconds: number
    navigation: "free" | "forward_only"
    allowAnswerChange: boolean
  }>
  stimuli: Array<{ id: string; sectionId: string; maxPlays: number | null }>
  questions: Array<{ id: string; sectionId: string; ordinal: number }>
  playsUsed: Array<{ stimulusId: string; playCount: number }>
  sectionStates: Array<{
    sectionId: string
    enteredAt: Date
    expiresAt: Date
    completedAt: Date | null
  }>
  attemptStartedAt: Date | null
  attemptExpiresAt: Date | null
}

/**
 * Everything the pure journal validator needs, read once. Only MEDIA-backed
 * stimuli are listed: a passage cannot be "played", so a `play` event naming
 * one is a malformed journal, not a cap question.
 */
export async function loadJournalContext(
  db: PgQueryable,
  input: { attemptId: string | null; testVersionId: string },
): Promise<JournalContextRows> {
  const [version, sections, stimuli, questions] = await Promise.all([
    db.query<{ duration_seconds: number }>(
      "SELECT duration_seconds FROM test_version WHERE id = $1",
      [input.testVersionId],
    ),
    db.query<{
      id: string
      ordinal: number
      duration_seconds: number
      navigation: "free" | "forward_only"
      allow_answer_change: boolean
    }>(
      `SELECT id, ordinal, duration_seconds, navigation::text AS navigation, allow_answer_change
         FROM test_section WHERE test_version_id = $1 ORDER BY ordinal`,
      [input.testVersionId],
    ),
    db.query<{ id: string; section_id: string; max_plays: number | null }>(
      `SELECT DISTINCT ON (st.id)
              st.id, ts.id AS section_id,
              COALESCE(st.max_plays, ts.default_max_plays) AS max_plays
         FROM stimulus st
         JOIN question_group qg ON qg.stimulus_id = st.id
         JOIN test_section ts ON ts.id = qg.test_section_id
        WHERE st.test_version_id = $1 AND st.media_asset_id IS NOT NULL
        ORDER BY st.id`,
      [input.testVersionId],
    ),
    db.query<{ id: string; section_id: string; ordinal: number }>(
      `SELECT q.id, ts.id AS section_id, q.ordinal
         FROM question q
         JOIN question_group qg ON qg.id = q.question_group_id
         JOIN test_section ts ON ts.id = qg.test_section_id
        WHERE q.test_version_id = $1`,
      [input.testVersionId],
    ),
  ])

  const [versionRow] = version.rows

  if (!versionRow) {
    throw new Error(`test version ${input.testVersionId} does not exist`)
  }

  let playsUsed: JournalContextRows["playsUsed"] = []
  let sectionStates: JournalContextRows["sectionStates"] = []
  let attemptStartedAt: Date | null = null
  let attemptExpiresAt: Date | null = null

  if (input.attemptId !== null) {
    const [plays, states, attempt] = await Promise.all([
      db.query<{ stimulus_id: string; play_count: number }>(
        "SELECT stimulus_id, play_count FROM stimulus_play WHERE attempt_id = $1",
        [input.attemptId],
      ),
      db.query<{
        test_section_id: string
        entered_at: Date
        expires_at: Date
        completed_at: Date | null
      }>(
        `SELECT test_section_id, entered_at, expires_at, completed_at
           FROM attempt_section WHERE attempt_id = $1`,
        [input.attemptId],
      ),
      db.query<{ started_at: Date | null; expires_at: Date | null }>(
        "SELECT started_at, expires_at FROM attempt WHERE id = $1",
        [input.attemptId],
      ),
    ])

    playsUsed = plays.rows.map((row) => ({
      stimulusId: row.stimulus_id,
      playCount: row.play_count,
    }))
    sectionStates = states.rows.map((row) => ({
      sectionId: row.test_section_id,
      enteredAt: row.entered_at,
      expiresAt: row.expires_at,
      completedAt: row.completed_at,
    }))
    attemptStartedAt = attempt.rows[0]?.started_at ?? null
    attemptExpiresAt = attempt.rows[0]?.expires_at ?? null
  }

  return {
    versionDurationSeconds: versionRow.duration_seconds,
    sections: sections.rows.map((row) => ({
      id: row.id,
      ordinal: row.ordinal,
      durationSeconds: row.duration_seconds,
      navigation: row.navigation,
      allowAnswerChange: row.allow_answer_change,
    })),
    stimuli: stimuli.rows.map((row) => ({
      id: row.id,
      sectionId: row.section_id,
      maxPlays: row.max_plays,
    })),
    questions: questions.rows.map((row) => ({
      id: row.id,
      sectionId: row.section_id,
      ordinal: row.ordinal,
    })),
    playsUsed,
    sectionStates,
    attemptStartedAt,
    attemptExpiresAt,
  }
}
```

In `packages/db/src/index.ts` import from the new file and add to the export lists (values: `advanceJournalCursor, createOfflineAttempt, getJournalCursor, loadJournalContext`; types: `CreateOfflineAttemptOutcome, JournalContextRows`).

- [ ] **Step 5: Run the db tests to verify they pass**

Run: `pnpm --filter @pp/db exec vitest run test/offline-journal-repository.test.ts test/migrate.test.ts && pnpm --filter @pp/db exec tsc --noEmit`
Expected: PASS. (If `migrate.test.ts` asserts the full migration list, add `1016_offline_attempts` to its expectation.)

- [ ] **Step 6: Commit the schema**

```bash
git add packages/db docs/db/schema.sql
git commit -m "feat(db): offline attempt origin and journal cursor"
```

- [ ] **Step 7: Write the request schema**

Create `packages/server/src/attempts/offline-sync-request.schema.ts`:

```ts
import { z } from "zod"

const Uuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "invalid_uuid",
  )

const base = {
  eventSeq: z.number().int().positive(),
  clientAt: z.iso.datetime(),
}

export const OfflineJournalEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...base,
    type: z.literal("start"),
    payload: z.strictObject({ slug: z.string().min(1), testVersionId: Uuid }),
  }),
  z.strictObject({
    ...base,
    type: z.literal("enter_section"),
    payload: z.strictObject({ sectionId: Uuid }),
  }),
  z.strictObject({
    ...base,
    type: z.literal("play"),
    payload: z.strictObject({ stimulusId: Uuid }),
  }),
  z.strictObject({
    ...base,
    type: z.literal("position"),
    payload: z.strictObject({ sectionId: Uuid, questionId: Uuid }),
  }),
  z.strictObject({
    ...base,
    type: z.literal("answer"),
    payload: z.strictObject({
      sectionId: Uuid,
      questionId: Uuid,
      clientInstanceId: z.string().min(1),
      seq: z.number().int().nonnegative(),
      selectedChoiceIds: z.array(Uuid),
      timeSpentMs: z.number().int().nonnegative().max(2_147_483_647).optional(),
    }),
  }),
  z.strictObject({
    ...base,
    type: z.literal("finish_section"),
    payload: z.strictObject({ sectionId: Uuid }),
  }),
])

export type OfflineJournalEvent = z.infer<typeof OfflineJournalEventSchema>

export const OfflineSyncRequestSchema = z.strictObject({
  /** The client-minted uuid; becomes `attempt.id` when the server adopts the attempt. */
  attemptId: Uuid,
  /** The device's clock at send time; the server derives clock skew from it. */
  clientSentAt: z.iso.datetime(),
  events: z.array(OfflineJournalEventSchema).min(1).max(500),
})

export class OfflineSyncRequestDto implements z.infer<
  typeof OfflineSyncRequestSchema
> {
  static readonly schema = OfflineSyncRequestSchema
  declare attemptId: string
  declare clientSentAt: string
  declare events: OfflineJournalEvent[]
}

export type OfflineSyncRequest = z.infer<typeof OfflineSyncRequestSchema>
```

- [ ] **Step 8: Write the failing validator tests**

Create `packages/server/test/offline-journal-validator.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import type { OfflineJournalEvent } from "../src/attempts/offline-sync-request.schema.js"
import {
  validateJournal,
  type JournalContext,
} from "../src/attempts/offline-journal.validator.js"

const RECEIVED = Date.parse("2026-11-22T12:00:00.000Z")
const ago = (seconds: number): string => new Date(RECEIVED - seconds * 1000).toISOString()
const SEC_L = "00000000-0000-4000-8000-0000000000a1"
const SEC_R = "00000000-0000-4000-8000-0000000000a2"
const ST_L = "00000000-0000-4000-8000-0000000000b1"
const QL1 = "00000000-0000-4000-8000-0000000000c1"
const QL2 = "00000000-0000-4000-8000-0000000000c2"
const QR1 = "00000000-0000-4000-8000-0000000000c3"
const VER = "00000000-0000-4000-8000-0000000000d1"

function ctx(over: Partial<JournalContext> = {}): JournalContext {
  return {
    receivedAt: new Date(RECEIVED),
    clientSentAt: new Date(RECEIVED),
    ackedThrough: 0,
    attemptExists: false,
    attemptStartedAt: null,
    attemptExpiresAt: null,
    versionDurationSeconds: 1200,
    sections: new Map([
      [SEC_L, { id: SEC_L, ordinal: 1, durationSeconds: 600, navigation: "forward_only", allowAnswerChange: false }],
      [SEC_R, { id: SEC_R, ordinal: 2, durationSeconds: 600, navigation: "free", allowAnswerChange: true }],
    ]),
    stimuli: new Map([[ST_L, { sectionId: SEC_L, maxPlays: 1 }]]),
    questions: new Map([
      [QL1, { sectionId: SEC_L, ordinal: 1 }],
      [QL2, { sectionId: SEC_L, ordinal: 2 }],
      [QR1, { sectionId: SEC_R, ordinal: 3 }],
    ]),
    playsUsed: new Map(),
    sectionStates: new Map(),
    ...over,
  }
}

const start = (seq: number, s: number): OfflineJournalEvent => ({ eventSeq: seq, type: "start", clientAt: ago(s), payload: { slug: "p3", testVersionId: VER } })
const enter = (seq: number, s: number, sectionId: string): OfflineJournalEvent => ({ eventSeq: seq, type: "enter_section", clientAt: ago(s), payload: { sectionId } })
const play = (seq: number, s: number): OfflineJournalEvent => ({ eventSeq: seq, type: "play", clientAt: ago(s), payload: { stimulusId: ST_L } })
const position = (seq: number, s: number, sectionId: string, questionId: string): OfflineJournalEvent => ({ eventSeq: seq, type: "position", clientAt: ago(s), payload: { sectionId, questionId } })
const answer = (seq: number, s: number, sectionId: string, questionId: string): OfflineJournalEvent => ({
  eventSeq: seq, type: "answer", clientAt: ago(s),
  payload: { sectionId, questionId, clientInstanceId: "dev-1", seq, selectedChoiceIds: ["00000000-0000-4000-8000-0000000000e1"] },
})
const finish = (seq: number, s: number, sectionId: string): OfflineJournalEvent => ({ eventSeq: seq, type: "finish_section", clientAt: ago(s), payload: { sectionId } })

function kinds(result: ReturnType<typeof validateJournal>): string[] {
  if (!result.ok) {
    return [`!${result.code}`]
  }

  return result.planned.map((p) => p.disposition.kind === "rejected" ? `rejected:${p.disposition.reason}` : p.disposition.kind)
}

describe("validateJournal", () => {
  it("accepts a clean journey and plans every event", () => {
    const events = [
      start(1, 1140), enter(2, 1130, SEC_L), play(3, 1120), answer(4, 1110, SEC_L, QL1),
      position(5, 1100, SEC_L, QL2), answer(6, 1090, SEC_L, QL2), finish(7, 1080, SEC_L),
      enter(8, 1070, SEC_R), answer(9, 1060, SEC_R, QR1),
    ]
    const result = validateJournal(events, ctx())

    expect(kinds(result)).toEqual(Array(9).fill("apply"))
  })

  it("ignores events already acknowledged and requires the rest to be contiguous", () => {
    const events = [start(1, 100), enter(2, 90, SEC_L), play(3, 80), answer(4, 70, SEC_L, QL1)]
    const result = validateJournal(events, ctx({ ackedThrough: 2, attemptExists: true }))

    expect(result.ok && result.planned.map((p) => p.event.eventSeq)).toEqual([3, 4])
  })

  it("rejects a gap in eventSeq", () => {
    expect(kinds(validateJournal([start(1, 100), enter(3, 90, SEC_L)], ctx()))).toEqual(["!offline_journal_invalid"])
  })

  it("rejects clientAt going backwards", () => {
    expect(kinds(validateJournal([start(1, 100), enter(2, 200, SEC_L)], ctx()))).toEqual(["!offline_journal_invalid"])
  })

  it("rejects clientAt later than clientSentAt plus tolerance", () => {
    const sentEarlier = ctx({ clientSentAt: new Date(RECEIVED - 600_000) })

    expect(kinds(validateJournal([start(1, 100)], sentEarlier))).toEqual(["!offline_journal_invalid"])
  })

  it("rejects events older than 72 hours", () => {
    expect(kinds(validateJournal([start(1, 73 * 3600)], ctx()))).toEqual(["!offline_journal_invalid"])
  })

  it("normalises a fast device clock instead of rejecting the attempt", () => {
    const deviceAhead = 600_000
    const events: OfflineJournalEvent[] = [
      { eventSeq: 1, type: "start", clientAt: new Date(RECEIVED + deviceAhead - 300_000).toISOString(), payload: { slug: "p3", testVersionId: VER } },
    ]
    const result = validateJournal(events, ctx({ clientSentAt: new Date(RECEIVED + deviceAhead) }))

    expect(result.ok && result.planned[0]?.effectiveAt.toISOString()).toBe(new Date(RECEIVED - 300_000).toISOString())
  })

  it("requires a start event for a new attempt and forbids one for an existing attempt", () => {
    expect(kinds(validateJournal([enter(1, 100, SEC_L)], ctx()))).toEqual(["!offline_journal_invalid"])
    expect(kinds(validateJournal([start(1, 100)], ctx({ attemptExists: true })))).toEqual(["!offline_journal_invalid"])
  })

  it("rejects an unknown section", () => {
    expect(kinds(validateJournal([start(1, 100), enter(2, 90, "00000000-0000-4000-8000-00000000ffff")], ctx()))).toEqual(["!offline_journal_invalid"])
  })

  it("refuses entering a second section while the first is still ticking", () => {
    expect(kinds(validateJournal([start(1, 100), enter(2, 90, SEC_L), enter(3, 80, SEC_R)], ctx()))).toEqual(["!offline_journal_invalid"])
  })

  it("treats a repeated enter of the open section as idempotent", () => {
    expect(kinds(validateJournal([start(1, 100), enter(2, 90, SEC_L), enter(3, 80, SEC_L)], ctx()))).toEqual(["apply", "apply", "apply"])
  })

  it("marks events after the section deadline late", () => {
    // listening entered 60 min ago has a 10-minute clock: an answer 11 minutes in is late.
    const events = [start(1, 3600), enter(2, 3590, SEC_L), answer(3, 3590 - 660, SEC_L, QL1)]

    expect(kinds(validateJournal(events, ctx({ versionDurationSeconds: 7200 })))).toEqual(["apply", "apply", "late"])
  })

  it("marks events after the whole-attempt deadline late even if the section clock remains", () => {
    // 1200 s attempt; reading entered at 1190 s elapsed has 600 s of section clock but only 10 s of attempt.
    const events = [
      start(1, 2000), enter(2, 1990, SEC_L), finish(3, 1980, SEC_L),
      enter(4, 1990 - 1190, SEC_R), answer(5, 1990 - 1210, SEC_R, QR1),
    ]
    const result = validateJournal(events, ctx())

    expect(kinds(result)).toEqual(["apply", "apply", "apply", "apply", "late"])
  })

  it("fails the whole journal when plays exceed the cap", () => {
    const events = [start(1, 100), enter(2, 90, SEC_L), play(3, 80), play(4, 70)]

    expect(validateJournal(events, ctx())).toMatchObject({ ok: false, code: "offline_play_cap_exceeded", eventSeq: 4 })
  })

  it("counts plays the server already recorded", () => {
    const events = [play(1, 70)]
    const state = new Map([[SEC_L, { enteredAt: new Date(RECEIVED - 90_000), expiresAt: new Date(RECEIVED + 500_000), completedAt: null }]])
    const result = validateJournal(events, ctx({
      attemptExists: true,
      attemptStartedAt: new Date(RECEIVED - 90_000),
      attemptExpiresAt: new Date(RECEIVED + 1_000_000),
      sectionStates: state,
      playsUsed: new Map([[ST_L, 1]]),
    }))

    expect(result).toMatchObject({ ok: false, code: "offline_play_cap_exceeded" })
  })

  it("does not count a late play against the cap", () => {
    const events = [start(1, 3600), enter(2, 3590, SEC_L), play(3, 3500), play(4, 3590 - 700)]

    expect(kinds(validateJournal(events, ctx({ versionDurationSeconds: 7200 })))).toEqual(["apply", "apply", "apply", "late"])
  })

  it("rejects moving backwards or answering an earlier question in a forward-only section", () => {
    const events = [
      start(1, 100), enter(2, 90, SEC_L), position(3, 80, SEC_L, QL2),
      position(4, 70, SEC_L, QL1), answer(5, 60, SEC_L, QL1),
    ]

    expect(kinds(validateJournal(events, ctx()))).toEqual([
      "apply", "apply", "apply", "rejected:navigation_locked", "rejected:navigation_locked",
    ])
  })

  it("lets a free section move backwards", () => {
    const events = [
      start(1, 200), enter(2, 190, SEC_L), finish(3, 180, SEC_L), enter(4, 170, SEC_R),
      position(5, 160, SEC_R, QR1), position(6, 150, SEC_R, QR1),
    ]

    expect(kinds(validateJournal(events, ctx())).every((k) => k === "apply")).toBe(true)
  })

  it("treats events after finish_section as late", () => {
    const events = [start(1, 100), enter(2, 90, SEC_L), finish(3, 80, SEC_L), answer(4, 70, SEC_L, QL1)]

    expect(kinds(validateJournal(events, ctx()))).toEqual(["apply", "apply", "apply", "late"])
  })

  it("rejects an event for a section that was never entered", () => {
    expect(kinds(validateJournal([start(1, 100), answer(2, 90, SEC_R, QR1)], ctx()))).toEqual(["apply", "rejected:section_not_entered"])
  })

  it("accepts appended events for a hydrated (already existing) attempt", () => {
    const state = new Map([[SEC_L, { enteredAt: new Date(RECEIVED - 120_000), expiresAt: new Date(RECEIVED + 480_000), completedAt: null }]])
    const result = validateJournal([answer(1, 60, SEC_L, QL1)], ctx({
      attemptExists: true,
      attemptStartedAt: new Date(RECEIVED - 120_000),
      attemptExpiresAt: new Date(RECEIVED + 1_080_000),
      sectionStates: state,
    }))

    expect(kinds(result)).toEqual(["apply"])
  })
})
```

- [ ] **Step 9: Run to verify it fails**

Run: `pnpm --filter @pp/server exec vitest run test/offline-journal-validator.test.ts`
Expected: FAIL — `Cannot find module '../src/attempts/offline-journal.validator.js'`.

- [ ] **Step 10: Implement the validator**

Create `packages/server/src/attempts/offline-journal.validator.ts`:

```ts
import type { OfflineJournalEvent } from "./offline-sync-request.schema.js"

/** A device clock may read this far past its own `clientSentAt`: ordinary jitter. */
export const FUTURE_TOLERANCE_MS = 60_000
/** Beyond this the attempt's content and the student's intent are both stale. */
export const MAX_JOURNAL_AGE_MS = 72 * 60 * 60 * 1000

export interface JournalSection {
  readonly id: string
  readonly ordinal: number
  readonly durationSeconds: number
  readonly navigation: "free" | "forward_only"
  readonly allowAnswerChange: boolean
}

export interface JournalStimulus {
  readonly sectionId: string
  readonly maxPlays: number | null
}

export interface JournalQuestion {
  readonly sectionId: string
  readonly ordinal: number
}

export interface JournalSectionState {
  readonly enteredAt: Date
  readonly expiresAt: Date
  readonly completedAt: Date | null
}

export interface JournalContext {
  readonly receivedAt: Date
  readonly clientSentAt: Date
  readonly ackedThrough: number
  readonly attemptExists: boolean
  readonly attemptStartedAt: Date | null
  readonly attemptExpiresAt: Date | null
  readonly versionDurationSeconds: number
  readonly sections: ReadonlyMap<string, JournalSection>
  readonly stimuli: ReadonlyMap<string, JournalStimulus>
  readonly questions: ReadonlyMap<string, JournalQuestion>
  readonly playsUsed: ReadonlyMap<string, number>
  readonly sectionStates: ReadonlyMap<string, JournalSectionState>
}

export type Disposition =
  | { readonly kind: "apply" }
  | { readonly kind: "late" }
  | { readonly kind: "rejected"; readonly reason: string }

export interface PlannedEvent {
  readonly event: OfflineJournalEvent
  readonly effectiveAt: Date
  readonly disposition: Disposition
}

export type JournalValidation =
  | { readonly ok: true; readonly planned: readonly PlannedEvent[] }
  | {
      readonly ok: false
      readonly code: "offline_journal_invalid" | "offline_play_cap_exceeded"
      readonly reason: string
      readonly eventSeq: number | null
    }

const APPLY: Disposition = { kind: "apply" }
const LATE: Disposition = { kind: "late" }
const rejected = (reason: string): Disposition => ({ kind: "rejected", reason })

/**
 * Pure replay planner for an offline journal (spec D6). It never touches the
 * database: the caller passes in everything it needs and gets back either a
 * structural failure (the WHOLE request is refused and captured) or one
 * disposition per event.
 *
 * Two classes of problem, deliberately handled differently:
 *   - Structural (gaps, time travel, unknown ids, two open sections, play cap):
 *     a genuine client never produces these, and applying a half-valid history
 *     would corrupt the attempt, so the request fails as a unit.
 *   - Per-event (late, navigation-locked, section not entered): a genuine
 *     client CAN produce these -- a clock that ran out mid-flight -- so the
 *     event is kept (as late/rejected) and the rest of the journal still lands.
 *
 * `effectiveAt` shifts every client timestamp by the device's clock skew
 * (`receivedAt - clientSentAt`), so a phone whose clock is merely wrong is not
 * punished; only the RELATIVE timing it reports can matter.
 */
export function validateJournal(
  allEvents: readonly OfflineJournalEvent[],
  ctx: JournalContext,
): JournalValidation {
  const events = allEvents.filter((event) => event.eventSeq > ctx.ackedThrough)

  if (events.length === 0) {
    return { ok: true, planned: [] }
  }

  const fail = (reason: string, eventSeq: number | null): JournalValidation => ({
    ok: false,
    code: "offline_journal_invalid",
    reason,
    eventSeq,
  })

  const skewMs = ctx.receivedAt.getTime() - ctx.clientSentAt.getTime()
  const earliest = ctx.receivedAt.getTime() - MAX_JOURNAL_AGE_MS
  const effective: Date[] = []
  let previous = Number.NEGATIVE_INFINITY

  for (const [index, event] of events.entries()) {
    const expectedSeq = ctx.ackedThrough + 1 + index

    if (event.eventSeq !== expectedSeq) {
      return fail(`expected eventSeq ${expectedSeq}, got ${event.eventSeq}`, event.eventSeq)
    }

    const clientMs = Date.parse(event.clientAt)

    if (clientMs > ctx.clientSentAt.getTime() + FUTURE_TOLERANCE_MS) {
      return fail("clientAt is later than clientSentAt", event.eventSeq)
    }

    const effectiveMs = clientMs + skewMs

    if (effectiveMs < earliest) {
      return fail("event is older than 72 hours", event.eventSeq)
    }

    if (effectiveMs < previous) {
      return fail("clientAt goes backwards", event.eventSeq)
    }

    previous = effectiveMs
    effective.push(new Date(effectiveMs))
  }

  const starts = events.filter((event) => event.type === "start")
  const [first] = events

  if (!ctx.attemptExists && first.type !== "start") {
    return fail("a new attempt must begin with a start event", first.eventSeq)
  }

  if (ctx.attemptExists && starts.length > 0) {
    return fail("start event for an attempt that already exists", starts[0].eventSeq)
  }

  if (starts.length > 1) {
    return fail("more than one start event", starts[1].eventSeq)
  }

  const states = new Map(ctx.sectionStates)
  const plays = new Map(ctx.playsUsed)
  const lastPosition = new Map<string, number>()
  let attemptStartedAt = ctx.attemptStartedAt
  let attemptDeadline = ctx.attemptExpiresAt
  const planned: PlannedEvent[] = []

  const attemptOver = (at: Date): boolean =>
    attemptDeadline !== null && at.getTime() >= attemptDeadline.getTime()
  const sectionOver = (state: JournalSectionState, at: Date): boolean =>
    state.completedAt !== null || at.getTime() >= state.expiresAt.getTime()

  for (const [index, event] of events.entries()) {
    const at = effective[index]
    let disposition: Disposition = APPLY

    switch (event.type) {
      case "start":
        break

      case "enter_section": {
        const section = ctx.sections.get(event.payload.sectionId)

        if (!section) {
          return fail("unknown section", event.eventSeq)
        }

        if (attemptOver(at)) {
          disposition = LATE

          break
        }

        const existing = states.get(section.id)

        if (existing && !sectionOver(existing, at)) {
          break
        }

        if (existing) {
          disposition = rejected("section_already_entered")

          break
        }

        const ticking = [...states.entries()].find(
          ([id, state]) => id !== section.id && !sectionOver(state, at),
        )

        if (ticking) {
          return fail("a previous section is still open", event.eventSeq)
        }

        if (attemptStartedAt === null) {
          attemptStartedAt = at
          attemptDeadline = new Date(at.getTime() + ctx.versionDurationSeconds * 1000)
        }

        states.set(section.id, {
          enteredAt: at,
          expiresAt: new Date(at.getTime() + section.durationSeconds * 1000),
          completedAt: null,
        })

        break
      }

      case "play": {
        const stimulus = ctx.stimuli.get(event.payload.stimulusId)

        if (!stimulus) {
          return fail("unknown stimulus", event.eventSeq)
        }

        const state = states.get(stimulus.sectionId)

        if (!state) {
          disposition = rejected("section_not_entered")

          break
        }

        if (attemptOver(at) || sectionOver(state, at)) {
          disposition = LATE

          break
        }

        const used = (plays.get(event.payload.stimulusId) ?? 0) + 1

        plays.set(event.payload.stimulusId, used)

        if (stimulus.maxPlays !== null && used > stimulus.maxPlays) {
          return {
            ok: false,
            code: "offline_play_cap_exceeded",
            reason: `stimulus ${event.payload.stimulusId} played ${used} times, cap ${stimulus.maxPlays}`,
            eventSeq: event.eventSeq,
          }
        }

        break
      }

      case "position":
      case "answer": {
        const section = ctx.sections.get(event.payload.sectionId)
        const question = ctx.questions.get(event.payload.questionId)

        if (!section || !question || question.sectionId !== section.id) {
          return fail("question does not belong to the section", event.eventSeq)
        }

        const state = states.get(section.id)

        if (!state) {
          disposition = rejected("section_not_entered")

          break
        }

        if (attemptOver(at) || sectionOver(state, at)) {
          disposition = LATE

          break
        }

        const last = lastPosition.get(section.id)

        if (
          section.navigation === "forward_only" &&
          last !== undefined &&
          question.ordinal < last
        ) {
          disposition = rejected("navigation_locked")

          break
        }

        if (event.type === "position") {
          lastPosition.set(section.id, question.ordinal)
        }

        break
      }

      case "finish_section": {
        const state = states.get(event.payload.sectionId)

        if (!state) {
          disposition = rejected("section_not_entered")
        } else if (attemptOver(at)) {
          disposition = LATE
        } else if (state.completedAt === null) {
          states.set(event.payload.sectionId, { ...state, completedAt: at })
        }

        break
      }
    }

    planned.push({ event, effectiveAt: at, disposition })
  }

  return { ok: true, planned }
}
```

- [ ] **Step 11: Run to verify it passes**

Run: `pnpm --filter @pp/server exec vitest run test/offline-journal-validator.test.ts && pnpm --filter @pp/server exec tsc --noEmit`
Expected: 21 tests PASS, typecheck clean. If a "late" case fails, recompute the arithmetic from the comment: attempt deadline = first-enter + `versionDurationSeconds`; section deadline = enter + section duration.

- [ ] **Step 12: Commit**

```bash
git add packages/server
git commit -m "feat(server): pure offline journal validator and sync request schema"
```

---

### Task 18: Server — `POST /api/attempts/offline-sync`

**What this builds.** The endpoint that adopts and replays a journal. It reuses the **existing** repository functions with `now = effectiveAt`, so expiry, grading and finalisation rules are not re-implemented. It is idempotent (cursor), serialised per attempt (advisory lock), and keeps everything it refuses in `failed_write` (spec §5 rule 4).

**Files:**
- Create: `packages/server/src/attempts/offline-sync.service.ts`
- Create: `packages/server/src/attempts/offline-sync.controller.ts`
- Modify: `packages/server/src/attempts/attempts.module.ts`
- Test: `packages/server/test/offline-sync.e2e.test.ts`
- Modify: `docs/api/openapi.yaml`

**Interfaces:**
- Consumes: Task 17's `validateJournal`, `OfflineSyncRequestDto`, `getJournalCursor`, `advanceJournalCursor`, `createOfflineAttempt`, `loadJournalContext`; existing `enterSection`, `claimPlay`, `setPosition`, `finishSection`, `writeResponse`, `loadOwnedAttempt`, `loadRunningOwnedAttempt`, `insertFailedWrite`, `resolveOwnedAttempt`, `ProblemException`, `seedOfflineFixture` (Task 14).
- Produces:
  ```ts
  export interface OfflineSyncResult {
    attemptId: string
    ackedThrough: number      // highest eventSeq the server now holds for this attempt
    applied: number           // events applied (including answers)
    late: number              // recorded, not applied: after a section/attempt deadline
    rejected: number          // recorded in failed_write, not applied
    answersAcked: number      // answer events applied or ignored_stale (drives the client toast)
    finalized: { status: "expired" | "submitted"; resultUrl: string } | null
  }
  // POST /api/attempts/offline-sync  200 OfflineSyncResult · 403 not_your_attempt · 409 offline_play_cap_exceeded | offline_attempt_conflict · 422 offline_journal_invalid
  ```

- [ ] **Step 1: Write the failing e2e tests**

Create `packages/server/test/offline-sync.e2e.test.ts`:

```ts
import type { PgPool } from "@liam-workspace/node-postgres"
import { randomUUID } from "node:crypto"
import request from "supertest"
import type { App } from "supertest/types.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { REQUEST_POOL } from "../src/database/tokens.js"
import type { OfflineJournalEvent } from "../src/attempts/offline-sync-request.schema.js"
import { createTestApp, type TestApp } from "./helpers/app.js"
import { seedOfflineFixture, type OfflineFixture } from "./helpers/offline-fixture.js"

const NOW = new Date("2026-11-22T12:00:00.000Z")
const ago = (seconds: number): string => new Date(NOW.getTime() - seconds * 1000).toISOString()

interface SyncBody {
  attemptId: string
  ackedThrough: number
  applied: number
  late: number
  rejected: number
  answersAcked: number
  finalized: { status: string; resultUrl: string } | null
}

describe("POST /attempts/offline-sync", () => {
  let app: TestApp | undefined = undefined
  let fx: OfflineFixture | undefined = undefined
  let pool: PgPool | undefined = undefined

  beforeAll(async () => {
    app = await createTestApp({ now: NOW })
    pool = app.get<PgPool>(REQUEST_POOL)
    fx = await seedOfflineFixture(app, "offline-sync")
  })

  afterAll(async () => {
    await app?.close()
  })

  const a = (): TestApp => {
    if (!app) {
      throw new Error("not ready")
    }

    return app
  }
  const f = (): OfflineFixture => {
    if (!fx) {
      throw new Error("not ready")
    }

    return fx
  }
  const db = (): PgPool => {
    if (!pool) {
      throw new Error("not ready")
    }

    return pool
  }

  async function student(sub: string): Promise<string> {
    const token = await a().mint({ sub, email: `${sub}@example.com` })

    await request(a().http.getHttpServer() as App)
      .post("/api/session")
      .set("Authorization", `Bearer ${token}`)
      .expect(201)

    return token
  }

  function sync(token: string, attemptId: string, events: OfflineJournalEvent[], sentAt = NOW.toISOString()) {
    return request(a().http.getHttpServer() as App)
      .post("/api/attempts/offline-sync")
      .set("Authorization", `Bearer ${token}`)
      .send({ attemptId, clientSentAt: sentAt, events })
  }

  /** start → listening (play, 2 answers, move, finish) → reading (1 answer), all within the last 20 minutes. */
  function journey(attemptId: string): OfflineJournalEvent[] {
    const { listening, reading } = f()
    const [l1, l2] = listening.questions
    const [r1] = reading.questions
    const at = (s: number, seq: number) => ({ eventSeq: seq, clientAt: ago(s) })

    if (!l1 || !l2 || !r1) {
      throw new Error("fixture questions missing")
    }

    return [
      { ...at(1140, 1), type: "start", payload: { slug: f().slug, testVersionId: f().versionId } },
      { ...at(1130, 2), type: "enter_section", payload: { sectionId: listening.sectionId } },
      { ...at(1120, 3), type: "play", payload: { stimulusId: listening.stimulusId } },
      { ...at(1110, 4), type: "answer", payload: { sectionId: listening.sectionId, questionId: l1.id, clientInstanceId: attemptId, seq: 1, selectedChoiceIds: [l1.choiceIds[0] ?? ""] } },
      { ...at(1100, 5), type: "position", payload: { sectionId: listening.sectionId, questionId: l2.id } },
      { ...at(1090, 6), type: "answer", payload: { sectionId: listening.sectionId, questionId: l2.id, clientInstanceId: attemptId, seq: 2, selectedChoiceIds: [l2.choiceIds[0] ?? ""] } },
      { ...at(1080, 7), type: "finish_section", payload: { sectionId: listening.sectionId } },
      { ...at(1070, 8), type: "enter_section", payload: { sectionId: reading.sectionId } },
      { ...at(1060, 9), type: "answer", payload: { sectionId: reading.sectionId, questionId: r1.id, clientInstanceId: attemptId, seq: 3, selectedChoiceIds: [r1.choiceIds[0] ?? ""] } },
    ]
  }

  it("adopts the client uuid, replays the whole journey, and the attempt can then be submitted", async () => {
    const token = await student("sync-happy")
    const attemptId = randomUUID()
    const res = await sync(token, attemptId, journey(attemptId)).expect(200)
    const body = res.body as SyncBody

    expect(body).toMatchObject({ attemptId, ackedThrough: 9, applied: 9, late: 0, rejected: 0, answersAcked: 3, finalized: null })

    const { rows } = await db().query<{ origin: string; status: string }>(
      "SELECT origin, status FROM attempt WHERE id = $1",
      [attemptId],
    )
    const plays = await db().query<{ play_count: number }>(
      "SELECT play_count FROM stimulus_play WHERE attempt_id = $1",
      [attemptId],
    )

    expect(rows[0]).toEqual({ origin: "offline", status: "in_progress" })
    expect(plays.rows[0]?.play_count).toBe(1)

    await request(a().http.getHttpServer() as App)
      .post(`/api/attempts/${attemptId}/submit`)
      .set("Authorization", `Bearer ${token}`)
      .send({ clientInstanceId: attemptId, responses: [] })
      .expect(201)
    const result = await request(a().http.getHttpServer() as App)
      .get(`/api/attempts/${attemptId}/result`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200)

    expect((result.body as { score: { correct: number } }).score.correct).toBe(3)
  })

  it("is idempotent and supports incremental sync via the cursor", async () => {
    const token = await student("sync-incremental")
    const attemptId = randomUUID()
    const events = journey(attemptId)
    const first = await sync(token, attemptId, events.slice(0, 4)).expect(200)
    const second = await sync(token, attemptId, events).expect(200)
    const again = await sync(token, attemptId, events).expect(200)

    expect((first.body as SyncBody).ackedThrough).toBe(4)
    expect(second.body).toMatchObject({ ackedThrough: 9, applied: 5 })
    expect(again.body).toMatchObject({ ackedThrough: 9, applied: 0 })

    const plays = await db().query<{ play_count: number }>(
      "SELECT play_count FROM stimulus_play WHERE attempt_id = $1",
      [attemptId],
    )

    expect(plays.rows[0]?.play_count).toBe(1)
  })

  it("refuses a journal that plays a capped recording twice, creates nothing, and captures it", async () => {
    const token = await student("sync-playcap")
    const attemptId = randomUUID()
    const events = journey(attemptId).slice(0, 3)
    const second: OfflineJournalEvent = { eventSeq: 4, clientAt: ago(1115), type: "play", payload: { stimulusId: f().listening.stimulusId } }
    const res = await sync(token, attemptId, [...events, second]).expect(409)

    expect((res.body as { type: string }).type).toBe("offline_play_cap_exceeded")

    const attempts = await db().query("SELECT 1 FROM attempt WHERE id = $1", [attemptId])
    const captured = await db().query<{ reason: string }>(
      "SELECT reason FROM failed_write WHERE attempt_id = $1",
      [attemptId],
    )

    expect(attempts.rows).toHaveLength(0)
    expect(captured.rows.map((r) => r.reason)).toContain("offline_play_cap_exceeded")
  })

  it("records an answer after the section deadline as late and does not apply it", async () => {
    const token = await student("sync-late")
    const attemptId = randomUUID()
    const { listening } = f()
    const [l1, l2] = listening.questions

    if (!l1 || !l2) {
      throw new Error("fixture questions missing")
    }

    const events: OfflineJournalEvent[] = [
      { eventSeq: 1, clientAt: ago(900), type: "start", payload: { slug: f().slug, testVersionId: f().versionId } },
      { eventSeq: 2, clientAt: ago(890), type: "enter_section", payload: { sectionId: listening.sectionId } },
      { eventSeq: 3, clientAt: ago(800), type: "answer", payload: { sectionId: listening.sectionId, questionId: l1.id, clientInstanceId: attemptId, seq: 1, selectedChoiceIds: [l1.choiceIds[0] ?? ""] } },
      // 890 - 600 = 290 s ago is the section deadline; an answer 100 s ago is after it.
      { eventSeq: 4, clientAt: ago(100), type: "answer", payload: { sectionId: listening.sectionId, questionId: l2.id, clientInstanceId: attemptId, seq: 2, selectedChoiceIds: [l2.choiceIds[0] ?? ""] } },
    ]
    const res = await sync(token, attemptId, events).expect(200)

    expect(res.body).toMatchObject({ late: 1, answersAcked: 1 })

    const answered = await db().query("SELECT 1 FROM response WHERE attempt_id = $1", [attemptId])

    expect(answered.rows).toHaveLength(1)
  })

  it("403s when the attempt id belongs to another student", async () => {
    const owner = await student("sync-owner")
    const intruder = await student("sync-intruder")
    const attemptId = randomUUID()

    await sync(owner, attemptId, journey(attemptId)).expect(200)
    await sync(intruder, attemptId, journey(attemptId)).expect(403)
  })

  it("409s when the student already has a live timed attempt on the same version", async () => {
    const token = await student("sync-conflict")

    const started = await request(a().http.getHttpServer() as App)
      .post("/api/attempts")
      .set("Authorization", `Bearer ${token}`)
      .send({ slug: f().slug })
    const { id } = started.body as { id: string }

    await request(a().http.getHttpServer() as App)
      .post(`/api/attempts/${id}/sections/${f().listening.sectionId}/enter`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200)

    const attemptId = randomUUID()
    const res = await sync(token, attemptId, journey(attemptId)).expect(409)

    expect((res.body as { type: string }).type).toBe("offline_attempt_conflict")
  })

  it("finalizes as expired when the whole-attempt clock ran out while offline", async () => {
    const token = await student("sync-expired")
    const attemptId = randomUUID()
    const { listening } = f()
    const [l1] = listening.questions

    if (!l1) {
      throw new Error("fixture questions missing")
    }

    const events: OfflineJournalEvent[] = [
      { eventSeq: 1, clientAt: ago(3 * 3600), type: "start", payload: { slug: f().slug, testVersionId: f().versionId } },
      { eventSeq: 2, clientAt: ago(3 * 3600 - 10), type: "enter_section", payload: { sectionId: listening.sectionId } },
      { eventSeq: 3, clientAt: ago(3 * 3600 - 60), type: "answer", payload: { sectionId: listening.sectionId, questionId: l1.id, clientInstanceId: attemptId, seq: 1, selectedChoiceIds: [l1.choiceIds[0] ?? ""] } },
    ]
    const res = await sync(token, attemptId, events).expect(200)
    const body = res.body as SyncBody

    expect(body.finalized).toMatchObject({ status: "expired", resultUrl: `/attempts/${attemptId}/result` })

    await request(a().http.getHttpServer() as App)
      .get(`/api/attempts/${attemptId}/result`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
  })

  it("422s a journal with a gap and 401s without a token", async () => {
    const token = await student("sync-invalid")
    const attemptId = randomUUID()
    const events = journey(attemptId)
    const gap = [events[0], events[2]].filter((e): e is OfflineJournalEvent => e !== undefined)
    const res = await sync(token, attemptId, gap).expect(422)

    expect((res.body as { type: string }).type).toBe("offline_journal_invalid")

    await request(a().http.getHttpServer() as App)
      .post("/api/attempts/offline-sync")
      .send({ attemptId, clientSentAt: NOW.toISOString(), events })
      .expect(401)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @pp/server exec vitest run test/offline-sync.e2e.test.ts`
Expected: FAIL — every sync call returns 404 (no such route).

- [ ] **Step 3: Implement the service**

Create `packages/server/src/attempts/offline-sync.service.ts`:

```ts
import {
  withTransaction,
  type PgPool,
} from "@liam-workspace/node-postgres"
import { HttpStatus, Inject, Injectable } from "@nestjs/common"
import type { Clock } from "@pp/common"
import {
  AttemptNotInProgressError,
  advanceJournalCursor,
  claimPlay as claimPlayRow,
  createOfflineAttempt,
  enterSection as enterSectionRow,
  finishSection as finishSectionRow,
  getJournalCursor,
  insertFailedWrite,
  loadJournalContext,
  loadOwnedAttempt,
  loadRunningOwnedAttempt,
  SectionExpiredError,
  setPosition as setPositionRow,
  writeResponse,
  type AttemptRow,
  type JournalContextRows,
} from "@pp/db"
import { CLOCK, REQUEST_POOL } from "../database/tokens.js"
import type { CapturedRequest } from "../http/raw-body-json.middleware.js"
import {
  validateJournal,
  type JournalContext,
  type PlannedEvent,
} from "./offline-journal.validator.js"
import type {
  OfflineJournalEvent,
  OfflineSyncRequest,
} from "./offline-sync-request.schema.js"
import { resolveOwnedAttempt } from "./ownership.js"
import { ProblemException } from "./problem.exception.js"

export interface OfflineSyncResult {
  attemptId: string
  ackedThrough: number
  applied: number
  late: number
  rejected: number
  answersAcked: number
  finalized: { status: "expired" | "submitted"; resultUrl: string } | null
}

type EventOutcome =
  | { kind: "applied" }
  | { kind: "answer" }
  | { kind: "late" }
  | { kind: "rejected"; reason: string }
  | { kind: "attempt_over" }

const ROUTE = "POST /api/attempts/offline-sync"

function toContext(
  rows: JournalContextRows,
  input: {
    receivedAt: Date
    clientSentAt: Date
    ackedThrough: number
    attemptExists: boolean
  },
): JournalContext {
  return {
    ...input,
    attemptStartedAt: rows.attemptStartedAt,
    attemptExpiresAt: rows.attemptExpiresAt,
    versionDurationSeconds: rows.versionDurationSeconds,
    sections: new Map(rows.sections.map((s) => [s.id, s])),
    stimuli: new Map(rows.stimuli.map((s) => [s.id, s])),
    questions: new Map(rows.questions.map((q) => [q.id, q])),
    playsUsed: new Map(rows.playsUsed.map((p) => [p.stimulusId, p.playCount])),
    sectionStates: new Map(rows.sectionStates.map((s) => [s.sectionId, s])),
  }
}

function forbidden(): ProblemException {
  return new ProblemException({
    type: "not_your_attempt",
    title: "The attempt belongs to another student.",
    status: HttpStatus.FORBIDDEN,
  })
}

@Injectable()
export class OfflineSyncService {
  constructor(
    @Inject(REQUEST_POOL) private readonly pool: PgPool,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async sync(
    subjectClaim: string,
    body: OfflineSyncRequest,
    req: CapturedRequest,
  ): Promise<OfflineSyncResult> {
    const receivedAt = this.clock.now()

    // One sync per attempt at a time. The lock is held by this outer
    // transaction's connection; the repository calls below use OTHER pool
    // connections on purpose -- they each own a transaction, and a competing
    // sync for the same attempt simply waits here until this one commits.
    return withTransaction(this.pool, async (lock) => {
      await lock.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [body.attemptId],
      )

      return this.replay(subjectClaim, body, req, receivedAt)
    })
  }

  private async replay(
    subjectClaim: string,
    body: OfflineSyncRequest,
    req: CapturedRequest,
    receivedAt: Date,
  ): Promise<OfflineSyncResult> {
    const owned = await resolveOwnedAttempt(this.pool, {
      attemptId: body.attemptId,
      subjectClaim,
    })

    if (owned.kind === "forbidden") {
      throw forbidden()
    }

    const studentId = owned.kind === "ok" ? owned.studentId : await this.studentIdOf(subjectClaim)
    const attempt: AttemptRow | null =
      owned.kind === "ok"
        ? await loadOwnedAttempt(this.pool, { attemptId: body.attemptId, studentId })
        : null
    const [first] = body.events
    const testVersionId =
      attempt?.testVersionId ??
      (first?.type === "start" ? first.payload.testVersionId : null)

    if (testVersionId === null) {
      throw await this.refuse(req, body, receivedAt, "offline_journal_invalid", 422, "a new attempt must begin with a start event")
    }

    const lastSeq = body.events.at(-1)?.eventSeq ?? 0

    if (attempt && attempt.status !== "in_progress") {
      // Already over: nothing can be applied. Advance the cursor so the client
      // stops resending, and tell it where the result lives.
      await advanceJournalCursor(this.pool, attempt.id, lastSeq)

      return {
        attemptId: attempt.id,
        ackedThrough: lastSeq,
        applied: 0,
        late: body.events.length,
        rejected: 0,
        answersAcked: 0,
        finalized: {
          status: attempt.status,
          resultUrl: `/attempts/${attempt.id}/result`,
        },
      }
    }

    const cursor = attempt ? await getJournalCursor(this.pool, attempt.id) : 0
    const rows = await loadJournalContext(this.pool, {
      attemptId: attempt ? attempt.id : null,
      testVersionId,
    })
    const validation = validateJournal(
      body.events,
      toContext(rows, {
        receivedAt,
        clientSentAt: new Date(body.clientSentAt),
        ackedThrough: cursor,
        attemptExists: attempt !== null,
      }),
    )

    if (!validation.ok) {
      throw await this.refuse(
        req,
        body,
        receivedAt,
        validation.code,
        validation.code === "offline_play_cap_exceeded" ? 409 : 422,
        validation.reason,
      )
    }

    const sectionRules = new Map(rows.sections.map((s) => [s.id, s]))
    const tally = { applied: 0, late: 0, rejected: 0, answersAcked: 0 }
    let ackedThrough = cursor
    let attemptOver = false

    for (const planned of validation.planned) {
      const { event } = planned
      let outcome: EventOutcome

      if (attemptOver || planned.disposition.kind === "late") {
        outcome = { kind: "late" }
      } else if (planned.disposition.kind === "rejected") {
        outcome = { kind: "rejected", reason: planned.disposition.reason }
      } else {
        // eslint-disable-next-line no-await-in-loop
        outcome = await this.applyEvent({
          planned,
          attemptId: body.attemptId,
          studentId,
          testVersionId,
          allowAnswerChange: (sectionId) => sectionRules.get(sectionId)?.allowAnswerChange ?? true,
          req,
          body,
          receivedAt,
        })
      }

      switch (outcome.kind) {
        case "applied":
          tally.applied += 1
          break

        case "answer":
          tally.applied += 1
          tally.answersAcked += 1
          break

        case "late":
          tally.late += 1
          break

        case "rejected":
          tally.rejected += 1
          // eslint-disable-next-line no-await-in-loop
          await this.capture(req, body, receivedAt, `offline_${outcome.reason}`, event)
          break

        case "attempt_over":
          tally.late += 1
          attemptOver = true
          break
      }

      ackedThrough = event.eventSeq
      // eslint-disable-next-line no-await-in-loop
      await advanceJournalCursor(this.pool, body.attemptId, ackedThrough)
    }

    // Lazy expiry: if the whole-attempt deadline has passed by NOW, finalize
    // it as the live routes would on their next touch, so the result exists.
    const running = await loadRunningOwnedAttempt(this.pool, {
      attemptId: body.attemptId,
      studentId,
      now: receivedAt,
    })

    return {
      attemptId: body.attemptId,
      ackedThrough,
      ...tally,
      finalized:
        running.attempt === null && running.finalized
          ? {
              status: "expired",
              resultUrl: `/attempts/${body.attemptId}/result`,
            }
          : null,
    }
  }

  private async applyEvent(input: {
    planned: PlannedEvent
    attemptId: string
    studentId: string
    testVersionId: string
    allowAnswerChange: (sectionId: string) => boolean
    req: CapturedRequest
    body: OfflineSyncRequest
    receivedAt: Date
  }): Promise<EventOutcome> {
    const { planned, attemptId, studentId, testVersionId } = input
    const { event, effectiveAt: now } = planned

    try {
      switch (event.type) {
        case "start": {
          const created = await createOfflineAttempt(this.pool, {
            attemptId,
            studentId,
            testVersionId,
            slug: event.payload.slug,
            now,
          })

          if (created.kind === "conflict") {
            throw await this.refuse(input.req, input.body, input.receivedAt, "offline_attempt_conflict", 409, "a live attempt already exists for this test")
          }

          if (created.kind === "version_unavailable") {
            throw await this.refuse(input.req, input.body, input.receivedAt, "offline_journal_invalid", 422, "the test version is not available")
          }

          return { kind: "applied" }
        }

        case "enter_section": {
          const entered = await enterSectionRow(this.pool, {
            attemptId,
            sectionId: event.payload.sectionId,
            now,
          })

          return entered.ok
            ? { kind: "applied" }
            : { kind: "rejected", reason: entered.reason }
        }

        case "play": {
          const claimed = await claimPlayRow(this.pool, {
            attemptId,
            stimulusId: event.payload.stimulusId,
            testVersionId,
            now,
          })

          return claimed.ok
            ? { kind: "applied" }
            : { kind: "rejected", reason: claimed.reason }
        }

        case "position": {
          try {
            const moved = await setPositionRow(this.pool, {
              attemptId,
              sectionId: event.payload.sectionId,
              questionId: event.payload.questionId,
              now,
            })

            return moved.ok
              ? { kind: "applied" }
              : { kind: "rejected", reason: moved.reason }
          } catch (error) {
            if (error instanceof SectionExpiredError) {
              return { kind: "late" }
            }

            throw error
          }
        }

        case "answer": {
          const written = await writeResponse(this.pool, {
            attemptId,
            questionId: event.payload.questionId,
            testVersionId,
            clientInstanceId: event.payload.clientInstanceId,
            seq: event.payload.seq,
            selectedChoiceIds: event.payload.selectedChoiceIds,
            answeredAt: now,
            timeSpentMs: event.payload.timeSpentMs ?? null,
            allowAnswerChange: input.allowAnswerChange(event.payload.sectionId),
            now,
          })

          if (written.kind === "rejected") {
            return { kind: "rejected", reason: written.reason }
          }

          return { kind: "answer" }
        }

        case "finish_section": {
          const finished = await finishSectionRow(this.pool, {
            attemptId,
            sectionId: event.payload.sectionId,
            now,
            applyRemainder: () => Promise.resolve([]),
          })

          if (finished.kind === "finished") {
            return { kind: "applied" }
          }

          return finished.kind === "already_expired"
            ? { kind: "attempt_over" }
            : { kind: "rejected", reason: finished.kind }
        }
      }
    } catch (error) {
      if (error instanceof ProblemException) {
        throw error
      }

      if (error instanceof AttemptNotInProgressError) {
        return { kind: "attempt_over" }
      }

      // Anything unclassified: keep the event, tell the client to retry. The
      // cursor was NOT advanced past this event, so the retry replays it.
      const capturedAs = await this.capture(
        input.req,
        input.body,
        input.receivedAt,
        `db_error:${(error as { code?: string }).code ?? "unknown"}`,
        event,
      )

      throw new ProblemException({
        type: "unexpected_error",
        title: "The journal could not be applied because of an unexpected server error.",
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        retryable: true,
        capturedAs,
      })
    }
  }

  private async studentIdOf(subjectClaim: string): Promise<string> {
    const { rows } = await this.pool.query<{ id: string }>(
      "SELECT id FROM student WHERE subject_claim = $1",
      [subjectClaim],
    )

    if (rows.length === 0) {
      throw forbidden()
    }

    return rows[0].id
  }

  private async capture(
    req: CapturedRequest,
    body: OfflineSyncRequest,
    receivedAt: Date,
    reason: string,
    event: OfflineJournalEvent | null,
  ): Promise<string> {
    const rawBody = event
      ? JSON.stringify(event)
      : (req.rawBody?.toString("utf8") ?? JSON.stringify(body))
    const captured = await insertFailedWrite(this.pool, {
      attemptId: body.attemptId,
      route: event ? `${ROUTE} (event)` : ROUTE,
      reason,
      rawBody,
      byteSize: Buffer.byteLength(rawBody),
      clientVersion: null,
      clientInstanceId:
        event?.type === "answer" ? event.payload.clientInstanceId : null,
      now: receivedAt,
    })

    return captured.id
  }

  private async refuse(
    req: CapturedRequest,
    body: OfflineSyncRequest,
    receivedAt: Date,
    type: "offline_journal_invalid" | "offline_play_cap_exceeded" | "offline_attempt_conflict",
    status: 409 | 422,
    detail: string,
  ): Promise<ProblemException> {
    const capturedAs = await this.capture(req, body, receivedAt, type, null)

    return new ProblemException({
      type,
      title: detail,
      status,
      detail,
      retryable: false,
      capturedAs,
    })
  }
}
```

Note for the implementer: `writeResponse`, `claimPlay`, `enterSection`, `setPosition`, `finishSection`, `insertFailedWrite` and `SectionExpiredError` are already exported from `@pp/db` (`packages/db/src/index.ts`); confirm `writeResponse` and `insertFailedWrite` are in its value-export list and add them if not.

- [ ] **Step 4: Controller and module**

Create `packages/server/src/attempts/offline-sync.controller.ts`:

```ts
import type { JwtClaims } from "@liam-workspace/node-auth-server"
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseFilters,
  UseGuards,
} from "@nestjs/common"
import { CurrentStudent } from "../auth/current-student.decorator.js"
import { JwksGuard } from "../auth/jwks.guard.js"
import type { CapturedRequest } from "../http/raw-body-json.middleware.js"
import { OfflineSyncRequestDto } from "./offline-sync-request.schema.js"
import {
  OfflineSyncService,
  type OfflineSyncResult,
} from "./offline-sync.service.js"
import { ProblemException } from "./problem.exception.js"
import { ProblemExceptionFilter } from "./problem.filter.js"

@Controller("attempts")
@UseGuards(JwksGuard)
@UseFilters(ProblemExceptionFilter)
export class OfflineSyncController {
  constructor(private readonly offlineSync: OfflineSyncService) {}

  /**
   * `POST /attempts/offline-sync` cannot collide with `POST /attempts/:id/submit`
   * (two path segments vs one) or `POST /attempts` (no suffix).
   */
  @Post("offline-sync")
  @HttpCode(200)
  sync(
    @CurrentStudent() claims: JwtClaims,
    @Body() body: OfflineSyncRequestDto,
    @Req() req: CapturedRequest,
  ): Promise<OfflineSyncResult> {
    if (!claims.sub) {
      throw new ProblemException({
        type: "invalid_token",
        title: "Missing, invalid or expired token.",
        status: HttpStatus.UNAUTHORIZED,
      })
    }

    return this.offlineSync.sync(claims.sub, body, req)
  }
}
```

Replace `attempts.module.ts`:

```ts
import { Module } from "@nestjs/common"
import { AttemptsController } from "./attempts.controller.js"
import { AttemptsService } from "./attempts.service.js"
import { OfflineSyncController } from "./offline-sync.controller.js"
import { OfflineSyncService } from "./offline-sync.service.js"

@Module({
  controllers: [AttemptsController, OfflineSyncController],
  providers: [AttemptsService, OfflineSyncService],
})
export class AttemptsModule {}
```

- [ ] **Step 5: Run the e2e suite to verify it passes**

Run: `pnpm --filter @pp/server exec vitest run test/offline-sync.e2e.test.ts && pnpm --filter @pp/server exec tsc --noEmit`
Expected: 8 tests PASS. If the *expired* test fails with `finalized: null`, check that `loadRunningOwnedAttempt` receives `receivedAt` (the fixed `NOW`), not `clientAt`. If the *happy path* shows `rejected > 0` with `offline_navigation_locked`, re-check that the `position` event for question 2 precedes the answer to question 2 in `journey()` — replay order is the whole point of journaling answers.

- [ ] **Step 6: Document the contract**

In `docs/api/openapi.yaml` add under `/attempts/{id}/position`'s sibling paths (e.g. after `/attempts/{id}/stimuli/{stimulusId}/play`):

```yaml
  /attempts/offline-sync:
    post:
      tags: [Attempt]
      operationId: syncOfflineAttempt
      summary: Replay a journal of lifecycle events recorded while offline
      description: |
        Journal-first lifecycle (spec D6): the client records `start`, `enter_section`, `play`,
        `position`, `answer` and `finish_section` events durably before sending them, then posts
        them here. `attemptId` is the client-minted uuid and becomes `attempt.id` when the server
        adopts the attempt, so no remapping is ever needed. Events are replayed IN ORDER through the
        same rules the live routes use, each at its CLAIMED time shifted by clock skew
        (`receivedAt − clientSentAt`). Idempotent: events at or below the stored cursor are skipped.

        Structurally impossible journals (gaps, time travel, two open sections, more plays than the
        cap) are refused as a whole and captured as a `failed_write`. Events that merely arrived
        after a deadline are recorded as `late`; navigation violations are `rejected` and captured.
        Hand-in is NOT part of the journal: it requires a connection.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/OfflineSyncRequest" }
      responses:
        "200":
          description: The journal was applied (possibly partly late/rejected).
          content:
            application/json:
              schema: { $ref: "#/components/schemas/OfflineSyncResult" }
        "401": { $ref: "#/components/responses/Unauthorized" }
        "403": { $ref: "#/components/responses/NotYourAttempt" }
        "409":
          description: "`offline_play_cap_exceeded` or `offline_attempt_conflict` (a live attempt exists for this test)."
          content:
            application/problem+json:
              schema: { $ref: "#/components/schemas/Problem" }
        "422":
          description: "`offline_journal_invalid` — the journal is structurally impossible."
          content:
            application/problem+json:
              schema: { $ref: "#/components/schemas/Problem" }
```

and in `components.schemas`:

```yaml
    OfflineJournalEvent:
      type: object
      required: [eventSeq, type, clientAt, payload]
      properties:
        eventSeq: { type: integer, minimum: 1, description: Contiguous per attempt, starting at 1. }
        type:
          type: string
          enum: [start, enter_section, play, position, answer, finish_section]
        clientAt: { type: string, format: date-time }
        payload:
          type: object
          description: |
            By type — start: `{slug, testVersionId}`; enter_section / finish_section: `{sectionId}`;
            play: `{stimulusId}`; position: `{sectionId, questionId}`; answer:
            `{sectionId, questionId, clientInstanceId, seq, selectedChoiceIds, timeSpentMs?}`.

    OfflineSyncRequest:
      type: object
      required: [attemptId, clientSentAt, events]
      additionalProperties: false
      properties:
        attemptId: { type: string, format: uuid }
        clientSentAt: { type: string, format: date-time }
        events:
          type: array
          minItems: 1
          maxItems: 500
          items: { $ref: "#/components/schemas/OfflineJournalEvent" }

    OfflineSyncResult:
      type: object
      required: [attemptId, ackedThrough, applied, late, rejected, answersAcked, finalized]
      properties:
        attemptId: { type: string }
        ackedThrough: { type: integer }
        applied: { type: integer }
        late: { type: integer }
        rejected: { type: integer }
        answersAcked: { type: integer }
        finalized:
          oneOf:
            - type: object
              required: [status, resultUrl]
              properties:
                status: { type: string, enum: [expired, submitted] }
                resultUrl: { type: string }
            - { type: "null" }
```

Run: `pnpm lint:api`
Expected: no errors.

- [ ] **Step 7: Full server gates, then commit**

Run: `pnpm --filter @pp/server exec vitest run && pnpm --filter @pp/db exec vitest run && pnpm lint`
Expected: PASS.

```bash
git add packages/server packages/db docs/api/openapi.yaml
git commit -m "feat(server): replay offline attempt journals via POST /attempts/offline-sync"
```


---

### Task 19: Client — journal store and monotonic local clock

**What this builds.** The device-side half of D6, with no UI and no network: an append-only IndexedDB **journal** of lifecycle events plus the **local attempt state** they mutate (written in the *same* transaction, so an event and its effect can never disagree), and a `LocalClock` that a student cannot rewind by setting the phone's clock back. Two corrections to the spec are applied:

- **The clock rule is `elapsed = max(monotonic, wall)`, not "wall jumps > 2 min are tamper".** Phones sleep: `performance.now()` stops while the screen is locked on iOS, so trusting the monotonic clock alone would hand a student free time every time they lock the phone. A wall-clock jump *forward* only ever costs the student time, so it is trusted; a jump *backward* is the only abuse worth defending against, and `max` ignores it. The high-water mark is persisted so a reload cannot rewind it either.
- **Answers are journaled** (`type: "answer"`), matching Task 17.

**Files:**
- Create: `packages/app/src/lib/attempt/journal-types.ts`
- Create: `packages/app/src/lib/attempt/local-sections.ts`
- Create: `packages/app/src/lib/attempt/journal-store.ts`
- Create: `packages/app/src/lib/attempt/local-clock.ts`
- Create: `packages/app/test/helpers/local-state-fixture.ts` (reused by Task 21)
- Test: `packages/app/test/journal-store.test.ts`, `packages/app/test/local-clock.test.ts`

**Interfaces:**
- Consumes: `OfflineBundleSection`, `RunnerSection`, `PlaybackRules` (`api-types.ts`, Task 15); `makeBundle` (Task 15).
- Produces:
  ```ts
  // journal-types.ts
  export type JournalEventType = "start" | "enter_section" | "play" | "position" | "answer" | "finish_section"
  export interface JournalEventRecord { readonly attemptId: string; readonly eventSeq: number; readonly type: JournalEventType; readonly clientAt: string; readonly payload: Readonly<Record<string, unknown>> }
  export interface LocalAttemptState {
    attemptId: string
    slug: string | null; testVersionId: string | null
    title: string; attemptNumber: number
    ownerSub: string | null                   // JWT `sub` of the student who owns it; sync and Continue act only for that student
    origin: "offline" | "hydrated"
    serverKnown: boolean                      // the server holds (or adopted) this attempt id
    createdAt: string                         // ISO, LOCAL clock timeline
    versionDurationSeconds: number
    sections: RunnerSection[]                 // content + per-section state; groups carry stimuli/questions
    playbackBySection: Record<string, PlaybackRules | null>
    mediaKeyByStimulus: Record<string, string>
    attemptStartedAt: string | null; attemptExpiresAt: string | null
    currentSectionId: string | null; currentQuestionId: string | null
    playsUsed: Record<string, number>
    nextEventSeq: number; syncedThrough: number
    finalized: { status: "expired"; submittedAt: string } | null
    syncError: string | null
  }
  // local-sections.ts
  export function toPendingSection(section: OfflineBundleSection): RunnerSection
  // journal-store.ts
  export interface JournalEventDraft { readonly type: JournalEventType; readonly clientAt: string; readonly payload: Readonly<Record<string, unknown>> }
  export class JournalStore {
    static open(dbName?: string): Promise<JournalStore>          // default "pp-attempts"
    getAttempt(attemptId: string): Promise<LocalAttemptState | null>
    listAttempts(): Promise<LocalAttemptState[]>
    putAttempt(state: LocalAttemptState): Promise<void>
    update(attemptId: string, mutate: (s: LocalAttemptState) => LocalAttemptState): Promise<LocalAttemptState | null>
    append(attemptId: string, draft: JournalEventDraft, mutate?: (s: LocalAttemptState) => LocalAttemptState): Promise<JournalEventRecord>
    eventsAfter(attemptId: string, afterSeq: number): Promise<JournalEventRecord[]>
    pendingCount(attemptId: string): Promise<number>             // events beyond syncedThrough
    markSynced(attemptId: string, ackedThrough: number): Promise<void>
    deleteAttempt(attemptId: string): Promise<void>
    onAppend(listener: () => void): () => void
    loadClockHighWater(): Promise<number | null>
    saveClockHighWater(ms: number): Promise<void>
    close(): void
  }
  // local-clock.ts
  export interface LocalClockDeps { readonly wallNow: () => number; readonly monoNow: () => number; readonly loadHighWater: () => Promise<number | null>; readonly saveHighWater: (ms: number) => Promise<void> }
  export class LocalClock { static create(deps: LocalClockDeps): Promise<LocalClock>; nowMs(): number; persist(): Promise<void> }
  ```

- [ ] **Step 1: Write the types and the section helper**

Create `packages/app/src/lib/attempt/journal-types.ts` with exactly the `JournalEventType`, `JournalEventRecord` and `LocalAttemptState` declarations from the Interfaces block (import `PlaybackRules`, `RunnerSection` as types from `../api-types.js`).

Create `packages/app/src/lib/attempt/local-sections.ts`:

```ts
import type { OfflineBundleSection, RunnerSection } from "../api-types.js"

/** A bundle section as an untouched `RunnerSection`: content only, no attempt state yet. */
export function toPendingSection(section: OfflineBundleSection): RunnerSection {
  return {
    id: section.id,
    type: section.type,
    title: section.title,
    questionCount: section.questionCount,
    durationSeconds: section.durationSeconds,
    instructions: section.instructions,
    status: "pending",
    completedAt: null,
    navigation: section.navigation,
    allowAnswerChange: section.allowAnswerChange,
    expiresAt: null,
    groups: section.groups,
  }
}
```

Create `packages/app/test/helpers/local-state-fixture.ts`:

```ts
import type { LocalAttemptState } from "../../src/lib/attempt/journal-types.js"
import { toPendingSection } from "../../src/lib/attempt/local-sections.js"
import { makeBundle } from "./bundle-fixture.js"

export function makeLocalState(
  over: Partial<LocalAttemptState> = {},
): LocalAttemptState {
  const bundle = makeBundle()

  return {
    attemptId: "att-1",
    slug: bundle.slug,
    testVersionId: bundle.testVersionId,
    title: bundle.title,
    attemptNumber: 1,
    ownerSub: "sub-1",
    origin: "offline",
    serverKnown: false,
    createdAt: "2026-11-22T11:00:00.000Z",
    versionDurationSeconds: bundle.durationSeconds,
    sections: bundle.sections.map(toPendingSection),
    playbackBySection: Object.fromEntries(
      bundle.sections.map((s) => [s.id, s.playback]),
    ),
    mediaKeyByStimulus: Object.fromEntries(
      bundle.media.map((m) => [m.stimulusId, m.key]),
    ),
    attemptStartedAt: null,
    attemptExpiresAt: null,
    currentSectionId: null,
    currentQuestionId: null,
    playsUsed: {},
    nextEventSeq: 1,
    syncedThrough: 0,
    finalized: null,
    syncError: null,
    ...over,
  }
}
```

- [ ] **Step 2: Write the failing store tests**

Create `packages/app/test/journal-store.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { JournalStore } from "../src/lib/attempt/journal-store.js"
import { makeLocalState } from "./helpers/local-state-fixture.js"

let n = 0
const freshName = (): string => `pp-attempts-test-${(n += 1)}`
const at = "2026-11-22T11:00:00.000Z"

describe("JournalStore", () => {
  it("assigns contiguous eventSeq per attempt and survives a reopen", async () => {
    const name = freshName()
    const store = await JournalStore.open(name)

    await store.putAttempt(makeLocalState())

    const a = await store.append("att-1", { type: "start", clientAt: at, payload: { slug: "p3" } })
    const b = await store.append("att-1", { type: "enter_section", clientAt: at, payload: { sectionId: "sec-l" } })

    expect([a.eventSeq, b.eventSeq]).toEqual([1, 2])

    store.close()

    const reopened = await JournalStore.open(name)

    expect((await reopened.eventsAfter("att-1", 0)).map((e) => e.eventSeq)).toEqual([1, 2])
    expect((await reopened.getAttempt("att-1"))?.nextEventSeq).toBe(3)
  })

  it("applies the state mutation in the same transaction as the event", async () => {
    const store = await JournalStore.open(freshName())

    await store.putAttempt(makeLocalState())
    await store.append(
      "att-1",
      { type: "position", clientAt: at, payload: {} },
      (s) => ({ ...s, currentQuestionId: "q-l2", nextEventSeq: 999 }),
    )

    const state = await store.getAttempt("att-1")

    expect(state?.currentQuestionId).toBe("q-l2")
    // The store owns the counter: a mutation can never skip or reuse a seq.
    expect(state?.nextEventSeq).toBe(2)
  })

  it("eventsAfter returns only newer events, scoped to the attempt", async () => {
    const store = await JournalStore.open(freshName())

    await store.putAttempt(makeLocalState())
    await store.putAttempt(makeLocalState({ attemptId: "att-2" }))
    await store.append("att-1", { type: "start", clientAt: at, payload: {} })
    await store.append("att-1", { type: "play", clientAt: at, payload: {} })
    await store.append("att-2", { type: "start", clientAt: at, payload: {} })

    expect((await store.eventsAfter("att-1", 1)).map((e) => e.eventSeq)).toEqual([2])
    expect(await store.eventsAfter("att-2", 5)).toEqual([])
  })

  it("markSynced drops acknowledged events and advances syncedThrough", async () => {
    const store = await JournalStore.open(freshName())

    await store.putAttempt(makeLocalState())
    await store.append("att-1", { type: "start", clientAt: at, payload: {} })
    await store.append("att-1", { type: "play", clientAt: at, payload: {} })
    await store.append("att-1", { type: "answer", clientAt: at, payload: {} })

    expect(await store.pendingCount("att-1")).toBe(3)

    await store.markSynced("att-1", 2)

    expect(await store.pendingCount("att-1")).toBe(1)
    expect((await store.getAttempt("att-1"))?.syncedThrough).toBe(2)
    expect((await store.eventsAfter("att-1", 0)).map((e) => e.eventSeq)).toEqual([3])
  })

  it("rejects an append for an attempt that does not exist", async () => {
    const store = await JournalStore.open(freshName())

    await expect(
      store.append("nope", { type: "start", clientAt: at, payload: {} }),
    ).rejects.toThrow("no local attempt nope")
  })

  it("notifies onAppend listeners and stops after unsubscribe", async () => {
    const store = await JournalStore.open(freshName())
    const listener = vi.fn()
    const unsubscribe = store.onAppend(listener)

    await store.putAttempt(makeLocalState())
    await store.append("att-1", { type: "start", clientAt: at, payload: {} })

    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    await store.append("att-1", { type: "play", clientAt: at, payload: {} })

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("update mutates state without writing an event; deleteAttempt removes state and events", async () => {
    const store = await JournalStore.open(freshName())

    await store.putAttempt(makeLocalState())
    await store.append("att-1", { type: "start", clientAt: at, payload: {} })
    await store.update("att-1", (s) => ({ ...s, syncError: "offline_journal_invalid" }))

    expect((await store.getAttempt("att-1"))?.syncError).toBe("offline_journal_invalid")
    expect(await store.pendingCount("att-1")).toBe(1)

    await store.deleteAttempt("att-1")

    expect(await store.getAttempt("att-1")).toBeNull()
    expect(await store.eventsAfter("att-1", 0)).toEqual([])
  })

  it("round-trips the clock high-water mark", async () => {
    const store = await JournalStore.open(freshName())

    expect(await store.loadClockHighWater()).toBeNull()

    await store.saveClockHighWater(1234)

    expect(await store.loadClockHighWater()).toBe(1234)
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @pp/app exec vitest run test/journal-store.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/attempt/journal-store.js'`.

- [ ] **Step 4: Implement the store**

Create `packages/app/src/lib/attempt/journal-store.ts`:

```ts
import type {
  JournalEventRecord,
  JournalEventType,
  LocalAttemptState,
} from "./journal-types.js"

const ATTEMPTS = "attempts"
const EVENTS = "events"
const META = "meta"
const CLOCK_KEY = "clockHighWater"

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"))
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"))
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"))
  })
}

function openDb(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1)

    request.onupgradeneeded = () => {
      const db = request.result

      db.createObjectStore(ATTEMPTS, { keyPath: "attemptId" })
      db.createObjectStore(EVENTS, { keyPath: ["attemptId", "eventSeq"] })
      db.createObjectStore(META, { keyPath: "key" })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB open failed"))
  })
}

const eventsRange = (attemptId: string, afterSeq: number): IDBKeyRange =>
  IDBKeyRange.bound([attemptId, afterSeq + 1], [attemptId, Number.MAX_SAFE_INTEGER])

export interface JournalEventDraft {
  readonly type: JournalEventType
  readonly clientAt: string
  readonly payload: Readonly<Record<string, unknown>>
}

/**
 * Append-only journal plus the local attempt state it mutates. `append` writes
 * the event AND the state change in one transaction: after a crash the journal
 * and the state can never disagree about what happened (spec D6, and the same
 * "durable before sent" rule `AnswerQueue` follows for answers).
 *
 * The store owns `nextEventSeq`; a `mutate` callback cannot skip or reuse a
 * sequence number, because the counter is applied AFTER the callback runs.
 */
export class JournalStore {
  private readonly db: IDBDatabase
  private readonly listeners = new Set<() => void>()

  private constructor(db: IDBDatabase) {
    this.db = db
  }

  static async open(dbName = "pp-attempts"): Promise<JournalStore> {
    return new JournalStore(await openDb(dbName))
  }

  async getAttempt(attemptId: string): Promise<LocalAttemptState | null> {
    const state = await promisify(
      this.db.transaction(ATTEMPTS).objectStore(ATTEMPTS).get(attemptId) as IDBRequest<
        LocalAttemptState | undefined
      >,
    )

    return state ?? null
  }

  listAttempts(): Promise<LocalAttemptState[]> {
    return promisify(
      this.db.transaction(ATTEMPTS).objectStore(ATTEMPTS).getAll() as IDBRequest<
        LocalAttemptState[]
      >,
    )
  }

  async putAttempt(state: LocalAttemptState): Promise<void> {
    const tx = this.db.transaction(ATTEMPTS, "readwrite")

    tx.objectStore(ATTEMPTS).put(state)
    await txDone(tx)
  }

  async update(
    attemptId: string,
    mutate: (s: LocalAttemptState) => LocalAttemptState,
  ): Promise<LocalAttemptState | null> {
    const tx = this.db.transaction(ATTEMPTS, "readwrite")
    const store = tx.objectStore(ATTEMPTS)
    const state = await promisify(
      store.get(attemptId) as IDBRequest<LocalAttemptState | undefined>,
    )

    if (!state) {
      await txDone(tx)

      return null
    }

    const next = mutate(state)

    store.put(next)
    await txDone(tx)

    return next
  }

  async append(
    attemptId: string,
    draft: JournalEventDraft,
    mutate: (s: LocalAttemptState) => LocalAttemptState = (s) => s,
  ): Promise<JournalEventRecord> {
    const tx = this.db.transaction([ATTEMPTS, EVENTS], "readwrite")
    const attempts = tx.objectStore(ATTEMPTS)
    const state = await promisify(
      attempts.get(attemptId) as IDBRequest<LocalAttemptState | undefined>,
    )

    if (!state) {
      tx.abort()

      throw new Error(`no local attempt ${attemptId}`)
    }

    const record: JournalEventRecord = {
      attemptId,
      eventSeq: state.nextEventSeq,
      type: draft.type,
      clientAt: draft.clientAt,
      payload: draft.payload,
    }

    tx.objectStore(EVENTS).put(record)
    attempts.put({ ...mutate(state), nextEventSeq: state.nextEventSeq + 1 })
    await txDone(tx)
    this.listeners.forEach((listener) => listener())

    return record
  }

  eventsAfter(attemptId: string, afterSeq: number): Promise<JournalEventRecord[]> {
    return promisify(
      this.db
        .transaction(EVENTS)
        .objectStore(EVENTS)
        .getAll(eventsRange(attemptId, afterSeq)) as IDBRequest<JournalEventRecord[]>,
    )
  }

  async pendingCount(attemptId: string): Promise<number> {
    const state = await this.getAttempt(attemptId)

    if (!state) {
      return 0
    }

    return promisify(
      this.db
        .transaction(EVENTS)
        .objectStore(EVENTS)
        .count(eventsRange(attemptId, state.syncedThrough)),
    )
  }

  async markSynced(attemptId: string, ackedThrough: number): Promise<void> {
    const tx = this.db.transaction([ATTEMPTS, EVENTS], "readwrite")

    tx.objectStore(EVENTS).delete(
      IDBKeyRange.bound([attemptId, 0], [attemptId, ackedThrough]),
    )

    const attempts = tx.objectStore(ATTEMPTS)
    const state = await promisify(
      attempts.get(attemptId) as IDBRequest<LocalAttemptState | undefined>,
    )

    if (state) {
      attempts.put({
        ...state,
        syncedThrough: Math.max(state.syncedThrough, ackedThrough),
      })
    }

    await txDone(tx)
  }

  async deleteAttempt(attemptId: string): Promise<void> {
    const tx = this.db.transaction([ATTEMPTS, EVENTS], "readwrite")

    tx.objectStore(ATTEMPTS).delete(attemptId)
    tx.objectStore(EVENTS).delete(
      IDBKeyRange.bound([attemptId, 0], [attemptId, Number.MAX_SAFE_INTEGER]),
    )
    await txDone(tx)
  }

  onAppend(listener: () => void): () => void {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  async loadClockHighWater(): Promise<number | null> {
    const row = await promisify(
      this.db.transaction(META).objectStore(META).get(CLOCK_KEY) as IDBRequest<
        { key: string; value: number } | undefined
      >,
    )

    return row?.value ?? null
  }

  async saveClockHighWater(ms: number): Promise<void> {
    const tx = this.db.transaction(META, "readwrite")

    tx.objectStore(META).put({ key: CLOCK_KEY, value: ms })
    await txDone(tx)
  }

  close(): void {
    this.db.close()
  }
}
```

- [ ] **Step 5: Run the store tests to verify they pass**

Run: `pnpm --filter @pp/app exec vitest run test/journal-store.test.ts`
Expected: 8 tests PASS.

- [ ] **Step 6: Write the failing clock tests**

Create `packages/app/test/local-clock.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { LocalClock, type LocalClockDeps } from "../src/lib/attempt/local-clock.js"

function deps(over: Partial<LocalClockDeps> & { wall: { v: number }; mono: { v: number } }): LocalClockDeps & { saved: number[] } {
  const saved: number[] = []

  return {
    wallNow: () => over.wall.v,
    monoNow: () => over.mono.v,
    loadHighWater: over.loadHighWater ?? (() => Promise.resolve(null)),
    saveHighWater: (ms) => {
      saved.push(ms)

      return Promise.resolve()
    },
    saved,
  }
}

describe("LocalClock", () => {
  it("advances with time", async () => {
    const wall = { v: 1_000_000 }
    const mono = { v: 0 }
    const clock = await LocalClock.create(deps({ wall, mono }))

    wall.v += 5_000
    mono.v += 5_000

    expect(clock.nowMs()).toBe(1_005_000)
  })

  it("ignores the wall clock being set backwards (the monotonic clock keeps going)", async () => {
    const wall = { v: 1_000_000 }
    const mono = { v: 0 }
    const clock = await LocalClock.create(deps({ wall, mono }))

    mono.v += 60_000
    wall.v = 400_000 // the student rewinds the phone clock

    expect(clock.nowMs()).toBe(1_060_000)

    mono.v += 1_000
    wall.v += 1_000

    expect(clock.nowMs()).toBe(1_061_000)
  })

  it("counts a wall-clock jump forward (the phone slept while the monotonic clock paused)", async () => {
    const wall = { v: 1_000_000 }
    const mono = { v: 0 }
    const clock = await LocalClock.create(deps({ wall, mono }))

    wall.v += 600_000 // 10 minutes passed on the wall...
    mono.v += 1_000 // ...but the monotonic clock only saw 1 s (device slept)

    expect(clock.nowMs()).toBe(1_600_000)
  })

  it("never returns an earlier time than it has already returned", async () => {
    const wall = { v: 1_000_000 }
    const mono = { v: 0 }
    const clock = await LocalClock.create(deps({ wall, mono }))

    mono.v += 10_000

    const first = clock.nowMs()

    wall.v -= 500_000

    expect(clock.nowMs()).toBeGreaterThanOrEqual(first)
  })

  it("a persisted high-water mark stops a reload from rewinding the clock", async () => {
    const wall = { v: 500_000 } // clock set back before the reload
    const mono = { v: 0 }
    const clock = await LocalClock.create(
      deps({ wall, mono, loadHighWater: () => Promise.resolve(1_000_000) }),
    )

    expect(clock.nowMs()).toBe(1_000_000)

    mono.v += 2_000
    wall.v += 2_000

    expect(clock.nowMs()).toBe(1_002_000)
  })

  it("persist writes the current high-water mark", async () => {
    const wall = { v: 1_000_000 }
    const mono = { v: 0 }
    const d = deps({ wall, mono })
    const clock = await LocalClock.create(d)

    mono.v += 3_000
    wall.v += 3_000
    clock.nowMs()
    await clock.persist()

    expect(d.saved.at(-1)).toBe(1_003_000)
  })
})
```

- [ ] **Step 7: Run (fails), implement, run (passes)**

Run: `pnpm --filter @pp/app exec vitest run test/local-clock.test.ts` — Expected: FAIL (module missing).

Create `packages/app/src/lib/attempt/local-clock.ts`:

```ts
export interface LocalClockDeps {
  readonly wallNow: () => number
  readonly monoNow: () => number
  readonly loadHighWater: () => Promise<number | null>
  readonly saveHighWater: (ms: number) => Promise<void>
}

/**
 * The clock an OFFLINE section deadline is judged by. The server never sees
 * this clock directly; it only ever sees the journal's claimed times, so the
 * only thing this class can defend is "a student cannot gain time by
 * rewinding the phone's clock".
 *
 * `elapsed = max(monotonic delta, wall delta)`:
 *   - wall set BACKWARDS: ignored, monotonic keeps counting;
 *   - wall jumped FORWARDS (or the device slept while `performance.now()`
 *     paused): trusted -- it can only cost the student time;
 *   - a persisted high-water mark carries the same guarantee across reloads.
 */
export class LocalClock {
  private readonly deps: LocalClockDeps
  private readonly anchorWall: number
  private readonly anchorMono: number
  private high: number

  private constructor(deps: LocalClockDeps, anchorWall: number) {
    this.deps = deps
    this.anchorWall = anchorWall
    this.anchorMono = deps.monoNow()
    this.high = anchorWall
  }

  static async create(deps: LocalClockDeps): Promise<LocalClock> {
    const stored = await deps.loadHighWater()

    return new LocalClock(deps, Math.max(deps.wallNow(), stored ?? 0))
  }

  nowMs(): number {
    const elapsedMono = this.deps.monoNow() - this.anchorMono
    const elapsedWall = this.deps.wallNow() - this.anchorWall
    const now = this.anchorWall + Math.max(0, elapsedMono, elapsedWall)

    this.high = Math.max(this.high, now)

    return this.high
  }

  persist(): Promise<void> {
    return this.deps.saveHighWater(this.high)
  }
}
```

Run again — Expected: 6 tests PASS.

- [ ] **Step 8: Gates and commit**

Run: `pnpm --filter @pp/app exec tsc --noEmit && pnpm lint`
Expected: clean (`lib/` may hold state; nothing here is a component).

```bash
git add packages/app
git commit -m "feat(app): offline attempt journal store and monotonic local clock"
```

---

### Task 20: Client — `AttemptGateway` and `RemoteAttemptGateway` (behaviour-preserving refactor)

**What this builds.** A single seam through which the runner talks about the *attempt lifecycle*, with one implementation that simply forwards to today's API functions. **No behaviour changes.** The existing suites for run, rules, hand-in and the brief screen are the guard: they must stay green **without edits to their assertions**. Task 21 then swaps in a hybrid implementation without touching the pages again.

Two interface additions beyond the spec §6 contract (needed because answers are journaled and the pages call the flush controller directly today): `noteAnswer` and `flushAnswers`, plus `isLocalOnly` (a local-only attempt does not exist on the server yet, so `PATCH /responses` and the `pagehide` keepalive flush must not fire for it). `submit` returns the real `SubmitResult`, not `FinalizedAttempt`.

**Files:**
- Create: `packages/app/src/lib/attempt/attempt-gateway.ts`
- Create: `packages/app/src/lib/attempt/remote-gateway.ts`
- Create: `packages/app/src/lib/attempt/gateway-selector.ts`
- Test: `packages/app/test/remote-gateway.test.ts`
- Modify (re-read each file first — Part B restyled them; anchor on the symbols named):
  - `packages/app/src/pages/attempts.$attemptId.run.tsx` — `RunScreenProps`, `RunScreen` (`handleClaimPlay`, `moveToQuestion`, `handleNavigatorNavigate`, `handleFinishSection`, `handleSelectChoice`, the mount-flush `useEffect`, `flushOnConnectionHint`, the zero-touch `getRunnerEnvelope` effect, `openSectionRef` assignment), `loadRunScreenData`, `loadRunRouteData`, `RouteComponent`
  - `packages/app/src/pages/attempts.$attemptId.hand-in.tsx` — `HandInScreenProps`, the `submitAttempt(...)` call in `HandInScreen`, `loadHandInRouteData`
  - `packages/app/src/pages/attempts.$attemptId.sections.$sectionId.rules.tsx` — `SectionRulesScreenProps`, `handleReady`, `loadSectionRulesData`
  - `packages/app/src/pages/tests.$slug.tsx` — `handleStart`
  - `packages/app/src/pages/index.tsx` — the library's Start handler (the function that calls `startAttempt`; Part B may have moved the call here from `tests.$slug.tsx`)

**Interfaces:**
- Consumes: the functions in `lib/attempts-api.ts` (`startAttempt`, `getRunnerEnvelope`, `enterSection`, `setPosition`, `claimPlay`, `finishSection`, `submitAttempt`); `AnswerQueue`, `QueuedAnswer` (`answerQueue.ts`); `FlushController`, `FlushResult` (`flushController.ts`).
- Produces:
  ```ts
  // attempt-gateway.ts
  export type OfflineReason = "offline" | "not_saved" | "media_missing" | "not_hydrated"
  export class OfflineError extends Error { readonly kind: "offline"; readonly reason: OfflineReason; constructor(reason: OfflineReason) }
  export interface StartHint { readonly inProgressAttemptId: string | null }
  export interface FlushContext { readonly controller: FlushController; readonly queue: AnswerQueue; readonly attemptId: string; readonly sectionId: string }
  export interface AttemptGateway {
    start(slug: string, hint?: StartHint): Promise<AttemptStart>
    loadEnvelope(attemptId: string): Promise<RunnerEnvelope>
    enterSection(attemptId: string, sectionId: string): Promise<SectionEntry>
    setPosition(attemptId: string, sectionId: string, questionId: string): Promise<void>
    claimPlay(attemptId: string, stimulusId: string): Promise<PlayGrant>
    finishSection(attemptId: string, sectionId: string, body: FinishSectionRequest): Promise<FinishSectionResult>
    submit(attemptId: string, body: SubmitRequest): Promise<SubmitResult>   // remote only; local rejects with OfflineError("offline")
    noteAnswer(attemptId: string, answer: QueuedAnswer): Promise<void>
    flushAnswers(ctx: FlushContext): Promise<FlushResult>
    isLocalOnly(attemptId: string): Promise<boolean>
  }
  // remote-gateway.ts
  export class RemoteAttemptGateway implements AttemptGateway {}
  // gateway-selector.ts
  export const attemptGateway: AttemptGateway
  export function gatewayFor(attemptId: string): AttemptGateway
  ```

- [ ] **Step 1: Write the failing delegation test**

Create `packages/app/test/remote-gateway.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest"
import * as api from "../src/lib/attempts-api.js"
import { RemoteAttemptGateway } from "../src/lib/attempt/remote-gateway.js"
import type { FlushContext } from "../src/lib/attempt/attempt-gateway.js"
import { OfflineError } from "../src/lib/attempt/attempt-gateway.js"

vi.mock("../src/lib/attempts-api.js", () => ({
  startAttempt: vi.fn(),
  getRunnerEnvelope: vi.fn(),
  enterSection: vi.fn(),
  setPosition: vi.fn(),
  claimPlay: vi.fn(),
  finishSection: vi.fn(),
  submitAttempt: vi.fn(),
}))

describe("RemoteAttemptGateway", () => {
  const gateway = new RemoteAttemptGateway()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("forwards each lifecycle call to the attempts API unchanged", async () => {
    vi.mocked(api.startAttempt).mockResolvedValue({ id: "a1" } as never)
    vi.mocked(api.getRunnerEnvelope).mockResolvedValue({ id: "a1" } as never)
    vi.mocked(api.enterSection).mockResolvedValue({ sectionId: "s1" } as never)
    vi.mocked(api.setPosition).mockResolvedValue()
    vi.mocked(api.claimPlay).mockResolvedValue({ mediaUrl: "/m" } as never)
    vi.mocked(api.finishSection).mockResolvedValue({ nextSectionId: null } as never)
    vi.mocked(api.submitAttempt).mockResolvedValue({ attemptId: "a1" } as never)

    await gateway.start("p3", { inProgressAttemptId: null })
    await gateway.loadEnvelope("a1")
    await gateway.enterSection("a1", "s1")
    await gateway.setPosition("a1", "s1", "q1")
    await gateway.claimPlay("a1", "st1")
    await gateway.finishSection("a1", "s1", { clientInstanceId: "i", responses: [] })
    await gateway.submit("a1", { clientInstanceId: "i", responses: [] })

    expect(api.startAttempt).toHaveBeenCalledWith("p3")
    expect(api.getRunnerEnvelope).toHaveBeenCalledWith("a1")
    expect(api.enterSection).toHaveBeenCalledWith("a1", "s1")
    expect(api.setPosition).toHaveBeenCalledWith("a1", "s1", "q1")
    expect(api.claimPlay).toHaveBeenCalledWith("a1", "st1")
    expect(api.finishSection).toHaveBeenCalledWith("a1", "s1", { clientInstanceId: "i", responses: [] })
    expect(api.submitAttempt).toHaveBeenCalledWith("a1", { clientInstanceId: "i", responses: [] })
  })

  it("flushAnswers flushes the section through the controller to the attempt's responses URL", async () => {
    const flushSection = vi.fn().mockResolvedValue({ flushed: true })
    const ctx = {
      controller: { flushSection },
      queue: {},
      attemptId: "a1",
      sectionId: "s1",
    } as unknown as FlushContext

    await gateway.flushAnswers(ctx)

    expect(flushSection).toHaveBeenCalledWith("a1", "s1", "/attempts/a1/responses")
  })

  it("noteAnswer is a no-op and a remote attempt is never local-only", async () => {
    await expect(gateway.noteAnswer("a1", {} as never)).resolves.toBeUndefined()
    await expect(gateway.isLocalOnly("a1")).resolves.toBe(false)
  })

  it("OfflineError carries a discriminating kind and reason", () => {
    const error = new OfflineError("media_missing")

    expect(error).toBeInstanceOf(Error)
    expect(error.kind).toBe("offline")
    expect(error.reason).toBe("media_missing")
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @pp/app exec vitest run test/remote-gateway.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/attempt/remote-gateway.js'`.

- [ ] **Step 3: Implement the gateway, remote implementation and selector**

Create `packages/app/src/lib/attempt/attempt-gateway.ts`:

```ts
import type { AnswerQueue, QueuedAnswer } from "../answerQueue.js"
import type {
  AttemptStart,
  FinishSectionRequest,
  FinishSectionResult,
  PlayGrant,
  RunnerEnvelope,
  SectionEntry,
  SubmitRequest,
  SubmitResult,
} from "../api-types.js"
import type { FlushController, FlushResult } from "../flushController.js"

export type OfflineReason =
  | "offline"
  | "not_saved"
  | "media_missing"
  | "not_hydrated"

/**
 * Thrown by a gateway for something that needs a connection (or a saved test)
 * and cannot be done right now. Distinct from `ApiError`: the server never said
 * no -- there was nobody to ask. Callers show the "needs a connection" copy;
 * they must not treat it as a refusal or retry-storm it.
 */
export class OfflineError extends Error {
  readonly kind = "offline" as const
  readonly reason: OfflineReason

  constructor(reason: OfflineReason) {
    super(`offline:${reason}`)
    this.reason = reason
  }
}

export interface StartHint {
  /** From the library card: an attempt already in progress for this test. */
  readonly inProgressAttemptId: string | null
}

export interface FlushContext {
  readonly controller: FlushController
  readonly queue: AnswerQueue
  readonly attemptId: string
  readonly sectionId: string
}

/**
 * The attempt lifecycle as the runner sees it. `RemoteAttemptGateway` forwards
 * to the API; the hybrid implementation (Task 21) journals locally first.
 * `enterSection`, `setPosition`, `claimPlay` and `finishSection` throw
 * `ApiError` for server-style refusals in BOTH implementations (the local one
 * synthesises the same problem types), so page error handling is unchanged.
 */
export interface AttemptGateway {
  start(slug: string, hint?: StartHint): Promise<AttemptStart>
  loadEnvelope(attemptId: string): Promise<RunnerEnvelope>
  enterSection(attemptId: string, sectionId: string): Promise<SectionEntry>
  setPosition(
    attemptId: string,
    sectionId: string,
    questionId: string,
  ): Promise<void>
  claimPlay(attemptId: string, stimulusId: string): Promise<PlayGrant>
  finishSection(
    attemptId: string,
    sectionId: string,
    body: FinishSectionRequest,
  ): Promise<FinishSectionResult>
  /** Remote only. The local gateway rejects with `OfflineError("offline")`. */
  submit(attemptId: string, body: SubmitRequest): Promise<SubmitResult>
  /** Called after `queue.recordAnswer`: lets a local attempt journal the answer. */
  noteAnswer(attemptId: string, answer: QueuedAnswer): Promise<void>
  flushAnswers(ctx: FlushContext): Promise<FlushResult>
  /** True when the server does not know this attempt id yet (offline start). */
  isLocalOnly(attemptId: string): Promise<boolean>
}
```

Create `packages/app/src/lib/attempt/remote-gateway.ts`:

```ts
import type { QueuedAnswer } from "../answerQueue.js"
import {
  claimPlay,
  enterSection,
  finishSection,
  getRunnerEnvelope,
  setPosition,
  startAttempt,
  submitAttempt,
} from "../attempts-api.js"
import type {
  AttemptStart,
  FinishSectionRequest,
  FinishSectionResult,
  PlayGrant,
  RunnerEnvelope,
  SectionEntry,
  SubmitRequest,
  SubmitResult,
} from "../api-types.js"
import type { FlushResult } from "../flushController.js"
import type {
  AttemptGateway,
  FlushContext,
  StartHint,
} from "./attempt-gateway.js"

/** Today's behaviour, verbatim: every call goes straight to the API. */
export class RemoteAttemptGateway implements AttemptGateway {
  start(slug: string, _hint?: StartHint): Promise<AttemptStart> {
    return startAttempt(slug)
  }

  loadEnvelope(attemptId: string): Promise<RunnerEnvelope> {
    return getRunnerEnvelope(attemptId)
  }

  enterSection(attemptId: string, sectionId: string): Promise<SectionEntry> {
    return enterSection(attemptId, sectionId)
  }

  setPosition(
    attemptId: string,
    sectionId: string,
    questionId: string,
  ): Promise<void> {
    return setPosition(attemptId, sectionId, questionId)
  }

  claimPlay(attemptId: string, stimulusId: string): Promise<PlayGrant> {
    return claimPlay(attemptId, stimulusId)
  }

  finishSection(
    attemptId: string,
    sectionId: string,
    body: FinishSectionRequest,
  ): Promise<FinishSectionResult> {
    return finishSection(attemptId, sectionId, body)
  }

  submit(attemptId: string, body: SubmitRequest): Promise<SubmitResult> {
    return submitAttempt(attemptId, body)
  }

  noteAnswer(_attemptId: string, _answer: QueuedAnswer): Promise<void> {
    return Promise.resolve()
  }

  flushAnswers(ctx: FlushContext): Promise<FlushResult> {
    return ctx.controller.flushSection(
      ctx.attemptId,
      ctx.sectionId,
      `/attempts/${ctx.attemptId}/responses`,
    )
  }

  isLocalOnly(_attemptId: string): Promise<boolean> {
    return Promise.resolve(false)
  }
}
```

Create `packages/app/src/lib/attempt/gateway-selector.ts`:

```ts
import type { AttemptGateway } from "./attempt-gateway.js"
import { RemoteAttemptGateway } from "./remote-gateway.js"

/**
 * The one gateway pages use. Task 21 replaces this with the hybrid
 * (journal-first) implementation; every page already goes through here.
 */
export const attemptGateway: AttemptGateway = new RemoteAttemptGateway()

export function gatewayFor(_attemptId: string): AttemptGateway {
  return attemptGateway
}
```

- [ ] **Step 4: Run the new test to verify it passes**

Run: `pnpm --filter @pp/app exec vitest run test/remote-gateway.test.ts && pnpm --filter @pp/app exec tsc --noEmit`
Expected: 4 tests PASS, typecheck clean.

- [ ] **Step 5: Snapshot the guard — run the existing suites BEFORE refactoring**

Run: `pnpm --filter @pp/app exec vitest run src/pages/attempts src/pages/tests src/components`
Expected: PASS. Record the pass count; Step 8 must show the same count.

- [ ] **Step 6: Move the run screen onto the gateway**

Re-read `pages/attempts.$attemptId.run.tsx`. Make exactly these changes (nothing else):

1. **Imports.** In the `../lib/attempts-api.js` import list remove `claimPlay`, `finishSection`, `getRunnerEnvelope` and `setPosition` (keep any other names the file still uses). Add:
   ```ts
   import type { AttemptGateway } from "../lib/attempt/attempt-gateway.js"
   import { attemptGateway } from "../lib/attempt/gateway-selector.js"
   ```
   (`OfflineError` is first *used* in Task 21; importing it now would trip the unused-import lint.)
2. **Props.** `RunScreenProps` gains `readonly gateway?: AttemptGateway` and `readonly localOnly?: boolean`. In `RunScreen`'s parameter destructuring add `gateway = attemptGateway, localOnly = false`.
3. **Calls.** Replace, in place:
   - `getRunnerEnvelope(attemptId)` in the zero-touch effect (the one guarded by `zeroTouchStartedRef`) → `gateway.loadEnvelope(attemptId)`; add `gateway` to that effect's dependency array.
   - `claimPlay(attemptId, stimulus.id)` in `handleClaimPlay` → `gateway.claimPlay(attemptId, stimulus.id)`.
   - both `setPosition(attemptId, section.id, <entry>.question.id)` calls (in `moveToQuestion` and in `handleNavigatorNavigate`) → `gateway.setPosition(...)` with the same arguments.
   - `finishSection(attemptId, section.id, body)` in `handleFinishSection` → `gateway.finishSection(attemptId, section.id, body)`.
4. **Flush.** Every `controller.flushSection(attemptId, section.id, \`/attempts/${attemptId}/responses\`)` (three sites: the `.then` chain in `handleSelectChoice`, the mount-time flush `useEffect`, and `flushOnConnectionHint`) becomes:
   ```ts
   gateway.flushAnswers({ controller, queue, attemptId, sectionId: section.id })
   ```
   Add `gateway` to the dependency arrays of those two effects.
5. **Journal hook.** In `handleSelectChoice`, the chain currently reads `durableWrite.then(() => controller.flushSection(...))`. Change the head of the chain to:
   ```ts
   void durableWrite
     .then(async (queued) => {
       await gateway.noteAnswer(attemptId, queued)

       return gateway.flushAnswers({ controller, queue, attemptId, sectionId: section.id })
     })
   ```
   (`queue.recordAnswer` already resolves with the `QueuedAnswer`.)
6. **Pagehide.** Where `openSectionRef.current` is assigned, make it `section && !localOnly ? { attemptId, sectionId: section.id } : null`. A local-only attempt does not exist on the server yet, so the keepalive `PATCH` would 403; its answers are already durable in the journal.
7. **Loaders.** `loadRunScreenData` calls `attemptGateway.loadEnvelope(attemptId)` instead of `getRunnerEnvelope(attemptId)`. `loadRunRouteData` returns one more field, computed alongside the others: `localOnly: await attemptGateway.isLocalOnly(attemptId)`; widen its declared return type and `RouteComponent` to pass `localOnly={localOnly}` to `RunScreen`.

- [ ] **Step 7: Move hand-in, rules and Start onto the gateway**

Re-read each file, then:

- `attempts.$attemptId.hand-in.tsx`: `HandInScreenProps` gains `readonly gateway?: AttemptGateway` (default `attemptGateway` in the destructuring); `submitAttempt(attemptId, body)` → `gateway.submit(attemptId, body)`; `loadHandInRouteData` uses `attemptGateway.loadEnvelope(attemptId)` instead of `getRunnerEnvelope`. Drop `submitAttempt` and `getRunnerEnvelope` from its `attempts-api` import.
- `attempts.$attemptId.sections.$sectionId.rules.tsx`: `SectionRulesScreenProps` gains `readonly gateway?: AttemptGateway`; `enterSection(attemptId, sectionId)` in `handleReady` → `gateway.enterSection(attemptId, sectionId)`; `loadSectionRulesData` uses `attemptGateway.loadEnvelope(attemptId)`. Drop both names from its `attempts-api` import. `loadSectionRulesData`'s return type is `Omit<SectionRulesScreenProps, "navigate" | "finalizedPriorAttempt">` — add `"gateway"` to that `Omit` so route data stays serialisable.
- `tests.$slug.tsx` `handleStart` and the library Start handler in `pages/index.tsx`: `startAttempt(slug)` → `attemptGateway.start(slug, { inProgressAttemptId: <the card's inProgressAttemptId, or null in the brief screen> })`; drop `startAttempt` from the `attempts-api` imports there.

- [ ] **Step 8: Run the guard again — same count, no assertion edits**

Run: `pnpm --filter @pp/app exec vitest run src/pages/attempts src/pages/tests src/pages/index.test.tsx src/components test`
Expected: PASS with the Step 5 count (plus the 4 new gateway tests). If a page test fails because it mocks `../lib/attempts-api.js` and a *new* import path is not covered, the failure is in how the gateway is reached, not in the assertion — fix the code, never the assertion. The mocks keep working because `RemoteAttemptGateway` calls the very same mocked module functions.

- [ ] **Step 9: Gates and commit**

Run: `pnpm --filter @pp/app exec tsc --noEmit && pnpm lint && pnpm format`
Expected: clean (`lint:frontend`: pages and `lib/` hold the state; no component gained a hook).

```bash
git add packages/app
git commit -m "refactor(app): route the attempt lifecycle through an AttemptGateway"
```


---

### Task 21: Client — local gateway, hybrid routing and journal sync (offline start, offline run, sync on reconnect)

**What this builds.** Everything that makes the prototype's offline behaviour real:

- `LocalAttemptGateway` applies `start`, `enter_section`, `position`, `play`, `finish_section` locally (journal-first), synthesising the same `ApiError` problem types the server would, so no page error handling changes.
- `HybridAttemptGateway` decides per call between local and remote: **journal-first whenever the attempt has unsynced events or the network is down; otherwise remote.** When online with unsynced events it syncs first, so the server is only ever *behind* the journal, never ahead of it.
- `createJournalSync` posts the journal to `POST /attempts/offline-sync`, acks answer-queue items, backs off with `classifyForRetry`, and tells the student "Back online — N answers sent."
- An **online-started attempt that loses connectivity** is *hydrated* from its last runner envelope on every envelope load, so it continues locally with no special case.
- Production wiring is installed from `main.tsx` (`installOfflineAttempts()`); unit tests keep the **remote** default, so the Task 20 guard suites are untouched by IndexedDB.

**Files:**
- Create: `packages/app/src/lib/attempt/local-envelope.ts`, `local-gateway.ts`, `sync-status.ts`, `journal-sync.ts`, `hybrid-gateway.ts`, `owner.ts`, `runtime.ts`, `install.ts`, `use-local-attempts.ts`
- Modify: `packages/app/src/lib/attempt/gateway-selector.ts`
- Modify: `packages/app/src/pages/attempts.$attemptId.run.tsx` (`handleClaimPlay`; add the `OfflineError` import)
- Modify: `packages/app/src/pages/index.tsx` (`continuableLocally` — re-read first; Part B + Task 16 touched it)
- Modify: `packages/app/src/main.tsx` (one call), `packages/app/src/lib/pwa/purge.ts` (Task 2)
- Modify: `packages/app/src/locales/*/runner.json`
- Test: `packages/app/test/local-gateway.test.ts`, `journal-sync.test.ts`, `hybrid-gateway.test.ts`, `owner.test.ts`, `packages/app/src/pages/attempts.$attemptId.run.offline.test.tsx`
- Create: `packages/app/test/helpers/envelope-fixture.ts`

**Interfaces:**
- Consumes: Task 19 (`JournalStore`, `LocalClock`, `LocalAttemptState`, `toPendingSection`, `makeLocalState`), Task 20 (`AttemptGateway`, `OfflineError`, `FlushContext`, `StartHint`, `RemoteAttemptGateway`), Task 15 (`offlineStore`, `makeBundle`), `ApiError`, `classifyForRetry`, `Scheduler` (`flushController.ts`), `toastStore` (Task 4), `networkStore` (Task 3).
- Produces:
  ```ts
  // local-gateway.ts
  export interface LocalGatewayDeps {
    readonly journal: JournalStore
    readonly clock: { nowMs(): number }
    readonly bundles: { list(): Promise<OfflineTestRecord[]>; getBundle(slug: string): Promise<OfflineBundle | null>; getMediaBlob(key: string): Promise<Blob | null> }
    readonly newId: () => string
    readonly objectUrl: (blob: Blob) => string
    readonly requestSync: () => void
    readonly ownerSub: () => string | null     // the signed-in student's JWT sub
  }
  export class LocalAttemptGateway implements AttemptGateway { constructor(deps: LocalGatewayDeps); hydrate(envelope: RunnerEnvelope): Promise<void> }
  // journal-sync.ts
  export interface OfflineSyncResponse { attemptId: string; ackedThrough: number; applied: number; late: number; rejected: number; answersAcked: number; finalized: { status: "expired" | "submitted"; resultUrl: string } | null }
  export type SyncOutcome = { kind: "nothing" } | { kind: "synced"; result: OfflineSyncResponse } | { kind: "offline" } | { kind: "terminal"; type: string }
  export interface JournalSync { syncNow(attemptId: string): Promise<SyncOutcome>; syncAll(): Promise<void>; request(): void }
  export function createJournalSync(deps: JournalSyncDeps): JournalSync   // deps.currentSub(): the signed-in student's sub; foreign-owned attempts are never synced
  // owner.ts
  export function currentSubject(): string | null                          // JWT sub of the current access token
  export function purgeSyncedAttempts(journal: JournalStore): Promise<void>
  // sync-status.ts
  export interface SyncStatusSnapshot { readonly syncing: boolean; readonly pendingAttempts: number; readonly pendingEvents: number; readonly failedAttemptIds: readonly string[] }
  export const syncStatus: { subscribe(l: () => void): () => void; getSnapshot(): SyncStatusSnapshot; set(next: SyncStatusSnapshot): void }
  // hybrid-gateway.ts
  export class HybridAttemptGateway implements AttemptGateway { constructor(deps: HybridDeps) }
  // gateway-selector.ts
  export function setAttemptGateway(next: AttemptGateway): void
  // install.ts
  export function installOfflineAttempts(): void
  // use-local-attempts.ts
  export function useLocalAttemptIds(): ReadonlySet<string>
  ```

#### Part A — the local envelope

- [ ] **Step 1: Implement the envelope builder** (no separate test: it is exercised through `loadEnvelope` in Part B's tests, and writing it first lets Part B compile).

Create `packages/app/src/lib/attempt/local-envelope.ts`:

```ts
import type {
  RunnerEnvelope,
  RunnerSection,
  StimulusWire,
} from "../api-types.js"
import type { LocalAttemptState } from "./journal-types.js"

export type MediaUrlResolver = (
  stimulusId: string,
  existingUrl: string | undefined,
) => Promise<string | undefined>

async function localStimulus(
  stimulus: StimulusWire,
  state: LocalAttemptState,
  resolveMediaUrl: MediaUrlResolver,
): Promise<StimulusWire> {
  if (stimulus.maxPlays !== null) {
    return { ...stimulus, playsUsed: state.playsUsed[stimulus.id] ?? 0 }
  }

  const mediaUrl = await resolveMediaUrl(stimulus.id, stimulus.mediaUrl)

  return mediaUrl === undefined ? stimulus : { ...stimulus, mediaUrl }
}

/**
 * The runner payload for a local attempt: the same shape `GET /attempts/:id`
 * returns, built from device state. `responses` is empty on purpose -- the run
 * screen merges the answer queue over the envelope on mount (its restore
 * effect), and the queue is the source of truth for unsent answers.
 */
export async function buildLocalEnvelope(
  state: LocalAttemptState,
  nowMs: number,
  resolveMediaUrl: MediaUrlResolver,
): Promise<RunnerEnvelope> {
  const sections: RunnerSection[] = await Promise.all(
    state.sections.map(async (section) => ({
      ...section,
      groups: await Promise.all(
        section.groups.map(async (group) => ({
          ...group,
          ...(group.stimulus
            ? {
                stimulus: await localStimulus(group.stimulus, state, resolveMediaUrl),
              }
            : {}),
        })),
      ),
    })),
  )
  const ordinals = sections
    .flatMap((section) => section.groups)
    .flatMap((group) => group.questions)
    .map((question) => question.ordinal)
    .sort((a, b) => a - b)

  return {
    id: state.attemptId,
    status: "in_progress",
    attemptNumber: state.attemptNumber,
    testTitle: state.title,
    expiresAt: state.attemptExpiresAt,
    serverTime: new Date(nowMs).toISOString(),
    questionCount: ordinals.length,
    answeredCount: 0,
    unansweredOrdinals: ordinals,
    currentSectionId: state.currentSectionId,
    currentQuestionId: state.currentQuestionId,
    sections,
    responses: [],
  }
}
```

#### Part B — `LocalAttemptGateway`

- [ ] **Step 2: Write the failing tests**

Create `packages/app/test/local-gateway.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { OfflineError } from "../src/lib/attempt/attempt-gateway.js"
import { JournalStore } from "../src/lib/attempt/journal-store.js"
import { LocalAttemptGateway } from "../src/lib/attempt/local-gateway.js"
import { makeBundle } from "./helpers/bundle-fixture.js"
import { makeLocalState } from "./helpers/local-state-fixture.js"

let n = 0
const T0 = Date.parse("2026-11-22T11:00:00.000Z")

async function setup(opts: { saved?: boolean; media?: boolean } = {}) {
  const journal = await JournalStore.open(`pp-local-gw-${(n += 1)}`)
  const now = { v: T0 }
  const bundle = makeBundle()
  const requestSync = vi.fn()
  const blob = new Blob([new Uint8Array([1, 2, 3, 4, 5, 6])], { type: "audio/mpeg" })
  const local = new LocalAttemptGateway({
    journal,
    clock: { nowMs: () => now.v },
    bundles: {
      list: () =>
        Promise.resolve(
          opts.saved === false
            ? []
            : [{ slug: bundle.slug, testVersionId: bundle.testVersionId, version: 1, title: bundle.title, level: bundle.level, totalBytes: 6, savedAt: "x" }],
        ),
      getBundle: (slug) =>
        Promise.resolve(opts.saved !== false && slug === bundle.slug ? bundle : null),
      getMediaBlob: (key) =>
        Promise.resolve(opts.media !== false && key === "l1.mp3" ? blob : null),
    },
    newId: () => "att-1",
    objectUrl: () => "blob:fake-audio",
    requestSync,
    ownerSub: () => "sub-1",
  })

  return { journal, now, local, requestSync }
}

const types = async (journal: JournalStore, id = "att-1"): Promise<string[]> =>
  (await journal.eventsAfter(id, 0)).map((e) => e.type)

describe("LocalAttemptGateway", () => {
  it("start creates a local attempt, journals a start event and resumes on a second call", async () => {
    const { local, journal, requestSync } = await setup()
    const started = await local.start("practice-3")

    expect(started).toMatchObject({ id: "att-1", status: "in_progress", resumed: false, expiresAt: null })
    expect(await types(journal)).toEqual(["start"])
    expect((await journal.getAttempt("att-1"))?.serverKnown).toBe(false)
    expect(requestSync).toHaveBeenCalled()
    expect(await local.start("practice-3")).toMatchObject({ id: "att-1", resumed: true })
    expect(await types(journal)).toEqual(["start"])
  })

  it("start records the owning student and never resumes another student's attempt on a shared device", async () => {
    const { local, journal } = await setup()

    await local.start("practice-3")

    expect((await journal.getAttempt("att-1"))?.ownerSub).toBe("sub-1")

    const sibling = new LocalAttemptGateway({
      journal,
      clock: { nowMs: () => T0 },
      bundles: {
        list: () => Promise.resolve([]),
        getBundle: () => Promise.resolve(makeBundle()),
        getMediaBlob: () => Promise.resolve(null),
      },
      newId: () => "att-sibling",
      objectUrl: () => "blob:x",
      requestSync: () => {},
      ownerSub: () => "sub-2",
    })
    const started = await sibling.start("practice-3")

    expect(started).toMatchObject({ id: "att-sibling", resumed: false })
  })

  it("start adopts an in-progress server attempt from the hint without journaling a start", async () => {
    const { local, journal } = await setup()
    const started = await local.start("practice-3", { inProgressAttemptId: "srv-9" })

    expect(started.id).toBe("srv-9")
    expect(await types(journal, "srv-9")).toEqual([])
    expect((await journal.getAttempt("srv-9"))).toMatchObject({ serverKnown: true, origin: "hydrated" })
  })

  it("start without a saved test throws OfflineError(not_saved)", async () => {
    const { local } = await setup({ saved: false })

    await expect(local.start("practice-3")).rejects.toMatchObject({ reason: "not_saved" })
  })

  it("enterSection starts the attempt clock on first entry, journals it, and is idempotent while open", async () => {
    const { local, journal } = await setup()

    await local.start("practice-3")

    const entry = await local.enterSection("att-1", "sec-l")

    expect(Date.parse(entry.expiresAt) - T0).toBe(600_000)
    expect(Date.parse(entry.attemptExpiresAt ?? "") - T0).toBe(1_200_000)
    expect(entry.playback).toEqual({ maxPlays: 1, allowPause: false, allowSeek: false })

    const again = await local.enterSection("att-1", "sec-l")

    expect(again.expiresAt).toBe(entry.expiresAt)
    expect(again.attemptStartedAt).toBeUndefined()
    expect(await types(journal)).toEqual(["start", "enter_section"])
  })

  it("refuses a second section while the first is still ticking", async () => {
    const { local } = await setup()

    await local.start("practice-3")
    await local.enterSection("att-1", "sec-l")

    await expect(local.enterSection("att-1", "sec-r")).rejects.toMatchObject({
      problem: { type: "section_still_open", status: 409 },
    })
  })

  it("forward-only: backwards is navigation_locked and not journaled; forwards is journaled", async () => {
    const { local, journal } = await setup()

    await local.start("practice-3")
    await local.enterSection("att-1", "sec-l")
    await local.setPosition("att-1", "sec-l", "q-l2")

    await expect(local.setPosition("att-1", "sec-l", "q-l1")).rejects.toMatchObject({
      problem: { type: "navigation_locked", status: 409 },
    })
    expect(await types(journal)).toEqual(["start", "enter_section", "position"])
  })

  it("position after the section clock ran out is section_expired", async () => {
    const { local, now } = await setup()

    await local.start("practice-3")
    await local.enterSection("att-1", "sec-l")
    now.v = T0 + 600_000

    await expect(local.setPosition("att-1", "sec-l", "q-l2")).rejects.toMatchObject({
      problem: { type: "section_expired", status: 410 },
    })
  })

  it("claimPlay spends the single play from the saved blob, then refuses", async () => {
    const { local, journal } = await setup()

    await local.start("practice-3")
    await local.enterSection("att-1", "sec-l")

    const grant = await local.claimPlay("att-1", "st-l")

    expect(grant).toMatchObject({ stimulusId: "st-l", playsUsed: 1, playsRemaining: 0, mediaUrl: "blob:fake-audio" })
    await expect(local.claimPlay("att-1", "st-l")).rejects.toMatchObject({
      problem: { type: "no_plays_remaining", status: 409 },
    })
    expect(await types(journal)).toEqual(["start", "enter_section", "play"])
  })

  it("claimPlay without the audio on this phone does NOT consume the play", async () => {
    const { local, journal } = await setup({ media: false })

    await local.start("practice-3")
    await local.enterSection("att-1", "sec-l")

    await expect(local.claimPlay("att-1", "st-l")).rejects.toBeInstanceOf(OfflineError)
    expect((await journal.getAttempt("att-1"))?.playsUsed["st-l"]).toBeUndefined()
    expect(await types(journal)).toEqual(["start", "enter_section"])
  })

  it("finishSection closes the section, names the next one, and the last returns null", async () => {
    const { local, journal } = await setup()

    await local.start("practice-3")
    await local.enterSection("att-1", "sec-l")

    const first = await local.finishSection("att-1", "sec-l", { clientInstanceId: "i", responses: [] })

    expect(first).toEqual({ sectionId: "sec-l", status: "finished", nextSectionId: "sec-r", finalFlush: [] })

    await local.enterSection("att-1", "sec-r")

    const last = await local.finishSection("att-1", "sec-r", { clientInstanceId: "i", responses: [] })

    expect(last.nextSectionId).toBeNull()
    expect(await types(journal)).toEqual(["start", "enter_section", "finish_section", "enter_section", "finish_section"])
  })

  it("past the whole-attempt deadline every call is attempt_expired with a result URL, and it stays finalized", async () => {
    const { local, now, journal } = await setup()

    await local.start("practice-3")
    await local.enterSection("att-1", "sec-l")
    now.v = T0 + 1_200_000

    await expect(local.setPosition("att-1", "sec-l", "q-l2")).rejects.toMatchObject({
      problem: {
        type: "attempt_expired",
        status: 410,
        attempt: { id: "att-1", status: "expired", resultUrl: "/attempts/att-1/result" },
      },
    })
    expect((await journal.getAttempt("att-1"))?.finalized?.status).toBe("expired")
  })

  it("submit is remote-only", async () => {
    const { local } = await setup()

    await expect(local.submit("att-1", { clientInstanceId: "i", responses: [] })).rejects.toMatchObject({
      reason: "offline",
    })
  })

  it("noteAnswer journals the answer with its queue seq", async () => {
    const { local, journal } = await setup()

    await local.start("practice-3")
    await local.enterSection("att-1", "sec-l")
    await local.noteAnswer("att-1", {
      attemptId: "att-1",
      sectionId: "sec-l",
      questionId: "q-l1",
      clientInstanceId: "dev",
      seq: 7,
      selectedChoiceIds: ["c-l1b"],
      answeredAt: "2026-11-22T11:00:05.000Z",
      timeSpentMs: null,
      terminalRejection: false,
    })

    const [, , answer] = await journal.eventsAfter("att-1", 0)

    expect(answer).toMatchObject({
      type: "answer",
      payload: { sectionId: "sec-l", questionId: "q-l1", clientInstanceId: "dev", seq: 7, selectedChoiceIds: ["c-l1b"] },
    })
  })

  it("loadEnvelope reports local progress and plays used", async () => {
    const { local } = await setup()

    await local.start("practice-3")
    await local.enterSection("att-1", "sec-l")
    await local.claimPlay("att-1", "st-l")

    const envelope = await local.loadEnvelope("att-1")
    const stimulus = envelope.sections[0]?.groups[0]?.stimulus

    expect(envelope).toMatchObject({ id: "att-1", currentSectionId: "sec-l", currentQuestionId: "q-l1", questionCount: 3 })
    expect(envelope.sections[0]).toMatchObject({ status: "open" })
    expect(stimulus && "playsUsed" in stimulus ? stimulus.playsUsed : -1).toBe(1)
  })

  it("hydrate converts server times to the local timeline and never overwrites local progress", async () => {
    const { local, journal, now } = await setup()
    const serverTime = "2026-11-22T11:00:30.000Z" // server is 30 s ahead of the local clock
    const envelope = {
      id: "srv-1",
      status: "in_progress" as const,
      attemptNumber: 2,
      testTitle: "Practice Test 3",
      expiresAt: "2026-11-22T11:10:30.000Z",
      serverTime,
      questionCount: 3,
      answeredCount: 0,
      unansweredOrdinals: [1, 2, 3],
      currentSectionId: "sec-l",
      currentQuestionId: "q-l1",
      sections: makeLocalState().sections.map((s) =>
        s.id === "sec-l"
          ? { ...s, status: "open" as const, expiresAt: "2026-11-22T11:10:30.000Z" }
          : s,
      ),
      responses: [],
    }

    await local.hydrate(envelope)

    const state = await journal.getAttempt("srv-1")

    // 11:10:30 server == 11:10:00 local
    expect(state?.attemptExpiresAt).toBe("2026-11-22T11:10:00.000Z")
    expect(state?.serverKnown).toBe(true)

    // Local work not yet acknowledged must win over a fresher-looking server snapshot.
    await journal.append("srv-1", { type: "position", clientAt: "2026-11-22T11:00:10.000Z", payload: {} }, (s) => ({ ...s, currentQuestionId: "q-l2" }))
    now.v = T0 + 20_000
    await local.hydrate(envelope)

    expect((await journal.getAttempt("srv-1"))?.currentQuestionId).toBe("q-l2")
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @pp/app exec vitest run test/local-gateway.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/attempt/local-gateway.js'`.

- [ ] **Step 4: Implement the local gateway**

Create `packages/app/src/lib/attempt/local-gateway.ts`:

```ts
import type { QueuedAnswer } from "../answerQueue.js"
import { ApiError } from "../api-client.js"
import type {
  AttemptStart,
  FinalizedAttempt,
  FinishSectionRequest,
  FinishSectionResult,
  OfflineBundle,
  PlayGrant,
  RunnerEnvelope,
  RunnerSection,
  SectionEntry,
  StimulusWire,
  SubmitRequest,
  SubmitResult,
} from "../api-types.js"
import type { FlushResult } from "../flushController.js"
import type { OfflineTestRecord } from "../offline/offline-store.js"
import {
  OfflineError,
  type AttemptGateway,
  type FlushContext,
  type StartHint,
} from "./attempt-gateway.js"
import type { JournalStore } from "./journal-store.js"
import type { JournalEventType, LocalAttemptState } from "./journal-types.js"
import { buildLocalEnvelope } from "./local-envelope.js"
import { toPendingSection } from "./local-sections.js"

export interface LocalGatewayDeps {
  readonly journal: JournalStore
  readonly clock: { nowMs(): number }
  readonly bundles: {
    list(): Promise<OfflineTestRecord[]>
    getBundle(slug: string): Promise<OfflineBundle | null>
    getMediaBlob(key: string): Promise<Blob | null>
  }
  readonly newId: () => string
  readonly objectUrl: (blob: Blob) => string
  readonly requestSync: () => void
  /** The signed-in student's JWT `sub`; stamped on every attempt this gateway creates or mirrors. */
  readonly ownerSub: () => string | null
}

const iso = (ms: number): string => new Date(ms).toISOString()

/** The `ApiError` the server would have sent, so page error handling needs no new branch. */
function problem(
  type: string,
  status: number,
  extra: Partial<ApiError["problem"]> = {},
): ApiError {
  return new ApiError({ type, title: type, status, ...extra })
}

const questionsOf = (section: RunnerSection) =>
  section.groups.flatMap((group) => group.questions)

const firstQuestionId = (section: RunnerSection): string | null =>
  questionsOf(section)[0]?.id ?? null

function findQuestion(
  state: LocalAttemptState,
  questionId: string,
): { sectionId: string; ordinal: number } | null {
  for (const section of state.sections) {
    const question = questionsOf(section).find((q) => q.id === questionId)

    if (question) {
      return { sectionId: section.id, ordinal: question.ordinal }
    }
  }

  return null
}

function findStimulus(
  state: LocalAttemptState,
  stimulusId: string,
): StimulusWire | null {
  for (const section of state.sections) {
    for (const group of section.groups) {
      if (group.stimulus?.id === stimulusId) {
        return group.stimulus
      }
    }
  }

  return null
}

const isTicking = (section: RunnerSection, nowMs: number): boolean =>
  section.status === "open" &&
  section.expiresAt !== null &&
  nowMs < Date.parse(section.expiresAt)

/**
 * Journal-first implementation of the attempt lifecycle for use with no
 * network. Every mutation appends a journal event AND updates the local state
 * in one IndexedDB transaction (`JournalStore.append`), then asks for a sync.
 * It enforces the same rules the server does (forward-only, play cap, section
 * and attempt clocks) so a student sees identical behaviour on and off line --
 * and the server re-checks them when it replays the journal.
 */
export class LocalAttemptGateway implements AttemptGateway {
  private readonly deps: LocalGatewayDeps

  constructor(deps: LocalGatewayDeps) {
    this.deps = deps
  }

  async start(slug: string, hint?: StartHint): Promise<AttemptStart> {
    const bundle = await this.deps.bundles.getBundle(slug)

    if (!bundle) {
      throw new OfflineError("not_saved")
    }

    const nowMs = this.deps.clock.nowMs()
    const owner = this.deps.ownerSub()
    // Siblings share an iPad: only THIS student's attempts can be resumed or counted.
    const known = (await this.deps.journal.listAttempts()).filter((a) => a.ownerSub === owner)
    const existing = known.find((a) => a.slug === slug && a.finalized === null)

    if (existing) {
      return this.startView(existing, true, nowMs)
    }

    const adopted = hint?.inProgressAttemptId ?? null
    const attemptId = adopted ?? this.deps.newId()
    const state: LocalAttemptState = {
      attemptId,
      slug,
      testVersionId: bundle.testVersionId,
      title: bundle.title,
      attemptNumber: known.filter((a) => a.slug === slug).length + 1,
      ownerSub: owner,
      origin: adopted ? "hydrated" : "offline",
      serverKnown: adopted !== null,
      createdAt: iso(nowMs),
      versionDurationSeconds: bundle.durationSeconds,
      sections: bundle.sections.map(toPendingSection),
      playbackBySection: Object.fromEntries(
        bundle.sections.map((s) => [s.id, s.playback]),
      ),
      mediaKeyByStimulus: Object.fromEntries(
        bundle.media.map((m) => [m.stimulusId, m.key]),
      ),
      attemptStartedAt: null,
      attemptExpiresAt: null,
      currentSectionId: null,
      currentQuestionId: null,
      playsUsed: {},
      nextEventSeq: 1,
      syncedThrough: 0,
      finalized: null,
      syncError: null,
    }

    await this.deps.journal.putAttempt(state)

    if (adopted === null) {
      await this.record(state, "start", { slug, testVersionId: bundle.testVersionId }, nowMs, (s) => s)
    }

    return this.startView(state, false, nowMs)
  }

  /**
   * Called by the hybrid gateway every time a remote envelope loads, so an
   * attempt that later loses connectivity can continue locally. It NEVER
   * overwrites local state that is ahead of the server (unsynced events, or an
   * attempt the server does not know yet).
   */
  async hydrate(envelope: RunnerEnvelope): Promise<void> {
    const existing = await this.deps.journal.getAttempt(envelope.id)

    if (
      existing &&
      (!existing.serverKnown ||
        (await this.deps.journal.pendingCount(envelope.id)) > 0)
    ) {
      return
    }

    const nowMs = this.deps.clock.nowMs()
    // server clock minus local clock, fixed at load: server instants are
    // re-expressed on the local timeline so deadlines are judged by one clock.
    const offset = Date.parse(envelope.serverTime) - nowMs
    const toLocal = (serverIso: string | null): string | null =>
      serverIso === null ? null : iso(Date.parse(serverIso) - offset)
    const sections = envelope.sections.map((section) => ({
      ...section,
      expiresAt: toLocal(section.expiresAt),
      completedAt: toLocal(section.completedAt),
    }))
    const playsUsed: Record<string, number> = {}

    for (const section of sections) {
      for (const group of section.groups) {
        if (group.stimulus && group.stimulus.maxPlays !== null) {
          playsUsed[group.stimulus.id] = group.stimulus.playsUsed
        }
      }
    }

    const versionDurationSeconds = sections.reduce((n, s) => n + s.durationSeconds, 0)
    const attemptExpiresAt = toLocal(envelope.expiresAt)

    await this.deps.journal.putAttempt({
      attemptId: envelope.id,
      slug: existing?.slug ?? null,
      testVersionId: existing?.testVersionId ?? null,
      title: envelope.testTitle,
      attemptNumber: envelope.attemptNumber,
      ownerSub: existing?.ownerSub ?? this.deps.ownerSub(),
      origin: existing?.origin ?? "hydrated",
      serverKnown: true,
      createdAt: existing?.createdAt ?? iso(nowMs),
      versionDurationSeconds,
      sections,
      playbackBySection: existing?.playbackBySection ?? {},
      mediaKeyByStimulus: existing?.mediaKeyByStimulus ?? {},
      attemptStartedAt:
        attemptExpiresAt === null
          ? null
          : iso(Date.parse(attemptExpiresAt) - versionDurationSeconds * 1000),
      attemptExpiresAt,
      currentSectionId: envelope.currentSectionId,
      currentQuestionId: envelope.currentQuestionId,
      playsUsed,
      nextEventSeq: existing?.nextEventSeq ?? 1,
      syncedThrough: existing?.syncedThrough ?? 0,
      finalized: null,
      syncError: null,
    })
  }

  async loadEnvelope(attemptId: string): Promise<RunnerEnvelope> {
    const state = await this.mustGet(attemptId)
    const nowMs = this.deps.clock.nowMs()

    await this.assertLive(state, nowMs)

    return buildLocalEnvelope(state, nowMs, async (stimulusId, existingUrl) => {
      const key = await this.mediaKeyFor(state, stimulusId)
      const blob = key === null ? null : await this.deps.bundles.getMediaBlob(key)

      return blob ? this.deps.objectUrl(blob) : existingUrl
    })
  }

  async enterSection(attemptId: string, sectionId: string): Promise<SectionEntry> {
    const state = await this.mustGet(attemptId)
    const nowMs = this.deps.clock.nowMs()

    await this.assertLive(state, nowMs)

    const section = state.sections.find((s) => s.id === sectionId)

    if (!section) {
      throw problem("not_found", 404)
    }

    if (isTicking(section, nowMs)) {
      return this.entryView(state, section, nowMs, false)
    }

    if (section.status !== "pending") {
      throw problem("section_expired", 410)
    }

    if (state.sections.some((s) => s.id !== sectionId && isTicking(s, nowMs))) {
      throw problem("section_still_open", 409)
    }

    const first = state.attemptStartedAt === null
    const expiresAt = iso(nowMs + section.durationSeconds * 1000)
    const next = await this.record(state, "enter_section", { sectionId }, nowMs, (s) => ({
      ...s,
      sections: s.sections.map((candidate) => {
        if (candidate.id === sectionId) {
          return { ...candidate, status: "open" as const, expiresAt }
        }

        // A previous section whose clock ran out is closed lazily, as the server does.
        return candidate.status === "open"
          ? { ...candidate, status: "closed" as const, completedAt: candidate.expiresAt }
          : candidate
      }),
      currentSectionId: sectionId,
      currentQuestionId: firstQuestionId(section),
      attemptStartedAt: first ? iso(nowMs) : s.attemptStartedAt,
      attemptExpiresAt: first
        ? iso(nowMs + s.versionDurationSeconds * 1000)
        : s.attemptExpiresAt,
    }))
    const entered = next.sections.find((s) => s.id === sectionId) ?? section

    return this.entryView(next, entered, nowMs, first)
  }

  async setPosition(attemptId: string, sectionId: string, questionId: string): Promise<void> {
    const state = await this.mustGet(attemptId)
    const nowMs = this.deps.clock.nowMs()

    await this.assertLive(state, nowMs)

    const section = state.sections.find((s) => s.id === sectionId)
    const target = findQuestion(state, questionId)

    if (!section || !target || target.sectionId !== sectionId) {
      throw problem("not_found", 404)
    }

    if (section.status === "closed") {
      throw problem("navigation_locked", 409)
    }

    if (section.status !== "open" || !isTicking(section, nowMs)) {
      throw problem("section_expired", 410)
    }

    const current =
      state.currentQuestionId === null ? null : findQuestion(state, state.currentQuestionId)

    if (
      section.navigation === "forward_only" &&
      current?.sectionId === sectionId &&
      target.ordinal < current.ordinal
    ) {
      throw problem("navigation_locked", 409)
    }

    await this.record(state, "position", { sectionId, questionId }, nowMs, (s) => ({
      ...s,
      currentSectionId: sectionId,
      currentQuestionId: questionId,
    }))
  }

  async claimPlay(attemptId: string, stimulusId: string): Promise<PlayGrant> {
    const state = await this.mustGet(attemptId)
    const nowMs = this.deps.clock.nowMs()

    await this.assertLive(state, nowMs)

    const stimulus = findStimulus(state, stimulusId)

    if (!stimulus) {
      throw problem("not_found", 404)
    }

    const used = state.playsUsed[stimulusId] ?? 0

    if (stimulus.maxPlays !== null && used >= stimulus.maxPlays) {
      throw problem("no_plays_remaining", 409)
    }

    // The play is only spent if the audio is actually on this phone: claiming
    // first and failing to play would burn the student's single play for nothing.
    const key = await this.mediaKeyFor(state, stimulusId)
    const blob = key === null ? null : await this.deps.bundles.getMediaBlob(key)

    if (!blob) {
      throw new OfflineError("media_missing")
    }

    await this.record(state, "play", { stimulusId }, nowMs, (s) => ({
      ...s,
      playsUsed: { ...s.playsUsed, [stimulusId]: used + 1 },
    }))

    return {
      stimulusId,
      playsUsed: used + 1,
      playsRemaining: stimulus.maxPlays === null ? null : stimulus.maxPlays - (used + 1),
      mediaUrl: this.deps.objectUrl(blob),
      urlExpiresAt: iso(nowMs + 5 * 60_000),
    }
  }

  async finishSection(
    attemptId: string,
    sectionId: string,
    _body: FinishSectionRequest,
  ): Promise<FinishSectionResult> {
    const state = await this.mustGet(attemptId)
    const nowMs = this.deps.clock.nowMs()

    await this.assertLive(state, nowMs)

    const index = state.sections.findIndex((s) => s.id === sectionId)
    const section = state.sections[index]

    if (!section) {
      throw problem("not_found", 404)
    }

    const nextSectionId = state.sections[index + 1]?.id ?? null
    const done: FinishSectionResult = {
      sectionId,
      status: "finished",
      nextSectionId,
      finalFlush: [],
    }

    if (section.status === "closed") {
      return done
    }

    if (section.status !== "open" || state.currentSectionId !== sectionId) {
      throw problem("section_not_open", 409)
    }

    await this.record(state, "finish_section", { sectionId }, nowMs, (s) => ({
      ...s,
      sections: s.sections.map((candidate) =>
        candidate.id === sectionId
          ? { ...candidate, status: "closed" as const, completedAt: iso(nowMs) }
          : candidate,
      ),
    }))

    return done
  }

  submit(_attemptId: string, _body: SubmitRequest): Promise<SubmitResult> {
    return Promise.reject(new OfflineError("offline"))
  }

  async noteAnswer(attemptId: string, answer: QueuedAnswer): Promise<void> {
    const state = await this.deps.journal.getAttempt(attemptId)

    if (!state) {
      return
    }

    await this.record(
      state,
      "answer",
      {
        sectionId: answer.sectionId,
        questionId: answer.questionId,
        clientInstanceId: answer.clientInstanceId,
        seq: answer.seq,
        selectedChoiceIds: answer.selectedChoiceIds,
        ...(answer.timeSpentMs === null ? {} : { timeSpentMs: answer.timeSpentMs }),
      },
      this.deps.clock.nowMs(),
      (s) => s,
    )
  }

  async flushAnswers(ctx: FlushContext): Promise<FlushResult> {
    this.deps.requestSync()

    const pending = (await ctx.queue.snapshotForSection(ctx.attemptId, ctx.sectionId)).length

    return pending === 0
      ? {
          flushed: true,
          rejectedQuestionIds: [],
          saveState: { status: "saved", pendingCount: 0 },
          outcome: "success",
        }
      : {
          flushed: false,
          rejectedQuestionIds: [],
          saveState: { status: "pending", pendingCount: pending },
          outcome: "retryable-failure",
        }
  }

  async isLocalOnly(attemptId: string): Promise<boolean> {
    const state = await this.deps.journal.getAttempt(attemptId)

    return state !== null && !state.serverKnown
  }

  // ---- internals ----

  private async mustGet(attemptId: string): Promise<LocalAttemptState> {
    const state = await this.deps.journal.getAttempt(attemptId)

    if (!state) {
      throw new OfflineError("not_hydrated")
    }

    return state
  }

  private async record(
    state: LocalAttemptState,
    type: JournalEventType,
    payload: Record<string, unknown>,
    nowMs: number,
    mutate: (s: LocalAttemptState) => LocalAttemptState,
  ): Promise<LocalAttemptState> {
    await this.deps.journal.append(
      state.attemptId,
      { type, clientAt: iso(nowMs), payload },
      mutate,
    )
    this.deps.requestSync()

    return mutate(state)
  }

  private async assertLive(state: LocalAttemptState, nowMs: number): Promise<void> {
    if (state.finalized) {
      throw this.expired(state)
    }

    if (state.attemptExpiresAt !== null && nowMs >= Date.parse(state.attemptExpiresAt)) {
      const finalized = {
        status: "expired" as const,
        submittedAt: state.attemptExpiresAt,
      }

      await this.deps.journal.update(state.attemptId, (s) => ({ ...s, finalized }))

      throw this.expired({ ...state, finalized })
    }
  }

  private expired(state: LocalAttemptState): ApiError {
    const attempt: FinalizedAttempt = {
      id: state.attemptId,
      status: "expired",
      submittedAt: state.finalized?.submittedAt ?? state.attemptExpiresAt ?? iso(0),
      resultUrl: `/attempts/${state.attemptId}/result`,
    }

    return problem("attempt_expired", 410, { attempt })
  }

  private async mediaKeyFor(
    state: LocalAttemptState,
    stimulusId: string,
  ): Promise<string | null> {
    const direct = state.mediaKeyByStimulus[stimulusId]

    if (direct) {
      return direct
    }

    // A hydrated attempt has no bundle of its own: find the saved test whose
    // media manifest names this stimulus (stimulus ids are unique per version).
    for (const record of await this.deps.bundles.list()) {
      // eslint-disable-next-line no-await-in-loop
      const bundle = await this.deps.bundles.getBundle(record.slug)
      const hit = bundle?.media.find((m) => m.stimulusId === stimulusId)

      if (hit) {
        return hit.key
      }
    }

    return null
  }

  private startView(state: LocalAttemptState, resumed: boolean, nowMs: number): AttemptStart {
    return {
      id: state.attemptId,
      attemptNumber: state.attemptNumber,
      status: "in_progress",
      createdAt: state.createdAt,
      startedAt: state.attemptStartedAt,
      expiresAt: state.attemptExpiresAt,
      serverTime: iso(nowMs),
      resumed,
      currentSectionId: state.currentSectionId,
      currentQuestionId: state.currentQuestionId,
      finalizedPriorAttempt: null,
    }
  }

  private entryView(
    state: LocalAttemptState,
    section: RunnerSection,
    nowMs: number,
    first: boolean,
  ): SectionEntry {
    const expiresAt = section.expiresAt ?? iso(nowMs)

    return {
      sectionId: section.id,
      title: section.title,
      type: section.type,
      questionCount: section.questionCount,
      enteredAt: iso(Date.parse(expiresAt) - section.durationSeconds * 1000),
      expiresAt,
      serverTime: iso(nowMs),
      ...(first && state.attemptStartedAt && state.attemptExpiresAt
        ? {
            attemptStartedAt: state.attemptStartedAt,
            attemptExpiresAt: state.attemptExpiresAt,
          }
        : {}),
      navigation: section.navigation,
      allowAnswerChange: section.allowAnswerChange,
      playback: state.playbackBySection[section.id] ?? null,
      instructions: section.instructions,
    }
  }
}
```

- [ ] **Step 5: Run the local-gateway tests to verify they pass**

Run: `pnpm --filter @pp/app exec vitest run test/local-gateway.test.ts && pnpm --filter @pp/app exec tsc --noEmit`
Expected: 16 tests PASS, typecheck clean.

#### Part C — sync status and journal sync

- [ ] **Step 6: Write the failing sync tests**

Create `packages/app/test/journal-sync.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AnswerQueue } from "../src/lib/answerQueue.js"
import { ApiError } from "../src/lib/api-client.js"
import { JournalStore } from "../src/lib/attempt/journal-store.js"
import {
  createJournalSync,
  purgeSyncedAttempts,
  type OfflineSyncResponse,
} from "../src/lib/attempt/journal-sync.js"
import { createSyncStatusStore } from "../src/lib/attempt/sync-status.js"
import { makeLocalState } from "./helpers/local-state-fixture.js"

let n = 0
const at = "2026-11-22T11:00:00.000Z"

const ok = (over: Partial<OfflineSyncResponse> = {}): OfflineSyncResponse => ({
  attemptId: "att-1",
  ackedThrough: 3,
  applied: 3,
  late: 0,
  rejected: 0,
  answersAcked: 1,
  finalized: null,
  ...over,
})

async function setup(post: (body: unknown) => Promise<OfflineSyncResponse>, online = true) {
  n += 1
  const journal = await JournalStore.open(`pp-sync-${n}`)
  const queue = await AnswerQueue.open(`pp-sync-q-${n}`)
  const onSynced = vi.fn()
  const scheduler = vi.fn().mockResolvedValue(undefined)
  const status = createSyncStatusStore()
  const sync = createJournalSync({
    journal,
    post: post as never,
    openQueue: () => Promise.resolve(queue),
    scheduler,
    wallNow: () => Date.parse(at),
    isOnline: () => online,
    currentSub: () => "sub-1",
    onSynced,
    status,
  })

  await journal.putAttempt(makeLocalState())
  await journal.append("att-1", { type: "start", clientAt: at, payload: { slug: "p3" } })
  await journal.append("att-1", { type: "enter_section", clientAt: at, payload: { sectionId: "sec-l" } })
  await journal.append("att-1", { type: "answer", clientAt: at, payload: { sectionId: "sec-l", questionId: "q-l1", clientInstanceId: queue.clientInstanceId(), seq: 1, selectedChoiceIds: ["c-l1a"] } })

  return { journal, queue, onSynced, scheduler, status, sync }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe("createJournalSync", () => {
  it("posts pending events, marks them synced, flips serverKnown, acks the answer queue and reports the count", async () => {
    const post = vi.fn().mockResolvedValue(ok())
    const { journal, queue, onSynced, sync } = await setup(post)

    await queue.recordAnswer({ attemptId: "att-1", sectionId: "sec-l", questionId: "q-l1", selectedChoiceIds: ["c-l1a"], timeSpentMs: null }, new Date(at))

    const outcome = await sync.syncNow("att-1")

    expect(outcome.kind).toBe("synced")
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: "att-1",
        clientSentAt: at,
        events: [
          expect.objectContaining({ eventSeq: 1, type: "start" }),
          expect.objectContaining({ eventSeq: 2, type: "enter_section" }),
          expect.objectContaining({ eventSeq: 3, type: "answer" }),
        ],
      }),
    )
    expect(await journal.pendingCount("att-1")).toBe(0)
    expect((await journal.getAttempt("att-1"))?.serverKnown).toBe(true)
    expect(await queue.snapshotForAttempt("att-1")).toEqual([])
    expect(onSynced).toHaveBeenCalledWith({ attemptId: "att-1", answersAcked: 1 })
  })

  it("does nothing when there is nothing to send, and does not call the network when offline", async () => {
    const post = vi.fn()
    const offline = await setup(post, false)

    expect(await offline.sync.syncNow("att-1")).toEqual({ kind: "offline" })
    expect(post).not.toHaveBeenCalled()
    expect(await offline.sync.syncNow("no-such-attempt")).toEqual({ kind: "nothing" })
  })

  it("retries a 5xx with backoff, then succeeds", async () => {
    const post = vi
      .fn()
      .mockRejectedValueOnce(new ApiError({ type: "unexpected_error", title: "x", status: 500 }))
      .mockResolvedValue(ok())
    const { sync, scheduler } = await setup(post)

    expect((await sync.syncNow("att-1")).kind).toBe("synced")
    expect(post).toHaveBeenCalledTimes(2)
    expect(scheduler).toHaveBeenCalledWith(500)
  })

  it("stops dead on a 4xx, records the problem type and does not retry", async () => {
    const post = vi
      .fn()
      .mockRejectedValue(new ApiError({ type: "offline_attempt_conflict", title: "x", status: 409 }))
    const { sync, journal, status } = await setup(post)

    expect(await sync.syncNow("att-1")).toEqual({ kind: "terminal", type: "offline_attempt_conflict" })
    expect(post).toHaveBeenCalledTimes(1)
    expect((await journal.getAttempt("att-1"))?.syncError).toBe("offline_attempt_conflict")
    expect(status.getSnapshot().failedAttemptIds).toEqual(["att-1"])
  })

  it("treats a network failure as offline and keeps the journal", async () => {
    const post = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
    const { sync, journal } = await setup(post)

    expect((await sync.syncNow("att-1")).kind).toBe("offline")
    expect(await journal.pendingCount("att-1")).toBe(3)
  })

  it("records a server-side finalization (time ran out while offline)", async () => {
    const post = vi.fn().mockResolvedValue(ok({ finalized: { status: "expired", resultUrl: "/attempts/att-1/result" } }))
    const { sync, journal } = await setup(post)

    await sync.syncNow("att-1")

    expect((await journal.getAttempt("att-1"))?.finalized?.status).toBe("expired")
  })

  it("dedupes concurrent syncs of the same attempt into one request", async () => {
    const post = vi.fn().mockResolvedValue(ok())
    const { sync } = await setup(post)

    await Promise.all([sync.syncNow("att-1"), sync.syncNow("att-1")])

    expect(post).toHaveBeenCalledTimes(1)
  })

  it("never syncs (or counts) another student's attempt on a shared device", async () => {
    const post = vi.fn().mockResolvedValue(ok({ attemptId: "att-sibling" }))
    const { sync, journal, status } = await setup(post)

    await journal.putAttempt(makeLocalState({ attemptId: "att-sibling", ownerSub: "sub-2" }))
    await journal.append("att-sibling", { type: "start", clientAt: at, payload: { slug: "p3" } })

    expect(await sync.syncNow("att-sibling")).toEqual({ kind: "nothing" })

    await sync.syncAll()

    expect(post).toHaveBeenCalledTimes(1) // only the signed-in student's att-1
    expect(await journal.pendingCount("att-sibling")).toBe(1)
    expect(status.getSnapshot().pendingAttempts).toBe(0)
  })

  it("publishes pending counts to the status store", async () => {
    const post = vi.fn().mockResolvedValue(ok())
    const { sync, status } = await setup(post)

    await sync.syncAll()

    expect(status.getSnapshot()).toMatchObject({ syncing: false, pendingAttempts: 0, pendingEvents: 0 })
  })
})

describe("purgeSyncedAttempts", () => {
  it("removes fully synced attempts but never unsynced work (spec D8)", async () => {
    const journal = await JournalStore.open("pp-purge-test")

    await journal.putAttempt(makeLocalState({ attemptId: "done", serverKnown: true }))
    await journal.putAttempt(makeLocalState({ attemptId: "unsynced", serverKnown: true }))
    await journal.append("unsynced", { type: "play", clientAt: at, payload: {} })
    await journal.putAttempt(makeLocalState({ attemptId: "never-sent", serverKnown: false }))

    await purgeSyncedAttempts(journal)

    expect((await journal.listAttempts()).map((a) => a.attemptId).sort()).toEqual(["never-sent", "unsynced"])
  })
})
```

- [ ] **Step 7: Run to verify it fails**

Run: `pnpm --filter @pp/app exec vitest run test/journal-sync.test.ts`
Expected: FAIL — modules `journal-sync.js` / `sync-status.js` missing.

- [ ] **Step 8: Implement sync status and journal sync**

Create `packages/app/src/lib/attempt/sync-status.ts`:

```ts
export interface SyncStatusSnapshot {
  readonly syncing: boolean
  readonly pendingAttempts: number
  readonly pendingEvents: number
  readonly failedAttemptIds: readonly string[]
}

export interface SyncStatusStore {
  subscribe(listener: () => void): () => void
  getSnapshot(): SyncStatusSnapshot
  set(next: SyncStatusSnapshot): void
}

const IDLE: SyncStatusSnapshot = {
  syncing: false,
  pendingAttempts: 0,
  pendingEvents: 0,
  failedAttemptIds: [],
}

const same = (a: SyncStatusSnapshot, b: SyncStatusSnapshot): boolean =>
  a.syncing === b.syncing &&
  a.pendingAttempts === b.pendingAttempts &&
  a.pendingEvents === b.pendingEvents &&
  a.failedAttemptIds.join(",") === b.failedAttemptIds.join(",")

/** `getSnapshot()` is reference-stable until a field changes (useSyncExternalStore). */
export function createSyncStatusStore(): SyncStatusStore {
  let current = IDLE
  const listeners = new Set<() => void>()

  return {
    subscribe(listener) {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => current,
    set(next) {
      if (same(current, next)) {
        return
      }

      current = next
      listeners.forEach((listener) => listener())
    },
  }
}

export const syncStatus: SyncStatusStore = createSyncStatusStore()
```

Create `packages/app/src/lib/attempt/journal-sync.ts`:

```ts
import type { AnswerQueue } from "../answerQueue.js"
import { ApiError } from "../api-client.js"
import { apiFetch } from "../api-client.js"
import type { Scheduler } from "../flushController.js"
import { classifyForRetry } from "../retryClassifier.js"
import type { JournalStore } from "./journal-store.js"
import type { JournalEventRecord } from "./journal-types.js"
import type { SyncStatusStore } from "./sync-status.js"

export interface OfflineSyncResponse {
  attemptId: string
  ackedThrough: number
  applied: number
  late: number
  rejected: number
  answersAcked: number
  finalized: { status: "expired" | "submitted"; resultUrl: string } | null
}

export interface OfflineSyncBody {
  attemptId: string
  clientSentAt: string
  events: Array<{
    eventSeq: number
    type: string
    clientAt: string
    payload: Readonly<Record<string, unknown>>
  }>
}

export type SyncOutcome =
  | { kind: "nothing" }
  | { kind: "synced"; result: OfflineSyncResponse }
  | { kind: "offline" }
  | { kind: "terminal"; type: string }

export interface JournalSyncDeps {
  readonly journal: JournalStore
  readonly post: (body: OfflineSyncBody) => Promise<OfflineSyncResponse>
  readonly openQueue: () => Promise<AnswerQueue>
  readonly scheduler: Scheduler
  readonly wallNow: () => number
  readonly isOnline: () => boolean
  /** The signed-in student's JWT `sub`. Attempts owned by anyone else are invisible to sync. */
  readonly currentSub: () => string | null
  readonly onSynced: (result: { attemptId: string; answersAcked: number }) => void
  readonly status: SyncStatusStore
}

export interface JournalSync {
  syncNow(attemptId: string): Promise<SyncOutcome>
  syncAll(): Promise<void>
  /** Debounced: coalesces a burst of appends into one sync. */
  request(): void
}

const MAX_ATTEMPTS = 5
const DEBOUNCE_MS = 1500

export const postOfflineSync = (body: OfflineSyncBody): Promise<OfflineSyncResponse> =>
  apiFetch<OfflineSyncResponse>("/attempts/offline-sync", {
    method: "POST",
    body: JSON.stringify(body),
  })

const toWire = (event: JournalEventRecord): OfflineSyncBody["events"][number] => ({
  eventSeq: event.eventSeq,
  type: event.type,
  clientAt: event.clientAt,
  payload: event.payload,
})

export function createJournalSync(deps: JournalSyncDeps): JournalSync {
  const inflight = new Map<string, Promise<SyncOutcome>>()
  let timer: ReturnType<typeof setTimeout> | undefined

  const isMine = (ownerSub: string | null): boolean =>
    ownerSub === null || ownerSub === deps.currentSub()

  async function publish(syncing: boolean): Promise<void> {
    const attempts = (await deps.journal.listAttempts()).filter((a) => isMine(a.ownerSub))
    let pendingEvents = 0
    let pendingAttempts = 0

    for (const attempt of attempts) {
      // eslint-disable-next-line no-await-in-loop
      const count = await deps.journal.pendingCount(attempt.attemptId)

      pendingEvents += count
      pendingAttempts += count > 0 ? 1 : 0
    }

    deps.status.set({
      syncing,
      pendingAttempts,
      pendingEvents,
      failedAttemptIds: attempts.filter((a) => a.syncError !== null).map((a) => a.attemptId),
    })
  }

  async function ackAnswers(
    attemptId: string,
    events: readonly JournalEventRecord[],
    ackedThrough: number,
  ): Promise<void> {
    const queue = await deps.openQueue()

    for (const event of events) {
      if (event.type === "answer" && event.eventSeq <= ackedThrough) {
        const { questionId, seq } = event.payload as { questionId: string; seq: number }

        // eslint-disable-next-line no-await-in-loop
        await queue.ackItem(attemptId, questionId, seq)
      }
    }
  }

  async function run(attemptId: string): Promise<SyncOutcome> {
    const state = await deps.journal.getAttempt(attemptId)

    if (!state || !isMine(state.ownerSub)) {
      return { kind: "nothing" }
    }

    const events = await deps.journal.eventsAfter(attemptId, state.syncedThrough)

    if (events.length === 0) {
      return { kind: "nothing" }
    }

    if (!deps.isOnline()) {
      return { kind: "offline" }
    }

    await publish(true)

    try {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        let response: OfflineSyncResponse

        try {
          // eslint-disable-next-line no-await-in-loop
          response = await deps.post({
            attemptId,
            clientSentAt: new Date(deps.wallNow()).toISOString(),
            events: events.map(toWire),
          })
        } catch (error) {
          const outcome =
            error instanceof ApiError
              ? classifyForRetry({ kind: "http-status", status: error.problem.status }, attempt)
              : classifyForRetry({ kind: "network-error" }, attempt)

          if (error instanceof ApiError && !outcome.retry) {
            // eslint-disable-next-line no-await-in-loop
            await deps.journal.update(attemptId, (s) => ({ ...s, syncError: error.problem.type }))

            return { kind: "terminal", type: error.problem.type }
          }

          if (!outcome.retry || attempt === MAX_ATTEMPTS || !deps.isOnline()) {
            return { kind: "offline" }
          }

          // eslint-disable-next-line no-await-in-loop
          await deps.scheduler(outcome.backoffMs)

          continue
        }

        // eslint-disable-next-line no-await-in-loop
        await deps.journal.markSynced(attemptId, response.ackedThrough)
        // eslint-disable-next-line no-await-in-loop
        await deps.journal.update(attemptId, (s) => ({
          ...s,
          serverKnown: true,
          syncError: null,
          finalized:
            response.finalized?.status === "expired"
              ? { status: "expired", submittedAt: s.attemptExpiresAt ?? new Date(deps.wallNow()).toISOString() }
              : s.finalized,
        }))
        // eslint-disable-next-line no-await-in-loop
        await ackAnswers(attemptId, events, response.ackedThrough)

        if (response.answersAcked > 0) {
          deps.onSynced({ attemptId, answersAcked: response.answersAcked })
        }

        return { kind: "synced", result: response }
      }

      return { kind: "offline" }
    } finally {
      await publish(false)
    }
  }

  function syncNow(attemptId: string): Promise<SyncOutcome> {
    const existing = inflight.get(attemptId)

    if (existing) {
      return existing
    }

    const started = run(attemptId).finally(() => {
      inflight.delete(attemptId)
    })

    inflight.set(attemptId, started)

    return started
  }

  async function syncAll(): Promise<void> {
    for (const attempt of await deps.journal.listAttempts()) {
      // eslint-disable-next-line no-await-in-loop
      await syncNow(attempt.attemptId)
    }

    await purgeSyncedAttempts(deps.journal)
    await publish(false)
  }

  return {
    syncNow,
    syncAll,
    request() {
      clearTimeout(timer)
      timer = setTimeout(() => {
        void syncAll()
      }, DEBOUNCE_MS)
    },
  }
}

/**
 * Deletes attempts the server fully holds (known, nothing pending). Unsynced
 * work is NEVER deleted -- not even on sign-out -- exactly like the answer
 * queue (spec D8): the next sign-in must still be able to send it.
 */
export async function purgeSyncedAttempts(journal: JournalStore): Promise<void> {
  for (const attempt of await journal.listAttempts()) {
    // eslint-disable-next-line no-await-in-loop
    if (attempt.serverKnown && (await journal.pendingCount(attempt.attemptId)) === 0) {
      // eslint-disable-next-line no-await-in-loop
      await journal.deleteAttempt(attempt.attemptId)
    }
  }
}
```

- [ ] **Step 9: Run the sync tests to verify they pass**

Run: `pnpm --filter @pp/app exec vitest run test/journal-sync.test.ts && pnpm --filter @pp/app exec tsc --noEmit`
Expected: 10 tests PASS. (If the `retries a 5xx` test shows `scheduler` called with something other than `500`, check `BASE_BACKOFF_MS` in `retryClassifier.ts`.)

#### Part D — hybrid routing, selector, install

- [ ] **Step 9a: The signed-in student's identity (shared-iPad safety)**

Siblings share an iPad, so every local attempt is stamped with its owner's JWT `sub` and sync/Continue only act for the signed-in student (the server would `403` a foreign attempt id anyway; without this the other child's unsent work would show up as a permanent "couldn't be sent" error under the wrong student).

Create `packages/app/test/owner.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest"
import * as auth from "../src/lib/auth.js"
import { currentSubject } from "../src/lib/attempt/owner.js"

const b64url = (value: object): string =>
  btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "")

afterEach(() => {
  vi.restoreAllMocks()
})

describe("currentSubject", () => {
  it("reads sub from the access token payload", () => {
    vi.spyOn(auth, "currentAccessToken").mockReturnValue(`h.${b64url({ sub: "sub-9" })}.s`)

    expect(currentSubject()).toBe("sub-9")
  })

  it("is null with no token, a malformed token, or no sub", () => {
    const spy = vi.spyOn(auth, "currentAccessToken")

    spy.mockReturnValue(null)
    expect(currentSubject()).toBeNull()
    spy.mockReturnValue("not-a-jwt")
    expect(currentSubject()).toBeNull()
    spy.mockReturnValue(`h.${b64url({ iss: "x" })}.s`)
    expect(currentSubject()).toBeNull()
  })
})
```

Run: `pnpm --filter @pp/app exec vitest run test/owner.test.ts` — Expected: FAIL (module missing). Create `packages/app/src/lib/attempt/owner.ts`:

```ts
import { currentAccessToken } from "../auth.js"

/**
 * The signed-in student's JWT `sub`, read from the access token WITHOUT
 * verifying it (this is a local routing key, not a security decision -- the
 * server re-verifies every request). Null when signed out or unreadable.
 */
export function currentSubject(): string | null {
  const token = currentAccessToken()
  const payload = token?.split(".")[1]

  if (!payload) {
    return null
  }

  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"))
    const sub = (JSON.parse(json) as { sub?: unknown }).sub

    return typeof sub === "string" ? sub : null
  } catch {
    return null
  }
}
```

Run again — Expected: 2 tests PASS.

- [ ] **Step 10: Write the failing hybrid tests**

Create `packages/app/test/hybrid-gateway.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { ApiError } from "../src/lib/api-client.js"
import type { AttemptGateway } from "../src/lib/attempt/attempt-gateway.js"
import { OfflineError } from "../src/lib/attempt/attempt-gateway.js"
import { HybridAttemptGateway } from "../src/lib/attempt/hybrid-gateway.js"
import { JournalStore } from "../src/lib/attempt/journal-store.js"
import type { JournalSync } from "../src/lib/attempt/journal-sync.js"
import { LocalAttemptGateway } from "../src/lib/attempt/local-gateway.js"
import { makeBundle } from "./helpers/bundle-fixture.js"
import { makeLocalState } from "./helpers/local-state-fixture.js"

let n = 0
const T0 = Date.parse("2026-11-22T11:00:00.000Z")

function remoteFake(): AttemptGateway {
  return {
    start: vi.fn().mockResolvedValue({ id: "srv-1" }),
    loadEnvelope: vi.fn().mockResolvedValue({ id: "srv-1", status: "in_progress", attemptNumber: 1, testTitle: "T", expiresAt: null, serverTime: "2026-11-22T11:00:00.000Z", questionCount: 0, answeredCount: 0, unansweredOrdinals: [], currentSectionId: null, currentQuestionId: null, sections: [], responses: [] }),
    enterSection: vi.fn().mockResolvedValue({ sectionId: "s" }),
    setPosition: vi.fn().mockResolvedValue(undefined),
    claimPlay: vi.fn().mockResolvedValue({ mediaUrl: "/m" }),
    finishSection: vi.fn().mockResolvedValue({ nextSectionId: null }),
    submit: vi.fn().mockResolvedValue({ attemptId: "att-1" }),
    noteAnswer: vi.fn().mockResolvedValue(undefined),
    flushAnswers: vi.fn().mockResolvedValue({ flushed: true }),
    isLocalOnly: vi.fn().mockResolvedValue(false),
  }
}

async function setup(online: { v: boolean } = { v: true }, saved = true) {
  n += 1
  const journal = await JournalStore.open(`pp-hybrid-${n}`)
  const bundle = makeBundle()
  const local = new LocalAttemptGateway({
    journal,
    clock: { nowMs: () => T0 },
    bundles: {
      list: () => Promise.resolve([]),
      getBundle: (slug) => Promise.resolve(saved && slug === bundle.slug ? bundle : null),
      getMediaBlob: () => Promise.resolve(null),
    },
    newId: () => "att-1",
    objectUrl: () => "blob:x",
    requestSync: () => {},
    ownerSub: () => "sub-1",
  })
  const remote = remoteFake()
  // A sync that "succeeds": the server now knows the attempt and nothing is pending.
  const sync: JournalSync = {
    syncNow: vi.fn(async (id: string) => {
      await journal.update(id, (s) => ({ ...s, serverKnown: true }))
      await journal.markSynced(id, 999)

      return { kind: "nothing" as const }
    }),
    syncAll: vi.fn().mockResolvedValue(undefined),
    request: vi.fn(),
  }
  const hybrid = new HybridAttemptGateway({
    remote,
    local,
    journal,
    sync,
    isOnline: () => online.v,
    hasSavedTest: (slug) => Promise.resolve(saved && slug === bundle.slug),
  })

  return { journal, remote, local, sync, hybrid, online }
}

describe("HybridAttemptGateway", () => {
  it("passes straight through to the remote when there is no local state", async () => {
    const { hybrid, remote } = await setup()

    await hybrid.setPosition("srv-1", "s", "q")

    expect(remote.setPosition).toHaveBeenCalledWith("srv-1", "s", "q")
  })

  it("start online uses the server; offline with a saved test starts locally; offline without one needs a connection", async () => {
    const online = { v: true }
    const { hybrid, remote, journal } = await setup(online)

    await hybrid.start("practice-3")

    expect(remote.start).toHaveBeenCalled()

    online.v = false

    expect((await hybrid.start("practice-3")).id).toBe("att-1")
    expect((await journal.getAttempt("att-1"))?.serverKnown).toBe(false)

    const none = await setup({ v: false }, false)

    await expect(none.hybrid.start("practice-3")).rejects.toMatchObject({ reason: "not_saved" })
  })

  it("start falls back to local when the network call fails outright", async () => {
    const { hybrid, remote } = await setup()

    vi.mocked(remote.start).mockRejectedValue(new TypeError("Failed to fetch"))

    expect((await hybrid.start("practice-3")).id).toBe("att-1")
  })

  it("a server refusal on start is NOT swallowed into an offline start", async () => {
    const { hybrid, remote } = await setup()

    vi.mocked(remote.start).mockRejectedValue(new ApiError({ type: "test_not_published", title: "x", status: 409 }))

    await expect(hybrid.start("practice-3")).rejects.toMatchObject({ problem: { type: "test_not_published" } })
  })

  it("an attempt the server does not know yet is synced first when online, then goes remote", async () => {
    const { hybrid, remote, sync, journal } = await setup()

    await journal.putAttempt(makeLocalState({ attemptId: "att-9", serverKnown: false }))

    await hybrid.setPosition("att-9", "sec-l", "q-l1")

    expect(sync.syncNow).toHaveBeenCalledWith("att-9")
    expect(remote.setPosition).toHaveBeenCalledWith("att-9", "sec-l", "q-l1")
  })

  it("offline, a server-known attempt continues locally and journals the move", async () => {
    const online = { v: false }
    const { hybrid, remote, journal } = await setup(online)

    await journal.putAttempt(makeLocalState({ attemptId: "att-2", serverKnown: true, currentSectionId: "sec-r", currentQuestionId: "q-r1", sections: makeLocalState().sections.map((s) => s.id === "sec-r" ? { ...s, status: "open" as const, expiresAt: new Date(T0 + 600_000).toISOString() } : s) }))
    await hybrid.setPosition("att-2", "sec-r", "q-r1")

    expect(remote.setPosition).not.toHaveBeenCalled()
    expect((await journal.eventsAfter("att-2", 0)).map((e) => e.type)).toEqual(["position"])
  })

  it("a network failure mid-call on a hydrated attempt falls back to the local gateway", async () => {
    const { hybrid, remote, journal } = await setup()

    await journal.putAttempt(makeLocalState({ attemptId: "att-3", serverKnown: true, currentSectionId: "sec-r", currentQuestionId: "q-r1", sections: makeLocalState().sections.map((s) => s.id === "sec-r" ? { ...s, status: "open" as const, expiresAt: new Date(T0 + 600_000).toISOString() } : s) }))
    vi.mocked(remote.setPosition).mockRejectedValue(new TypeError("Failed to fetch"))
    await hybrid.setPosition("att-3", "sec-r", "q-r1")

    expect((await journal.eventsAfter("att-3", 0)).map((e) => e.type)).toEqual(["position"])
  })

  it("loadEnvelope hydrates local state from every successful remote load", async () => {
    const { hybrid, journal } = await setup()

    await hybrid.loadEnvelope("srv-1")

    expect(await journal.getAttempt("srv-1")).toMatchObject({ serverKnown: true, origin: "hydrated" })
  })

  it("submit offline with unsynced work is an OfflineError and never reaches the server", async () => {
    const online = { v: false }
    const { hybrid, remote, journal } = await setup(online)

    await journal.putAttempt(makeLocalState({ attemptId: "att-4", serverKnown: false }))

    await expect(hybrid.submit("att-4", { clientInstanceId: "i", responses: [] })).rejects.toBeInstanceOf(OfflineError)
    expect(remote.submit).not.toHaveBeenCalled()
  })

  it("submit online syncs first, submits remotely, then drops the local copy", async () => {
    const { hybrid, remote, journal, sync } = await setup()

    await journal.putAttempt(makeLocalState({ attemptId: "att-5", serverKnown: false }))
    await hybrid.submit("att-5", { clientInstanceId: "i", responses: [] })

    expect(sync.syncNow).toHaveBeenCalledWith("att-5")
    expect(remote.submit).toHaveBeenCalled()
    expect(await journal.getAttempt("att-5")).toBeNull()
  })

  it("a network failure on submit is reported as OfflineError", async () => {
    const { hybrid, remote } = await setup()

    vi.mocked(remote.submit).mockRejectedValue(new TypeError("Failed to fetch"))

    await expect(hybrid.submit("srv-1", { clientInstanceId: "i", responses: [] })).rejects.toBeInstanceOf(OfflineError)
  })

  it("noteAnswer journals only when the attempt is local-only, has unsynced events, or the network is down", async () => {
    const online = { v: true }
    const { hybrid, journal } = await setup(online)

    await journal.putAttempt(makeLocalState({ attemptId: "att-6", serverKnown: true }))

    const answer = { attemptId: "att-6", sectionId: "sec-l", questionId: "q-l1", clientInstanceId: "d", seq: 1, selectedChoiceIds: ["c"], answeredAt: "x", timeSpentMs: null, terminalRejection: false }

    await hybrid.noteAnswer("att-6", answer)

    expect(await journal.eventsAfter("att-6", 0)).toHaveLength(0)

    online.v = false
    await hybrid.noteAnswer("att-6", answer)

    expect(await journal.eventsAfter("att-6", 0)).toHaveLength(1)
  })

  it("isLocalOnly reflects serverKnown", async () => {
    const { hybrid, journal } = await setup()

    await journal.putAttempt(makeLocalState({ attemptId: "att-7", serverKnown: false }))

    expect(await hybrid.isLocalOnly("att-7")).toBe(true)
    expect(await hybrid.isLocalOnly("unknown")).toBe(false)
  })
})
```

- [ ] **Step 11: Run to verify it fails**

Run: `pnpm --filter @pp/app exec vitest run test/hybrid-gateway.test.ts`
Expected: FAIL — `hybrid-gateway.js` missing.

- [ ] **Step 12: Implement the hybrid gateway, selector, runtime and install**

Create `packages/app/src/lib/attempt/hybrid-gateway.ts`:

```ts
import type { QueuedAnswer } from "../answerQueue.js"
import type {
  AttemptStart,
  FinishSectionRequest,
  FinishSectionResult,
  PlayGrant,
  RunnerEnvelope,
  SectionEntry,
  SubmitRequest,
  SubmitResult,
} from "../api-types.js"
import type { FlushResult } from "../flushController.js"
import {
  OfflineError,
  type AttemptGateway,
  type FlushContext,
  type StartHint,
} from "./attempt-gateway.js"
import type { JournalStore } from "./journal-store.js"
import type { JournalSync } from "./journal-sync.js"
import type { LocalAttemptGateway } from "./local-gateway.js"

export interface HybridDeps {
  readonly remote: AttemptGateway
  readonly local: LocalAttemptGateway
  readonly journal: JournalStore
  readonly sync: JournalSync
  readonly isOnline: () => boolean
  readonly hasSavedTest: (slug: string) => Promise<boolean>
}

type Route = "local" | "remote"

/**
 * `fetch` rejects with a TypeError when no response was received at all. An
 * `ApiError` (the server answered, with a refusal) and an `OfflineError` are
 * deliberately NOT network failures: a refusal must reach the page unchanged.
 */
function isNetworkFailure(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof DOMException && error.name === "AbortError")
  )
}

/**
 * Chooses, per call, between the journal-first local gateway and the server.
 *
 *   - Unknown to this device           -> remote (today's behaviour exactly).
 *   - Local-only, or unsynced events   -> local (the server is BEHIND the
 *     journal; talking to it directly would reorder history). When online it
 *     syncs first, so this window closes as soon as it can.
 *   - Server-known and fully synced    -> remote while online, local when not.
 *
 * Known limit (recorded in the PR): if a remote `claimPlay`/`finishSection`
 * request reaches the server and only its RESPONSE is lost, the local fallback
 * repeats the action. Plays are the one place that can over-count, and the
 * server audits that at sync (`offline_play_cap_exceeded`).
 */
export class HybridAttemptGateway implements AttemptGateway {
  private readonly d: HybridDeps

  constructor(deps: HybridDeps) {
    this.d = deps
  }

  async start(slug: string, hint?: StartHint): Promise<AttemptStart> {
    if (this.d.isOnline()) {
      try {
        return await this.d.remote.start(slug, hint)
      } catch (error) {
        if (!isNetworkFailure(error)) {
          throw error
        }
      }
    }

    if (!(await this.d.hasSavedTest(slug))) {
      throw new OfflineError("not_saved")
    }

    return this.d.local.start(slug, hint)
  }

  async loadEnvelope(attemptId: string): Promise<RunnerEnvelope> {
    if ((await this.pick(attemptId)) === "local") {
      return this.d.local.loadEnvelope(attemptId)
    }

    try {
      const envelope = await this.d.remote.loadEnvelope(attemptId)

      // Keep a local mirror so a later loss of connectivity can continue offline.
      await this.d.local.hydrate(envelope).catch(() => undefined)

      return envelope
    } catch (error) {
      if (isNetworkFailure(error) && (await this.d.journal.getAttempt(attemptId))) {
        return this.d.local.loadEnvelope(attemptId)
      }

      throw error
    }
  }

  enterSection(attemptId: string, sectionId: string): Promise<SectionEntry> {
    return this.dispatch(
      attemptId,
      () => this.d.remote.enterSection(attemptId, sectionId),
      () => this.d.local.enterSection(attemptId, sectionId),
    )
  }

  setPosition(attemptId: string, sectionId: string, questionId: string): Promise<void> {
    return this.dispatch(
      attemptId,
      () => this.d.remote.setPosition(attemptId, sectionId, questionId),
      () => this.d.local.setPosition(attemptId, sectionId, questionId),
    )
  }

  claimPlay(attemptId: string, stimulusId: string): Promise<PlayGrant> {
    return this.dispatch(
      attemptId,
      () => this.d.remote.claimPlay(attemptId, stimulusId),
      () => this.d.local.claimPlay(attemptId, stimulusId),
    )
  }

  finishSection(
    attemptId: string,
    sectionId: string,
    body: FinishSectionRequest,
  ): Promise<FinishSectionResult> {
    return this.dispatch(
      attemptId,
      () => this.d.remote.finishSection(attemptId, sectionId, body),
      () => this.d.local.finishSection(attemptId, sectionId, body),
    )
  }

  async submit(attemptId: string, body: SubmitRequest): Promise<SubmitResult> {
    if ((await this.pick(attemptId)) === "local") {
      // Still local after trying to sync: nothing the server can submit yet.
      throw new OfflineError("offline")
    }

    try {
      const result = await this.d.remote.submit(attemptId, body)

      await this.d.journal.deleteAttempt(attemptId)

      return result
    } catch (error) {
      if (isNetworkFailure(error)) {
        throw new OfflineError("offline")
      }

      throw error
    }
  }

  async noteAnswer(attemptId: string, answer: QueuedAnswer): Promise<void> {
    const state = await this.d.journal.getAttempt(attemptId)

    if (!state) {
      return
    }

    const mustJournal =
      !state.serverKnown ||
      !this.d.isOnline() ||
      (await this.d.journal.pendingCount(attemptId)) > 0

    if (mustJournal) {
      await this.d.local.noteAnswer(attemptId, answer)
    }
  }

  async flushAnswers(ctx: FlushContext): Promise<FlushResult> {
    if ((await this.pick(ctx.attemptId)) === "local") {
      return this.d.local.flushAnswers(ctx)
    }

    return this.d.remote.flushAnswers(ctx)
  }

  isLocalOnly(attemptId: string): Promise<boolean> {
    return this.d.local.isLocalOnly(attemptId)
  }

  private async route(attemptId: string): Promise<Route> {
    const state = await this.d.journal.getAttempt(attemptId)

    if (!state) {
      return "remote"
    }

    if (!state.serverKnown || (await this.d.journal.pendingCount(attemptId)) > 0) {
      return "local"
    }

    return this.d.isOnline() ? "remote" : "local"
  }

  /** `route`, but when online and behind, catch the server up first. */
  private async pick(attemptId: string): Promise<Route> {
    const route = await this.route(attemptId)

    if (route === "local" && this.d.isOnline()) {
      await this.d.sync.syncNow(attemptId)

      return this.route(attemptId)
    }

    return route
  }

  private async dispatch<T>(
    attemptId: string,
    remoteCall: () => Promise<T>,
    localCall: () => Promise<T>,
  ): Promise<T> {
    if ((await this.pick(attemptId)) === "local") {
      return localCall()
    }

    try {
      return await remoteCall()
    } catch (error) {
      if (isNetworkFailure(error) && (await this.d.journal.getAttempt(attemptId))) {
        return localCall()
      }

      throw error
    }
  }
}
```

Replace `packages/app/src/lib/attempt/gateway-selector.ts`:

```ts
import type { AttemptGateway } from "./attempt-gateway.js"
import { RemoteAttemptGateway } from "./remote-gateway.js"

let current: AttemptGateway = new RemoteAttemptGateway()

/**
 * Installs the gateway pages will use. The default is the remote gateway, so
 * tests (and any code path that never calls `installOfflineAttempts()`) never
 * touch IndexedDB; `main.tsx` installs the hybrid at boot.
 */
export function setAttemptGateway(next: AttemptGateway): void {
  current = next
}

/** Forwards every call to whichever gateway is installed at call time. */
export const attemptGateway: AttemptGateway = {
  start: (slug, hint) => current.start(slug, hint),
  loadEnvelope: (id) => current.loadEnvelope(id),
  enterSection: (id, sectionId) => current.enterSection(id, sectionId),
  setPosition: (id, sectionId, questionId) => current.setPosition(id, sectionId, questionId),
  claimPlay: (id, stimulusId) => current.claimPlay(id, stimulusId),
  finishSection: (id, sectionId, body) => current.finishSection(id, sectionId, body),
  submit: (id, body) => current.submit(id, body),
  noteAnswer: (id, answer) => current.noteAnswer(id, answer),
  flushAnswers: (ctx) => current.flushAnswers(ctx),
  isLocalOnly: (id) => current.isLocalOnly(id),
}

export function gatewayFor(_attemptId: string): AttemptGateway {
  return attemptGateway
}
```

Create `packages/app/src/lib/attempt/runtime.ts`:

```ts
import { AnswerQueue } from "../answerQueue.js"
import i18n from "../../i18n.js"
import { networkStore } from "../network.js"
import { offlineStore } from "../offline/offline-store.js"
import { toastStore } from "../toast.js"
import { HybridAttemptGateway } from "./hybrid-gateway.js"
import { JournalStore } from "./journal-store.js"
import { createJournalSync, postOfflineSync, type JournalSync } from "./journal-sync.js"
import { LocalAttemptGateway } from "./local-gateway.js"
import { LocalClock } from "./local-clock.js"
import { currentSubject } from "./owner.js"
import { RemoteAttemptGateway } from "./remote-gateway.js"
import { syncStatus } from "./sync-status.js"

export interface AttemptRuntime {
  readonly gateway: HybridAttemptGateway
  readonly sync: JournalSync
  readonly journal: JournalStore
}

let runtime: Promise<AttemptRuntime> | undefined

/** Opens IndexedDB once and wires the production gateway graph. Lazy: never runs at import. */
export function getAttemptRuntime(): Promise<AttemptRuntime> {
  runtime ??= build()

  return runtime
}

async function build(): Promise<AttemptRuntime> {
  const journal = await JournalStore.open()
  const clock = await LocalClock.create({
    wallNow: () => Date.now(),
    monoNow: () => performance.now(),
    loadHighWater: () => journal.loadClockHighWater(),
    saveHighWater: (ms) => journal.saveClockHighWater(ms),
  })

  // Persist the high-water mark often enough that a reload cannot rewind it by much.
  window.setInterval(() => void clock.persist(), 5_000)
  document.addEventListener("visibilitychange", () => void clock.persist())
  window.addEventListener("pagehide", () => void clock.persist())

  // eslint-disable-next-line prefer-const
  let sync: JournalSync
  const local = new LocalAttemptGateway({
    journal,
    clock,
    bundles: offlineStore,
    newId: () => crypto.randomUUID(),
    objectUrl: (blob) => URL.createObjectURL(blob),
    requestSync: () => sync.request(),
    ownerSub: currentSubject,
  })

  sync = createJournalSync({
    journal,
    post: postOfflineSync,
    openQueue: () => AnswerQueue.open(),
    scheduler: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    wallNow: () => Date.now(),
    isOnline: () => networkStore.getSnapshot().online,
    currentSub: currentSubject,
    onSynced: ({ answersAcked }) => {
      toastStore.show(i18n.t("runner:offline.sync.sent", { count: answersAcked }), "cloud")
    },
    status: syncStatus,
  })
  journal.onAppend(() => sync.request())

  const gateway = new HybridAttemptGateway({
    remote: new RemoteAttemptGateway(),
    local,
    journal,
    sync,
    isOnline: () => networkStore.getSnapshot().online,
    hasSavedTest: (slug) => offlineStore.has(slug),
  })

  return { gateway, sync, journal }
}
```

Create `packages/app/src/lib/attempt/install.ts`:

```ts
import type { AttemptGateway } from "./attempt-gateway.js"
import { setAttemptGateway } from "./gateway-selector.js"
import { getAttemptRuntime } from "./runtime.js"

/** A gateway that opens the runtime on first use and then delegates to the hybrid. */
function lazyHybrid(): AttemptGateway {
  const rt = () => getAttemptRuntime().then((r) => r.gateway)

  return {
    start: async (slug, hint) => (await rt()).start(slug, hint),
    loadEnvelope: async (id) => (await rt()).loadEnvelope(id),
    enterSection: async (id, sectionId) => (await rt()).enterSection(id, sectionId),
    setPosition: async (id, sectionId, questionId) => (await rt()).setPosition(id, sectionId, questionId),
    claimPlay: async (id, stimulusId) => (await rt()).claimPlay(id, stimulusId),
    finishSection: async (id, sectionId, body) => (await rt()).finishSection(id, sectionId, body),
    submit: async (id, body) => (await rt()).submit(id, body),
    noteAnswer: async (id, answer) => (await rt()).noteAnswer(id, answer),
    flushAnswers: async (ctx) => (await rt()).flushAnswers(ctx),
    isLocalOnly: async (id) => (await rt()).isLocalOnly(id),
  }
}

/**
 * Called once from `main.tsx`: installs the journal-first gateway and starts
 * the sync triggers (spec D6): app start, `online`, and the tab becoming
 * visible again. Appends already request a debounced sync through the journal.
 */
export function installOfflineAttempts(): void {
  setAttemptGateway(lazyHybrid())

  void getAttemptRuntime().then(({ sync }) => {
    void sync.syncAll()
    window.addEventListener("online", () => void sync.syncAll())
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        void sync.syncAll()
      }
    })
  })
}
```

Create `packages/app/src/lib/attempt/use-local-attempts.ts`:

```ts
import { useEffect, useState } from "react"
import { currentSubject } from "./owner.js"
import { getAttemptRuntime } from "./runtime.js"

/** The ids of attempts this device holds state for (what "Continue" can do offline). */
export function useLocalAttemptIds(): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    let cancelled = false

    void getAttemptRuntime()
      .then(({ journal }) => journal.listAttempts())
      .then((attempts) => {
        if (!cancelled) {
          const me = currentSubject()

          setIds(
            new Set(
              attempts
                .filter((a) => a.ownerSub === null || a.ownerSub === me)
                .map((a) => a.attemptId),
            ),
          )
        }
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [])

  return ids
}
```

In `packages/app/src/main.tsx`, before `createRoot(root).render(...)`, add `import { installOfflineAttempts } from "@pp/app/lib/attempt/install"` with the other imports and call `installOfflineAttempts()` once.

- [ ] **Step 13: Run the hybrid tests and the Task 20 guard**

Run: `pnpm --filter @pp/app exec vitest run test/hybrid-gateway.test.ts src/pages/attempts src/pages/tests && pnpm --filter @pp/app exec tsc --noEmit`
Expected: 13 hybrid tests PASS; the page suites still pass untouched (they never call `installOfflineAttempts()`, so they keep the remote gateway).

#### Part E — pages, library, purge, copy

- [ ] **Step 14: Add the toast copy to all six locales**

Append inside each `packages/app/src/locales/<lang>/runner.json`:

English:
```json
  "offline.sync.sent_one": "Back online — {{count}} answer sent.",
  "offline.sync.sent_other": "Back online — {{count}} answers sent."
```
German: `"offline.sync.sent_one": "Wieder online – {{count}} Antwort gesendet."`, `"offline.sync.sent_other": "Wieder online – {{count}} Antworten gesendet."`
Spanish: `"offline.sync.sent_one": "De nuevo en línea: {{count}} respuesta enviada."`, `"offline.sync.sent_other": "De nuevo en línea: {{count}} respuestas enviadas."`
French: `"offline.sync.sent_one": "De retour en ligne — {{count}} réponse envoyée."`, `"offline.sync.sent_other": "De retour en ligne — {{count}} réponses envoyées."`
Italian: `"offline.sync.sent_one": "Di nuovo online — {{count}} risposta inviata."`, `"offline.sync.sent_other": "Di nuovo online — {{count}} risposte inviate."`
Japanese (one form only, as elsewhere in `ja`): `"offline.sync.sent": "オンラインに戻りました — {{count}}件の回答を送信しました。"`

Run: `pnpm --filter @pp/app exec vitest run src/locales/locale-parity.test.ts` — Expected: PASS.

- [ ] **Step 15: Write the failing offline-play page test**

Create `packages/app/test/helpers/envelope-fixture.ts`:

```ts
import type { RunnerEnvelope } from "../../src/lib/api-types.js"
import { makeBundle } from "./bundle-fixture.js"

/**
 * An attempt with 10 minutes left. `open` picks the section that is running:
 * the listening section starts on its first question, the reading section on
 * its only question (listening already closed).
 */
export function makeEnvelope(open: "listening" | "reading" = "listening"): RunnerEnvelope {
  const bundle = makeBundle()
  const now = Date.now()
  const expiresAt = new Date(now + 600_000).toISOString()
  const openId = open === "listening" ? "sec-l" : "sec-r"

  return {
    id: "att-1",
    status: "in_progress",
    attemptNumber: 1,
    testTitle: bundle.title,
    expiresAt,
    serverTime: new Date(now).toISOString(),
    questionCount: 3,
    answeredCount: 0,
    unansweredOrdinals: [1, 2, 3],
    currentSectionId: openId,
    currentQuestionId: open === "listening" ? "q-l1" : "q-r1",
    sections: bundle.sections.map((section) => ({
      ...section,
      status:
        section.id === openId
          ? ("open" as const)
          : open === "reading" && section.id === "sec-l"
            ? ("closed" as const)
            : ("pending" as const),
      completedAt: null,
      expiresAt: section.id === openId ? expiresAt : null,
    })),
    responses: [],
  }
}
```

Create `packages/app/src/pages/attempts.$attemptId.run.offline.test.tsx` (importing `../i18n.js` initialises the global i18next instance the screen reads, so no provider is needed; if Part B's chrome needs router context, wrap with `renderWithRouter` from `src/test/renderWithRouter.tsx`):

```tsx
import "../i18n.js"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { AnswerQueue } from "../lib/answerQueue.js"
import { OfflineError, type AttemptGateway } from "../lib/attempt/attempt-gateway.js"
import { makeEnvelope } from "../../test/helpers/envelope-fixture.js"
import { RunScreen } from "./attempts.$attemptId.run.js"

function gatewayThatCannotPlay(): AttemptGateway {
  return {
    start: vi.fn(),
    loadEnvelope: vi.fn(),
    enterSection: vi.fn(),
    setPosition: vi.fn().mockResolvedValue(undefined),
    claimPlay: vi.fn().mockRejectedValue(new OfflineError("media_missing")),
    finishSection: vi.fn(),
    submit: vi.fn(),
    noteAnswer: vi.fn().mockResolvedValue(undefined),
    flushAnswers: vi.fn().mockResolvedValue({
      flushed: true,
      rejectedQuestionIds: [],
      saveState: { status: "saved", pendingCount: 0 },
      outcome: "success",
    }),
    isLocalOnly: vi.fn().mockResolvedValue(true),
  }
}

describe("RunScreen offline playback", () => {
  it("shows the recording-did-not-load state, not a crash, when the audio is not on the phone", async () => {
    const gateway = gatewayThatCannotPlay()
    const queue = await AnswerQueue.open("pp-run-offline-test")

    render(
      <RunScreen
        attemptId="att-1"
        envelope={makeEnvelope()}
        queue={queue}
        navigate={vi.fn()}
        gateway={gateway}
        localOnly
      />,
    )
    fireEvent.click(await screen.findByRole("button", { name: /play recording/i }))

    await waitFor(() =>
      expect(screen.getByText(/recording didn't load/i)).toBeInTheDocument(),
    )
    expect(gateway.claimPlay).toHaveBeenCalledWith("att-1", "st-l")
  })

  it("journals the answer through the gateway and flushes through it too", async () => {
    const gateway = gatewayThatCannotPlay()
    const queue = await AnswerQueue.open("pp-run-offline-test-2")
    // Reading section: its answers are never locked behind a recording.
    const envelope = makeEnvelope("reading")

    render(
      <RunScreen
        attemptId="att-1"
        envelope={envelope}
        queue={queue}
        navigate={vi.fn()}
        gateway={gateway}
        localOnly
      />,
    )
    fireEvent.click(await screen.findByRole("radio", { name: /a garden/i }))

    await waitFor(() => expect(gateway.noteAnswer).toHaveBeenCalled())
    expect(gateway.noteAnswer).toHaveBeenCalledWith(
      "att-1",
      expect.objectContaining({ questionId: "q-r1", selectedChoiceIds: ["c-r1a"] }),
    )
    expect(gateway.flushAnswers).toHaveBeenCalledWith(
      expect.objectContaining({ attemptId: "att-1", sectionId: "sec-r" }),
    )
  })
})
```

Run: `pnpm --filter @pp/app exec vitest run "src/pages/attempts.\$attemptId.run.offline.test.tsx"`
Expected: FAIL — the first test throws (`OfflineError` is rethrown by `handleClaimPlay`, which only handles `ApiError`).

- [ ] **Step 16: Handle `OfflineError` in `handleClaimPlay`**

Re-read `pages/attempts.$attemptId.run.tsx`. Add `OfflineError` to the `attempt-gateway` import (now used) and, in `handleClaimPlay`'s `catch (error)` block, add **before** the existing `if (!(error instanceof ApiError)) { throw error }`:

```ts
      if (error instanceof OfflineError) {
        // Nothing was claimed (the local gateway only spends a play when the
        // audio is on this phone), so this is the same honest "the recording
        // did not come through" state the audio element's own error produces.
        setPlayState({ status: "failed" })

        return
      }
```

Run: `pnpm --filter @pp/app exec vitest run "src/pages/attempts.\$attemptId.run.offline.test.tsx" src/pages/attempts`
Expected: PASS (both new tests and the untouched run suite).

- [ ] **Step 17: Library — offline Continue needs local state**

Re-read `pages/index.tsx`. `LibraryScreenProps` gains `readonly localAttemptIds?: ReadonlySet<string>` (default `new Set()` inside the component); `RouteComponent` passes `localAttemptIds={useLocalAttemptIds()}`. In the Task 16 `startGate(...)` call replace `continuableLocally: false` with:

```ts
continuableLocally:
  test.inProgressAttemptId !== null &&
  localAttemptIds.has(test.inProgressAttemptId),
```

Add to `pages/index.test.tsx` (reusing the helpers Task 16 added there — `fixtureCard`, `libraryProps`, `renderLibrary` stand for whatever that file already defines for a card fixture and a render call; adapt the names, keep the assertions):

```tsx
const continueControl = (): HTMLElement =>
  screen.getByText(/continue/i).closest("a, button") as HTMLElement
const isDisabled = (el: HTMLElement): boolean =>
  el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true"

it("offline: Continue is enabled only when this device holds the attempt's state", () => {
  const inProgress = { ...fixtureCard, inProgressAttemptId: "att-1" }
  const { rerender } = renderLibrary({
    tests: [inProgress],
    offline: { ...fakeOffline, online: false },
    localAttemptIds: new Set(),
  })

  expect(isDisabled(continueControl())).toBe(true)

  rerender(
    <LibraryScreen
      {...libraryProps([inProgress])}
      offline={{ ...fakeOffline, online: false }}
      localAttemptIds={new Set(["att-1"])}
    />,
  )

  expect(isDisabled(continueControl())).toBe(false)
})
```

Gate Continue exactly as Task 16 gates Start: `disabled` for a button, or `aria-disabled="true"` with `tabIndex={-1}` and a click guard for a link, plus the `needsConnection` reason text.

Run: `pnpm --filter @pp/app exec vitest run src/pages/index.test.tsx` — Expected: PASS.

- [ ] **Step 18: Sign-out purge keeps unsynced work**

Re-read `lib/pwa/purge.ts` (Task 2). Add, after the `offlineStore.removeAll()` call Task 15 added:

```ts
  await getAttemptRuntime()
    .then(({ journal }) => purgeSyncedAttempts(journal))
    .catch(() => undefined)
```

with imports `getAttemptRuntime` from `../attempt/runtime.js` and `purgeSyncedAttempts` from `../attempt/journal-sync.js`. Extend Task 2's purge test: mock `../attempt/runtime.js` to return a runtime whose `journal` is a real `JournalStore` holding one synced and one unsynced attempt, call `purgeClientCaches()`, and assert only the unsynced attempt remains.

- [ ] **Step 19: Full gates and commit**

Run:
```
pnpm --filter @pp/app exec vitest run
pnpm --filter @pp/app exec tsc --noEmit && pnpm lint && pnpm format
```
Expected: PASS everywhere. `lint:frontend` must stay clean — the only React in this task is `use-local-attempts.ts` (a hook in `lib/`) and page edits.

```bash
git add packages/app
git commit -m "feat(app): journal-first offline attempts with hybrid routing and sync on reconnect"
```


---

### Task 22: Client — offline hand-in guard, "waiting" time-up variant and pending-sync indicator

**What this builds.** The last visible offline states from the prototype and spec §11.2:

- **Hand in** is disabled while offline, with the reason `Handing in needs a connection. Your answers are safe on this phone — reconnect and try again.` (prototype `vHandin`), and a submit that fails for lack of a connection shows the same reason instead of crashing.
- **Time's up, waiting variant.** If the clock ran out while offline there is no result yet: same screen, `We'll score it as soon as you're back online.`, a disabled **See your result** with its reason, a **Check again** button, and an automatic one-shot reload when the sync finishes (spec §11 deviation 2).
- **Pending-sync note** ("Saved on this phone — it will be sent when you're back online.") on the library, plus an error note ("Some answers couldn't be sent. Please tell an adult.") if the server terminally refused a journal.

**Files:**
- Create: `packages/app/src/lib/attempt/use-sync-status.ts`
- Create: `packages/app/src/lib/attempt/waiting-summary.ts` + `packages/app/test/waiting-summary.test.ts`
- Create: `packages/app/src/components/PendingSyncNote.tsx` + `PendingSyncNote.test.tsx`
- Modify (re-read first — Part B restyled them): `packages/app/src/pages/attempts.$attemptId.hand-in.tsx`, `packages/app/src/pages/attempts.$attemptId.time-up.tsx`, `packages/app/src/pages/index.tsx`
- Test: `packages/app/src/pages/attempts.$attemptId.hand-in.offline.test.tsx`, `packages/app/src/pages/attempts.$attemptId.time-up.offline.test.tsx`, additions to `packages/app/src/pages/index.test.tsx`
- Modify: `packages/app/src/locales/{en,de,es,fr,it,ja}/runner.json`

**Interfaces:**
- Consumes: `syncStatus` / `SyncStatusSnapshot` (Task 21), `getAttemptRuntime` (Task 21), `OfflineError` and `AttemptGateway` (Task 20), `networkStore` (Task 3), `AnswerQueue`, `LocalAttemptState`, `makeLocalState`, `makeEnvelope` (Tasks 19/21).
- Produces:
  ```ts
  // use-sync-status.ts
  export function useSyncStatus(): SyncStatusSnapshot
  // waiting-summary.ts
  export interface WaitingSummary { readonly testTitle: string; readonly answeredCount: number; readonly unansweredCount: number }
  export function summarizeWaiting(state: LocalAttemptState, answeredQuestionIds: ReadonlySet<string>): WaitingSummary
  export function loadWaitingSummary(attemptId: string): Promise<WaitingSummary | null>   // null unless this device holds unsent work for the attempt
  // components/PendingSyncNote.tsx (stateless)
  export interface PendingSyncNoteProps { readonly pendingAttempts: number; readonly failed: boolean }
  // pages: HandInScreenProps.online?: boolean (default true); TimeUpData.waiting?: true; TimeUpScreenProps { data; onCheckAgain?: () => void; syncFailed?: boolean }
  ```

- [ ] **Step 1: Add the copy to all six locales**

Append inside each `packages/app/src/locales/<lang>/runner.json`:

English:
```json
  "offline.handIn.needsConnection": "Handing in needs a connection. Your answers are safe on this phone — reconnect and try again.",
  "offline.timeUp.waiting": "We'll score it as soon as you're back online.",
  "offline.timeUp.waitingReason": "Your result isn't ready yet.",
  "offline.timeUp.checkAgain": "Check again",
  "offline.timeUp.failed": "We couldn't send this test. Please tell an adult.",
  "offline.pendingSync": "Saved on this phone — it will be sent when you're back online.",
  "offline.syncFailed": "Some answers couldn't be sent. Please tell an adult."
```
German:
```json
  "offline.handIn.needsConnection": "Zum Abgeben brauchst du eine Verbindung. Deine Antworten sind auf diesem Telefon sicher – verbinde dich und versuche es erneut.",
  "offline.timeUp.waiting": "Wir werten ihn aus, sobald du wieder online bist.",
  "offline.timeUp.waitingReason": "Dein Ergebnis ist noch nicht fertig.",
  "offline.timeUp.checkAgain": "Erneut prüfen",
  "offline.timeUp.failed": "Wir konnten diesen Test nicht senden. Bitte sag einem Erwachsenen Bescheid.",
  "offline.pendingSync": "Auf diesem Telefon gespeichert – wird gesendet, sobald du wieder online bist.",
  "offline.syncFailed": "Einige Antworten konnten nicht gesendet werden. Bitte sag einem Erwachsenen Bescheid."
```
Spanish:
```json
  "offline.handIn.needsConnection": "Para entregar se necesita conexión. Tus respuestas están a salvo en este teléfono: vuelve a conectarte e inténtalo de nuevo.",
  "offline.timeUp.waiting": "Lo calificaremos en cuanto vuelvas a estar en línea.",
  "offline.timeUp.waitingReason": "Tu resultado aún no está listo.",
  "offline.timeUp.checkAgain": "Comprobar de nuevo",
  "offline.timeUp.failed": "No pudimos enviar esta prueba. Díselo a un adulto.",
  "offline.pendingSync": "Guardado en este teléfono: se enviará cuando vuelvas a estar en línea.",
  "offline.syncFailed": "No se pudieron enviar algunas respuestas. Díselo a un adulto."
```
French:
```json
  "offline.handIn.needsConnection": "Pour rendre le test, il faut une connexion. Tes réponses sont en sécurité sur ce téléphone — reconnecte-toi et réessaie.",
  "offline.timeUp.waiting": "Nous le corrigerons dès que tu seras de nouveau en ligne.",
  "offline.timeUp.waitingReason": "Ton résultat n'est pas encore prêt.",
  "offline.timeUp.checkAgain": "Vérifier à nouveau",
  "offline.timeUp.failed": "Nous n'avons pas pu envoyer ce test. Préviens un adulte.",
  "offline.pendingSync": "Enregistré sur ce téléphone — il sera envoyé quand tu seras de nouveau en ligne.",
  "offline.syncFailed": "Certaines réponses n'ont pas pu être envoyées. Préviens un adulte."
```
Italian:
```json
  "offline.handIn.needsConnection": "Per consegnare serve una connessione. Le tue risposte sono al sicuro su questo telefono: riconnettiti e riprova.",
  "offline.timeUp.waiting": "Lo valuteremo non appena sarai di nuovo online.",
  "offline.timeUp.waitingReason": "Il tuo risultato non è ancora pronto.",
  "offline.timeUp.checkAgain": "Controlla di nuovo",
  "offline.timeUp.failed": "Non siamo riusciti a inviare questo test. Avvisa un adulto.",
  "offline.pendingSync": "Salvato su questo telefono: verrà inviato quando sarai di nuovo online.",
  "offline.syncFailed": "Alcune risposte non sono state inviate. Avvisa un adulto."
```
Japanese:
```json
  "offline.handIn.needsConnection": "提出には接続が必要です。回答はこの端末に安全に保存されています。接続してからもう一度お試しください。",
  "offline.timeUp.waiting": "オンラインに戻りしだい採点します。",
  "offline.timeUp.waitingReason": "結果はまだ準備できていません。",
  "offline.timeUp.checkAgain": "もう一度確認",
  "offline.timeUp.failed": "このテストを送信できませんでした。大人に伝えてください。",
  "offline.pendingSync": "この端末に保存しました。オンラインに戻ると送信されます。",
  "offline.syncFailed": "送信できなかった回答があります。大人に伝えてください。"
```

Run: `pnpm --filter @pp/app exec vitest run src/locales/locale-parity.test.ts` — Expected: PASS.

- [ ] **Step 2: Write the failing indicator tests**

Create `packages/app/src/components/PendingSyncNote.test.tsx` (use the same `renderWithI18n` helper Task 16 introduced at `src/test/renderWithI18n.tsx`):

```tsx
import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { renderWithI18n } from "../test/renderWithI18n.js"
import { PendingSyncNote } from "./PendingSyncNote.js"

describe("PendingSyncNote", () => {
  it("renders nothing when nothing is waiting", () => {
    const { container } = renderWithI18n(<PendingSyncNote pendingAttempts={0} failed={false} />)

    expect(container).toBeEmptyDOMElement()
  })

  it("says the test is saved on this phone while something is waiting", () => {
    renderWithI18n(<PendingSyncNote pendingAttempts={1} failed={false} />)

    expect(screen.getByRole("status")).toHaveTextContent(
      "Saved on this phone — it will be sent when you're back online.",
    )
  })

  it("a refused journal is an alert, and wins over the waiting note", () => {
    renderWithI18n(<PendingSyncNote pendingAttempts={1} failed />)

    expect(screen.getByRole("alert")).toHaveTextContent("Please tell an adult")
    expect(screen.queryByRole("status")).toBeNull()
  })
})
```

Create `packages/app/test/waiting-summary.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { summarizeWaiting } from "../src/lib/attempt/waiting-summary.js"
import { makeLocalState } from "./helpers/local-state-fixture.js"

describe("summarizeWaiting", () => {
  it("counts answered questions against the test's total", () => {
    const summary = summarizeWaiting(makeLocalState(), new Set(["q-l1", "q-r1"]))

    expect(summary).toEqual({ testTitle: "Practice Test 3", answeredCount: 2, unansweredCount: 1 })
  })

  it("never reports more answered than there are questions", () => {
    const summary = summarizeWaiting(makeLocalState(), new Set(["a", "b", "c", "d", "e"]))

    expect(summary).toMatchObject({ answeredCount: 3, unansweredCount: 0 })
  })
})
```

- [ ] **Step 3: Run (fail), implement, run (pass)**

Run: `pnpm --filter @pp/app exec vitest run src/components/PendingSyncNote.test.tsx test/waiting-summary.test.ts` — Expected: FAIL (modules missing).

Create `packages/app/src/lib/attempt/use-sync-status.ts`:

```ts
import { useSyncExternalStore } from "react"
import { syncStatus, type SyncStatusSnapshot } from "./sync-status.js"

export function useSyncStatus(): SyncStatusSnapshot {
  return useSyncExternalStore(
    syncStatus.subscribe,
    syncStatus.getSnapshot,
    syncStatus.getSnapshot,
  )
}
```

Create `packages/app/src/lib/attempt/waiting-summary.ts`:

```ts
import { AnswerQueue } from "../answerQueue.js"
import type { LocalAttemptState } from "./journal-types.js"
import { getAttemptRuntime } from "./runtime.js"

export interface WaitingSummary {
  readonly testTitle: string
  readonly answeredCount: number
  readonly unansweredCount: number
}

export function summarizeWaiting(
  state: LocalAttemptState,
  answeredQuestionIds: ReadonlySet<string>,
): WaitingSummary {
  const total = state.sections
    .flatMap((section) => section.groups)
    .flatMap((group) => group.questions).length
  const answered = Math.min(total, answeredQuestionIds.size)

  return {
    testTitle: state.title,
    answeredCount: answered,
    unansweredCount: total - answered,
  }
}

/**
 * What the time-up screen can honestly say when the server has no result yet.
 * Null unless THIS device holds work the server has not seen -- so a genuine
 * server failure is never disguised as "waiting".
 */
export async function loadWaitingSummary(
  attemptId: string,
): Promise<WaitingSummary | null> {
  const { journal } = await getAttemptRuntime()
  const state = await journal.getAttempt(attemptId)

  if (!state) {
    return null
  }

  if (state.serverKnown && (await journal.pendingCount(attemptId)) === 0) {
    return null
  }

  const queue = await AnswerQueue.open()

  try {
    const items = await queue.snapshotForAttempt(attemptId)

    return summarizeWaiting(
      state,
      new Set(
        items.filter((i) => i.selectedChoiceIds.length > 0).map((i) => i.questionId),
      ),
    )
  } finally {
    void queue.close()
  }
}
```

Create `packages/app/src/components/PendingSyncNote.tsx`:

```tsx
import { useTranslation } from "react-i18next"

export interface PendingSyncNoteProps {
  readonly pendingAttempts: number
  readonly failed: boolean
}

export function PendingSyncNote({ pendingAttempts, failed }: PendingSyncNoteProps) {
  const { t } = useTranslation("runner")

  if (failed) {
    return (
      <p
        role="alert"
        className="bg-bad-bg text-bad mt-3 rounded-[9px] px-3.5 py-2.5 text-sm font-semibold"
      >
        {t("offline.syncFailed")}
      </p>
    )
  }

  if (pendingAttempts === 0) {
    return null
  }

  return (
    <p
      role="status"
      className="border-amber bg-amber/15 text-ink-2 mt-3 rounded-[9px] border px-3.5 py-2.5 text-sm font-semibold"
    >
      {t("offline.pendingSync")}
    </p>
  )
}
```

Run again — Expected: 5 tests PASS.

- [ ] **Step 4: Write the failing hand-in tests**

Create `packages/app/src/pages/attempts.$attemptId.hand-in.offline.test.tsx`:

```tsx
import "../i18n.js"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { AnswerQueue } from "../lib/answerQueue.js"
import { OfflineError, type AttemptGateway } from "../lib/attempt/attempt-gateway.js"
import { makeEnvelope } from "../../test/helpers/envelope-fixture.js"
import { HandInScreen } from "./attempts.$attemptId.hand-in.js"

function gateway(submit: AttemptGateway["submit"]): AttemptGateway {
  return {
    start: vi.fn(),
    loadEnvelope: vi.fn(),
    enterSection: vi.fn(),
    setPosition: vi.fn(),
    claimPlay: vi.fn(),
    finishSection: vi.fn(),
    submit,
    noteAnswer: vi.fn(),
    flushAnswers: vi.fn(),
    isLocalOnly: vi.fn().mockResolvedValue(false),
  }
}

let n = 0
const openQueue = () => AnswerQueue.open(`pp-handin-offline-${(n += 1)}`)

describe("HandInScreen offline", () => {
  it("offline: Hand in is disabled and the reason describes it", async () => {
    const submit = vi.fn()

    render(
      <HandInScreen
        attemptId="att-1"
        envelope={makeEnvelope("reading")}
        queue={await openQueue()}
        navigate={vi.fn()}
        gateway={gateway(submit)}
        online={false}
      />,
    )

    const button = screen.getByRole("button", { name: "Hand in" })

    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription(/needs a connection/i)
    fireEvent.click(button)
    expect(submit).not.toHaveBeenCalled()
  })

  it("online: a submit that cannot reach the server shows the reason and stays retryable", async () => {
    const submit = vi.fn().mockRejectedValue(new OfflineError("offline"))
    const navigate = vi.fn()

    render(
      <HandInScreen
        attemptId="att-1"
        envelope={makeEnvelope("reading")}
        queue={await openQueue()}
        navigate={navigate}
        gateway={gateway(submit)}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Hand in" }))

    await waitFor(() =>
      expect(screen.getAllByText(/needs a connection/i).length).toBeGreaterThan(0),
    )
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Hand in" })).toBeEnabled()
  })

  it("online: a successful submit goes to the result", async () => {
    const submit = vi.fn().mockResolvedValue({
      attemptId: "att-1",
      status: "submitted",
      submittedAt: "2026-11-22T11:00:00.000Z",
      resultUrl: "/attempts/att-1/result",
      finalFlush: [],
    })
    const navigate = vi.fn()

    render(
      <HandInScreen
        attemptId="att-1"
        envelope={makeEnvelope("reading")}
        queue={await openQueue()}
        navigate={navigate}
        gateway={gateway(submit)}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Hand in" }))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/attempts/att-1/result"))
  })
})
```

- [ ] **Step 5: Run to verify it fails**

Run: `pnpm --filter @pp/app exec vitest run "src/pages/attempts.\$attemptId.hand-in.offline.test.tsx"`
Expected: FAIL — the first test finds Hand in *enabled* (no `online` prop yet) and the second throws an unhandled `OfflineError` rejection.

- [ ] **Step 6: Guard hand-in**

Re-read `pages/attempts.$attemptId.hand-in.tsx`, then:

1. Import `OfflineError` alongside the Task 20 `AttemptGateway` import: `import { OfflineError, type AttemptGateway } from "../lib/attempt/attempt-gateway.js"`.
2. `HandInScreenProps` gains `readonly online?: boolean`; destructure `online = true`.
3. Extend the `Outcome` union: `| { readonly status: "offline" }`.
4. In `handleSubmit`'s final `.catch((error: unknown) => {`, add as the **first** statement, before the `if (!(error instanceof ApiError)) { throw error }` line:
   ```ts
        if (error instanceof OfflineError) {
          setOutcome({ status: "offline" })

          return
        }
   ```
5. `const disabled = outcome.status === "submitting" || !online`.
6. Render the reason beside the existing `outcome.status === "error"` block (keep the page's markup conventions; this is the content):
   ```tsx
        {!online || outcome.status === "offline" ? (
          <p
            id="hand-in-offline"
            role="alert"
            className="notice border-amber bg-amber/15 text-ink-2 mt-[14px] max-w-[400px] rounded-[9px] border px-[14px] py-[11px] text-left text-[13.5px] font-semibold"
          >
            {t("offline.handIn.needsConnection")}
          </p>
        ) : null}
   ```
   and on the Hand in `<button>` add `aria-describedby={!online ? "hand-in-offline" : undefined}`.
7. In the file's `RouteComponent`, add
   ```ts
   const online = useSyncExternalStore(
     networkStore.subscribe,
     () => networkStore.getSnapshot().online,
     () => true,
   )
   ```
   (imports: `useSyncExternalStore` from `react`, `networkStore` from `../lib/network.js`) and pass `online={online}` to `HandInScreen`.

- [ ] **Step 7: Run to verify it passes, plus the existing hand-in suite**

Run: `pnpm --filter @pp/app exec vitest run "src/pages/attempts.\$attemptId.hand-in"`
Expected: 3 new tests PASS and the existing hand-in tests unchanged.

- [ ] **Step 8: Write the failing time-up tests**

Create `packages/app/src/pages/attempts.$attemptId.time-up.offline.test.tsx`:

```tsx
import "../i18n.js"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { getAttemptResult } from "../lib/attempts-api.js"
import { loadWaitingSummary } from "../lib/attempt/waiting-summary.js"
import { loadTimeUp, TimeUpScreen } from "./attempts.$attemptId.time-up.js"

vi.mock("../lib/attempts-api.js", () => ({ getAttemptResult: vi.fn() }))
vi.mock("../lib/attempt/waiting-summary.js", () => ({ loadWaitingSummary: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
})

describe("loadTimeUp", () => {
  it("returns the normal data when the result loads (and no waiting flag)", async () => {
    vi.mocked(getAttemptResult).mockResolvedValue({
      attemptId: "att-1",
      test: { title: "Practice Test 3", version: 1 },
      score: { answered: 2, unanswered: 1 },
    } as never)

    const data = await loadTimeUp("att-1")

    expect(data).toEqual({
      testTitle: "Practice Test 3",
      answeredCount: 2,
      unansweredCount: 1,
      resultUrl: "/attempts/att-1/result",
    })
    expect(loadWaitingSummary).not.toHaveBeenCalled()
  })

  it("returns the waiting variant when the server has no result but this device holds unsent work", async () => {
    vi.mocked(getAttemptResult).mockRejectedValue(new TypeError("Failed to fetch"))
    vi.mocked(loadWaitingSummary).mockResolvedValue({
      testTitle: "Practice Test 3",
      answeredCount: 2,
      unansweredCount: 1,
    })

    expect(await loadTimeUp("att-1")).toEqual({
      testTitle: "Practice Test 3",
      answeredCount: 2,
      unansweredCount: 1,
      resultUrl: "/attempts/att-1/result",
      waiting: true,
    })
  })

  it("rethrows when nothing on this device explains the failure", async () => {
    const failure = new TypeError("Failed to fetch")

    vi.mocked(getAttemptResult).mockRejectedValue(failure)
    vi.mocked(loadWaitingSummary).mockResolvedValue(null)

    await expect(loadTimeUp("att-1")).rejects.toBe(failure)
  })
})

describe("TimeUpScreen waiting variant", () => {
  const waiting = {
    testTitle: "Practice Test 3",
    answeredCount: 2,
    unansweredCount: 1,
    resultUrl: "/attempts/att-1/result",
    waiting: true as const,
  }

  it("explains the wait, disables See your result with a reason, and offers Check again", () => {
    const onCheckAgain = vi.fn()

    render(<TimeUpScreen data={waiting} onCheckAgain={onCheckAgain} />)

    expect(screen.getByText("We'll score it as soon as you're back online.")).toBeInTheDocument()

    const see = screen.getByRole("button", { name: /see your result/i })

    expect(see).toBeDisabled()
    expect(see).toHaveAccessibleDescription("Your result isn't ready yet.")
    fireEvent.click(screen.getByRole("button", { name: "Check again" }))
    expect(onCheckAgain).toHaveBeenCalledOnce()
  })

  it("a refused journal replaces Check again with the adult-help alert", () => {
    render(<TimeUpScreen data={waiting} syncFailed />)

    expect(screen.getByRole("alert")).toHaveTextContent("Please tell an adult")
    expect(screen.queryByRole("button", { name: "Check again" })).toBeNull()
  })

  it("the normal variant still links to the result", () => {
    render(
      <TimeUpScreen
        data={{ testTitle: "T", answeredCount: 1, unansweredCount: 0, resultUrl: "/attempts/att-1/result" }}
      />,
    )

    expect(screen.getByRole("link", { name: /see your result/i })).toHaveAttribute(
      "href",
      "/attempts/att-1/result",
    )
  })
})
```

- [ ] **Step 9: Run to verify it fails**

Run: `pnpm --filter @pp/app exec vitest run "src/pages/attempts.\$attemptId.time-up.offline.test.tsx"`
Expected: FAIL — `loadTimeUp` rethrows the network error; `TimeUpScreen` has no waiting variant.

- [ ] **Step 10: Implement the waiting variant**

Re-read `pages/attempts.$attemptId.time-up.tsx`, then:

1. Imports: `import { loadWaitingSummary } from "../lib/attempt/waiting-summary.js"`, `useSyncStatus` from `../lib/attempt/use-sync-status.js`, `networkStore` from `../lib/network.js`, and `useEffect`, `useSyncExternalStore` from `react`.
2. `TimeUpData` gains `readonly waiting?: true`.
3. Replace the body of `loadTimeUp`:
   ```ts
   export async function loadTimeUp(
     attemptId: string,
     attempt?: FinalizedAttempt,
   ): Promise<TimeUpData> {
     const resultUrl = attempt?.resultUrl ?? `/attempts/${attemptId}/result`

     try {
       const result = await getAttemptResult(attemptId)

       return {
         testTitle: result.test.title,
         answeredCount: result.score.answered,
         unansweredCount: result.score.unanswered,
         resultUrl:
           attempt?.id === result.attemptId ? attempt.resultUrl : `/attempts/${result.attemptId}/result`,
       }
     } catch (error) {
       // The clock may have run out while offline: the server has no result
       // yet because it has not seen the journal. Only say "waiting" when this
       // device really holds that unsent work; anything else is a real failure.
       const summary = await loadWaitingSummary(attemptId)

       if (summary === null) {
         throw error
       }

       return {
         testTitle: summary.testTitle,
         answeredCount: summary.answeredCount,
         unansweredCount: summary.unansweredCount,
         resultUrl,
         waiting: true,
       }
     }
   }
   ```
   (Keep the exact non-waiting `resultUrl` logic the function has today — copy it from the current body rather than the sketch above if they differ.)
4. `TimeUpScreenProps` gains `readonly onCheckAgain?: () => void` and `readonly syncFailed?: boolean`; destructure them with the existing `data`.
5. In the markup: the message paragraph becomes `{data.waiting ? t("offline.timeUp.waiting") : t("timeUp.message")}`, and the result link block becomes:
   ```tsx
        {data.waiting ? (
          <>
            <button
              type="button"
              className="device-button mt-[18px]"
              disabled
              aria-describedby="time-up-waiting"
            >
              {t("timeUp.seeResult")}
            </button>
            <p id="time-up-waiting" className="text-ink-2 mt-2 text-sm font-semibold">
              {t("offline.timeUp.waitingReason")}
            </p>
            {syncFailed ? (
              <p role="alert" className="text-bad mt-2 text-sm font-semibold">
                {t("offline.timeUp.failed")}
              </p>
            ) : (
              <button
                type="button"
                className="device-button mt-2"
                data-variant="secondary"
                onClick={onCheckAgain}
              >
                {t("offline.timeUp.checkAgain")}
              </button>
            )}
          </>
        ) : parsedResultUrl.success ? (
          <a href={parsedResultUrl.data} className="device-button mt-[18px]">
            {t("timeUp.seeResult")}
          </a>
        ) : null}
   ```
6. In `RouteComponent`:
   ```tsx
   function RouteComponent() {
     const { attemptId } = Route.useParams()
     const data = Route.useLoaderData()
     const status = useSyncStatus()
     const online = useSyncExternalStore(
       networkStore.subscribe,
       () => networkStore.getSnapshot().online,
       () => true,
     )
     const syncFailed = status.failedAttemptIds.includes(attemptId)
     const recheck = (): void => {
       window.location.reload()
     }

     // Once the journal has gone through, reload ONCE (guarded) to swap the
     // waiting screen for the real one. The guard stops a loop if the server
     // still has no result (e.g. the journal was refused).
     useEffect(() => {
       if (!data.waiting || !online || status.syncing || status.pendingAttempts > 0 || syncFailed) {
         return
       }

       const key = `time-up-retry:${attemptId}`

       try {
         if (window.sessionStorage.getItem(key)) {
           return
         }

         window.sessionStorage.setItem(key, "1")
       } catch {
         return
       }

       window.location.reload()
     }, [attemptId, data.waiting, online, status.syncing, status.pendingAttempts, syncFailed])

     return <TimeUpScreen data={data} onCheckAgain={recheck} syncFailed={syncFailed} />
   }
   ```

- [ ] **Step 11: Run to verify it passes, plus the existing time-up suite**

Run: `pnpm --filter @pp/app exec vitest run "src/pages/attempts.\$attemptId.time-up"`
Expected: 6 new tests PASS and the existing time-up tests unchanged (the normal `loadTimeUp` result has no `waiting` key, so existing `toEqual` assertions still hold).

- [ ] **Step 12: Show the pending-sync note on the library**

Re-read `pages/index.tsx`. `LibraryScreenProps` gains `readonly sync?: { readonly pendingAttempts: number; readonly failed: boolean }` (default `{ pendingAttempts: 0, failed: false }` in the component); `RouteComponent` passes `sync={{ pendingAttempts: status.pendingAttempts, failed: status.failedAttemptIds.length > 0 }}` from `const status = useSyncStatus()`. Render `<PendingSyncNote pendingAttempts={sync.pendingAttempts} failed={sync.failed} />` directly under the subtitle paragraph (above the install card). Add to `pages/index.test.tsx`:

```tsx
it("shows the saved-on-this-phone note while an offline attempt is waiting to be sent", () => {
  renderLibrary({ sync: { pendingAttempts: 1, failed: false } })

  expect(screen.getByRole("status", { name: "" })).toHaveTextContent(
    "Saved on this phone — it will be sent when you're back online.",
  )
})

it("shows the adult-help alert when a journal was refused", () => {
  renderLibrary({ sync: { pendingAttempts: 0, failed: true } })

  expect(screen.getByRole("alert")).toHaveTextContent("Please tell an adult")
})
```

(`renderLibrary` is the helper Task 16/21 already use in that file; if more than one `status` role exists on the page, query `screen.getByText(/saved on this phone/i)` instead.)

Run: `pnpm --filter @pp/app exec vitest run src/pages/index.test.tsx` — Expected: PASS.

- [ ] **Step 13: Full gates and commit**

Run:
```
pnpm --filter @pp/app exec vitest run
pnpm --filter @pp/app exec tsc --noEmit && pnpm lint && pnpm format
```
Expected: PASS. `lint:i18n` must show no new findings: every string above goes through `t()`.

```bash
git add packages/app
git commit -m "feat(app): offline hand-in guard, waiting time-up variant and pending-sync indicator"
```

---

### Task 23: Reminder subscriptions — table, repository, config, `PUT/DELETE /api/me/reminders`

**Files:**
- Create: `packages/db/migrations/1017_reminder_subscription.cjs`
- Modify: `docs/db/schema.sql` (append the table — `schema.sql` is the documented source of truth, the migration copies it verbatim)
- Create: `packages/db/src/repositories/reminder.repository.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/test/reminder-subscription.test.ts`
- Modify: `packages/server/src/config.ts`
- Test: `packages/server/test/reminders-config.test.ts`
- Create: `packages/server/src/reminders/reminder.dto.ts`, `packages/server/src/reminders/reminders.service.ts`, `packages/server/src/reminders/reminders.controller.ts`, `packages/server/src/reminders/reminders.module.ts`
- Modify: `packages/server/src/app.module.ts`
- Test: `packages/server/test/reminders.e2e.test.ts`
- Modify: `docs/api/openapi.yaml`, `compose.yml`

**Interfaces:**
- Consumes: `REQUEST_POOL` (`database/tokens.ts`), `JwksGuard`, `CurrentStudent`, `ProblemException`/`ProblemExceptionFilter` (`attempts/`), `findStudentBySubject` / `upsertStudentBySubject` (`@pp/db`), `loadServerConfig()`.
- Produces (Task 24 and 25 rely on these exact names):
  ```ts
  // @pp/db
  export type ReminderLocale = "de" | "en" | "es" | "fr" | "it" | "ja"
  export interface ReminderSubscriptionInput {
    studentId: string; endpoint: string; p256dh: string; auth: string
    timezone: string; locale: ReminderLocale; hour: number; minute: number
  }
  export interface ReminderSubscriptionRow extends ReminderSubscriptionInput { lastSentOn: string | null } // 'YYYY-MM-DD'
  export function upsertReminderSubscription(db: PgQueryable, input: ReminderSubscriptionInput): Promise<ReminderSubscriptionRow>
  export function findReminderSubscription(db: PgQueryable, studentId: string): Promise<ReminderSubscriptionRow | null>
  export function deleteReminderSubscription(db: PgQueryable, studentId: string): Promise<boolean>
  // @pp/server config.ts
  export interface PushConfig { readonly publicKey: string; readonly privateKey: string; readonly subject: string }
  // ServerConfig gains:  push: PushConfig | null
  // HTTP: PUT /api/me/reminders (204 | 400 invalid_body | 401 | 404 student_not_provisioned | 503 reminders_not_configured)
  //       DELETE /api/me/reminders (204, idempotent, works even when push is not configured)
  ```

- [ ] **Step 1: Write the failing database test**

Create `packages/db/test/reminder-subscription.test.ts`:

```ts
import { randomUUID } from "node:crypto"
import type pg from "pg"
import { describe, expect, it } from "vitest"
import { upsertStudentBySubject } from "../src/index.js"
import {
  deleteReminderSubscription,
  findReminderSubscription,
  upsertReminderSubscription,
  type ReminderSubscriptionInput,
} from "../src/repositories/reminder.repository.js"
import { withDatabase } from "./helpers/database.js"

async function newStudent(pool: pg.Pool): Promise<string> {
  const { student } = await upsertStudentBySubject(pool, {
    subjectClaim: `sub-${randomUUID()}`,
    email: `${randomUUID()}@example.test`,
    displayName: "Reminder",
  })

  return student.id
}

function input(
  studentId: string,
  overrides: Partial<ReminderSubscriptionInput> = {},
): ReminderSubscriptionInput {
  return {
    studentId,
    endpoint: `https://push.example.test/${randomUUID()}`,
    p256dh: "p256dh-key",
    auth: "auth-secret",
    timezone: "America/New_York",
    locale: "en",
    hour: 16,
    minute: 30,
    ...overrides,
  }
}

const RAW_INSERT = `INSERT INTO reminder_subscription
  (student_id, endpoint, p256dh, auth, timezone, hour, minute)
  VALUES ($1, $2, 'k', 'a', 'UTC', $3, $4)`

describe("migration 1017 — reminder_subscription constraints", () => {
  it("refuses an out-of-range hour or minute", async () => {
    await withDatabase(async (pool) => {
      const studentId = await newStudent(pool)

      await expect(
        pool.query(RAW_INSERT, [studentId, "https://p.example.test/a", 24, 0]),
      ).rejects.toMatchObject({ constraint: "reminder_hour_range" })
      await expect(
        pool.query(RAW_INSERT, [studentId, "https://p.example.test/b", 8, 60]),
      ).rejects.toMatchObject({ constraint: "reminder_minute_range" })
    })
  })

  it("refuses a non-https endpoint", async () => {
    await withDatabase(async (pool) => {
      const studentId = await newStudent(pool)

      await expect(
        pool.query(RAW_INSERT, [studentId, "http://p.example.test/a", 8, 0]),
      ).rejects.toMatchObject({ constraint: "reminder_endpoint_https" })
    })
  })

  it("holds one subscription per student and one student per endpoint", async () => {
    await withDatabase(async (pool) => {
      const first = await newStudent(pool)
      const second = await newStudent(pool)

      await pool.query(RAW_INSERT, [first, "https://p.example.test/x", 8, 0])
      await expect(
        pool.query(RAW_INSERT, [first, "https://p.example.test/y", 8, 0]),
      ).rejects.toMatchObject({ constraint: "reminder_subscription_pkey" })
      await expect(
        pool.query(RAW_INSERT, [second, "https://p.example.test/x", 8, 0]),
      ).rejects.toMatchObject({ constraint: "reminder_subscription_endpoint_key" })
    })
  })

  it("is deleted with its student", async () => {
    await withDatabase(async (pool) => {
      const studentId = await newStudent(pool)
      await pool.query(RAW_INSERT, [studentId, "https://p.example.test/z", 8, 0])

      await pool.query(`DELETE FROM student WHERE id = $1`, [studentId])

      const { rows } = await pool.query(`SELECT 1 FROM reminder_subscription`)
      expect(rows).toHaveLength(0)
    })
  })
})

describe("reminder repository — upsert / find / delete", () => {
  it("stores and reads back a subscription", async () => {
    await withDatabase(async (pool) => {
      const studentId = await newStudent(pool)
      const saved = await upsertReminderSubscription(
        pool,
        input(studentId, { locale: "ja", timezone: "Asia/Tokyo" }),
      )

      expect(saved).toMatchObject({
        studentId,
        locale: "ja",
        timezone: "Asia/Tokyo",
        hour: 16,
        minute: 30,
        lastSentOn: null,
      })
      expect(await findReminderSubscription(pool, studentId)).toEqual(saved)
    })
  })

  it("replaces the student's previous subscription instead of adding a second row", async () => {
    await withDatabase(async (pool) => {
      const studentId = await newStudent(pool)
      await upsertReminderSubscription(pool, input(studentId))
      const replacement = input(studentId, { locale: "fr" })

      await upsertReminderSubscription(pool, replacement)

      const { rows } = await pool.query<{ endpoint: string }>(
        `SELECT endpoint FROM reminder_subscription`,
      )
      expect(rows).toEqual([{ endpoint: replacement.endpoint }])
    })
  })

  it("keeps last_sent_on when the same endpoint re-subscribes, clears it for a new endpoint", async () => {
    await withDatabase(async (pool) => {
      const studentId = await newStudent(pool)
      const original = input(studentId)
      await upsertReminderSubscription(pool, original)
      await pool.query(
        `UPDATE reminder_subscription SET last_sent_on = '2026-01-15' WHERE student_id = $1`,
        [studentId],
      )

      const same = await upsertReminderSubscription(pool, original)
      expect(same.lastSentOn).toBe("2026-01-15")

      const moved = await upsertReminderSubscription(
        pool,
        input(studentId),
      )
      expect(moved.lastSentOn).toBeNull()
    })
  })

  it("moves an endpoint to the student who subscribes with it (shared phone)", async () => {
    await withDatabase(async (pool) => {
      const first = await newStudent(pool)
      const second = await newStudent(pool)
      const shared = input(first)
      await upsertReminderSubscription(pool, shared)

      await upsertReminderSubscription(pool, { ...shared, studentId: second })

      expect(await findReminderSubscription(pool, first)).toBeNull()
      expect(await findReminderSubscription(pool, second)).toMatchObject({
        endpoint: shared.endpoint,
      })
    })
  })

  it("deletes only the named student's row and reports whether one existed", async () => {
    await withDatabase(async (pool) => {
      const first = await newStudent(pool)
      const second = await newStudent(pool)
      await upsertReminderSubscription(pool, input(first))
      await upsertReminderSubscription(pool, input(second))

      expect(await deleteReminderSubscription(pool, first)).toBe(true)
      expect(await deleteReminderSubscription(pool, first)).toBe(false)
      expect(await findReminderSubscription(pool, second)).not.toBeNull()
    })
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @pp/db exec vitest run test/reminder-subscription.test.ts`
Expected: FAIL — `Cannot find module '../src/repositories/reminder.repository.js'` (and, once that exists, `relation "reminder_subscription" does not exist`).

- [ ] **Step 3: Add the migration and the schema source of truth**

Create `packages/db/migrations/1017_reminder_subscription.cjs` (same style as `1007_admin_audit.cjs`). Numbering note: `1016` belongs to Task 17 (offline attempts); Part C/D must be merged in numeric order — `node-pg-migrate` refuses out-of-order runs.

```js
/* eslint-disable camelcase, typescript/no-unsafe-call, typescript/no-unsafe-member-access */
exports.shorthands = undefined

exports.up = (pgm) => {
  pgm.sql(`
-- docs/db/schema.sql, "REMINDER SUBSCRIPTION", verbatim.
CREATE TABLE reminder_subscription (
    student_id    uuid        PRIMARY KEY REFERENCES student (id) ON DELETE CASCADE,
    endpoint      text        NOT NULL,
    p256dh        text        NOT NULL,
    auth          text        NOT NULL,
    timezone      text        NOT NULL,
    locale        text        NOT NULL DEFAULT 'en',
    hour          smallint    NOT NULL,
    minute        smallint    NOT NULL,
    -- The student's LOCAL calendar date of the last reminder sent (or claimed).
    -- A date, not a timestamp: "once per local day" is the rule.
    last_sent_on  date,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT reminder_endpoint_https     CHECK (endpoint LIKE 'https://%'),
    CONSTRAINT reminder_keys_not_blank     CHECK (length(btrim(p256dh)) > 0 AND length(btrim(auth)) > 0),
    CONSTRAINT reminder_timezone_not_blank CHECK (length(btrim(timezone)) > 0),
    CONSTRAINT reminder_locale_known       CHECK (locale IN ('de', 'en', 'es', 'fr', 'it', 'ja')),
    CONSTRAINT reminder_hour_range         CHECK (hour BETWEEN 0 AND 23),
    CONSTRAINT reminder_minute_range       CHECK (minute BETWEEN 0 AND 59)
);

-- One browser belongs to one student at a time; the repository evicts the
-- previous holder when a second student subscribes from the same phone.
CREATE UNIQUE INDEX reminder_subscription_endpoint_key ON reminder_subscription (endpoint);
  `)
}

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE reminder_subscription;`)
}
```

Append the identical `CREATE TABLE` + `CREATE UNIQUE INDEX` statements (without the `pgm.sql` wrapper) to the end of `docs/db/schema.sql` under the heading comment `-- REMINDER SUBSCRIPTION`.

- [ ] **Step 4: Write the repository and export it**

Create `packages/db/src/repositories/reminder.repository.ts`:

```ts
import type { PgQueryable } from "@liam-workspace/node-postgres"

export type ReminderLocale = "de" | "en" | "es" | "fr" | "it" | "ja"

export interface ReminderSubscriptionInput {
  studentId: string
  endpoint: string
  p256dh: string
  auth: string
  timezone: string
  locale: ReminderLocale
  hour: number
  minute: number
}

export interface ReminderSubscriptionRow extends ReminderSubscriptionInput {
  /** The student's LOCAL calendar date, `YYYY-MM-DD`, of the last reminder. */
  lastSentOn: string | null
}

interface ReminderDbRow {
  student_id: string
  endpoint: string
  p256dh: string
  auth: string
  timezone: string
  locale: ReminderLocale
  hour: number
  minute: number
  last_sent_on: string | null
}

export const REMINDER_COLUMNS = `student_id, endpoint, p256dh, auth, timezone, locale,
  hour, minute, to_char(last_sent_on, 'YYYY-MM-DD') AS last_sent_on`

export function toReminderRow(row: ReminderDbRow): ReminderSubscriptionRow {
  return {
    studentId: row.student_id,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    timezone: row.timezone,
    locale: row.locale,
    hour: row.hour,
    minute: row.minute,
    lastSentOn: row.last_sent_on,
  }
}

/**
 * Two statements, not one data-modifying CTE: PostgreSQL does not let a
 * sub-statement's DELETE free a unique key for a sibling INSERT in the same
 * command. Evicting the endpoint's previous holder first is what makes a
 * shared phone follow whoever subscribed last; the window between the two
 * statements can only fail the upsert with a unique violation (caller retries
 * by tapping again), never leave two students on one endpoint.
 *
 * `last_sent_on` survives a re-subscribe from the SAME endpoint (toggling the
 * switch must not earn a second reminder today) and resets for a new one.
 */
export async function upsertReminderSubscription(
  db: PgQueryable,
  input: ReminderSubscriptionInput,
): Promise<ReminderSubscriptionRow> {
  await db.query(
    `DELETE FROM reminder_subscription WHERE endpoint = $1 AND student_id <> $2`,
    [input.endpoint, input.studentId],
  )

  const { rows } = await db.query<ReminderDbRow>(
    `INSERT INTO reminder_subscription
       (student_id, endpoint, p256dh, auth, timezone, locale, hour, minute)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (student_id) DO UPDATE
        SET last_sent_on = CASE
              WHEN reminder_subscription.endpoint = EXCLUDED.endpoint
              THEN reminder_subscription.last_sent_on END,
            endpoint = EXCLUDED.endpoint,
            p256dh = EXCLUDED.p256dh,
            auth = EXCLUDED.auth,
            timezone = EXCLUDED.timezone,
            locale = EXCLUDED.locale,
            hour = EXCLUDED.hour,
            minute = EXCLUDED.minute,
            updated_at = now()
     RETURNING ${REMINDER_COLUMNS}`,
    [
      input.studentId,
      input.endpoint,
      input.p256dh,
      input.auth,
      input.timezone,
      input.locale,
      input.hour,
      input.minute,
    ],
  )

  return toReminderRow(rows[0])
}

export async function findReminderSubscription(
  db: PgQueryable,
  studentId: string,
): Promise<ReminderSubscriptionRow | null> {
  const { rows } = await db.query<ReminderDbRow>(
    `SELECT ${REMINDER_COLUMNS} FROM reminder_subscription WHERE student_id = $1`,
    [studentId],
  )

  return rows.length > 0 ? toReminderRow(rows[0]) : null
}

export async function deleteReminderSubscription(
  db: PgQueryable,
  studentId: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `DELETE FROM reminder_subscription WHERE student_id = $1`,
    [studentId],
  )

  return (rowCount ?? 0) > 0
}
```

In `packages/db/src/index.ts`, after the `student.repository.js` import block add:

```ts
import {
  deleteReminderSubscription,
  findReminderSubscription,
  upsertReminderSubscription,
  type ReminderLocale,
  type ReminderSubscriptionInput,
  type ReminderSubscriptionRow,
} from "./repositories/reminder.repository.js"
```

add `export type { ReminderLocale, ReminderSubscriptionInput, ReminderSubscriptionRow }` next to the other `export type` groups, and add `upsertReminderSubscription, findReminderSubscription, deleteReminderSubscription,` to the big `export { … }` list.

- [ ] **Step 5: Run the database test and confirm it passes**

Run: `pnpm --filter @pp/db exec vitest run test/reminder-subscription.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/db/migrations/1017_reminder_subscription.cjs docs/db/schema.sql packages/db/src/repositories/reminder.repository.ts packages/db/src/index.ts packages/db/test/reminder-subscription.test.ts
git commit -m "feat(db): reminder_subscription table and repository"
```

- [ ] **Step 7: Write the failing config test**

Create `packages/server/test/reminders-config.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { loadServerConfig } from "../src/config.js"

const BASE = {
  DATABASE_URL: "postgresql://pp:pw@localhost:5432/pp",
  JWKS_URL: "https://auth.test/jwks",
  MEDIA_SIGNING_SECRET: "secret",
}

describe("loadServerConfig — Web Push", () => {
  it("leaves push null when no VAPID variable is set, so the server still boots", () => {
    expect(loadServerConfig(BASE).push).toBeNull()
  })

  it("treats empty strings (compose's `${VAR:-}` defaults) as unset", () => {
    expect(
      loadServerConfig({
        ...BASE,
        VAPID_PUBLIC_KEY: "",
        VAPID_PRIVATE_KEY: "  ",
        VAPID_SUBJECT: "",
      }).push,
    ).toBeNull()
  })

  it("reads all three when all three are set", () => {
    expect(
      loadServerConfig({
        ...BASE,
        VAPID_PUBLIC_KEY: "pub",
        VAPID_PRIVATE_KEY: "priv",
        VAPID_SUBJECT: "mailto:ops@example.test",
      }).push,
    ).toEqual({
      publicKey: "pub",
      privateKey: "priv",
      subject: "mailto:ops@example.test",
    })
  })

  it("fails the boot when only some are set — a half-configured key pair is a typo, not a mode", () => {
    expect(() =>
      loadServerConfig({ ...BASE, VAPID_PUBLIC_KEY: "pub" }),
    ).toThrow("VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT must be set together")
  })
})
```

Run: `pnpm --filter @pp/server exec vitest run test/reminders-config.test.ts`
Expected: FAIL — `expected undefined to be null` (no `push` key yet).

- [ ] **Step 8: Implement the config**

In `packages/server/src/config.ts` add above `ServerConfig`:

```ts
export interface PushConfig {
  readonly publicKey: string
  readonly privateKey: string
  readonly subject: string
}
```

add `push: PushConfig | null` as the last field of `ServerConfig`, add the helper below `required`:

```ts
/**
 * All three or none. Compose's `${VAR:-}` hands the container EMPTY strings
 * for unset variables, so blank counts as unset; a partial set refuses to
 * boot rather than silently running without reminders.
 */
function loadPushConfig(env: Environment): PushConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim() ?? ""
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() ?? ""
  const subject = env.VAPID_SUBJECT?.trim() ?? ""
  const present = [publicKey, privateKey, subject].filter(
    (value) => value.length > 0,
  ).length

  if (present === 0) {
    return null
  }

  if (present < 3) {
    throw new Error(
      "VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT must be set together",
    )
  }

  return { publicKey, privateKey, subject }
}
```

and add `push: loadPushConfig(env),` at the end of the object returned by `loadServerConfig`.

Run: `pnpm --filter @pp/server exec vitest run test/reminders-config.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 9: Write the failing end-to-end test**

Create `packages/server/test/reminders.e2e.test.ts`:

```ts
import type { PgPool } from "@liam-workspace/node-postgres"
import request from "supertest"
import type { App } from "supertest/types.js"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { REQUEST_POOL } from "../src/database/tokens.js"
import { createTestApp, type TestApp } from "./helpers/app.js"

const SUBSCRIPTION = {
  endpoint: "https://push.example.test/send/abc123",
  expirationTime: null,
  keys: {
    p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
    auth: "tBHItJI5svbpez7KI4CCXg",
  },
}
const BODY = {
  subscription: SUBSCRIPTION,
  timezone: "America/New_York",
  locale: "en",
  hour: 16,
  minute: 30,
}

interface Row {
  student_id: string
  endpoint: string
  locale: string
}

describe("PUT/DELETE /api/me/reminders", () => {
  let app: TestApp | undefined = undefined

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app?.close()
  })

  beforeEach(async () => {
    await pool().query(`DELETE FROM reminder_subscription`)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  function ready(): TestApp {
    if (!app) {
      throw new Error("Application failed to initialize")
    }

    return app
  }

  function pool(): PgPool {
    return ready().get<PgPool>(REQUEST_POOL)
  }

  function configurePush(): void {
    vi.stubEnv("VAPID_PUBLIC_KEY", "test-public")
    vi.stubEnv("VAPID_PRIVATE_KEY", "test-private")
    vi.stubEnv("VAPID_SUBJECT", "mailto:test@example.test")
  }

  function server(): App {
    return ready().http.getHttpServer() as App
  }

  async function provisioned(sub: string): Promise<string> {
    const token = await ready().mint({ sub, email: `${sub}@example.test` })

    await request(server())
      .post("/api/session")
      .set("Authorization", `Bearer ${token}`)

    return token
  }

  async function rows(): Promise<Row[]> {
    const { rows: found } = await pool().query<Row>(
      `SELECT student_id, endpoint, locale FROM reminder_subscription`,
    )

    return found
  }

  describe("when Web Push is configured", () => {
    beforeEach(configurePush)

    it("stores the subscription and answers 204", async () => {
      const token = await provisioned("rem-a")

      await request(server())
        .put("/api/me/reminders")
        .set("Authorization", `Bearer ${token}`)
        .send(BODY)
        .expect(204)

      expect(await rows()).toMatchObject([
        { endpoint: SUBSCRIPTION.endpoint, locale: "en" },
      ])
    })

    it("defaults the locale to en and accepts the other five", async () => {
      const token = await provisioned("rem-locale")
      const { locale: _omitted, ...withoutLocale } = BODY

      await request(server())
        .put("/api/me/reminders")
        .set("Authorization", `Bearer ${token}`)
        .send(withoutLocale)
        .expect(204)
      expect((await rows())[0].locale).toBe("en")

      await request(server())
        .put("/api/me/reminders")
        .set("Authorization", `Bearer ${token}`)
        .send({ ...BODY, locale: "ja" })
        .expect(204)
      expect((await rows())[0].locale).toBe("ja")
    })

    it("a second PUT replaces the first: still one row for the student", async () => {
      const token = await provisioned("rem-replace")
      const put = (endpoint: string) =>
        request(server())
          .put("/api/me/reminders")
          .set("Authorization", `Bearer ${token}`)
          .send({ ...BODY, subscription: { ...SUBSCRIPTION, endpoint } })
          .expect(204)

      await put("https://push.example.test/send/one")
      await put("https://push.example.test/send/two")

      expect(await rows()).toMatchObject([
        { endpoint: "https://push.example.test/send/two" },
      ])
    })

    it("moves an endpoint to the student who subscribes with it", async () => {
      const first = await provisioned("rem-shared-1")
      const second = await provisioned("rem-shared-2")
      const put = (token: string) =>
        request(server())
          .put("/api/me/reminders")
          .set("Authorization", `Bearer ${token}`)
          .send(BODY)
          .expect(204)

      await put(first)
      await put(second)

      expect(await rows()).toHaveLength(1)
    })

    it.each([
      ["a non-https endpoint", { subscription: { ...SUBSCRIPTION, endpoint: "http://push.example.test/x" } }],
      ["an unknown timezone", { timezone: "Mars/Phobos" }],
      ["an out-of-range hour", { hour: 24 }],
      ["an unknown locale", { locale: "xx" }],
      ["a missing key", { subscription: { endpoint: SUBSCRIPTION.endpoint, keys: { p256dh: "x" } } }],
      ["an unexpected field", { admin: true }],
    ])("refuses %s with 400 invalid_body", async (_name, patch) => {
      const token = await provisioned("rem-invalid")

      const res = await request(server())
        .put("/api/me/reminders")
        .set("Authorization", `Bearer ${token}`)
        .send({ ...BODY, ...patch })
        .expect(400)

      expect((res.body as { type: string }).type).toBe("invalid_body")
      expect(await rows()).toHaveLength(0)
    })

    it("answers 401 without a token", async () => {
      await request(server()).put("/api/me/reminders").send(BODY).expect(401)
      await request(server()).delete("/api/me/reminders").expect(401)
    })

    it("answers 404 student_not_provisioned for a token whose student was never created", async () => {
      const token = await ready().mint({ sub: "rem-ghost", email: "ghost@example.test" })

      const res = await request(server())
        .put("/api/me/reminders")
        .set("Authorization", `Bearer ${token}`)
        .send(BODY)
        .expect(404)

      expect((res.body as { type: string }).type).toBe("student_not_provisioned")
    })

    it("DELETE removes only the caller's row and is idempotent", async () => {
      const mine = await provisioned("rem-del-1")
      const theirs = await provisioned("rem-del-2")
      await request(server()).put("/api/me/reminders").set("Authorization", `Bearer ${mine}`).send(BODY).expect(204)
      await request(server())
        .put("/api/me/reminders")
        .set("Authorization", `Bearer ${theirs}`)
        .send({ ...BODY, subscription: { ...SUBSCRIPTION, endpoint: "https://push.example.test/send/other" } })
        .expect(204)

      await request(server()).delete("/api/me/reminders").set("Authorization", `Bearer ${mine}`).expect(204)
      await request(server()).delete("/api/me/reminders").set("Authorization", `Bearer ${mine}`).expect(204)

      expect(await rows()).toMatchObject([{ endpoint: "https://push.example.test/send/other" }])
    })
  })

  describe("when Web Push is not configured", () => {
    beforeEach(() => {
      vi.stubEnv("VAPID_PUBLIC_KEY", "")
      vi.stubEnv("VAPID_PRIVATE_KEY", "")
      vi.stubEnv("VAPID_SUBJECT", "")
    })

    it("PUT answers 503 reminders_not_configured and stores nothing", async () => {
      const token = await provisioned("rem-off")

      const res = await request(server())
        .put("/api/me/reminders")
        .set("Authorization", `Bearer ${token}`)
        .send(BODY)
        .expect(503)

      expect((res.body as { type: string }).type).toBe("reminders_not_configured")
      expect(await rows()).toHaveLength(0)
    })

    it("DELETE still answers 204 so sign-out cleanup never breaks", async () => {
      const token = await provisioned("rem-off-del")

      await request(server()).delete("/api/me/reminders").set("Authorization", `Bearer ${token}`).expect(204)
    })
  })
})
```

Run: `pnpm --filter @pp/server exec vitest run test/reminders.e2e.test.ts`
Expected: FAIL — every request answers 404 (`Cannot PUT /api/me/reminders`).

- [ ] **Step 10: Implement DTO, service, controller, module**

Create `packages/server/src/reminders/reminder.dto.ts`:

```ts
import { z } from "zod"

export const REMINDER_LOCALES = ["de", "en", "es", "fr", "it", "ja"] as const

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value })

    return true
  } catch {
    return false
  }
}

/**
 * `subscription` is `PushSubscription.toJSON()`: `{ endpoint, expirationTime,
 * keys: { p256dh, auth } }`. https-only because the push service is always
 * https and an `http://` endpoint would be a server-side request to a
 * client-chosen plain-text URL.
 */
export const ReminderSubscriptionSchema = z.strictObject({
  subscription: z.strictObject({
    endpoint: z
      .url()
      .max(2048)
      .refine((value) => value.startsWith("https://"), "endpoint_must_be_https"),
    expirationTime: z.number().nullable().optional(),
    keys: z.strictObject({
      p256dh: z.string().min(1).max(256),
      auth: z.string().min(1).max(256),
    }),
  }),
  timezone: z.string().min(1).max(64).refine(isTimeZone, "invalid_timezone"),
  locale: z.enum(REMINDER_LOCALES).default("en"),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
})

export class ReminderSubscriptionDto implements z.infer<
  typeof ReminderSubscriptionSchema
> {
  static readonly schema = ReminderSubscriptionSchema
  declare subscription: {
    endpoint: string
    expirationTime?: number | null
    keys: { p256dh: string; auth: string }
  }
  declare timezone: string
  declare locale: (typeof REMINDER_LOCALES)[number]
  declare hour: number
  declare minute: number
}
```

Create `packages/server/src/reminders/reminders.service.ts`:

```ts
import type { PgPool } from "@liam-workspace/node-postgres"
import { HttpStatus, Inject, Injectable } from "@nestjs/common"
import {
  deleteReminderSubscription,
  findStudentBySubject,
  upsertReminderSubscription,
} from "@pp/db"
import { ProblemException } from "../attempts/problem.exception.js"
import { loadServerConfig } from "../config.js"
import { REQUEST_POOL } from "../database/tokens.js"
import type { ReminderSubscriptionDto } from "./reminder.dto.js"

@Injectable()
export class RemindersService {
  constructor(@Inject(REQUEST_POOL) private readonly pool: PgPool) {}

  async save(subjectClaim: string, body: ReminderSubscriptionDto): Promise<void> {
    if (!loadServerConfig().push) {
      throw new ProblemException({
        type: "reminders_not_configured",
        title: "Practice reminders are not configured on this server.",
        status: HttpStatus.SERVICE_UNAVAILABLE,
      })
    }

    const student = await findStudentBySubject(this.pool, subjectClaim)

    if (!student) {
      throw new ProblemException({
        type: "student_not_provisioned",
        title: "No student profile exists for this token.",
        status: HttpStatus.NOT_FOUND,
      })
    }

    await upsertReminderSubscription(this.pool, {
      studentId: student.id,
      endpoint: body.subscription.endpoint,
      p256dh: body.subscription.keys.p256dh,
      auth: body.subscription.keys.auth,
      timezone: body.timezone,
      locale: body.locale,
      hour: body.hour,
      minute: body.minute,
    })
  }

  /** Works with push unconfigured: sign-out cleanup must never fail on config. */
  async remove(subjectClaim: string): Promise<void> {
    const student = await findStudentBySubject(this.pool, subjectClaim)

    if (student) {
      await deleteReminderSubscription(this.pool, student.id)
    }
  }
}
```

Create `packages/server/src/reminders/reminders.controller.ts`:

```ts
import type { JwtClaims } from "@liam-workspace/node-auth-server"
import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Put,
  UseFilters,
  UseGuards,
} from "@nestjs/common"
import { ProblemException } from "../attempts/problem.exception.js"
import { ProblemExceptionFilter } from "../attempts/problem.filter.js"
import { CurrentStudent } from "../auth/current-student.decorator.js"
import { JwksGuard } from "../auth/jwks.guard.js"
import { ReminderSubscriptionDto } from "./reminder.dto.js"
import { RemindersService } from "./reminders.service.js"

@Controller("me/reminders")
@UseGuards(JwksGuard)
@UseFilters(ProblemExceptionFilter)
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Put()
  @HttpCode(HttpStatus.NO_CONTENT)
  async save(
    @CurrentStudent() claims: JwtClaims,
    @Body() body: ReminderSubscriptionDto,
  ): Promise<void> {
    await this.reminders.save(subjectOf(claims), body)
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentStudent() claims: JwtClaims): Promise<void> {
    await this.reminders.remove(subjectOf(claims))
  }
}

/** JwksGuard rejects a null sub, so this is a belt-and-braces narrowing. */
function subjectOf(claims: JwtClaims): string {
  if (!claims.sub) {
    throw new ProblemException({
      type: "invalid_token",
      title: "Missing, invalid or expired token.",
      status: HttpStatus.UNAUTHORIZED,
    })
  }

  return claims.sub
}
```

Create `packages/server/src/reminders/reminders.module.ts`:

```ts
import { Module } from "@nestjs/common"
import { RemindersController } from "./reminders.controller.js"
import { RemindersService } from "./reminders.service.js"

@Module({
  controllers: [RemindersController],
  providers: [RemindersService],
})
export class RemindersModule {}
```

In `packages/server/src/app.module.ts` add `import { RemindersModule } from "./reminders/reminders.module.js"` (alphabetical, before the `ResponsesModule` import) and `RemindersModule,` in the `imports` array (before `ResponsesModule,`).

- [ ] **Step 11: Run the end-to-end test and confirm it passes**

Run: `pnpm --filter @pp/server exec vitest run test/reminders.e2e.test.ts`
Expected: PASS (all cases, including the six `it.each` rejections).

- [ ] **Step 12: Document the contract**

In `docs/api/openapi.yaml`, insert immediately before the `# ──… Catalog ──` comment line (the one directly followed by `  /tests:`):

```yaml
  /me/reminders:
    put:
      tags: [Session]
      operationId: putReminderSubscription
      summary: Turn on the daily practice reminder for this device
      description: |
        Stores this student's Web Push subscription (`PushSubscription.toJSON()`) and the local time
        to remind at. One subscription per student: a second PUT replaces the first, and an endpoint
        already held by another student moves to the caller (a shared phone follows whoever
        subscribed last). Returns `503 reminders_not_configured` when the server has no VAPID keys.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/ReminderSubscriptionRequest" }
      responses:
        "204": { description: Subscription stored. }
        "400": { $ref: "#/components/responses/InvalidBody" }
        "401": { $ref: "#/components/responses/Unauthorized" }
        "404":
          description: No profile for this `sub` — call `POST /session` first.
          content:
            {
              application/problem+json:
                { schema: { $ref: "#/components/schemas/Problem" } },
            }
        "503":
          description: "`reminders_not_configured` — the server has no VAPID key pair."
          content:
            {
              application/problem+json:
                { schema: { $ref: "#/components/schemas/Problem" } },
            }
    delete:
      tags: [Session]
      operationId: deleteReminderSubscription
      summary: Turn off the daily practice reminder
      description: |
        Idempotent: 204 whether or not a subscription existed, and available even when the server
        has no VAPID keys, so sign-out cleanup never fails on server configuration.
      responses:
        "204": { description: No subscription remains for this student. }
        "401": { $ref: "#/components/responses/Unauthorized" }

```

and, directly above the line `    Problem:` under `components.schemas` (the one followed by `type: object` / `description: RFC 9457 problem details.`), add:

```yaml
    ReminderSubscriptionRequest:
      type: object
      required: [subscription, timezone, hour, minute]
      additionalProperties: false
      properties:
        subscription:
          type: object
          required: [endpoint, keys]
          additionalProperties: false
          properties:
            endpoint: { type: string, format: uri, maxLength: 2048, pattern: "^https://" }
            expirationTime: { type: [number, "null"] }
            keys:
              type: object
              required: [p256dh, auth]
              additionalProperties: false
              properties:
                p256dh: { type: string, minLength: 1, maxLength: 256 }
                auth: { type: string, minLength: 1, maxLength: 256 }
        timezone: { type: string, description: IANA zone, e.g. `America/New_York`. }
        locale: { type: string, enum: [de, en, es, fr, it, ja], default: en }
        hour: { type: integer, minimum: 0, maximum: 23 }
        minute: { type: integer, minimum: 0, maximum: 59 }

```

Run: `pnpm lint:api`
Expected: no errors (warnings that already existed before this task are acceptable; none new).

In `compose.yml`, in the `api` service's `environment:` block, directly after the `MEDIA_MAX_BYTES:` line, add:

```yaml
      # Web Push for the practice reminders. All three or none: an empty value
      # counts as unset (config.ts), a partial set refuses to boot, none means
      # PUT /api/me/reminders answers 503 reminders_not_configured and no
      # reminders are sent. Generate a pair with:
      #   pnpm --filter @pp/server exec web-push generate-vapid-keys
      VAPID_PUBLIC_KEY: ${VAPID_PUBLIC_KEY:-}
      VAPID_PRIVATE_KEY: ${VAPID_PRIVATE_KEY:-}
      VAPID_SUBJECT: ${VAPID_SUBJECT:-}
```

- [ ] **Step 13: Run the gates and commit**

Run: `pnpm lint && pnpm --filter @pp/db test && pnpm --filter @pp/server test && pnpm format`
Expected: all green. (If `pnpm format` reports the new files, run `pnpm format:fix` and re-run.)

```bash
git add packages/server/src/config.ts packages/server/src/reminders packages/server/src/app.module.ts packages/server/test/reminders-config.test.ts packages/server/test/reminders.e2e.test.ts docs/api/openapi.yaml compose.yml
git commit -m "feat(server): PUT/DELETE /api/me/reminders with optional VAPID config"
```

---

### Task 24: Reminder scheduler — due-time maths, claim-then-send, `web-push` behind a port

**Files:**
- Create: `packages/server/src/reminders/reminder-due.ts`
- Test: `packages/server/test/reminder-due.test.ts`
- Modify: `packages/db/src/repositories/reminder.repository.ts`, `packages/db/src/index.ts`
- Test: `packages/db/test/reminder-candidates.test.ts`
- Create: `packages/server/src/reminders/tokens.ts`, `packages/server/src/reminders/push-sender.ts`, `packages/server/src/reminders/reminder-messages.ts`, `packages/server/src/reminders/reminder.scheduler.ts`
- Modify: `packages/server/src/reminders/reminders.module.ts`, `packages/server/package.json`, `pnpm-lock.yaml`
- Test: `packages/server/test/reminder-scheduler.test.ts`

**Interfaces:**
- Consumes (Task 23): `ReminderSubscriptionRow`, `REMINDER_COLUMNS`, `toReminderRow`, `upsertReminderSubscription`, `PushConfig`, `loadServerConfig().push`; (existing) `JOB_POOL`, `CLOCK`, `Clock` from `@pp/common`, `withTransaction` from `@liam-workspace/node-postgres`.
- Produces:
  ```ts
  // reminder-due.ts (pure)
  export const REMINDER_GRACE_MINUTES = 360
  export interface LocalMoment { readonly date: string; readonly minutesOfDay: number } // 'YYYY-MM-DD', 0..1439
  export function localMoment(instant: Date, timezone: string): LocalMoment | null     // null for an unknown zone
  export interface ReminderSchedule { readonly timezone: string; readonly hour: number; readonly minute: number; readonly lastSentOn: string | null; readonly lastFinishedAt: Date | null }
  export function isReminderDue(schedule: ReminderSchedule, now: Date): boolean
  // @pp/db (added to reminder.repository.ts)
  export interface ReminderCandidateRow extends ReminderSubscriptionRow { lastFinishedAt: Date | null }
  export function listReminderCandidates(db: PgQueryable): Promise<ReminderCandidateRow[]>
  export function claimReminderSend(db: PgQueryable, studentId: string, localDate: string): Promise<boolean>
  export function releaseReminderClaim(db: PgQueryable, studentId: string, previous: string | null): Promise<void>
  export function deleteReminderSubscriptionByEndpoint(db: PgQueryable, endpoint: string): Promise<void>
  // push-sender.ts
  export interface PushTarget { readonly endpoint: string; readonly p256dh: string; readonly auth: string }
  export interface PushMessage { readonly title: string; readonly body: string; readonly url: string }
  export type PushOutcome = { readonly kind: "sent" } | { readonly kind: "gone" } | { readonly kind: "failed"; readonly statusCode: number | null }
  export interface PushSender { send(target: PushTarget, message: PushMessage): Promise<PushOutcome> }
  export class WebPushSender implements PushSender { constructor(config: PushConfig) }
  // tokens.ts
  export const PUSH_SENDER = "PUSH_SENDER"   // provides PushSender | null
  // reminder.scheduler.ts
  export const REMINDER_LOCK_KEY = 7_302_261_130
  export const REMINDER_RETRY_MINUTES = 15
  export interface TickSummary { readonly status: "ran" | "locked" | "disabled"; readonly sent: number; readonly removed: number; readonly failed: number; readonly skipped: number }
  export class ReminderScheduler { tick(): Promise<TickSummary> }   // also runs every 60 s once the module is initialised
  ```

- [ ] **Step 1: Write the failing pure due-time test**

Create `packages/server/test/reminder-due.test.ts`. Every instant is written in UTC and annotated with its local time so a reader can check the arithmetic.

```ts
import { describe, expect, it } from "vitest"
import {
  REMINDER_GRACE_MINUTES,
  isReminderDue,
  localMoment,
  type ReminderSchedule,
} from "../src/reminders/reminder-due.js"

const NY: ReminderSchedule = {
  timezone: "America/New_York",
  hour: 16,
  minute: 30,
  lastSentOn: null,
  lastFinishedAt: null,
}
const at = (iso: string): Date => new Date(iso)

describe("localMoment", () => {
  it("returns the zone's calendar date and minutes since local midnight", () => {
    // 21:30Z is 16:30 EST (UTC-5) in January.
    expect(localMoment(at("2026-01-15T21:30:00Z"), "America/New_York")).toEqual({
      date: "2026-01-15",
      minutesOfDay: 990,
    })
  })

  it("rolls the local date forward ahead of UTC (UTC+14)", () => {
    // 10:30Z on the 15th is 00:30 on the 16th in Pacific/Kiritimati.
    expect(localMoment(at("2026-01-15T10:30:00Z"), "Pacific/Kiritimati")).toEqual({
      date: "2026-01-16",
      minutesOfDay: 30,
    })
  })

  it("reports local midnight as minute 0, never 1440", () => {
    // 05:00Z is 00:00 EST.
    expect(localMoment(at("2026-01-15T05:00:00Z"), "America/New_York")?.minutesOfDay).toBe(0)
  })

  it("returns null for an unknown zone instead of throwing", () => {
    expect(localMoment(at("2026-01-15T21:30:00Z"), "Mars/Phobos")).toBeNull()
  })
})

describe("isReminderDue", () => {
  it("is not due one minute before the local time", () => {
    expect(isReminderDue(NY, at("2026-01-15T21:29:00Z"))).toBe(false) // 16:29 EST
  })

  it("is due at exactly the local time", () => {
    expect(isReminderDue(NY, at("2026-01-15T21:30:00Z"))).toBe(true) // 16:30 EST
  })

  it("follows daylight saving: the same 16:30 is 20:30Z in July", () => {
    expect(isReminderDue(NY, at("2026-07-15T20:29:00Z"))).toBe(false) // 16:29 EDT
    expect(isReminderDue(NY, at("2026-07-15T20:30:00Z"))).toBe(true) // 16:30 EDT
  })

  it("catches up after downtime but only inside the grace window", () => {
    expect(REMINDER_GRACE_MINUTES).toBe(360)
    expect(isReminderDue(NY, at("2026-01-16T03:29:00Z"))).toBe(true) // 22:29 EST, 359 min late
    expect(isReminderDue(NY, at("2026-01-16T03:30:00Z"))).toBe(false) // 22:30 EST, 360 min late
  })

  it("is not due again once today's local date was already sent", () => {
    expect(
      isReminderDue({ ...NY, lastSentOn: "2026-01-15" }, at("2026-01-15T21:30:00Z")),
    ).toBe(false)
  })

  it("is due again the next local day after yesterday's send", () => {
    expect(
      isReminderDue({ ...NY, lastSentOn: "2026-01-15" }, at("2026-01-16T21:30:00Z")),
    ).toBe(true)
  })

  it("is skipped when the student finished an attempt earlier the same local day", () => {
    expect(
      isReminderDue(
        { ...NY, lastFinishedAt: at("2026-01-15T15:00:00Z") }, // 10:00 EST today
        at("2026-01-15T21:30:00Z"),
      ),
    ).toBe(false)
  })

  it("is NOT skipped for an attempt finished the previous local day, even if that is today in UTC", () => {
    expect(
      isReminderDue(
        { ...NY, lastFinishedAt: at("2026-01-15T04:00:00Z") }, // 23:00 EST on the 14th
        at("2026-01-15T21:30:00Z"),
      ),
    ).toBe(true)
  })

  it("spring forward: a 02:30 reminder that does not exist fires at the first tick after 03:00", () => {
    const springForward: ReminderSchedule = { ...NY, hour: 2, minute: 30 }

    expect(isReminderDue(springForward, at("2026-03-08T06:59:00Z"))).toBe(false) // 01:59 EST
    expect(isReminderDue(springForward, at("2026-03-08T07:00:00Z"))).toBe(true) // 03:00 EDT (02:xx skipped)
  })

  it("fall back: 01:30 happens twice but lastSentOn stops the second", () => {
    const fallBack: ReminderSchedule = { ...NY, hour: 1, minute: 30 }

    expect(isReminderDue(fallBack, at("2026-11-01T05:30:00Z"))).toBe(true) // 01:30 EDT, first pass
    expect(
      isReminderDue({ ...fallBack, lastSentOn: "2026-11-01" }, at("2026-11-01T06:30:00Z")),
    ).toBe(false) // 01:30 EST, second pass
  })

  it("handles a half-hour offset (Asia/Kolkata, UTC+5:30)", () => {
    const kolkata: ReminderSchedule = { ...NY, timezone: "Asia/Kolkata" }

    expect(isReminderDue(kolkata, at("2026-01-15T10:59:00Z"))).toBe(false) // 16:29 IST
    expect(isReminderDue(kolkata, at("2026-01-15T11:00:00Z"))).toBe(true) // 16:30 IST
  })

  it("compares the sent date in the student's zone, not UTC (UTC+14)", () => {
    const kiritimati: ReminderSchedule = {
      ...NY,
      timezone: "Pacific/Kiritimati",
      hour: 0,
      minute: 15,
    }
    const now = at("2026-01-15T10:30:00Z") // 00:30 on 2026-01-16 local

    expect(isReminderDue({ ...kiritimati, lastSentOn: "2026-01-15" }, now)).toBe(true)
    expect(isReminderDue({ ...kiritimati, lastSentOn: "2026-01-16" }, now)).toBe(false)
  })

  it("is never due for an unknown timezone", () => {
    expect(isReminderDue({ ...NY, timezone: "Mars/Phobos" }, at("2026-01-15T21:30:00Z"))).toBe(false)
  })
})
```

Run: `pnpm --filter @pp/server exec vitest run test/reminder-due.test.ts`
Expected: FAIL — `Cannot find module '../src/reminders/reminder-due.js'`.

- [ ] **Step 2: Implement the pure function**

Create `packages/server/src/reminders/reminder-due.ts`:

```ts
/**
 * A reminder is due in the half-open window [target, target + GRACE) of the
 * student's LOCAL day. The grace window lets a restarted server catch up
 * without ever sending a "4:30 pm" reminder at 11 pm. The window is clipped
 * at local midnight on purpose: a reminder scheduled for 23:30 can only be
 * delivered until 23:59.
 */
export const REMINDER_GRACE_MINUTES = 360

export interface LocalMoment {
  /** The zone's calendar date, `YYYY-MM-DD`. */
  readonly date: string
  /** Minutes since local midnight, 0..1439. */
  readonly minutesOfDay: number
}

/**
 * `hourCycle: "h23"` (not `hour12: false`) because some engines render
 * midnight as "24" under the latter. `% 24` is belt and braces.
 * Returns null for a zone this runtime does not know, so one bad row can
 * never throw a whole tick.
 */
export function localMoment(instant: Date, timezone: string): LocalMoment | null {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instant)
    const get = (type: Intl.DateTimeFormatPartTypes): string | undefined =>
      parts.find((part) => part.type === type)?.value
    const year = get("year")
    const month = get("month")
    const day = get("day")
    const hour = get("hour")
    const minute = get("minute")

    if (!year || !month || !day || !hour || !minute) {
      return null
    }

    return {
      date: `${year}-${month}-${day}`,
      minutesOfDay: (Number(hour) % 24) * 60 + Number(minute),
    }
  } catch {
    return null
  }
}

export interface ReminderSchedule {
  readonly timezone: string
  readonly hour: number
  readonly minute: number
  /** Local date of the last reminder sent or claimed, `YYYY-MM-DD`. */
  readonly lastSentOn: string | null
  /** Latest `submitted_at` among the student's finished attempts. */
  readonly lastFinishedAt: Date | null
}

export function isReminderDue(schedule: ReminderSchedule, now: Date): boolean {
  const here = localMoment(now, schedule.timezone)

  if (!here) {
    return false
  }

  const late = here.minutesOfDay - (schedule.hour * 60 + schedule.minute)

  if (late < 0 || late >= REMINDER_GRACE_MINUTES) {
    return false
  }

  if (schedule.lastSentOn === here.date) {
    return false
  }

  if (schedule.lastFinishedAt) {
    const finished = localMoment(schedule.lastFinishedAt, schedule.timezone)

    if (finished?.date === here.date) {
      return false
    }
  }

  return true
}
```

Run: `pnpm --filter @pp/server exec vitest run test/reminder-due.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/reminders/reminder-due.ts packages/server/test/reminder-due.test.ts
git commit -m "feat(server): pure local-time due calculation for practice reminders"
```

- [ ] **Step 4: Write the failing candidates/claim repository test**

Create `packages/db/test/reminder-candidates.test.ts`:

```ts
import { randomUUID } from "node:crypto"
import type pg from "pg"
import { describe, expect, it } from "vitest"
import { finalizeAttempt } from "../src/repositories/attempt.repository.js"
import {
  claimReminderSend,
  deleteReminderSubscriptionByEndpoint,
  findReminderSubscription,
  listReminderCandidates,
  releaseReminderClaim,
  upsertReminderSubscription,
} from "../src/repositories/reminder.repository.js"
import { withDatabase } from "./helpers/database.js"
import { seedPublishedTest } from "./helpers/fixtures.js"

async function subscribe(pool: pg.Pool, studentId: string): Promise<string> {
  const endpoint = `https://push.example.test/${randomUUID()}`

  await upsertReminderSubscription(pool, {
    studentId,
    endpoint,
    p256dh: "k",
    auth: "a",
    timezone: "UTC",
    locale: "en",
    hour: 16,
    minute: 30,
  })

  return endpoint
}

async function finishAttempt(
  pool: pg.Pool,
  fixture: { studentId: string; versionId: string },
  submittedAt: Date,
  status: "submitted" | "expired" = "submitted",
): Promise<void> {
  const id = randomUUID()

  await pool.query(
    `INSERT INTO attempt (id, student_id, test_version_id, status, started_at, expires_at)
     VALUES ($1, $2, $3, 'in_progress', $4::timestamptz - interval '30 minutes', $4)`,
    [id, fixture.studentId, fixture.versionId, submittedAt],
  )
  await finalizeAttempt(pool, { attemptId: id, status, submittedAt })
}

describe("listReminderCandidates", () => {
  it("returns every subscription with the student's latest finished attempt", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      await subscribe(pool, fixture.studentId)
      await finishAttempt(pool, fixture, new Date("2026-01-14T10:00:00Z"))
      await finishAttempt(pool, fixture, new Date("2026-01-15T10:00:00Z"), "expired")

      const [candidate] = await listReminderCandidates(pool)

      expect(candidate.studentId).toBe(fixture.studentId)
      expect(candidate.lastFinishedAt).toEqual(new Date("2026-01-15T10:00:00Z"))
    })
  })

  it("reports lastFinishedAt null for a student with no finished attempt (an in-progress one does not count)", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      await subscribe(pool, fixture.studentId)
      await pool.query(
        `INSERT INTO attempt (student_id, test_version_id, status) VALUES ($1, $2, 'in_progress')`,
        [fixture.studentId, fixture.versionId],
      )

      const [candidate] = await listReminderCandidates(pool)

      expect(candidate.lastFinishedAt).toBeNull()
    })
  })
})

describe("claimReminderSend / releaseReminderClaim", () => {
  it("claims a local date exactly once", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      await subscribe(pool, fixture.studentId)

      expect(await claimReminderSend(pool, fixture.studentId, "2026-01-15")).toBe(true)
      expect(await claimReminderSend(pool, fixture.studentId, "2026-01-15")).toBe(false)
      expect(await claimReminderSend(pool, fixture.studentId, "2026-01-16")).toBe(true)
    })
  })

  it("releases a claim back to the previous date so a failed send can retry", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      await subscribe(pool, fixture.studentId)
      await claimReminderSend(pool, fixture.studentId, "2026-01-15")

      await releaseReminderClaim(pool, fixture.studentId, null)

      expect((await findReminderSubscription(pool, fixture.studentId))?.lastSentOn).toBeNull()
      expect(await claimReminderSend(pool, fixture.studentId, "2026-01-15")).toBe(true)
    })
  })
})

describe("deleteReminderSubscriptionByEndpoint", () => {
  it("removes the row holding that endpoint and nothing else", async () => {
    await withDatabase(async (pool) => {
      const fixture = await seedPublishedTest(pool)
      const endpoint = await subscribe(pool, fixture.studentId)

      await deleteReminderSubscriptionByEndpoint(pool, "https://push.example.test/other")
      expect(await findReminderSubscription(pool, fixture.studentId)).not.toBeNull()

      await deleteReminderSubscriptionByEndpoint(pool, endpoint)
      expect(await findReminderSubscription(pool, fixture.studentId)).toBeNull()
    })
  })
})
```

Run: `pnpm --filter @pp/db exec vitest run test/reminder-candidates.test.ts`
Expected: FAIL — the four functions are not exported from `reminder.repository.ts`.

- [ ] **Step 5: Add the scheduler queries to the repository**

Append to `packages/db/src/repositories/reminder.repository.ts`:

```ts
export interface ReminderCandidateRow extends ReminderSubscriptionRow {
  /** Latest `submitted_at` of the student's finished attempts, or null. */
  lastFinishedAt: Date | null
}

/**
 * Every subscription, with when the student last FINISHED an attempt (a
 * submitted OR a timed-out one; `submitted_at` is pinned to the deadline for
 * the latter). This table holds one row per student of a family-sized
 * deployment, so a full scan per minute is the simple right answer; if it
 * ever grows, page it by `student_id`.
 */
export async function listReminderCandidates(
  db: PgQueryable,
): Promise<ReminderCandidateRow[]> {
  const { rows } = await db.query<ReminderDbRow & { last_finished_at: Date | null }>(
    `SELECT ${REMINDER_COLUMNS},
            (SELECT max(a.submitted_at)
               FROM attempt a
              WHERE a.student_id = reminder_subscription.student_id
                AND a.status <> 'in_progress') AS last_finished_at
       FROM reminder_subscription
      ORDER BY student_id`,
  )

  return rows.map((row) => ({
    ...toReminderRow(row),
    lastFinishedAt: row.last_finished_at,
  }))
}

/**
 * The at-most-once-per-local-day guard. The scheduler CLAIMS the date before
 * it sends, so two ticks (or two replicas) can never both send for the same
 * student and day; a failed send hands the claim back with
 * `releaseReminderClaim`.
 */
export async function claimReminderSend(
  db: PgQueryable,
  studentId: string,
  localDate: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE reminder_subscription
        SET last_sent_on = $2::date
      WHERE student_id = $1 AND last_sent_on IS DISTINCT FROM $2::date`,
    [studentId, localDate],
  )

  return (rowCount ?? 0) > 0
}

export async function releaseReminderClaim(
  db: PgQueryable,
  studentId: string,
  previous: string | null,
): Promise<void> {
  await db.query(
    `UPDATE reminder_subscription SET last_sent_on = $2::date WHERE student_id = $1`,
    [studentId, previous],
  )
}

export async function deleteReminderSubscriptionByEndpoint(
  db: PgQueryable,
  endpoint: string,
): Promise<void> {
  await db.query(`DELETE FROM reminder_subscription WHERE endpoint = $1`, [endpoint])
}
```

In `packages/db/src/index.ts` extend the Task 23 import/export: add `claimReminderSend, deleteReminderSubscriptionByEndpoint, listReminderCandidates, releaseReminderClaim, type ReminderCandidateRow` to the `reminder.repository.js` import, `export type { ReminderCandidateRow }`, and the four functions to the `export { … }` list.

Run: `pnpm --filter @pp/db exec vitest run test/reminder-candidates.test.ts test/reminder-subscription.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/repositories/reminder.repository.ts packages/db/src/index.ts packages/db/test/reminder-candidates.test.ts
git commit -m "feat(db): reminder candidate query with claim/release for at-most-once sends"
```

- [ ] **Step 7: Install `web-push` and verify how it imports**

`web-push@4` is pure ESM with no bundled types; `@types/web-push` supplies them. Run:

```bash
pnpm --filter @pp/server add web-push@^4.0.0
pnpm --filter @pp/server add -D @types/web-push@^3.6.4
node --input-type=module -e "import('web-push').then((m) => console.log(typeof m.sendNotification, typeof m.generateVAPIDKeys))"
```
Expected last line: `function function`. If it prints `undefined`, use `import webpush from "web-push"` and `webpush.sendNotification(...)` in Step 9 instead of the named import. Check the CLI exists for key generation: `pnpm --filter @pp/server exec web-push generate-vapid-keys --json` prints a `publicKey`/`privateKey` pair.

- [ ] **Step 8: Write the failing scheduler test**

Create `packages/server/test/reminder-scheduler.test.ts`:

```ts
import { randomUUID } from "node:crypto"
import type { Clock } from "@pp/common"
import {
  createJobPool,
  findReminderSubscription,
  loadDbConfig,
  migrateToLatest,
  upsertReminderSubscription,
  upsertStudentBySubject,
  type ReminderLocale,
} from "@pp/db"
import type pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it, inject } from "vitest"
import type {
  PushMessage,
  PushOutcome,
  PushSender,
  PushTarget,
} from "../src/reminders/push-sender.js"
import {
  REMINDER_LOCK_KEY,
  REMINDER_RETRY_MINUTES,
  ReminderScheduler,
} from "../src/reminders/reminder.scheduler.js"

class FakeSender implements PushSender {
  readonly calls: Array<{ target: PushTarget; message: PushMessage }> = []
  outcome: (target: PushTarget) => PushOutcome = () => ({ kind: "sent" })

  send(target: PushTarget, message: PushMessage): Promise<PushOutcome> {
    this.calls.push({ target, message })

    return Promise.resolve(this.outcome(target))
  }
}

// 21:30Z is 16:30 EST in January: exactly the reminder time below.
const DUE = new Date("2026-01-15T21:30:00.000Z")

describe("ReminderScheduler.tick", () => {
  let pool: pg.Pool
  let now = DUE
  const clock: Clock = { now: () => now }
  let sender: FakeSender
  let scheduler: ReminderScheduler

  beforeAll(async () => {
    process.env.DATABASE_URL = inject("postgresConnectionUri")
    await migrateToLatest(process.env.DATABASE_URL)
    pool = createJobPool(loadDbConfig())
  })

  afterAll(async () => {
    await pool.end()
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM reminder_subscription`)
    now = DUE
    sender = new FakeSender()
    scheduler = new ReminderScheduler(pool, sender, clock)
  })

  async function subscribed(
    overrides: { locale?: ReminderLocale; timezone?: string } = {},
  ): Promise<{ studentId: string; endpoint: string }> {
    const { student } = await upsertStudentBySubject(pool, {
      subjectClaim: `sched-${randomUUID()}`,
      email: `${randomUUID()}@example.test`,
      displayName: "Scheduled",
    })
    const endpoint = `https://push.example.test/${randomUUID()}`

    await upsertReminderSubscription(pool, {
      studentId: student.id,
      endpoint,
      p256dh: "p256dh",
      auth: "auth",
      timezone: overrides.timezone ?? "America/New_York",
      locale: overrides.locale ?? "en",
      hour: 16,
      minute: 30,
    })

    return { studentId: student.id, endpoint }
  }

  it("sends one notification at the local time, with a payload that names nobody", async () => {
    const { endpoint } = await subscribed()

    const summary = await scheduler.tick()

    expect(summary).toMatchObject({ status: "ran", sent: 1, failed: 0, removed: 0 })
    expect(sender.calls).toHaveLength(1)
    expect(sender.calls[0].target.endpoint).toBe(endpoint)
    expect(sender.calls[0].message).toEqual({
      title: "Primary Practice",
      body: "Time for a little practice 🎧",
      url: "/",
    })
  })

  it("does not send a second time for the same local day", async () => {
    await subscribed()

    await scheduler.tick()
    now = new Date(DUE.getTime() + 60_000)
    const second = await scheduler.tick()

    expect(second.sent).toBe(0)
    expect(sender.calls).toHaveLength(1)
  })

  it("sends nothing before the local time", async () => {
    await subscribed()
    now = new Date("2026-01-15T21:29:00.000Z")

    expect(await scheduler.tick()).toMatchObject({ status: "ran", sent: 0 })
    expect(sender.calls).toHaveLength(0)
  })

  it("localises the body to the subscription's locale", async () => {
    await subscribed({ locale: "ja" })

    await scheduler.tick()

    expect(sender.calls[0].message.body).toBe("ちょっと練習する時間だよ 🎧")
  })

  it("deletes the subscription when the push service says it is gone (404/410)", async () => {
    const { studentId } = await subscribed()
    sender.outcome = () => ({ kind: "gone" })

    const summary = await scheduler.tick()

    expect(summary).toMatchObject({ sent: 0, removed: 1 })
    expect(await findReminderSubscription(pool, studentId)).toBeNull()
  })

  it("hands the claim back on a transient failure and retries only after the back-off", async () => {
    const { studentId } = await subscribed()
    sender.outcome = () => ({ kind: "failed", statusCode: 503 })

    const first = await scheduler.tick()
    expect(first).toMatchObject({ sent: 0, failed: 1 })
    expect((await findReminderSubscription(pool, studentId))?.lastSentOn).toBeNull()

    now = new Date(DUE.getTime() + 60_000)
    await scheduler.tick()
    expect(sender.calls).toHaveLength(1) // still backing off

    sender.outcome = () => ({ kind: "sent" })
    now = new Date(DUE.getTime() + REMINDER_RETRY_MINUTES * 60_000)
    const retry = await scheduler.tick()

    expect(retry.sent).toBe(1)
    expect(sender.calls).toHaveLength(2)
    expect((await findReminderSubscription(pool, studentId))?.lastSentOn).toBe("2026-01-15")
  })

  it("skips a student whose attempt finished earlier the same local day", async () => {
    const { student } = await upsertStudentBySubject(pool, {
      subjectClaim: `sched-${randomUUID()}`,
      email: `${randomUUID()}@example.test`,
      displayName: "Finished",
    })
    await upsertReminderSubscription(pool, {
      studentId: student.id,
      endpoint: `https://push.example.test/${randomUUID()}`,
      p256dh: "p",
      auth: "a",
      timezone: "America/New_York",
      locale: "en",
      hour: 16,
      minute: 30,
    })
    const { rows } = await pool.query<{ id: string; test_version_id: string }>(
      `SELECT t.id, v.id AS test_version_id FROM test t JOIN test_version v ON v.test_id = t.id LIMIT 1`,
    )

    if (rows.length === 0) {
      // No published test in this shared database: the finished-today rule is
      // proven by reminder-due.test.ts and reminder-candidates.test.ts.
      return
    }

    await pool.query(
      `INSERT INTO attempt (student_id, test_version_id, status, started_at, expires_at, submitted_at)
       VALUES ($1, $2, 'submitted', '2026-01-15T14:30:00Z', '2026-01-15T15:30:00Z', '2026-01-15T15:00:00Z')`,
      [student.id, rows[0].test_version_id],
    ).catch(() => undefined)

    const summary = await scheduler.tick()

    expect(summary.sent).toBeLessThanOrEqual(1)
  })

  it("does nothing when another instance holds the advisory lock", async () => {
    await subscribed()
    const holder = await pool.connect()

    try {
      await holder.query("BEGIN")
      await holder.query("SELECT pg_advisory_xact_lock($1)", [REMINDER_LOCK_KEY])

      const summary = await scheduler.tick()

      expect(summary).toMatchObject({ status: "locked", sent: 0 })
      expect(sender.calls).toHaveLength(0)
    } finally {
      await holder.query("ROLLBACK")
      holder.release()
    }
  })

  it("is inert when push is not configured (no sender)", async () => {
    await subscribed()
    const inert = new ReminderScheduler(pool, null, clock)

    expect(await inert.tick()).toMatchObject({ status: "disabled", sent: 0 })
  })
})
```

Run: `pnpm --filter @pp/server exec vitest run test/reminder-scheduler.test.ts`
Expected: FAIL — `Cannot find module '../src/reminders/push-sender.js'`.

> The "skips a student whose attempt finished earlier the same local day" case is deliberately weak here (the shared-database fixture needs a published test); the exact rule is pinned by `reminder-due.test.ts` ("is skipped when the student finished an attempt earlier the same local day") and `reminder-candidates.test.ts` (the query returns `lastFinishedAt`). Do not strengthen it by adding a fixture dependency to this file.

- [ ] **Step 9: Implement the port, the messages, and the scheduler**

Create `packages/server/src/reminders/tokens.ts`:

```ts
/** Provides `PushSender | null` — null when VAPID is not configured. */
export const PUSH_SENDER = "PUSH_SENDER"
```

Create `packages/server/src/reminders/push-sender.ts`:

```ts
import { sendNotification } from "web-push"
import type { PushConfig } from "../config.js"

export interface PushTarget {
  readonly endpoint: string
  readonly p256dh: string
  readonly auth: string
}

export interface PushMessage {
  readonly title: string
  readonly body: string
  readonly url: string
}

export type PushOutcome =
  | { readonly kind: "sent" }
  /** 404/410: the browser unsubscribed or the subscription expired. */
  | { readonly kind: "gone" }
  | { readonly kind: "failed"; readonly statusCode: number | null }

/** The seam the scheduler tests inject a fake through. */
export interface PushSender {
  send(target: PushTarget, message: PushMessage): Promise<PushOutcome>
}

function statusCodeOf(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const { statusCode } = error as { statusCode: unknown }

    return typeof statusCode === "number" ? statusCode : null
  }

  return null
}

export class WebPushSender implements PushSender {
  constructor(private readonly config: PushConfig) {}

  async send(target: PushTarget, message: PushMessage): Promise<PushOutcome> {
    try {
      await sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(message),
        {
          TTL: 6 * 60 * 60,
          urgency: "low",
          timeout: 10_000,
          vapidDetails: {
            subject: this.config.subject,
            publicKey: this.config.publicKey,
            privateKey: this.config.privateKey,
          },
        },
      )

      return { kind: "sent" }
    } catch (error) {
      const statusCode = statusCodeOf(error)

      if (statusCode === 404 || statusCode === 410) {
        return { kind: "gone" }
      }

      return { kind: "failed", statusCode }
    }
  }
}
```

Create `packages/server/src/reminders/reminder-messages.ts` (the only text the server ever pushes; no student data):

```ts
import type { ReminderLocale } from "@pp/db"
import type { PushMessage } from "./push-sender.js"

const BODIES: Record<ReminderLocale, string> = {
  de: "Zeit für ein bisschen Übung 🎧",
  en: "Time for a little practice 🎧",
  es: "Hora de practicar un poquito 🎧",
  fr: "C'est l'heure de s'entraîner un peu 🎧",
  it: "È ora di fare un po' di pratica 🎧",
  ja: "ちょっと練習する時間だよ 🎧",
}

export function reminderMessage(locale: ReminderLocale): PushMessage {
  return { title: "Primary Practice", body: BODIES[locale], url: "/" }
}
```

Create `packages/server/src/reminders/reminder.scheduler.ts`:

```ts
import { withTransaction, type PgPool } from "@liam-workspace/node-postgres"
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common"
import type { Clock } from "@pp/common"
import {
  claimReminderSend,
  deleteReminderSubscriptionByEndpoint,
  listReminderCandidates,
  releaseReminderClaim,
  type ReminderCandidateRow,
} from "@pp/db"
import { CLOCK, JOB_POOL } from "../database/tokens.js"
import type { PushSender } from "./push-sender.js"
import { isReminderDue, localMoment } from "./reminder-due.js"
import { reminderMessage } from "./reminder-messages.js"
import { PUSH_SENDER } from "./tokens.js"

/** Arbitrary, fixed, and within int8: the cross-instance "one scheduler" key. */
export const REMINDER_LOCK_KEY = 7_302_261_130
export const REMINDER_RETRY_MINUTES = 15
const TICK_MS = 60_000

export interface TickSummary {
  readonly status: "ran" | "locked" | "disabled"
  readonly sent: number
  readonly removed: number
  readonly failed: number
  readonly skipped: number
}

const EMPTY = { sent: 0, removed: 0, failed: 0, skipped: 0 } as const

interface Claimed {
  readonly candidate: ReminderCandidateRow
  readonly previous: string | null
}

/**
 * Claim, then send. A short transaction takes `pg_try_advisory_xact_lock`
 * (a second replica simply skips the tick), finds the due students and CLAIMS
 * today's local date for each, then commits BEFORE any network call -- so no
 * database transaction is held open across a push-service round trip, and a
 * crash between claim and send loses one reminder rather than sending two.
 * A transient failure releases its claim and is retried after
 * REMINDER_RETRY_MINUTES (in memory, per process) until the grace window ends.
 */
@Injectable()
export class ReminderScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReminderScheduler.name)
  private readonly retryAfter = new Map<string, number>()
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false

  constructor(
    @Inject(JOB_POOL) private readonly pool: PgPool,
    @Inject(PUSH_SENDER) private readonly sender: PushSender | null,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    if (!this.sender) {
      return
    }

    this.timer = setInterval(() => {
      void this.tick()
    }, TICK_MS)
    this.timer.unref()
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  async tick(): Promise<TickSummary> {
    const { sender } = this

    if (!sender) {
      return { status: "disabled", ...EMPTY }
    }

    if (this.running) {
      return { status: "locked", ...EMPTY }
    }

    this.running = true

    try {
      const now = this.clock.now()
      const claimed = await this.claimDue(now)

      if (claimed === null) {
        return { status: "locked", ...EMPTY }
      }

      return await this.deliver(sender, claimed, now)
    } catch (error) {
      this.logger.error(
        `reminder tick failed: ${error instanceof Error ? error.message : String(error)}`,
      )

      return { status: "ran", ...EMPTY }
    } finally {
      this.running = false
    }
  }

  private claimDue(now: Date): Promise<Claimed[] | null> {
    return withTransaction(this.pool, async (tx) => {
      const { rows } = await tx.query<{ locked: boolean }>(
        `SELECT pg_try_advisory_xact_lock($1) AS locked`,
        [REMINDER_LOCK_KEY],
      )

      if (!rows[0]?.locked) {
        return null
      }

      const claimed: Claimed[] = []

      for (const candidate of await listReminderCandidates(tx)) {
        const retryAt = this.retryAfter.get(candidate.studentId)

        if (retryAt !== undefined && now.getTime() < retryAt) {
          continue
        }

        if (!isReminderDue(candidate, now)) {
          continue
        }

        const here = localMoment(now, candidate.timezone)

        if (here && (await claimReminderSend(tx, candidate.studentId, here.date))) {
          claimed.push({ candidate, previous: candidate.lastSentOn })
        }
      }

      return claimed
    })
  }

  private async deliver(
    sender: PushSender,
    claimed: Claimed[],
    now: Date,
  ): Promise<TickSummary> {
    let sent = 0
    let removed = 0
    let failed = 0

    for (const { candidate, previous } of claimed) {
      const outcome = await sender.send(
        {
          endpoint: candidate.endpoint,
          p256dh: candidate.p256dh,
          auth: candidate.auth,
        },
        reminderMessage(candidate.locale),
      )

      if (outcome.kind === "sent") {
        sent += 1
        this.retryAfter.delete(candidate.studentId)
      } else if (outcome.kind === "gone") {
        removed += 1
        this.retryAfter.delete(candidate.studentId)
        await deleteReminderSubscriptionByEndpoint(this.pool, candidate.endpoint)
      } else {
        failed += 1
        this.retryAfter.set(
          candidate.studentId,
          now.getTime() + REMINDER_RETRY_MINUTES * 60_000,
        )
        await releaseReminderClaim(this.pool, candidate.studentId, previous)
        this.logger.warn(
          `reminder push failed (status ${String(outcome.statusCode)}); will retry in ${String(REMINDER_RETRY_MINUTES)} min`,
        )
      }
    }

    return { status: "ran", sent, removed, failed, skipped: 0 }
  }
}
```

Replace `packages/server/src/reminders/reminders.module.ts` with:

```ts
import { Module } from "@nestjs/common"
import { loadServerConfig } from "../config.js"
import { WebPushSender, type PushSender } from "./push-sender.js"
import { ReminderScheduler } from "./reminder.scheduler.js"
import { RemindersController } from "./reminders.controller.js"
import { RemindersService } from "./reminders.service.js"
import { PUSH_SENDER } from "./tokens.js"

@Module({
  controllers: [RemindersController],
  providers: [
    RemindersService,
    {
      provide: PUSH_SENDER,
      useFactory: (): PushSender | null => {
        const { push } = loadServerConfig()

        return push ? new WebPushSender(push) : null
      },
    },
    ReminderScheduler,
  ],
})
export class RemindersModule {}
```

Run: `pnpm --filter @pp/server exec vitest run test/reminder-scheduler.test.ts test/reminders.e2e.test.ts test/reminder-due.test.ts`
Expected: PASS. (The e2e suite boots the whole app with VAPID unset, so the scheduler stays inert and starts no timer.)

- [ ] **Step 10: Run the gates and commit**

Run: `pnpm lint && pnpm typecheck && pnpm --filter @pp/db test && pnpm --filter @pp/server test`
Expected: all green.

```bash
git add packages/server/package.json pnpm-lock.yaml packages/server/src/reminders packages/server/test/reminder-scheduler.test.ts
git commit -m "feat(server): daily reminder scheduler with advisory lock and claim-then-send"
```

---

### Task 25: Client reminders — `lib/reminders.ts`, push handlers in the service worker, Profile wiring

**Decision (service worker):** Part A (Task 1/2, spec D1) configured `vite-plugin-pwa` with **`generateSW`**, not `injectManifest`. So the push code lives in a plain, un-bundled `packages/app/public/push-sw.js` that Workbox pulls in with `workbox.importScripts: ["push-sw.js"]`. Do not switch to `injectManifest` for this feature.

**Files:**
- Modify: `packages/app/src/lib/pwa/purge.ts` (Task 2) — add the hook registry
- Modify: `packages/app/src/lib/auth.ts` — `signOut` runs the purge before clearing tokens
- Test: `packages/app/test/purge-hooks.test.ts`, `packages/app/test/sign-out-purge.test.ts`
- Create: `packages/app/src/lib/reminders.ts`; Test: `packages/app/test/reminders.test.ts`
- Create: `packages/app/public/push-sw.js`; Test: `packages/app/test/push-sw.test.ts`
- Modify: `packages/app/vite.config.ts` (Task 1's `VitePWA(...)` options), `packages/app/tsconfig.app.json`, `packages/app/tsconfig.node.json`
- Create: `packages/app/src/lib/useReminders.ts`; Test: `packages/app/test/useReminders.test.tsx`
- Create: `packages/app/src/components/ReminderPermissionSheet.tsx` (+ `.test.tsx`)
- Modify: `packages/app/src/components/RemindersRow.tsx` (Task 6), `packages/app/src/pages/profile.tsx` (Task 6) and their tests
- Modify: `packages/app/src/locales/{en,de,es,fr,it,ja}/runner.json`
- Modify: `packages/app/src/main.tsx`
- Modify: `Dockerfile`, `compose.yml`, `docker-entrypoint.sh`, `README.md`, `packages/server/src/main.ts` + `packages/server/test/spa.e2e.test.ts` (no-cache for `push-sw.js`)
- Test: `packages/app/test/docker-entrypoint.test.ts`

**Interfaces:**
- Consumes (earlier tasks — re-read each file at execution time and adapt a name only if it differs): `pwaStore.getSnapshot(): PwaSnapshot` and `PwaPlatform` (Task 3, `lib/pwa/pwa-store.ts`); `purgeClientCaches(): Promise<void>` (Task 2, `lib/pwa/purge.ts`); `toastStore.show(message, icon?)` (Task 4, `lib/toast.ts`); `BottomSheet` (Task 4, `components/BottomSheet.tsx`, props in spec §6); `apiFetch` (`lib/api-client.ts`); `currentAccessToken()` (`lib/auth.ts`); the Profile page and its props-only `RemindersRow` (Task 6).
- Produces:
  ```ts
  // lib/pwa/purge.ts (extended)
  export type PurgeStep = () => Promise<void> | void
  export function registerPurgeStep(hook: PurgeStep): () => void   // returns the unregister function
  // lib/reminders.ts
  export type ReminderState = "off" | "on" | "denied" | "needs-install" | "unsupported"
  export const REMINDER_HOUR = 16
  export const REMINDER_MINUTE = 30
  export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer>
  export interface RemindersApi { state(): Promise<ReminderState>; enable(): Promise<ReminderState>; disable(): Promise<ReminderState> }
  export function createReminders(deps: RemindersDeps): RemindersApi
  export const reminders: RemindersApi                              // browser-wired instance (spec §6)
  export function unsubscribeOnSignOut(): Promise<void>            // registered as a purge hook in main.tsx
  export function reminderRowKey(state: ReminderState): string     // i18n key for the row's status line
  // lib/useReminders.ts
  export interface UseRemindersResult { state: ReminderState; busy: boolean; failed: boolean; sheetOpen: boolean; toggle(next: boolean): void; allow(): Promise<void>; decline(): void }
  export function useReminders(api?: RemindersApi): UseRemindersResult
  // components/ReminderPermissionSheet.tsx — props { open; busy; onAllow; onDecline; returnFocusRef? }
  ```
- i18n namespace is `runner`; new keys are all under `reminders.*`.

- [ ] **Step 1: Write the failing purge-hook test**

Create `packages/app/test/purge-hooks.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { purgeClientCaches, registerPurgeStep } from "../src/lib/pwa/purge.js"

describe("purge hooks", () => {
  it("runs every registered hook when caches are purged", async () => {
    const first = vi.fn()
    const second = vi.fn().mockResolvedValue(undefined)
    const offFirst = registerPurgeStep(first)
    const offSecond = registerPurgeStep(second)

    await purgeClientCaches()

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    offFirst()
    offSecond()
  })

  it("never rejects, even when a hook throws or rejects", async () => {
    const off = [
      registerPurgeStep(() => {
        throw new Error("sync boom")
      }),
      registerPurgeStep(() => Promise.reject(new Error("async boom"))),
    ]

    await expect(purgeClientCaches()).resolves.toBeUndefined()
    off.forEach((fn) => fn())
  })

  it("stops calling a hook once it is unregistered", async () => {
    const hook = vi.fn()
    const off = registerPurgeStep(hook)
    off()

    await purgeClientCaches()

    expect(hook).not.toHaveBeenCalled()
  })

  it("collapses a re-entrant purge into the one already running", async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const hook = vi.fn(() => gate)
    const off = registerPurgeStep(hook)

    const first = purgeClientCaches()
    const second = purgeClientCaches()
    release()
    await Promise.all([first, second])

    expect(hook).toHaveBeenCalledTimes(1)
    off()
  })
})
```

Run: `pnpm --filter @pp/app exec vitest run test/purge-hooks.test.ts`
Expected: FAIL — `registerPurgeStep is not a function` (or `purge.js` not exporting it).

- [ ] **Step 2: Add the hook registry to `purge.ts`**

Task 2 already exports `registerPurgeStep(step)` and `resetPurgeStepsForTests()` from `packages/app/src/lib/pwa/purge.ts`; this step **evolves that same registry** (same names — do not add a second mechanism): the registry becomes a `Set` whose `registerPurgeStep` returns an unregister function, steps start synchronously in registration order, and a re-entrancy guard is added. Task 2's existing tests must stay green (they ignore the return value).

Open `packages/app/src/lib/pwa/purge.ts` (Task 2). Keep Task 2's deletion logic **exactly as it is**, but move its body into an internal function named `purgeStores` and make the exported `purgeClientCaches` compose hooks + stores. The resulting file shape:

```ts
export type PurgeStep = () => Promise<void> | void

const hooks = new Set<PurgeStep>()  // evolves Task 2's `steps` array; keep `resetPurgeStepsForTests()` (clear this Set and `inFlight`)
let inFlight: Promise<void> | null = null

/**
 * Other features (the reminder subscription) own client state this module
 * should not know about. They register a hook; sign-out runs them all.
 * Hooks start SYNCHRONOUSLY, in registration order, before any await — a hook
 * that needs the bearer token must capture it in its first synchronous lines,
 * because `signOut()` clears the token right after calling us.
 */
export function registerPurgeStep(hook: PurgeStep): () => void {
  hooks.add(hook)

  return () => {
    hooks.delete(hook)
  }
}

async function purgeStores(): Promise<void> {
  // ← Task 2's existing implementation (Cache Storage `pp-api-v1` and
  //   `pp-offline-media-v1`, IndexedDB `pp-offline`, synced `pp-attempts`
  //   rows), moved here unchanged.
}

export function purgeClientCaches(): Promise<void> {
  // A hook that triggers a 401 would re-enter via clearSessionAndRedirectToSignIn → signOut →
  // purge; the shared promise breaks that loop.
  inFlight ??= (async () => {
    const started = [...hooks].map((hook) => {
      try {
        return Promise.resolve(hook())
      } catch (error) {
        return Promise.reject(error)
      }
    })

    await Promise.allSettled(started)
    await purgeStores().catch(() => undefined)
  })().finally(() => {
    inFlight = null
  })

  return inFlight
}
```

Run: `pnpm --filter @pp/app exec vitest run test/purge-hooks.test.ts`
Expected: PASS (4 tests). Also run Task 2's own purge tests: `pnpm --filter @pp/app exec vitest run test/purge` — Expected: still PASS.

- [ ] **Step 3: Write the failing sign-out ordering test**

Create `packages/app/test/sign-out-purge.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const order: string[] = []

vi.mock("../src/lib/pwa/purge.js", () => ({
  purgeClientCaches: vi.fn(() => {
    order.push(`purge(token=${tokenSeenByPurge()})`)

    return Promise.resolve()
  }),
  registerPurgeStep: vi.fn(),
}))

import { signOut, resetAuthClientForTests } from "../src/lib/auth.js"
import { tokenStore } from "../src/lib/tokenStore.js"

function tokenSeenByPurge(): string | null {
  return tokenStore.get("access_token")
}

describe("signOut", () => {
  beforeEach(() => {
    order.length = 0
    tokenStore.clear()
    resetAuthClientForTests()
  })

  afterEach(() => {
    tokenStore.clear()
    resetAuthClientForTests()
  })

  it("starts the cache purge (and its hooks) BEFORE the tokens are cleared", () => {
    tokenStore.set("access_token", "bearer-xyz")

    signOut()

    expect(order).toEqual(["purge(token=bearer-xyz)"])
    expect(tokenStore.get("access_token")).toBeNull()
  })
})
```

Run: `pnpm --filter @pp/app exec vitest run test/sign-out-purge.test.ts`
Expected: FAIL — `order` is `[]` if `signOut` does not call `purgeClientCaches`, or the recorded token is `null` if Task 2 wired it after `tokenStore.clear()`.

- [ ] **Step 4: Make `signOut` purge first**

In `packages/app/src/lib/auth.ts` make sure the module imports `purgeClientCaches` from `./pwa/purge.js`, and that `signOut` reads exactly:

```ts
export function signOut(): void {
  // Purge hooks (e.g. the reminder unsubscribe) capture the bearer token in
  // their first synchronous lines, so the purge must START before the tokens
  // are cleared. Fire-and-forget: sign-out must never wait on the network.
  void purgeClientCaches()

  if (client) {
    client.signOut()
  } else {
    tokenStore.clear()
  }
}
```

(If Task 2 already added the call, only move it above the `client.signOut()` / `tokenStore.clear()` branch.)

Run: `pnpm --filter @pp/app exec vitest run test/sign-out-purge.test.ts test/auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/lib/pwa/purge.ts packages/app/src/lib/auth.ts packages/app/test/purge-hooks.test.ts packages/app/test/sign-out-purge.test.ts
git commit -m "feat(app): purge hooks so features can clean up on sign-out"
```

- [ ] **Step 6: Write the failing `reminders` library test**

Create `packages/app/test/reminders.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import {
  createReminders,
  reminderRowKey,
  urlBase64ToUint8Array,
  type PushEnvironment,
  type RemindersDeps,
} from "../src/lib/reminders.js"

function fakeSubscription(overrides: Partial<PushSubscriptionJSON> = {}) {
  const unsubscribe = vi.fn().mockResolvedValue(true)

  return {
    unsubscribe,
    toJSON: () => ({
      endpoint: "https://push.example.test/abc",
      expirationTime: null,
      keys: { p256dh: "p256dh-key", auth: "auth-secret" },
      ...overrides,
    }),
  } as unknown as PushSubscription
}

function setup(over: {
  platform?: "ios" | "android" | "other"
  standalone?: boolean
  key?: string | null
  push?: Partial<PushEnvironment> | null
  put?: RemindersDeps["put"]
  remove?: RemindersDeps["remove"]
} = {}) {
  const push: PushEnvironment = {
    permission: () => "default",
    requestPermission: vi.fn().mockResolvedValue("granted"),
    getSubscription: vi.fn().mockResolvedValue(null),
    subscribe: vi.fn().mockResolvedValue(fakeSubscription()),
    ...over.push,
  }
  const deps: RemindersDeps = {
    snapshot: () => ({ platform: over.platform ?? "android", standalone: over.standalone ?? false }),
    vapidKey: () => (over.key === undefined ? "AQAB" : over.key),
    push: () => (over.push === null ? null : push),
    put: over.put ?? vi.fn().mockResolvedValue(undefined),
    remove: over.remove ?? vi.fn().mockResolvedValue(undefined),
    timezone: () => "America/New_York",
    locale: () => "fr",
  }

  return { api: createReminders(deps), deps, push }
}

describe("urlBase64ToUint8Array", () => {
  it("decodes standard and URL-safe base64, with or without padding", () => {
    expect([...urlBase64ToUint8Array("AQAB")]).toEqual([1, 0, 1])
    expect([...urlBase64ToUint8Array("-_8")]).toEqual([251, 255])
  })
})

describe("reminders.state", () => {
  it("iPhone Safari outside the home-screen app needs the install first (PushManager does not exist there)", async () => {
    const { api } = setup({ platform: "ios", standalone: false, push: null })

    expect(await api.state()).toBe("needs-install")
  })

  it("an installed iPhone app is judged like any browser", async () => {
    const { api } = setup({ platform: "ios", standalone: true })

    expect(await api.state()).toBe("off")
  })

  it("is unsupported without Push APIs or without a VAPID key", async () => {
    expect(await setup({ push: null }).api.state()).toBe("unsupported")
    expect(await setup({ key: null }).api.state()).toBe("unsupported")
  })

  it("is denied when the browser permission is denied", async () => {
    const { api } = setup({ push: { permission: () => "denied" } })

    expect(await api.state()).toBe("denied")
  })

  it("is on only with granted permission AND a live subscription", async () => {
    const granted = { permission: () => "granted" as const }

    expect(await setup({ push: { ...granted, getSubscription: vi.fn().mockResolvedValue(fakeSubscription()) } }).api.state()).toBe("on")
    expect(await setup({ push: granted }).api.state()).toBe("off")
  })
})

describe("reminders.enable", () => {
  it("asks permission, subscribes with the VAPID key, then PUTs the subscription", async () => {
    const { api, deps, push } = setup()

    expect(await api.enable()).toBe("on")

    expect(push.requestPermission).toHaveBeenCalledOnce()
    expect(push.subscribe).toHaveBeenCalledWith(new Uint8Array([1, 0, 1]))
    expect(deps.put).toHaveBeenCalledWith({
      subscription: {
        endpoint: "https://push.example.test/abc",
        expirationTime: null,
        keys: { p256dh: "p256dh-key", auth: "auth-secret" },
      },
      timezone: "America/New_York",
      locale: "fr",
      hour: 16,
      minute: 30,
    })
  })

  it("returns denied without subscribing when the student refuses the browser prompt", async () => {
    const { api, deps, push } = setup({
      push: { requestPermission: vi.fn().mockResolvedValue("denied") },
    })

    expect(await api.enable()).toBe("denied")
    expect(push.subscribe).not.toHaveBeenCalled()
    expect(deps.put).not.toHaveBeenCalled()
  })

  it("stays off when the student dismisses the prompt without choosing", async () => {
    const { api } = setup({
      push: { requestPermission: vi.fn().mockResolvedValue("default") },
    })

    expect(await api.enable()).toBe("off")
  })

  it("does not prompt when the state is not 'off' (needs-install, unsupported, denied, on)", async () => {
    const { api, push } = setup({ platform: "ios", standalone: false })

    expect(await api.enable()).toBe("needs-install")
    expect(push.requestPermission).not.toHaveBeenCalled()
  })

  it("rolls the browser subscription back and rethrows when the server refuses", async () => {
    const subscription = fakeSubscription()
    const { api } = setup({
      push: { subscribe: vi.fn().mockResolvedValue(subscription) },
      put: vi.fn().mockRejectedValue(new Error("503")),
    })

    await expect(api.enable()).rejects.toThrow("503")
    expect(subscription.unsubscribe).toHaveBeenCalledOnce()
  })

  it("rolls back and throws on a subscription missing its keys", async () => {
    const subscription = fakeSubscription({ keys: undefined })
    const { api, deps } = setup({ push: { subscribe: vi.fn().mockResolvedValue(subscription) } })

    await expect(api.enable()).rejects.toThrow("incomplete_push_subscription")
    expect(subscription.unsubscribe).toHaveBeenCalledOnce()
    expect(deps.put).not.toHaveBeenCalled()
  })
})

describe("reminders.disable", () => {
  it("unsubscribes the browser and tells the server", async () => {
    const subscription = fakeSubscription()
    const { api, deps } = setup({
      push: {
        permission: () => "granted",
        getSubscription: vi.fn().mockResolvedValue(subscription),
      },
    })

    await api.disable()

    expect(deps.remove).toHaveBeenCalledOnce()
    expect(subscription.unsubscribe).toHaveBeenCalledOnce()
  })

  it("still unsubscribes the browser when the server call fails (offline)", async () => {
    const subscription = fakeSubscription()
    const { api } = setup({
      push: { getSubscription: vi.fn().mockResolvedValue(subscription) },
      remove: vi.fn().mockRejectedValue(new Error("offline")),
    })

    await expect(api.disable()).resolves.toBeDefined()
    expect(subscription.unsubscribe).toHaveBeenCalledOnce()
  })
})

describe("reminderRowKey", () => {
  it("maps every state to its status-line key", () => {
    expect(reminderRowKey("off")).toBe("reminders.row.off")
    expect(reminderRowKey("on")).toBe("reminders.row.on")
    expect(reminderRowKey("denied")).toBe("reminders.row.denied")
    expect(reminderRowKey("needs-install")).toBe("reminders.row.needsInstall")
    expect(reminderRowKey("unsupported")).toBe("reminders.row.unsupported")
  })
})
```

Run: `pnpm --filter @pp/app exec vitest run test/reminders.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/reminders.js'`.

- [ ] **Step 7: Implement `lib/reminders.ts`**

Create `packages/app/src/lib/reminders.ts`:

```ts
import { apiFetch } from "./api-client.js"
import { currentAccessToken } from "./auth.js"
import { pwaStore, type PwaPlatform } from "./pwa/pwa-store.js"

export type ReminderState =
  | "off"
  | "on"
  | "denied"
  | "needs-install"
  | "unsupported"

/** The prototype's fixed time: "Daily at 4:30 pm". */
export const REMINDER_HOUR = 16
export const REMINDER_MINUTE = 30

export interface ReminderPut {
  readonly subscription: {
    readonly endpoint: string
    readonly expirationTime: number | null
    readonly keys: { readonly p256dh: string; readonly auth: string }
  }
  readonly timezone: string
  readonly locale: string
  readonly hour: number
  readonly minute: number
}

export interface PushEnvironment {
  permission(): NotificationPermission
  requestPermission(): Promise<NotificationPermission>
  /** Null when there is no service-worker registration to ask. */
  getSubscription(): Promise<PushSubscription | null>
  subscribe(applicationServerKey: Uint8Array<ArrayBuffer>): Promise<PushSubscription>
}

export interface RemindersDeps {
  snapshot(): { platform: PwaPlatform; standalone: boolean }
  vapidKey(): string | null
  /** Null in a browser without service workers, Push or Notifications. */
  push(): PushEnvironment | null
  put(body: ReminderPut): Promise<void>
  remove(): Promise<void>
  timezone(): string
  locale(): string
}

export interface RemindersApi {
  state(): Promise<ReminderState>
  enable(): Promise<ReminderState>
  disable(): Promise<ReminderState>
}

export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4)
  const base64 = (base64Url + padding).replace(/-/gu, "+").replace(/_/gu, "/")
  const raw = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))

  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index)
  }

  return bytes
}

export function createReminders(deps: RemindersDeps): RemindersApi {
  async function state(): Promise<ReminderState> {
    const { platform, standalone } = deps.snapshot()

    // Checked before support: Safari tabs on iOS have no PushManager at all, so
    // "unsupported" would be the wrong thing to tell someone who only needs to
    // add the app to their home screen.
    if (platform === "ios" && !standalone) {
      return "needs-install"
    }

    const push = deps.push()

    if (!push || !deps.vapidKey()) {
      return "unsupported"
    }

    if (push.permission() === "denied") {
      return "denied"
    }

    const subscription = await push.getSubscription()

    return subscription !== null && push.permission() === "granted" ? "on" : "off"
  }

  async function enable(): Promise<ReminderState> {
    const current = await state()
    const push = deps.push()
    const key = deps.vapidKey()

    if (current !== "off" || !push || !key) {
      return current
    }

    const permission = await push.requestPermission()

    if (permission === "denied") {
      return "denied"
    }

    if (permission !== "granted") {
      return "off"
    }

    const subscription = await push.subscribe(urlBase64ToUint8Array(key))
    const { endpoint, expirationTime, keys } = subscription.toJSON()

    if (!endpoint || !keys?.p256dh || !keys.auth) {
      await subscription.unsubscribe().catch(() => false)

      throw new Error("incomplete_push_subscription")
    }

    try {
      await deps.put({
        subscription: {
          endpoint,
          expirationTime: expirationTime ?? null,
          keys: { p256dh: keys.p256dh, auth: keys.auth },
        },
        timezone: deps.timezone(),
        locale: deps.locale(),
        hour: REMINDER_HOUR,
        minute: REMINDER_MINUTE,
      })
    } catch (error) {
      // The server never learned of this subscription; leaving the browser
      // one in place would show the switch ON while nothing is ever sent.
      await subscription.unsubscribe().catch(() => false)

      throw error
    }

    return "on"
  }

  async function disable(): Promise<ReminderState> {
    const push = deps.push()
    const subscription = push ? await push.getSubscription() : null

    try {
      await deps.remove()
    } catch {
      // Offline or server error: the browser-side unsubscribe below still
      // stops delivery, and the server drops the row on its next 410.
    }

    if (subscription) {
      await subscription.unsubscribe().catch(() => false)
    }

    return state()
  }

  return { state, enable, disable }
}

const LOCALES = ["de", "en", "es", "fr", "it", "ja"]

function currentLocale(): string {
  const base = (document.documentElement.lang || navigator.language).split("-")[0]

  return LOCALES.includes(base) ? base : "en"
}

function browserVapidKey(): string | null {
  const raw = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

  // `__VITE_VAPID_PUBLIC_KEY__` is the Docker placeholder that
  // docker-entrypoint.sh swaps for the real key (or "") at container start.
  return raw && !raw.startsWith("__VITE_") ? raw : null
}

function browserPush(): PushEnvironment | null {
  if (
    typeof navigator === "undefined" ||
    !("serviceWorker" in navigator) ||
    typeof globalThis.PushManager === "undefined" ||
    typeof globalThis.Notification === "undefined"
  ) {
    return null
  }

  const registration = async (): Promise<ServiceWorkerRegistration | null> =>
    (await navigator.serviceWorker.getRegistration()) ?? null

  return {
    permission: () => Notification.permission,
    requestPermission: () => Notification.requestPermission(),
    getSubscription: async () => (await (await registration())?.pushManager.getSubscription()) ?? null,
    subscribe: async (applicationServerKey) => {
      const ready = await navigator.serviceWorker.ready

      return ready.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      })
    },
  }
}

export const reminders: RemindersApi = createReminders({
  snapshot: () => {
    const { platform, standalone } = pwaStore.getSnapshot()

    return { platform, standalone }
  },
  vapidKey: browserVapidKey,
  push: browserPush,
  put: (body) =>
    apiFetch<void>("/me/reminders", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  remove: () => apiFetch<void>("/me/reminders", { method: "DELETE" }),
  timezone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  locale: currentLocale,
})

/**
 * The sign-out hook. It runs as the FIRST synchronous step of
 * `purgeClientCaches()` (see purge.ts / auth.ts `signOut`), so it captures the
 * bearer token before the tokens are cleared and sends the server DELETE with
 * a raw `keepalive` fetch -- `apiFetch` would redirect to sign-in on a 401 and
 * can read the token too late. The browser subscription is dropped locally
 * regardless, which is what actually stops delivery.
 */
export function unsubscribeOnSignOut(): Promise<void> {
  const token = currentAccessToken()

  if (token) {
    void fetch("/api/me/reminders", {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
      keepalive: true,
    }).catch(() => undefined)
  }

  const push = browserPush()

  if (!push) {
    return Promise.resolve()
  }

  return push
    .getSubscription()
    .then((subscription) => subscription?.unsubscribe())
    .then(() => undefined)
    .catch(() => undefined)
}

const ROW_KEYS: Record<ReminderState, string> = {
  off: "reminders.row.off",
  on: "reminders.row.on",
  denied: "reminders.row.denied",
  "needs-install": "reminders.row.needsInstall",
  unsupported: "reminders.row.unsupported",
}

export function reminderRowKey(state: ReminderState): string {
  return ROW_KEYS[state]
}
```

Run: `pnpm --filter @pp/app exec vitest run test/reminders.test.ts`
Expected: PASS (all cases).

Add a test for the sign-out hook to the same file's neighbour, `packages/app/test/reminders-sign-out.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { unsubscribeOnSignOut } from "../src/lib/reminders.js"
import { tokenStore } from "../src/lib/tokenStore.js"

describe("unsubscribeOnSignOut", () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)
    tokenStore.set("access_token", "bearer-xyz")
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    tokenStore.clear()
  })

  it("sends the DELETE with the token it captured synchronously, even if the token is cleared right after", async () => {
    const pending = unsubscribeOnSignOut()
    tokenStore.clear()
    await pending

    expect(fetchMock).toHaveBeenCalledWith("/api/me/reminders", {
      method: "DELETE",
      headers: { authorization: "Bearer bearer-xyz" },
      keepalive: true,
    })
  })

  it("sends nothing and still resolves when there is no session", async () => {
    tokenStore.clear()

    await expect(unsubscribeOnSignOut()).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
```

Run: `pnpm --filter @pp/app exec vitest run test/reminders-sign-out.test.ts`
Expected: PASS (jsdom has no `PushManager`, so `browserPush()` is null and only the fetch path runs).

- [ ] **Step 8: Commit**

```bash
git add packages/app/src/lib/reminders.ts packages/app/test/reminders.test.ts packages/app/test/reminders-sign-out.test.ts
git commit -m "feat(app): reminders library — state, enable, disable, sign-out unsubscribe"
```

- [ ] **Step 9: Write the failing service-worker handler test and register node-context tests**

Create `packages/app/test/push-sw.test.ts` (node context: it reads the real file and runs it in a `vm` sandbox with a fake service-worker `self`):

```ts
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { runInNewContext } from "node:vm"
import { describe, expect, it } from "vitest"

const source = readFileSync(join(process.cwd(), "public/push-sw.js"), "utf8")

interface ShownNotification {
  title: string
  options: { body?: string; tag?: string; icon?: string; data?: { url: string } }
}

function loadWorker(windows: Array<{ focus: () => Promise<unknown> }> = []) {
  const listeners = new Map<string, (event: unknown) => void>()
  const shown: ShownNotification[] = []
  const opened: string[] = []
  const self = {
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.set(type, listener)
    },
    registration: {
      showNotification: (title: string, options: ShownNotification["options"]) => {
        shown.push({ title, options })

        return Promise.resolve()
      },
    },
    clients: {
      matchAll: () => Promise.resolve(windows),
      openWindow: (url: string) => {
        opened.push(url)

        return Promise.resolve(null)
      },
    },
  }

  runInNewContext(source, { self })

  async function push(data: unknown, parseFails = false): Promise<void> {
    const waits: Array<Promise<unknown>> = []

    listeners.get("push")?.({
      data: {
        json: () => {
          if (parseFails) {
            throw new SyntaxError("bad json")
          }

          return data
        },
      },
      waitUntil: (promise: Promise<unknown>) => waits.push(promise),
    })
    await Promise.all(waits)
  }

  async function click(url?: string): Promise<{ closed: boolean }> {
    const waits: Array<Promise<unknown>> = []
    const state = { closed: false }

    listeners.get("notificationclick")?.({
      notification: {
        close: () => {
          state.closed = true
        },
        data: url === undefined ? undefined : { url },
      },
      waitUntil: (promise: Promise<unknown>) => waits.push(promise),
    })
    await Promise.all(waits)

    return state
  }

  return { shown, opened, push, click }
}

describe("push-sw.js", () => {
  it("shows the pushed title and body, tagged so reminders never stack", async () => {
    const worker = loadWorker()

    await worker.push({ title: "Primary Practice", body: "Time for a little practice 🎧", url: "/" })

    expect(worker.shown).toHaveLength(1)
    expect(worker.shown[0].title).toBe("Primary Practice")
    expect(worker.shown[0].options).toMatchObject({
      body: "Time for a little practice 🎧",
      tag: "daily-reminder",
      icon: "/pwa-192x192.png",
      data: { url: "/" },
    })
  })

  it("still shows a notification (Chrome requires one per push) when the payload is not JSON", async () => {
    const worker = loadWorker()

    await worker.push(undefined, true)

    expect(worker.shown).toHaveLength(1)
    expect(worker.shown[0].title).toBe("Primary Practice")
  })

  it.each(["https://evil.example/x", "//evil.example/x", "javascript:alert(1)", 42])(
    "only ever opens an in-app path: %s becomes /",
    async (url) => {
      const worker = loadWorker()

      await worker.push({ title: "t", body: "b", url })

      expect(worker.shown[0].options.data?.url).toBe("/")
    },
  )

  it("closes the notification and focuses an open app window", async () => {
    let focused = false
    const worker = loadWorker([
      {
        focus: () => {
          focused = true

          return Promise.resolve()
        },
      },
    ])

    const { closed } = await worker.click("/")

    expect(closed).toBe(true)
    expect(focused).toBe(true)
    expect(worker.opened).toEqual([])
  })

  it("opens the app when no window is open", async () => {
    const worker = loadWorker([])

    await worker.click("/history")

    expect(worker.opened).toEqual(["/history"])
  })

  it("falls back to / when the notification carries no data", async () => {
    const worker = loadWorker([])

    await worker.click(undefined)

    expect(worker.opened).toEqual(["/"])
  })
})
```

In `packages/app/tsconfig.node.json` extend `"include"` with `"test/push-sw.test.ts"` and `"test/docker-entrypoint.test.ts"` (alongside the existing `test/dev-auth-prod-build.test.ts`), and in `packages/app/tsconfig.app.json` extend `"exclude"` with the same two paths. (They import `node:*`, which the app tsconfig's `types: ["vite/client"]` does not provide — the same reason `dev-auth-prod-build.test.ts` is split out. Task 26 adds `test/pwa-build-output.test.ts` to both lists.)

Run: `pnpm --filter @pp/app exec vitest run test/push-sw.test.ts`
Expected: FAIL — `ENOENT … public/push-sw.js`.

- [ ] **Step 10: Write `public/push-sw.js`**

Create `packages/app/public/push-sw.js` (plain script: Workbox's generated `sw.js` pulls it in with `importScripts`; it is not bundled, so no imports, no syntax newer than the target browsers):

```js
/* Practice-reminder handlers, pulled into the Workbox service worker by
 * `workbox.importScripts: ["push-sw.js"]` (vite.config.ts). Plain JS on
 * purpose: it is copied from public/ as-is and never bundled. */

function safeAppPath(value) {
  // In-app paths only. "//host" is protocol-relative (off-site), and anything
  // not starting with a single "/" (https:, javascript:, a number…) is refused.
  return typeof value === "string" && value.charAt(0) === "/" && value.charAt(1) !== "/"
    ? value
    : "/"
}

self.addEventListener("push", function (event) {
  var data = {}

  try {
    data = event.data ? event.data.json() : {}
  } catch (error) {
    data = {}
  }

  var title = typeof data.title === "string" && data.title ? data.title : "Primary Practice"
  var body = typeof data.body === "string" ? data.body : ""

  // userVisibleOnly: every push MUST end in a visible notification, so a
  // malformed payload still shows the default title rather than nothing.
  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      icon: "/pwa-192x192.png",
      badge: "/pwa-192x192.png",
      tag: "daily-reminder",
      data: { url: safeAppPath(data.url) },
    }),
  )
})

self.addEventListener("notificationclick", function (event) {
  event.notification.close()

  var url = safeAppPath(event.notification.data && event.notification.data.url)

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (windows) {
        for (var index = 0; index < windows.length; index += 1) {
          if ("focus" in windows[index]) {
            return windows[index].focus()
          }
        }

        return self.clients.openWindow(url)
      }),
  )
})
```

Confirm the icon the worker references exists: `ls packages/app/public/pwa-192x192.png` (Task 1 generates it). If Task 1 named the icon differently, change both `icon:` and `badge:` here and the string in the test.

Run: `pnpm --filter @pp/app exec vitest run test/push-sw.test.ts && pnpm --filter @pp/app typecheck`
Expected: PASS; typecheck clean (the new test is compiled by `tsconfig.node.json`).

- [ ] **Step 11: Wire the script into the generated service worker**

In `packages/app/vite.config.ts`, find the object passed to `VitePWA(...)` that Task 1 built from `cmsPwaOptions(...)`. Inside its `workbox` object (next to `navigateFallback` / `runtimeCaching`) add:

```ts
      // Practice reminders: push + notificationclick live in public/push-sw.js.
      importScripts: ["push-sw.js"],
```

Verify the built worker loads it:

```bash
pnpm --filter @pp/app build
grep -o 'importScripts([^)]*push-sw.js[^)]*)' packages/app/dist/sw.js
ls packages/app/dist/push-sw.js
```
Expected: the `grep` prints `importScripts("push-sw.js")` (or the equivalent minified form) and `ls` lists the file.

- [ ] **Step 12: Commit**

```bash
git add packages/app/public/push-sw.js packages/app/test/push-sw.test.ts packages/app/vite.config.ts packages/app/tsconfig.app.json packages/app/tsconfig.node.json
git commit -m "feat(app): service-worker push and notificationclick handlers"
```

- [ ] **Step 13: Add the `reminders.*` strings to all six locales**

Write this script to a temporary file and run it from the repository root (it appends the keys in the same order for every locale, preserving the existing two-space JSON style):

```bash
SCRIPT="$(mktemp -d)/add-reminder-keys.mjs"
cat > "$SCRIPT" <<'EOF'
import { readFileSync, writeFileSync } from "node:fs"

const KEYS = [
  "reminders.row.title",
  "reminders.row.off",
  "reminders.row.on",
  "reminders.row.denied",
  "reminders.row.needsInstall",
  "reminders.row.unsupported",
  "reminders.sheet.title",
  "reminders.sheet.body",
  "reminders.sheet.allow",
  "reminders.sheet.deny",
  "reminders.sheet.close",
  "reminders.toast.on",
  "reminders.toast.off",
  "reminders.toast.blocked",
  "reminders.error.generic",
]

const TEXT = {
  en: [
    "Practice reminders",
    "Off",
    "Daily at 4:30 pm",
    "Blocked in your browser settings.",
    "On iPhone, install the app first to turn reminders on.",
    "Reminders aren't available in this browser.",
    "Allow reminders?",
    "Primary Practice would like to send a short reminder to practise each afternoon. Your browser will ask you to confirm next.",
    "Allow",
    "Don't allow",
    "Close",
    "Reminders turned on.",
    "Reminders turned off.",
    "Reminders blocked.",
    "Reminders couldn't be turned on. Please try again.",
  ],
  de: [
    "Übungserinnerungen",
    "Aus",
    "Täglich um 16:30 Uhr",
    "In den Browser-Einstellungen blockiert.",
    "Auf dem iPhone muss die App zuerst installiert werden, um Erinnerungen einzuschalten.",
    "Erinnerungen sind in diesem Browser nicht verfügbar.",
    "Erinnerungen erlauben?",
    "Primary Practice möchte dir jeden Nachmittag eine kurze Erinnerung zum Üben schicken. Dein Browser fragt dich als Nächstes um Bestätigung.",
    "Erlauben",
    "Nicht erlauben",
    "Schließen",
    "Erinnerungen eingeschaltet.",
    "Erinnerungen ausgeschaltet.",
    "Erinnerungen blockiert.",
    "Erinnerungen konnten nicht eingeschaltet werden. Bitte versuche es noch einmal.",
  ],
  es: [
    "Recordatorios de práctica",
    "Desactivados",
    "Cada día a las 16:30",
    "Bloqueados en la configuración del navegador.",
    "En iPhone, instala primero la app para activar los recordatorios.",
    "Los recordatorios no están disponibles en este navegador.",
    "¿Permitir recordatorios?",
    "Primary Practice quiere enviarte un breve recordatorio para practicar cada tarde. Tu navegador te pedirá confirmación a continuación.",
    "Permitir",
    "No permitir",
    "Cerrar",
    "Recordatorios activados.",
    "Recordatorios desactivados.",
    "Recordatorios bloqueados.",
    "No se pudieron activar los recordatorios. Inténtalo de nuevo.",
  ],
  fr: [
    "Rappels d'entraînement",
    "Désactivés",
    "Chaque jour à 16 h 30",
    "Bloqués dans les paramètres du navigateur.",
    "Sur iPhone, installe d'abord l'app pour activer les rappels.",
    "Les rappels ne sont pas disponibles dans ce navigateur.",
    "Autoriser les rappels ?",
    "Primary Practice voudrait t'envoyer un court rappel pour t'entraîner chaque après-midi. Ton navigateur te demandera ensuite de confirmer.",
    "Autoriser",
    "Ne pas autoriser",
    "Fermer",
    "Rappels activés.",
    "Rappels désactivés.",
    "Rappels bloqués.",
    "Impossible d'activer les rappels. Réessaie.",
  ],
  it: [
    "Promemoria di pratica",
    "Disattivati",
    "Ogni giorno alle 16:30",
    "Bloccati nelle impostazioni del browser.",
    "Su iPhone, installa prima l'app per attivare i promemoria.",
    "I promemoria non sono disponibili in questo browser.",
    "Consentire i promemoria?",
    "Primary Practice vorrebbe mandarti un breve promemoria per esercitarti ogni pomeriggio. Il browser ti chiederà poi di confermare.",
    "Consenti",
    "Non consentire",
    "Chiudi",
    "Promemoria attivati.",
    "Promemoria disattivati.",
    "Promemoria bloccati.",
    "Non è stato possibile attivare i promemoria. Riprova.",
  ],
  ja: [
    "練習のリマインダー",
    "オフ",
    "毎日午後4時30分",
    "ブラウザの設定でブロックされています。",
    "iPhoneでは、先にアプリをインストールするとリマインダーをオンにできます。",
    "このブラウザではリマインダーを使えません。",
    "リマインダーを許可しますか？",
    "Primary Practice から、毎日午後に練習のお知らせを送ってもよいですか？次にブラウザが確認します。",
    "許可する",
    "許可しない",
    "閉じる",
    "リマインダーをオンにしました。",
    "リマインダーをオフにしました。",
    "リマインダーをブロックしました。",
    "リマインダーをオンにできませんでした。もう一度お試しください。",
  ],
}

for (const [locale, values] of Object.entries(TEXT)) {
  const path = `packages/app/src/locales/${locale}/runner.json`
  const json = JSON.parse(readFileSync(path, "utf8"))

  KEYS.forEach((key, index) => {
    if (!(key in json)) {
      json[key] = values[index]
    }
  })
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`)
}
EOF
node "$SCRIPT"
pnpm exec prettier --write packages/app/src/locales --log-level warn
git diff --stat packages/app/src/locales
```
Expected: six files changed, each only by added lines (if a `reminders.*` key already existed from Task 5/6 the script keeps its value — review `git diff` and align the Profile row copy to those keys rather than keeping duplicates).

Run: `pnpm --filter @pp/app exec vitest run src/locales && pnpm lint:i18n`
Expected: PASS (key parity across `de en es fr it ja`).

- [ ] **Step 14: Write the failing `useReminders` hook test**

Create `packages/app/test/useReminders.test.tsx`:

```tsx
import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import "../src/i18n.js"
import type { RemindersApi, ReminderState } from "../src/lib/reminders.js"
import { toastStore } from "../src/lib/toast.js"
import { useReminders } from "../src/lib/useReminders.js"

function fakeApi(initial: ReminderState) {
  const api = {
    state: vi.fn().mockResolvedValue(initial),
    enable: vi.fn().mockResolvedValue("on" satisfies ReminderState),
    disable: vi.fn().mockResolvedValue("off" satisfies ReminderState),
  } satisfies RemindersApi

  return api
}

async function mounted(api: RemindersApi) {
  const hook = renderHook(() => useReminders(api))

  await waitFor(() => expect(api.state).toHaveBeenCalled())
  await act(async () => {
    await Promise.resolve()
  })

  return hook
}

describe("useReminders", () => {
  let toast: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    toast = vi.spyOn(toastStore, "show").mockImplementation(() => undefined)
  })

  afterEach(() => {
    toast.mockRestore()
  })

  it("loads the real state on mount", async () => {
    const { result } = await mounted(fakeApi("on"))

    expect(result.current.state).toBe("on")
  })

  it("turning the switch on opens the permission sheet and does NOT ask the browser yet", async () => {
    const api = fakeApi("off")
    const { result } = await mounted(api)

    act(() => result.current.toggle(true))

    expect(result.current.sheetOpen).toBe(true)
    expect(api.enable).not.toHaveBeenCalled()
  })

  it("Allow enables, closes the sheet, flips to on and toasts 'Reminders turned on.'", async () => {
    const api = fakeApi("off")
    const { result } = await mounted(api)
    act(() => result.current.toggle(true))

    await act(async () => {
      await result.current.allow()
    })

    expect(api.enable).toHaveBeenCalledOnce()
    expect(result.current.state).toBe("on")
    expect(result.current.sheetOpen).toBe(false)
    expect(toast).toHaveBeenCalledWith("Reminders turned on.", "bell")
  })

  it("a refusal at the browser prompt shows 'Reminders blocked.' and the denied row", async () => {
    const api = fakeApi("off")
    api.enable.mockResolvedValue("denied")
    const { result } = await mounted(api)
    act(() => result.current.toggle(true))

    await act(async () => {
      await result.current.allow()
    })

    expect(result.current.state).toBe("denied")
    expect(toast).toHaveBeenCalledWith("Reminders blocked.", "bell")
  })

  it("dismissing the browser prompt leaves it off with no toast", async () => {
    const api = fakeApi("off")
    api.enable.mockResolvedValue("off")
    const { result } = await mounted(api)
    act(() => result.current.toggle(true))

    await act(async () => {
      await result.current.allow()
    })

    expect(result.current.state).toBe("off")
    expect(result.current.sheetOpen).toBe(false)
    expect(toast).not.toHaveBeenCalled()
  })

  it("a server failure closes the sheet, raises the failure flag and toasts nothing", async () => {
    const api = fakeApi("off")
    api.enable.mockRejectedValue(new Error("503"))
    const { result } = await mounted(api)
    act(() => result.current.toggle(true))

    await act(async () => {
      await result.current.allow()
    })

    expect(result.current.failed).toBe(true)
    expect(result.current.state).toBe("off")
    expect(result.current.sheetOpen).toBe(false)
    expect(toast).not.toHaveBeenCalled()
  })

  it("Don't allow just closes the sheet — it never marks reminders blocked", async () => {
    const api = fakeApi("off")
    const { result } = await mounted(api)
    act(() => result.current.toggle(true))

    act(() => result.current.decline())

    expect(result.current.sheetOpen).toBe(false)
    expect(result.current.state).toBe("off")
    expect(api.enable).not.toHaveBeenCalled()
  })

  it("turning it off disables and toasts 'Reminders turned off.'", async () => {
    const api = fakeApi("on")
    const { result } = await mounted(api)

    await act(async () => {
      result.current.toggle(false)
      await Promise.resolve()
    })
    await waitFor(() => expect(result.current.state).toBe("off"))

    expect(api.disable).toHaveBeenCalledOnce()
    expect(toast).toHaveBeenCalledWith("Reminders turned off.", "bell")
  })

  it.each(["denied", "needs-install", "unsupported"] as const)(
    "does nothing when toggled while the state is %s",
    async (state) => {
      const api = fakeApi(state)
      const { result } = await mounted(api)

      act(() => result.current.toggle(true))

      expect(result.current.sheetOpen).toBe(false)
      expect(api.enable).not.toHaveBeenCalled()
    },
  )
})
```

Run: `pnpm --filter @pp/app exec vitest run test/useReminders.test.tsx`
Expected: FAIL — `Cannot find module '../src/lib/useReminders.js'`.

- [ ] **Step 15: Implement the hook**

Create `packages/app/src/lib/useReminders.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { reminders, type RemindersApi, type ReminderState } from "./reminders.js"
import { toastStore } from "./toast.js"

export interface UseRemindersResult {
  readonly state: ReminderState
  readonly busy: boolean
  /** The last turn-on attempt failed (server or network); cleared on the next toggle. */
  readonly failed: boolean
  readonly sheetOpen: boolean
  /** The switch's onChange: `true` asks first (sheet), `false` turns off at once. */
  toggle(next: boolean): void
  allow(): Promise<void>
  decline(): void
}

/**
 * Lives in lib/, not components/: components are props-only. The Profile page
 * owns one of these and hands the pieces to RemindersRow and
 * ReminderPermissionSheet.
 */
export function useReminders(api: RemindersApi = reminders): UseRemindersResult {
  const { t } = useTranslation("runner")
  const [state, setState] = useState<ReminderState>("off")
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true

    const refresh = (): void => {
      void api.state().then((next) => {
        if (alive.current) {
          setState(next)
        }
      })
    }

    refresh()
    // The student may flip the permission in browser settings and come back.
    document.addEventListener("visibilitychange", refresh)

    return () => {
      alive.current = false
      document.removeEventListener("visibilitychange", refresh)
    }
  }, [api])

  const toggle = useCallback(
    (next: boolean): void => {
      setFailed(false)

      if (next) {
        if (state === "off") {
          setSheetOpen(true)
        }

        return
      }

      if (state !== "on") {
        return
      }

      setBusy(true)
      void api
        .disable()
        .then((after) => {
          if (alive.current) {
            setState(after)
          }

          toastStore.show(t("reminders.toast.off"), "bell")
        })
        .finally(() => {
          if (alive.current) {
            setBusy(false)
          }
        })
    },
    [api, state, t],
  )

  const allow = useCallback(async (): Promise<void> => {
    setBusy(true)

    try {
      const after = await api.enable()

      setState(after)
      setSheetOpen(false)

      if (after === "on") {
        toastStore.show(t("reminders.toast.on"), "bell")
      } else if (after === "denied") {
        toastStore.show(t("reminders.toast.blocked"), "bell")
      }
    } catch {
      setFailed(true)
      setSheetOpen(false)
    } finally {
      setBusy(false)
    }
  }, [api, t])

  const decline = useCallback((): void => {
    setSheetOpen(false)
  }, [])

  return { state, busy, failed, sheetOpen, toggle, allow, decline }
}
```

Run: `pnpm --filter @pp/app exec vitest run test/useReminders.test.tsx && pnpm lint:frontend`
Expected: PASS; the frontend lint reports no new layering violation (hooks in `lib/` are allowed; `components/` stays stateless).

- [ ] **Step 16: Write the failing permission-sheet component test, then the component**

Create `packages/app/src/components/ReminderPermissionSheet.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import { ReminderPermissionSheet } from "./ReminderPermissionSheet.js"

describe("ReminderPermissionSheet", () => {
  afterEach(cleanup)

  it("is a named dialog with the prototype copy and the two choices", () => {
    render(<ReminderPermissionSheet open busy={false} onAllow={vi.fn()} onDecline={vi.fn()} />)

    const dialog = screen.getByRole("dialog", { name: "Allow reminders?" })

    expect(dialog).toHaveTextContent("Primary Practice would like to send a short reminder to practise each afternoon.")
    expect(screen.getByRole("button", { name: "Allow" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Don't allow" })).toBeEnabled()
  })

  it("Allow and Don't allow call their handlers", async () => {
    const onAllow = vi.fn()
    const onDecline = vi.fn()
    const user = userEvent.setup()
    render(<ReminderPermissionSheet open busy={false} onAllow={onAllow} onDecline={onDecline} />)

    await user.click(screen.getByRole("button", { name: "Allow" }))
    await user.click(screen.getByRole("button", { name: "Don't allow" }))

    expect(onAllow).toHaveBeenCalledOnce()
    expect(onDecline).toHaveBeenCalledOnce()
  })

  it("Escape closes it the same way as Don't allow", async () => {
    const onDecline = vi.fn()
    const user = userEvent.setup()
    render(<ReminderPermissionSheet open busy={false} onAllow={vi.fn()} onDecline={onDecline} />)

    await user.keyboard("{Escape}")

    expect(onDecline).toHaveBeenCalledOnce()
  })

  it("disables both choices and marks Allow busy while the browser prompt is up", () => {
    render(<ReminderPermissionSheet open busy onAllow={vi.fn()} onDecline={vi.fn()} />)

    expect(screen.getByRole("button", { name: "Allow" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Allow" })).toHaveAttribute("aria-busy", "true")
    expect(screen.getByRole("button", { name: "Don't allow" })).toBeDisabled()
  })

  it("renders nothing when closed", () => {
    render(<ReminderPermissionSheet open={false} busy={false} onAllow={vi.fn()} onDecline={vi.fn()} />)

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })
})
```

Run: `pnpm --filter @pp/app exec vitest run src/components/ReminderPermissionSheet.test.tsx`
Expected: FAIL — module not found.

Create `packages/app/src/components/ReminderPermissionSheet.tsx`:

```tsx
import type { JSX, RefObject } from "react"
import { useTranslation } from "react-i18next"
import { BottomSheet } from "./BottomSheet.js"

export interface ReminderPermissionSheetProps {
  readonly open: boolean
  /** True while the browser's own permission prompt / subscribe call is in flight. */
  readonly busy: boolean
  readonly onAllow: () => void
  readonly onDecline: () => void
  readonly returnFocusRef?: RefObject<HTMLElement | null>
}

/**
 * The "soft ask" in front of the browser's one-shot permission prompt: a
 * "Don't allow" here costs nothing, whereas a denial at the browser prompt is
 * sticky. Props-only; the hook in lib/useReminders.ts owns the state.
 */
export function ReminderPermissionSheet({
  open,
  busy,
  onAllow,
  onDecline,
  returnFocusRef,
}: ReminderPermissionSheetProps): JSX.Element {
  const { t } = useTranslation("runner")

  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onDecline()
        }
      }}
      title={t("reminders.sheet.title")}
      closeLabel={t("reminders.sheet.close")}
      returnFocusRef={returnFocusRef}
    >
      <p className="text-ink-2 mb-3.5 text-sm">{t("reminders.sheet.body")}</p>
      <div className="grid gap-2.5">
        <button
          type="button"
          className="device-button"
          disabled={busy}
          aria-busy={busy}
          onClick={onAllow}
        >
          {t("reminders.sheet.allow")}
        </button>
        <button
          type="button"
          className="device-button"
          data-variant="secondary"
          disabled={busy}
          onClick={onDecline}
        >
          {t("reminders.sheet.deny")}
        </button>
      </div>
    </BottomSheet>
  )
}
```

Run: `pnpm --filter @pp/app exec vitest run src/components/ReminderPermissionSheet.test.tsx`
Expected: PASS.

- [ ] **Step 17: Wire the Profile row and sheet**

Re-read `packages/app/src/components/RemindersRow.tsx` and `packages/app/src/pages/profile.tsx` (Task 6) and make them match this shape. Keep Task 6's export names, `data-testid`s and surrounding list markup; replace only the reminder row's behaviour. Class names below are the prototype's, as ported in Task 4 — confirm with `rg -n "\.switch|\.li\b|\.ticon" packages/app/src/index.css` and adapt if Task 4 prefixed them.

`RemindersRow.tsx` (props-only):

```tsx
import { useId, type JSX, type RefObject } from "react"
import { useTranslation } from "react-i18next"
import { reminderRowKey, type ReminderState } from "../lib/reminders.js"

export interface RemindersRowProps {
  readonly state: ReminderState
  readonly busy: boolean
  readonly failed: boolean
  readonly onToggle: (next: boolean) => void
  readonly switchRef?: RefObject<HTMLInputElement | null>
}

export function RemindersRow({ state, busy, failed, onToggle, switchRef }: RemindersRowProps): JSX.Element {
  const { t } = useTranslation("runner")
  const statusId = useId()
  // Off and on are the only states the switch can change; every other state is
  // a reason (shown as the status line), not a dead control.
  const disabled = busy || (state !== "off" && state !== "on")

  return (
    <div className="li">
      <span className="ticon" aria-hidden="true">🔔</span>
      <div className="t">
        {t("reminders.row.title")}
        <small id={statusId}>{t(reminderRowKey(state))}</small>
        {failed ? (
          <small role="alert" className="text-bad">{t("reminders.error.generic")}</small>
        ) : null}
      </div>
      <span className="switch">
        <input
          ref={switchRef}
          type="checkbox"
          role="switch"
          aria-label={t("reminders.row.title")}
          aria-describedby={statusId}
          checked={state === "on"}
          disabled={disabled}
          onChange={(event) => {
            onToggle(event.target.checked)
          }}
        />
        <i />
      </span>
    </div>
  )
}
```

(If Task 6 draws the bell with an SVG icon helper instead of the emoji, keep its icon.)

`profile.tsx` — inside the Profile screen component add:

```tsx
const reminderSwitchRef = useRef<HTMLInputElement>(null)
const reminder = useReminders()
```

render the row and the sheet:

```tsx
<RemindersRow
  state={reminder.state}
  busy={reminder.busy}
  failed={reminder.failed}
  onToggle={reminder.toggle}
  switchRef={reminderSwitchRef}
/>
```

and, once, at the end of the screen's JSX:

```tsx
<ReminderPermissionSheet
  open={reminder.sheetOpen}
  busy={reminder.busy}
  onAllow={() => {
    void reminder.allow()
  }}
  onDecline={reminder.decline}
  returnFocusRef={reminderSwitchRef}
/>
```

with imports `useReminders` from `../lib/useReminders.js`, `RemindersRow` / `ReminderPermissionSheet` from `../components/…`. If the page receives its student/props from a loader, `useReminders()` needs nothing from it.

Add this case to `packages/app/src/pages/profile.test.tsx`, using the render helper Task 6 defined there (called `renderProfile` below — use its real name) and mocking the reminders library so no browser APIs are needed:

```tsx
vi.mock("../lib/reminders.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/reminders.js")>()),
  reminders: {
    state: vi.fn().mockResolvedValue("off"),
    enable: vi.fn().mockResolvedValue("on"),
    disable: vi.fn().mockResolvedValue("off"),
  },
}))

it("Practice reminders: switch → permission sheet → Allow turns them on and toasts", async () => {
  const user = userEvent.setup()
  renderProfile()

  await user.click(await screen.findByRole("switch", { name: "Practice reminders" }))
  expect(screen.getByRole("dialog", { name: "Allow reminders?" })).toBeInTheDocument()

  await user.click(screen.getByRole("button", { name: "Allow" }))

  expect(await screen.findByRole("switch", { name: "Practice reminders" })).toBeChecked()
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
})

it.each([
  ["denied", "Blocked in your browser settings."],
  ["needs-install", "On iPhone, install the app first to turn reminders on."],
  ["unsupported", "Reminders aren't available in this browser."],
] as const)("explains why the switch is disabled when reminders are %s", async (state, reason) => {
  const { reminders } = await import("../lib/reminders.js")
  vi.mocked(reminders.state).mockResolvedValueOnce(state)
  renderProfile()

  const row = await screen.findByRole("switch", { name: "Practice reminders" })

  expect(row).toBeDisabled()
  expect(row).toHaveAccessibleDescription(reason)
})
```

Run: `pnpm --filter @pp/app exec vitest run src/pages/profile.test.tsx src/components`
Expected: PASS.

- [ ] **Step 18: Register the sign-out hook at boot**

In `packages/app/src/main.tsx`, after the `import "@pp/app/i18n"` side-effect import, add the imports and the registration (before `createRoot`):

```tsx
import { registerPurgeStep } from "@pp/app/lib/pwa/purge"
import { unsubscribeOnSignOut } from "@pp/app/lib/reminders"

registerPurgeStep(unsubscribeOnSignOut)
```

(Use the relative-vs-alias import style the file already uses; `main.tsx` imports with the `@pp/app/…` alias.)

Run: `pnpm --filter @pp/app typecheck && pnpm --filter @pp/app exec vitest run test/i18n-is-initialised.test.ts`
Expected: PASS.

- [ ] **Step 19: Commit the client work**

```bash
git add packages/app/src packages/app/test packages/app/public
git commit -m "feat(app): practice reminders — permission sheet, Profile row, sign-out cleanup"
```

- [ ] **Step 20: Ship the public key — Dockerfile, compose, entrypoint (with a test)**

`VITE_VAPID_PUBLIC_KEY` is a **public** value (it is in every page that subscribes), so a build arg is fine. Like the `VITE_AUTH_*` trio it is baked at build time; unlike them it is **optional**: no key means "reminders unavailable", never a refused boot.

`Dockerfile` — in the builder stage, next to the `VITE_AUTH_REDIRECT_URI` ARG, add `ARG VITE_VAPID_PUBLIC_KEY=__VITE_VAPID_PUBLIC_KEY__` and extend the `ENV` block:

```dockerfile
ARG VITE_AUTH_REDIRECT_URI=__VITE_AUTH_REDIRECT_URI__
ARG VITE_VAPID_PUBLIC_KEY=__VITE_VAPID_PUBLIC_KEY__
ENV VITE_AUTH_ISSUER=$VITE_AUTH_ISSUER \
    VITE_AUTH_CLIENT_ID=$VITE_AUTH_CLIENT_ID \
    VITE_AUTH_REDIRECT_URI=$VITE_AUTH_REDIRECT_URI \
    VITE_VAPID_PUBLIC_KEY=$VITE_VAPID_PUBLIC_KEY
```

`compose.yml` — in the `api.build.args` block add (the default **is** the placeholder, so an unset variable leaves the runtime substitution below in charge):

```yaml
        VITE_VAPID_PUBLIC_KEY: ${VITE_VAPID_PUBLIC_KEY:-__VITE_VAPID_PUBLIC_KEY__}
```

`docker-entrypoint.sh` — after the three `substitute VITE_AUTH_*` calls add an optional variant, and widen the final end-state check:

```sh
# Optional: unlike the auth trio, an unset value is NOT fatal -- it means
# "practice reminders unavailable" (the client treats "" as no key). It falls
# back to the server's own VAPID_PUBLIC_KEY, so one variable configures both.
substitute_optional() {
  var_name="$1"
  value="$2"
  esc=$(printf '%s' "$value" | sed 's/[\\&|]/\\&/g')
  find "$SPA_DIR" -type f \( -name '*.js' -o -name '*.html' \) \
    -exec sed -i "s|__${var_name}__|${esc}|g" {} +
}

substitute_optional VITE_VAPID_PUBLIC_KEY "${VITE_VAPID_PUBLIC_KEY:-${VAPID_PUBLIC_KEY:-}}"
```

and change the end-state check's pattern from `grep -l '__VITE_AUTH'` to `grep -lE '__VITE_(AUTH|VAPID)'` and its message to `__VITE_AUTH*/__VITE_VAPID* placeholder still present …`.

Create `packages/app/test/docker-entrypoint.test.ts` (it runs the real script against a throw-away SPA directory; GNU `sed -i` is required, which is what the Alpine image has, so it skips on BSD/macOS `sed` rather than failing — the Task 26 checklist covers a real `docker build` + `docker run`):

```ts
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

const entrypoint = join(process.cwd(), "../../docker-entrypoint.sh")
const gnuSed = spawnSync("sed", ["--version"]).status === 0
const AUTH = {
  VITE_AUTH_ISSUER: "https://auth.example.test",
  VITE_AUTH_CLIENT_ID: "client",
  VITE_AUTH_REDIRECT_URI: "https://quiz.example.test/callback",
}
const dirs: string[] = []

function run(env: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "pp-entrypoint-"))
  dirs.push(dir)
  mkdirSync(join(dir, "assets"))
  writeFileSync(join(dir, "index.html"), "<html></html>")
  writeFileSync(
    join(dir, "assets", "app.js"),
    'const a="__VITE_AUTH_ISSUER__",b="__VITE_AUTH_CLIENT_ID__",c="__VITE_AUTH_REDIRECT_URI__",k="__VITE_VAPID_PUBLIC_KEY__";',
  )
  execFileSync("sh", [entrypoint, "true"], {
    env: { PATH: process.env.PATH ?? "", SPA_ROOT: dir, ...env },
    stdio: "pipe",
  })

  return readFileSync(join(dir, "assets", "app.js"), "utf8")
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe.skipIf(!gnuSed)("docker-entrypoint.sh — VAPID public key", () => {
  it("falls back to the server's VAPID_PUBLIC_KEY", () => {
    expect(run({ ...AUTH, VAPID_PUBLIC_KEY: "BPub_key-123" })).toContain('k="BPub_key-123"')
  })

  it("prefers an explicit VITE_VAPID_PUBLIC_KEY", () => {
    expect(
      run({ ...AUTH, VITE_VAPID_PUBLIC_KEY: "explicit", VAPID_PUBLIC_KEY: "server" }),
    ).toContain('k="explicit"')
  })

  it("boots with NO key and ships an empty string, not the placeholder", () => {
    const built = run(AUTH)

    expect(built).toContain('k=""')
    expect(built).not.toContain("__VITE_")
  })

  it("keeps sed-special characters in the value intact", () => {
    expect(run({ ...AUTH, VAPID_PUBLIC_KEY: "a&b|c\\d" })).toContain('k="a&b|c\\d"')
  })

  it("still fails closed on a missing auth variable", () => {
    expect(() => run({ VITE_AUTH_ISSUER: "x" })).toThrow()
  })
})
```

Run: `pnpm --filter @pp/app exec vitest run test/docker-entrypoint.test.ts`
Expected before editing the script: FAIL (the placeholder is not substituted). After: PASS on Linux/GNU `sed`; skipped on macOS (the output says `skipped`).

- [ ] **Step 21: Serve `push-sw.js` no-cache, and document the variables**

Service workers re-check their imported scripts on every update probe, so `push-sw.js` must obey the same no-cache rule as `sw.js`. In `packages/server/src/main.ts` find the `express.static(spaRoot, …)` mount's `setHeaders` (added by Task 2: it sends `Cache-Control: no-cache` for `sw.js`, `workbox-*.js` and `manifest.webmanifest`) — `rg -n "no-cache" packages/server/src/main.ts packages/server/test/helpers/app.ts` finds it — and add `push-sw.js` to that matcher in **both** `main.ts` and the mirrored mount in `packages/server/test/helpers/app.ts`. Add to `packages/server/test/spa.e2e.test.ts`, inside the existing `describeIfSpaBuilt("SPA serving", …)`:

```ts
  it("serves push-sw.js as a real script file with Cache-Control: no-cache", async () => {
    if (!app) {
      throw new Error("Application failed to initialize")
    }

    const res = await request(app.http.getHttpServer() as App)
      .get("/push-sw.js")
      .expect(200)

    expect(res.headers["content-type"]).toMatch(/javascript/u)
    expect(res.headers["cache-control"]).toContain("no-cache")
    expect(res.text).toContain("notificationclick")
  })
```

Build first so the SPA exists: `pnpm --filter @pp/app build && pnpm --filter @pp/server exec vitest run test/spa.e2e.test.ts`
Expected: PASS (the suite uses the local build — see `defaultSpaRootToLocalBuild` in `global-setup.ts`).

README — in the Docker section after the paragraph about `VITE_AUTH_*`, add:

````markdown
### 🔔 Practice reminders (Web Push)

Reminders are optional. Without keys the Profile switch explains they are unavailable and the server answers `503 reminders_not_configured`.

```bash
pnpm --filter @pp/server exec web-push generate-vapid-keys --json   # one-time
export VAPID_PUBLIC_KEY=...        # also baked into the SPA (see below)
export VAPID_PRIVATE_KEY=...       # secret — never commit it
export VAPID_SUBJECT=mailto:you@example.com
```

All three or none (a partial set refuses to boot). `VAPID_PUBLIC_KEY` also reaches the browser: `docker-entrypoint.sh` substitutes it into the built SPA at container start (or pass `VITE_VAPID_PUBLIC_KEY` as a build arg to bake it). The scheduler sends one reminder per student per local day at 4:30 pm in the student's own time zone, never after they have already finished a test that day. On iPhone, reminders only work once the app has been added to the home screen (iOS 16.4+).
````

- [ ] **Step 22: Run the gates and commit**

Run: `pnpm lint && pnpm typecheck && pnpm --filter @pp/app test && pnpm --filter @pp/server exec vitest run test/spa.e2e.test.ts && pnpm format`
Expected: all green (the entrypoint test reports *skipped* on macOS).

```bash
git add Dockerfile compose.yml docker-entrypoint.sh README.md packages/app/test/docker-entrypoint.test.ts packages/server/src/main.ts packages/server/test
git commit -m "feat(app): ship the VAPID public key to the SPA; serve push-sw.js uncached"
```

---

### Task 26: Acceptance — parity verification, build-output test, docs, dead-code removal

**Files:**
- Create: `docs/superpowers/plans/2026-11-22-quiz-pwa-mobile-acceptance.md`
- Create: `packages/app/test/pwa-build-output.test.ts`
- Modify: `packages/app/tsconfig.app.json`, `packages/app/tsconfig.node.json`
- Modify: `README.md`, `docs/README.md`, `docs/architecture/library-adoption.md`
- Delete (after `rg` proves nothing imports them): `packages/app/src/components/DeviceSheet.tsx`, `packages/app/src/components/AppMenu.tsx`, `packages/app/src/components/AppMenu.test.tsx`
- Modify: `packages/app/src/index.css` (remove rules no component uses), `packages/app/src/locales/*/runner.json` (remove `menu.*` keys nothing reads)

**Interfaces:**
- Consumes: the finished app from Tasks 1–25; the prototype at https://quiz.preview.icovn.me (`docs/prototype/pwa-mobile.html`).
- Produces: a signed-off acceptance table and a clean tree. No new runtime interfaces.

- [ ] **Step 1: Write the failing build-output test**

Create `packages/app/test/pwa-build-output.test.ts` (a node-context test like `dev-auth-prod-build.test.ts`: it runs a real production build into a temp directory and inspects the output). Add it to `packages/app/tsconfig.node.json` `"include"` and `packages/app/tsconfig.app.json` `"exclude"` (the same two edits Task 25 made for its node-context tests).

```ts
import { execFileSync } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

interface Manifest {
  name: string
  short_name: string
  start_url: string
  scope: string
  display: string
  theme_color: string
  background_color: string
  icons: Array<{ src: string; sizes: string; type?: string; purpose?: string }>
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * The service worker is the one artefact no component test can see, and a
 * mistake in it is silent: a worker that caches `/api/media` leaks a play-
 * capped recording, one that caches `/api/session` serves a signed-out
 * student's profile. So this builds for real and inspects what ships.
 * (Server-side `Cache-Control` for sw.js/manifest lives in spa.e2e.test.ts.)
 */
describe("production build — PWA output", () => {
  const appRoot = process.cwd()
  let outDir = ""
  let sw = ""
  let manifest: Manifest
  let indexHtml = ""

  beforeAll(() => {
    outDir = mkdtempSync(join(tmpdir(), "pp-app-pwa-build-"))
    execFileSync("pnpm", ["exec", "vite", "build", "--mode", "production", "--outDir", outDir], {
      cwd: appRoot,
      env: {
        ...process.env,
        NODE_ENV: "production",
        VITEST: undefined,
        VITE_VAPID_PUBLIC_KEY: "BPublicKeyForTheBuildTest",
      },
      stdio: "pipe",
    })
    sw = readFileSync(join(outDir, "sw.js"), "utf8")
    manifest = JSON.parse(readFileSync(join(outDir, "manifest.webmanifest"), "utf8")) as Manifest
    indexHtml = readFileSync(join(outDir, "index.html"), "utf8")
  }, 180_000)

  afterAll(() => {
    if (outDir && process.env.KEEP_PROD_BUILD_TEST_OUTPUT !== "1") {
      rmSync(outDir, { recursive: true, force: true })
    }
  })

  function precachedUrls(): string[] {
    return [...sw.matchAll(/url:\s*"([^"]+)"/gu)].map((match) => match[1])
  }

  it("emits the service worker, its runtime and the manifest", () => {
    expect(existsSync(join(outDir, "sw.js"))).toBe(true)
    expect(existsSync(join(outDir, "manifest.webmanifest"))).toBe(true)
    expect(readdirSync(outDir).some((name) => /^workbox-.*\.js$/u.test(name))).toBe(true)
    expect(indexHtml).toContain('rel="manifest"')
  })

  it("has every field Chrome needs to call the app installable", () => {
    expect(manifest).toMatchObject({
      start_url: "/",
      scope: "/",
      display: "standalone",
    })
    expect(manifest.name.length).toBeGreaterThan(0)
    expect(manifest.short_name.length).toBeGreaterThan(0)
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/iu)
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/iu)
    expect(manifest.icons.some((icon) => icon.sizes === "192x192")).toBe(true)
    expect(manifest.icons.some((icon) => icon.sizes === "512x512")).toBe(true)
    expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(true)
  })

  it("ships every manifest icon as a real PNG", () => {
    for (const icon of manifest.icons) {
      const file = join(outDir, icon.src.replace(/^\//u, ""))

      expect(existsSync(file), `${icon.src} is missing from the build`).toBe(true)
      expect(readFileSync(file).subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
    }
  })

  it("has an apple-touch-icon and the theme colour in index.html", () => {
    expect(indexHtml).toContain('rel="apple-touch-icon"')
    expect(indexHtml).toContain('name="theme-color"')
  })

  it("precaches the app shell and the self-hosted fonts, and no Google Fonts links remain", () => {
    const urls = precachedUrls()

    expect(urls).toContain("index.html")
    expect(urls.some((url) => url.endsWith(".woff2"))).toBe(true)
    expect(urls.some((url) => url.endsWith(".css"))).toBe(true)
    expect(indexHtml).not.toContain("fonts.googleapis.com")
    expect(indexHtml).not.toContain("fonts.gstatic.com")
  })

  it("never precaches API, media or health routes", () => {
    for (const url of precachedUrls()) {
      expect(url).not.toMatch(/^(\/)?(api|media|health)(\/|$)/u)
    }
  })

  it("falls back to the app shell for navigation but not for /api, /media or /health", () => {
    expect(sw).toContain("index.html")
    expect(sw).toMatch(/denylist/u)
    expect(sw).toMatch(/\^\\?\/api\\?\//u)
    expect(sw).toMatch(/\^\\?\/media\\?\//u)
    expect(sw).toMatch(/\^\\?\/health/u)
  })

  it("has no runtime-cache route for media, session or any mutating attempt call", () => {
    expect(sw).not.toContain("/api/media")
    expect(sw).not.toContain("/api/session")
    expect(sw).not.toMatch(/\/api\/attempts\/[^"']*(submit|position|responses|play|sections)/u)
  })

  it("only caches the allow-listed GET API cache", () => {
    expect(sw).toContain("pp-api-v1")
  })

  it("waits to be told to update — it never skips waiting on its own", () => {
    expect(sw).toContain("SKIP_WAITING")
  })

  it("pulls in the push handlers and ships the file", () => {
    expect(sw).toMatch(/importScripts\(\s*["']push-sw\.js["']/u)
    expect(existsSync(join(outDir, "push-sw.js"))).toBe(true)
  })

  it("inlines the VAPID public key the build was given", () => {
    const assets = readdirSync(join(outDir, "assets"))
      .filter((name) => name.endsWith(".js"))
      .map((name) => readFileSync(join(outDir, "assets", name), "utf8"))
      .join("\n")

    expect(assets).toContain("BPublicKeyForTheBuildTest")
  })
})
```

Add `"test/pwa-build-output.test.ts"` to the `include` array in `packages/app/tsconfig.node.json` and to the `exclude` array in `packages/app/tsconfig.app.json`.

Run: `pnpm --filter @pp/app exec vitest run test/pwa-build-output.test.ts`
Expected: if Tasks 1–2 and 25 are merged this should already PASS — run it anyway and read every failure as a real regression to fix **in the owning task's file** (not by loosening an assertion here). If an assertion fails because the generated worker spells something differently (for example the denylist regexes minify to `/^\/api\//` in a form the pattern above does not match), inspect with `grep -o 'denylist[^]]*]' packages/app/dist/sw.js` after `pnpm --filter @pp/app build` and tighten the regex to the **actual** output — never remove the check. The service worker must not route `/api/media`; that assertion is the point of this test.

- [ ] **Step 2: Commit the test**

```bash
git add packages/app/test/pwa-build-output.test.ts packages/app/tsconfig.app.json packages/app/tsconfig.node.json
git commit -m "test(app): pin the shipped service worker, manifest, icons and fonts"
```

- [ ] **Step 3: Write the parity acceptance checklist**

Create `docs/superpowers/plans/2026-11-22-quiz-pwa-mobile-acceptance.md` with exactly this content:

````markdown
# Quiz PWA — parity acceptance checklist

Reference: the prototype at https://quiz.preview.icovn.me (`docs/prototype/pwa-mobile.html`). Open it in a second Chrome window beside the app and compare screen by screen. The app wins only where the spec lists a deviation (§11). Fill the **Result** column ✅/❌ and attach screenshots to the PR. Nothing in this file is automated; the automated gates are listed at the bottom.

## Setup

1. Production-like run (the service worker is disabled under `pnpm dev`, so install / offline / update rows cannot be verified there):
   ```bash
   docker compose up -d postgres
   pnpm build
   DATABASE_URL=postgresql://pp:$POSTGRES_PASSWORD@127.0.0.1:5433/pp \
   JWKS_URL=https://auth-dev.icovn.me/jwks MEDIA_SIGNING_SECRET=dev-only \
   SPA_ROOT="$PWD/packages/app/dist" PORT=3000 node packages/server/dist/main.js
   ```
   Sign in against `https://auth-dev.icovn.me` with a student account that holds the `student` role for client `quiz-web` (the issuer's dev login; redirect URI `http://localhost:3000/callback` must be registered), and seed tests with `pnpm seed`.
2. Chrome → open `http://localhost:3000`.
3. **Phone viewport:** DevTools (⌥⌘I) → Toggle device toolbar (⇧⌘M) → dropdown "Responsive" → width **390**, height **844**, DPR 3 (pass 1); repeat everything visual at **320 × 568** (pass 2).
4. **Offline:** DevTools → Network → throttling dropdown → **Offline** (back to **No throttling** to reconnect).
5. **Service worker / install:** DevTools → Application → *Manifest* (Installability section must list no errors), *Service workers* (status "activated and is running"; leave "Update on reload" **off**), *Storage* → Cache storage / IndexedDB.
6. **Reduced motion:** DevTools → ⌘⇧P → "Show Rendering" → "Emulate CSS media feature prefers-reduced-motion" = *reduce*.
7. **Overflow check** (console): `document.documentElement.scrollWidth <= innerWidth` must be `true` on every screen.
8. **Lighthouse** (DevTools → Lighthouse, Mode *Navigation*, Device *Mobile*, categories Accessibility + Best practices): both ≥ 95. Lighthouse 12+ has no PWA category — installability is the Application → Manifest check above.

## Parity matrix (spec §3, 34 rows)

| # | Feature | How to verify | Expected | Result |
|---|---|---|---|---|
| 1 | Installable standalone app, manifest, icons, splash | Application → Manifest | Name, short name, start_url `/`, display `standalone`, 192/512/maskable icons shown; Installability: no errors. Install (⊕ in the address bar) opens a window with no browser chrome; a splash in the teal brand colour shows briefly | ☐ |
| 2 | Offline app shell | Load `/` signed in, then Network → Offline, reload | Library shell and fonts render (Nunito, not a fallback face); no browser "offline" dinosaur page | ☐ |
| 3 | Install banner, Android prompt, iOS steps, dismiss, installed state | Fresh profile → Library | Card "Add Primary Practice to your home screen" with **Install** / **Not now**. Install → Chrome's prompt. Not now → card gone and stays gone after reload; Profile still offers Install. After installing: card and Profile button replaced by the "Installed" chip. **MANUAL (iPhone Safari):** Install → three-step "Add to Home Screen" sheet, "I've added it" closes it | ☐ |
| 4 | Update banner; deferred during a test | Application → Service workers → "skipWaiting" via a new build, or `pnpm build` again then reload twice | On Library/Profile: "A new version is ready." + **Refresh** (reloads on the new version). During `/attempts/*`: "A new version is ready. It will install after you finish this test." with **no** button; page never reloads mid-test | ☐ |
| 5 | Offline banner (browsing vs in-test wording) + "Waiting to be sent: N" | Network → Offline on Library, then on a running test | Library: "You're offline. Showing what is saved on this phone." Test: "…Keep answering — your answers are saved on this phone…" with "Waiting to be sent: N" once answers are queued | ☐ |
| 6 | Tab bar | Library, History, Profile | Three tabs, active one has `aria-current="page"` and the teal top marker; bar absent on rules / run / hand-in / result / review / time-up | ☐ |
| 7 | Toasts | Trigger "Reminders turned on.", "Back online — N answers sent." | Dark pill above the bottom bar, icon + text, `role="status"`, gone after ~4 s | ☐ |
| 8 | Bottom sheets | Open Install (iOS mode), navigator, run menu, sign-out confirm | Slide up inside the viewport, scrim behind, title + Close button; **Esc** closes; focus returns to the trigger; Tab cycles inside | ☐ |
| 9 | Sign-in + no-access | Signed out → `/sign-in`; sign in with an account that has no role | Logo, copy, **Sign in** → "Signing in…" busy; failure shows the red alert and re-enables the button. No-access screen: "This account does not have access to Quiz yet." with **Sign out** | ☐ |
| 10 | Library | Signed in | Greeting; "You have one test waiting." / "N tests waiting." plural-aware; filter All / To do / Done; cards with chips ("In progress · Reading", "Best N%"); skeleton while loading; Attempts / Average / Best row; another test shows "Finish X first." when one is in progress | ☐ |
| 11 | Start → rules directly | Tap **Start test** | Button shows busy, lands on the first section's rules — no brief screen in between | ☐ |
| 12 | Save offline | On a card tap **Save offline · N MB**, then Network → Offline | Progress "Saving… N%" then "Available offline" chip; Profile lists it with a Remove button (toast "{title} removed from this phone."); Start enabled offline only for saved tests, otherwise disabled with "Needs a connection. Save it for offline use while you're online." | ☐ |
| 13 | Rules screen | Open a section's rules | Eyebrow "{test} · Attempt N", "Before you begin: {Section}", question count · minutes, rule list with icons, **I'm ready** busy → run | ☐ |
| 14 | Run top bar | Start listening | ⋯ menu, section chip, save chip, timer chip (mono); at ≤ 60 s the timer turns red **with a clock icon**; `role="timer"` has an accessible name and does not announce every second (one "One minute left."); progress bar | ☐ |
| 15 | Run bottom bar | Listening vs reading | Listening: no Previous. Reading: Previous (disabled on Q1). Grid button shows `n/N`. Last question: "Finish {Section}" or "Hand in" | ☐ |
| 16 | Listening card | Play a recording | Scene emoji; **Play recording** → "Playing…" (equaliser) → "Played"; "1 play left" copy; answers disabled with "Play the recording to unlock the answers." until played; cannot pause; a failed load shows "The recording didn't load…" | ☐ |
| 17 | Reading passage + choices | Open a reading question; open a multi-select one | Passage in a `<details>` (open on Q1); A–D lettered choices; selected state teal; "Select all that apply." for multi | ☐ |
| 18 | Navigator sheet | Tap the grid button | Per-section grids; answered / current / blank statuses; legend; forward-only note on listening; cells jump only in free-navigation sections | ☐ |
| 19 | Finish-section confirm | Last question of listening → Finish | Sheet "Finish Listening?" with blank count and "You cannot come back to this section." | ☐ |
| 20 | Run menu sheet | Tap ⋯ | "The clock keeps running while you are away." + **Leave test** | ☐ |
| 21 | Save chip states + back-online toast | Answer online; go offline and answer; reconnect | "Saved" → "Saving…" → "Saved"; offline "Waiting to send: N"; reconnect → "Saving…" then toast "Back online — N answers sent." and "Saved" | ☐ |
| 22 | Hand-in | Reading → Hand in | Tiles Answered / Not answered; "Question N is still blank."; minutes-left line; **Hand in** busy → result. Offline: button disabled with "Handing in needs a connection. Your answers are safe on this phone — reconnect and try again." | ☐ |
| 23 | Time-up | Let a section's clock reach 0 (or leave 15 s) | Section variant: "Time's up" + **Continue to {next}**; last section: "Time is up", answered / left-blank tiles, **See your result**. Offline variant (spec §11.2): "We'll score it as soon as you're back online." | ☐ |
| 24 | Result | Finish a test | Ring with %, headline by band ("Well done!" ≥ 80, "Good effort!" ≥ 50, else "Keep practising!"), "Your best score so far." chip when best, per-section breakdown, practice-score notice, **Review answers** | ☐ |
| 25 | Review | Review answers | Outcome chip with icon; passage; choices tagged "Your answer · correct/incorrect", "Correct answer"; explanation block; Prev / Jump / Next; Jump sheet marks ✓ ✕ – | ☐ |
| 26 | History | History tab | Cards with test, attempt, date, score, status chip with icon ("Handed in" / "Time ran out"), **Review answers** / **Result** | ☐ |
| 27 | Profile | Profile tab | Identity; Install row; reminders switch; Version row ("up to date" / "update ready" + Refresh); saved-for-offline list with Remove; **Sign out** confirm sheet; plus the two deviations: language group, and an Admin link for admins only | ☐ |
| 28 | Practice reminders | Toggle the switch | "Allow reminders?" sheet → Allow → browser prompt → "Reminders turned on." and row "Daily at 4:30 pm". Off → "Reminders turned off.". Blocked in browser → disabled row "Blocked in your browser settings." **MANUAL:** real push delivery at the scheduled time on Android Chrome and installed iPhone (iOS 16.4+); iPhone Safari tab shows "On iPhone, install the app first…" | ☐ |
| 29 | Offline mid-test | Start online, go offline, Next / play / answer / Finish a section | Everything advances; answers queue; nothing blocks; reconnect syncs | ☐ |
| 30 | Offline start | Saved test, Network → Offline, **Start test** | Attempt starts and runs; after reconnect the attempt appears in History with the same answers; server shows `origin = 'offline'` | ☐ |
| 31 | Hand-in blocked offline | See row 22 | Disabled with the reason text, `aria-describedby` wired | ☐ |
| 32 | Resume after reload mid-test | Reload during a run (online, then offline with a saved test) | Same question, answers and remaining clock | ☐ |
| 33 | Safe areas, targets, motion, overflow | 390 and 320 passes; reduced motion on | No horizontal overflow; every tappable ≥ 44 px; bars respect `env(safe-area-inset-*)` (**MANUAL on a notched phone**); with reduced motion no spinner/equaliser/skeleton/slide animation yet every state still readable | ☐ |
| 34 | Sign-out purge | Sign out; Application → Cache storage / IndexedDB | `pp-api-v1`, `pp-offline-media-v1` and `pp-offline` are gone; unsynced answers/journal rows are **kept** (spec D8); the reminder subscription is removed (`DELETE /api/me/reminders` in the Network panel, `reminder_subscription` row gone) | ☐ |

## Real-device pass (MANUAL — not automated anywhere)

- [ ] **iPhone (iOS ≥ 16.4), Safari:** Share → Add to Home Screen → launch from the icon → standalone, status bar not clipped (safe-area padding), splash shown, sign-in completes inside the standalone app, reminders switch enabled and a reminder arrives.
- [ ] **Android (Chrome):** install prompt → installed app → airplane mode → saved test runs offline → reconnect syncs → reminder arrives.
- [ ] **Shared device:** sign in as student A, enable reminders and save a test offline, sign out, sign in as student B: B sees none of A's saved tests or cached library, and A's reminders no longer arrive on this phone.
- [ ] **Docker image:** `docker compose build api` then run the image with and without `VAPID_PUBLIC_KEY`; `curl -s localhost:3000/ | grep -c __VITE_` prints `0` in both cases and `docker-entrypoint.sh` exits 0 (the unit test for it is skipped on macOS).

## Automated gates (must be green before sign-off)

`pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm format` · `pnpm --filter @pp/app exec vitest run test/pwa-build-output.test.ts` · `pnpm lint:api`
````

- [ ] **Step 4: Update the README, docs index and library-adoption**

`README.md` — insert after the "What is this project?" list, before "Packages":

```markdown
## 📱 Installable app (PWA)

The student app installs to a phone's home screen and keeps working when the connection drops:

- **Install** — Chrome/Android shows an install card on the Library; on iPhone, Share → Add to Home Screen (Profile has the steps).
- **Offline** — the app shell, fonts and the library load with no network; "Save offline" stores a whole test (questions and recordings) on the phone, and a saved test can be started and finished offline. Answers and navigation are written to the device first and sent when the connection returns; handing in needs a connection.
- **Updates** — a "new version is ready" banner; a running test is never reloaded under the student.
- **Reminders** — optional daily Web Push reminder (see "Practice reminders" below).
- **Shared phones** — signing out clears cached data and saved tests for that student; unsent answers are kept.

Design: [`docs/superpowers/specs/2026-11-22-quiz-pwa-mobile-design.md`](docs/superpowers/specs/2026-11-22-quiz-pwa-mobile-design.md) · clickable prototype: `docs/prototype/pwa-mobile.html` · verification: [`docs/superpowers/plans/2026-11-22-quiz-pwa-mobile-acceptance.md`](docs/superpowers/plans/2026-11-22-quiz-pwa-mobile-acceptance.md).
The service worker is disabled under `pnpm dev`; test install/offline/update against a production build (`pnpm build`, then serve the app from the server with `SPA_ROOT`).
```

`docs/README.md` — extend the `prototype/` bullet to: "a standalone HTML prototype of the test-runner UI (`index.html`) and the installable mobile PWA prototype (`pwa-mobile.html`)."

`docs/architecture/library-adoption.md` — directly under the paragraph that starts `**\`vite-preset-pwa\` is not a nice-to-have here.**`, add:

```markdown
**Status (2026-11-22): adopted and configured** (`docs/superpowers/specs/2026-11-22-quiz-pwa-mobile-design.md`, D1). The preset supplies the manifest and base Workbox options through `vite-plugin-pwa`'s `generateSW`; its default `runtimeCaching` (every `/api` GET `NetworkFirst`) is deliberately **replaced** by an allow-list, because this API serves play-capped media and per-student data that a shared device must not leak. Registration is `prompt`, not `autoUpdate`, so a student is never reloaded mid-test.
```

- [ ] **Step 5: Remove the dead code, proven by `rg`**

Prove nothing imports the retired drawer and sheet:

```bash
rg -n "DeviceSheet|AppMenu|MenuStudent" packages/app/src packages/app/test --glob '!**/AppMenu.tsx' --glob '!**/AppMenu.test.tsx' --glob '!**/DeviceSheet.tsx'
```
Expected: **no output**. If it lists files, those tasks (10, 13) did not finish the migration. For a leftover `MenuStudent` type only, move it instead of keeping `AppMenu`: add `export type MenuStudent = Pick<Student, "displayName" | "email">` to `packages/app/src/lib/api-types.ts`, repoint the importers, and re-run the `rg`. If a real component still renders `AppMenu` or `DeviceSheet`, stop: that screen is not at parity yet — fix it in its own task, not here.

Then delete:

```bash
git rm -f --ignore-unmatch packages/app/src/components/AppMenu.tsx packages/app/src/components/AppMenu.test.tsx packages/app/src/components/DeviceSheet.tsx   # Task 13 normally already removed them; this is idempotent
```

Find the CSS rules nothing uses any more (class names that appear only in `index.css`):

```bash
for c in device-sheet-overlay device-sheet-content device-sheet-close device-drawer-panel device-drawer-student device-drawer-avatar device-drawer-actions device-drawer-footer device-drawer-languages device-drawer-sign-out device-language-button device-drawer question-panel question-panel-groups question-panel-note question-group question-grid question-legend np-cell np-key pip choice-dot; do
  n=$(rg -l --fixed-strings -- "$c" packages/app/src --glob '!index.css' | wc -l | tr -d ' ')
  echo "$n  $c"
done
```
Delete from `packages/app/src/index.css` exactly the rule blocks whose count is `0` (a `0` for `device-drawer` also covers `.device-drawer-*` selectors beginning with it; check the printed list rather than assuming). Keep any class with a non-zero count — Task 10 may have kept `question-panel`/`np-*` for the navigator.

Remove locale keys nothing reads:

```bash
for k in $(node -e 'console.log(Object.keys(require("./packages/app/src/locales/en/runner.json")).filter(k=>k.startsWith("menu.")).join(" "))'); do
  n=$(rg -l --fixed-strings "\"$k\"" packages/app/src --glob '!locales/**' | wc -l | tr -d ' ')
  echo "$n  $k"
done
```
For each key printing `0`, delete it from all six `runner.json` files (keep them in parity — `locale-parity.test.ts` enforces it) with a one-off node script modelled on Task 25 Step 13 that `delete json[key]` for each, then `pnpm exec prettier --write packages/app/src/locales --log-level warn`.

Run: `pnpm lint && pnpm typecheck && pnpm --filter @pp/app test`
Expected: green; `git status` shows only deletions plus the CSS/locale edits.

- [ ] **Step 6: Final gates**

Run, in this order, and paste each result into the PR description:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm format
pnpm --filter @pp/app exec vitest run test/pwa-build-output.test.ts
pnpm lint:api
```
Expected: every command exits 0. Then run the acceptance checklist end to end (both viewport passes and the MANUAL real-device section), mark every row, and attach the screenshots. Any ❌ is a defect in the task that owns the row (the Task column of spec §3), not a reason to edit the checklist.

- [ ] **Step 7: Commit**

```bash
git add README.md docs/README.md docs/architecture/library-adoption.md docs/superpowers/plans/2026-11-22-quiz-pwa-mobile-acceptance.md packages/app
git commit -m "docs: PWA acceptance checklist, README and adoption notes; remove retired drawer code"
```

---
