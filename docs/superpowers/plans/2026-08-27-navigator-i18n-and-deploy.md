# Navigator, i18n and Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app genuinely usable by one child on one iPad, unsupervised, in any of six languages, deployed as a two-service Docker stack — the collapsible question navigator and app menu, a real (gated, not decorative) i18n sweep across all six locales, iPad-specific touch/safe-area/orientation polish, and the production deploy that serves the built SPA alongside the API.

**Architecture:** `packages/app` (Vite + React 19, `@liam-workspace/browser-react-ui`) gains two `sheet`-based panels — the question navigator (right) and the app menu (left) — sharing one open-panel state so only one is ever open, exactly as the prototype's `closePanels()`/`openPanel()` pair enforces by hand. `packages/server` gains a global `/api` prefix (required by the OpenAPI contract's `servers: [{url: /api}]`, never actually wired by plan 2) so it can serve the built SPA at `/` and the REST API at `/api` from the same origin and the same Docker image.

**Tech Stack:** React 19 · Vite · TypeScript 6 (ESM, `nodenext`) · Tailwind v4 + Radix (`@liam-workspace/browser-react-ui`) · `i18next` / `react-i18next` · Vitest 4 · `@testing-library/react` · `@liam-workspace/node-i18n-lint` · NestJS 11 · Docker

**Spec:** `docs/superpowers/specs/2026-08-25-toefl-primary-fork-design.md` (phase 6 of §8: "Navigator, menu, i18n sweep, iPad polish, Docker deploy")

**What this plan assumes exists.** Plans 1–5 have already run: `@pp/common`, `@pp/db`, `@pp/server` (session, catalog, attempts, durable writes, submit/grade/result/review/history, admin import/publish/export, media, seed) and `packages/app` (Vite + React 19, `@liam-workspace/browser-react-ui` components, the listening and reading screens, `packages/web`/`packages/socket` deleted). **None of that code exists in this repository yet** — at the time this plan was written, `packages/app` does not exist and `pnpm-workspace.yaml` still lists only `common`/`db`/`server`. Every path this plan names under `packages/app` is therefore a prediction grounded in the spec (§2's harvest list: `vite.config.ts`, tsconfigs, the TanStack router plugin, `i18n.ts`, `QuestionMedia.tsx`, `branding.ts`) and in Vite/`react-i18next` convention, not a file this plan's author read. **Before Task 1, grep for the actual file** (e.g. `find packages/app/src -iname "i18n.ts"`) and if a name or shape differs from what a step assumes, use the real one and say so in your report — the props/types contracts below (grounded in `docs/api/openapi.yaml`, which is real) are what must not drift; the exact host file for a CSS rule or the exact name of a shared layout component is not.

## Global Constraints

- **`pnpm lint`, `pnpm format`, `pnpm typecheck`, `pnpm test` all exit 0 at the end of every task.** Never `git add -A`, never a commit command, in any step.
- **`node-i18n-lint` scans `.tsx`/`.jsx` only** (never `.test.tsx`), and flags exactly three shapes: JSX text, a string literal on a `USER_FACING_ATTRS` attribute (`placeholder`, `title`, `alt`, `aria-label`, `aria-placeholder`, `aria-description`, `label`), and a bare string literal in a JSX expression (`{'Save'}`). It filters out empty strings, punctuation-only strings, URLs, ≤2-char identifiers and CSS-selector-shaped strings via `isTranslatable`. **It does not check that a translation key exists in all six locale files** — a key present only in `en.json` still passes it, because i18next's `fallbackLng: "en"` silently serves the English string in every other locale. Task 5 adds a second gate for exactly that gap.
- **The `sheet` primitive is `Sheet`, `SheetTrigger`, `SheetClose`, `SheetContent` from `@liam-workspace/browser-react-ui`** (verified in the installed package's `src/sheet.tsx`). `SheetContent` renders through the same underlying `radix-ui` `Dialog.Content` that `DialogTitle`/`DialogDescription` (also exported from the same package's barrel, via `dialog.tsx`) attach to — so a `<DialogTitle>` placed inside `<SheetContent>` satisfies Radix's accessibility requirement even though `sheet.tsx` exports no `SheetTitle` of its own. Every `SheetContent` in this plan carries a `DialogTitle`; skipping it is not a style choice, it is the thing that stops Radix's dev-console warning ("`DialogContent` requires a `DialogTitle`") and, more importantly, stops a screen reader from announcing an unlabelled dialog.
- **Touch targets.** `browser-react-ui`'s largest icon-button size token is `icon-lg` at `size-10` (40px) — verified in the installed package's `button.tsx` `cva` config. Apple's Human Interface Guidelines minimum is 44×44pt. Tailwind's spacing scale is 4px per unit, so `size-11` = 44px exactly — every interactive element this plan creates for the runner chrome uses `size-11` explicitly rather than the kit's default sizes, which are all one step short.
- **`/api` is not decorative.** `docs/api/openapi.yaml` declares `servers: [{ url: /api }]` and `cmsPwaOptions`'s `runtimeCaching` (from `@liam-workspace/vite-preset-pwa`, already adopted) matches `url.pathname.startsWith('/api')` for its `NetworkFirst` cache rule. Nothing in plan 2's thirteen tasks calls `app.setGlobalPrefix`. Task 8 adds it — until then every earlier plan's e2e tests hit bare paths (`/session`, `/tests`, …) and keep passing, because supertest talks to the Nest app directly and never sees a reverse proxy or a `servers:` block. Confirm this is still true when you start Task 8 (`grep -rn "setGlobalPrefix" packages/server/src`) before assuming the prefix is missing.
- **pnpm does not hoist transitive dependencies.** `@nestjs/platform-express` depends on `express`, but `packages/server`'s own `node_modules` does not get an `express` entry from that alone under pnpm's strict linking — importing it directly (Task 8 does) requires declaring it explicitly.

## File Structure

| File                                                                    | Responsibility                                                              |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `packages/app/src/features/runner/navigator-state.ts`                   | Task 1: pure cell-state derivation, no React                                |
| `packages/app/src/features/runner/QuestionNavigator.tsx`                | Task 2: the right-hand `sheet`                                              |
| `packages/app/src/features/runner/AppMenu.tsx`                          | Task 3: the left-hand `sheet`                                               |
| `packages/app/src/features/runner/usePanelState.ts`, `RunnerPanels.tsx` | Task 4: shared open-panel state, mutual exclusivity                         |
| `package.json` (root)                                                   | Task 5: `lint:i18n` stops swallowing its exit code; Task 6: it joins `lint` |
| `packages/app/test/locale-parity.test.ts`                               | Task 5: the gate `node-i18n-lint` cannot provide                            |
| `packages/app/src/locales/{de,en,es,fr,it,ja}/runner.json`              | Task 6: the sweep's new namespace                                           |
| `packages/app/index.html`, `src/index.css`                              | Task 7: viewport, safe-area, touch-action                                   |
| `packages/server/src/main.ts`, `src/config.ts`, `package.json`          | Task 8: `/api` prefix, SPA serving                                          |
| `Dockerfile`, `compose.yml`                                             | Task 8: build and serve `packages/app` from the `api` image                 |

---

### Task 1: The navigator's cell state, as a pure function

The prototype's `NAV` object (`docs/prototype/index.html`, lines 3118–3167) already encodes the rule this task ports: a `forward_only` section's cells are **all** disabled while the section is open or closed — not just the ones already passed — because the navigator only ever _shows_ position in that mode, never changes it; a `free` section's cells stay clickable throughout; and review mode disables nothing and colours by outcome instead of progress. Server-side, `docs/api/openapi.yaml`'s `/attempts/{id}/position` route says the same thing from the other end: "Accepted where `navigation` is `free` and refused where it is `forward_only`, from the same route — the navigator's disabled cells are a rendering of what this call would reject." This task is that rendering, written once, unit-tested, and consumed by Task 2 rather than re-derived inside JSX.

**Files:**

- Create: `packages/app/src/features/runner/navigator-state.ts`
- Create: `packages/app/src/features/runner/navigator-state.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks in this plan. Grounded directly in `docs/api/openapi.yaml`'s `RunnerSection` (`id`, `type: SectionType`, `status: pending|open|closed`, `navigation: NavigationMode`), `RunnerEnvelope` (`unansweredOrdinals`, `currentSectionId`, `currentQuestionId`) and `ReviewItem` (`outcome: correct|incorrect|unanswered`) schemas. `SectionType` is `listening|reading|vocabulary|grammar`; `NavigationMode` is `free|forward_only` — both verified against `openapi.yaml` lines 1116–1123, not assumed.
- Produces:

  ```ts
  export type SectionKind = "listening" | "reading" | "vocabulary" | "grammar"
  export type NavigationMode = "free" | "forward_only"
  export type SectionStatus = "pending" | "open" | "closed"
  export type NavigatorCellStatus =
    | "current"
    | "answered"
    | "blank"
    | "correct"
    | "incorrect"

  export interface NavigatorCell {
    questionId: string
    ordinal: number
    status: NavigatorCellStatus
    disabled: boolean
  }

  export interface NavigatorGroup {
    sectionId: string
    sectionType: SectionKind
    cells: NavigatorCell[]
  }

  export interface NavigatorSource {
    mode: "runner" | "review"
    currentQuestionId: string | null
    sections: {
      id: string
      type: SectionKind
      navigation: NavigationMode
      status: SectionStatus
      questions: { id: string; ordinal: number }[]
    }[]
    answeredQuestionIds: ReadonlySet<string>
    outcomeByQuestionId?: ReadonlyMap<
      string,
      "correct" | "incorrect" | "unanswered"
    >
  }

  export function buildNavigatorGroups(
    source: NavigatorSource,
  ): NavigatorGroup[]
  ```

  Task 2 consumes `buildNavigatorGroups` and nothing else from this file — the component never re-implements the disabled/status rules.

- [ ] **Step 1: Write the failing tests — seven cases, each independently failable**

  `packages/app/src/features/runner/navigator-state.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest"
  import {
    buildNavigatorGroups,
    type NavigatorSource,
  } from "./navigator-state.js"

  function runnerSource(
    overrides: Partial<NavigatorSource> = {},
  ): NavigatorSource {
    return {
      mode: "runner",
      currentQuestionId: "q2",
      sections: [
        {
          id: "sec-listen",
          type: "listening",
          navigation: "forward_only",
          status: "open",
          questions: [
            { id: "q1", ordinal: 1 },
            { id: "q2", ordinal: 2 },
            { id: "q3", ordinal: 3 },
          ],
        },
      ],
      answeredQuestionIds: new Set(["q1"]),
      ...overrides,
    }
  }

  describe("buildNavigatorGroups", () => {
    it("marks the current question as current even in a forward_only section", () => {
      const [group] = buildNavigatorGroups(runnerSource())
      expect(group.cells[1]).toMatchObject({
        questionId: "q2",
        status: "current",
      })
    })

    it("disables every cell in an open forward_only section, not just the ones already passed", () => {
      const [group] = buildNavigatorGroups(runnerSource())
      expect(group.cells.every((c) => c.disabled)).toBe(true)
    })

    it("disables every cell in a CLOSED forward_only section too", () => {
      const source = runnerSource({
        sections: [
          {
            ...runnerSource().sections[0],
            status: "closed",
          },
        ],
      })
      const [group] = buildNavigatorGroups(source)
      expect(group.cells.every((c) => c.disabled)).toBe(true)
    })

    it("keeps a free section's cells enabled after a forward_only section closes", () => {
      const source = runnerSource({
        currentQuestionId: "q5",
        sections: [
          {
            id: "sec-listen",
            type: "listening",
            navigation: "forward_only",
            status: "closed",
            questions: [{ id: "q1", ordinal: 1 }],
          },
          {
            id: "sec-read",
            type: "reading",
            navigation: "free",
            status: "open",
            questions: [{ id: "q5", ordinal: 5 }],
          },
        ],
      })
      const [, reading] = buildNavigatorGroups(source)
      expect(reading.cells.every((c) => !c.disabled)).toBe(true)
    })

    it("disables a pending section's cells even when its navigation mode is free", () => {
      const source = runnerSource({
        sections: [
          {
            id: "sec-read",
            type: "reading",
            navigation: "free",
            status: "pending",
            questions: [{ id: "q9", ordinal: 9 }],
          },
        ],
      })
      const [group] = buildNavigatorGroups(source)
      expect(group.cells[0].disabled).toBe(true)
    })

    it("colours review cells by outcome and never disables them", () => {
      const source: NavigatorSource = {
        mode: "review",
        currentQuestionId: null,
        sections: [
          {
            id: "sec-read",
            type: "reading",
            navigation: "free",
            status: "closed",
            questions: [
              { id: "q1", ordinal: 1 },
              { id: "q2", ordinal: 2 },
            ],
          },
        ],
        answeredQuestionIds: new Set(["q1", "q2"]),
        outcomeByQuestionId: new Map([
          ["q1", "correct"],
          ["q2", "incorrect"],
        ]),
      }
      const [group] = buildNavigatorGroups(source)
      expect(group.cells).toEqual([
        { questionId: "q1", ordinal: 1, status: "correct", disabled: false },
        { questionId: "q2", ordinal: 2, status: "incorrect", disabled: false },
      ])
    })

    it("marks a question with no recorded response as blank", () => {
      const source = runnerSource({
        currentQuestionId: "q1",
        answeredQuestionIds: new Set(),
      })
      const [group] = buildNavigatorGroups(source)
      expect(group.cells[2]).toMatchObject({
        questionId: "q3",
        status: "blank",
      })
    })
  })
  ```

- [ ] **Step 2: Run it to verify it fails**

  Run: `pnpm --filter @pp/app test navigator-state`
  Expected: FAIL — `Cannot find module './navigator-state.js'`. If `@pp/app` is not the package name plan 3 actually used, find the real one (`grep '"name"' packages/app/package.json`) and use it for every `pnpm --filter` command in this plan.

- [ ] **Step 3: Implement**

  ```ts
  export function buildNavigatorGroups(
    source: NavigatorSource,
  ): NavigatorGroup[] {
    return source.sections.map((section) => ({
      sectionId: section.id,
      sectionType: section.type,
      cells: section.questions.map((q) => {
        const outcome = source.outcomeByQuestionId?.get(q.id)
        const status: NavigatorCellStatus =
          source.mode === "review"
            ? outcome === "correct" || outcome === "incorrect"
              ? outcome
              : "blank"
            : q.id === source.currentQuestionId
              ? "current"
              : source.answeredQuestionIds.has(q.id)
                ? "answered"
                : "blank"
        const disabled =
          source.mode === "review"
            ? false
            : section.status === "pending" ||
              section.navigation === "forward_only"
        return { questionId: q.id, ordinal: q.ordinal, status, disabled }
      }),
    }))
  }
  ```

- [ ] **Step 4: Run, gates**

  Run: `pnpm --filter @pp/app test navigator-state` → PASS, all seven.

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

  Do NOT run `git add` and do NOT commit. Leave the work uncommitted; the reviewer stages by explicit path and writes the commit.

---

### Task 2: `QuestionNavigator` — the right-hand sheet

**Files:**

- Create: `packages/app/src/features/runner/QuestionNavigator.tsx`
- Create: `packages/app/src/features/runner/QuestionNavigator.test.tsx`
- Create: `packages/app/src/locales/en/runner.json` (grown further in Task 6; this task adds only the keys it uses)

**Interfaces:**

- Consumes: `buildNavigatorGroups`, `NavigatorSource` (Task 1); `Sheet`, `SheetContent`, `DialogTitle`, `DialogDescription` from `@liam-workspace/browser-react-ui`; `useTranslation` from `react-i18next` against a new `runner` namespace.
- Produces:

  ```ts
  export interface QuestionNavigatorProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    source: NavigatorSource
    answeredCount: number
    totalCount: number
    onNavigate: (sectionId: string, questionId: string) => void
  }
  export function QuestionNavigator(props: QuestionNavigatorProps): JSX.Element
  ```

  `answeredCount`/`totalCount` are passed in rather than derived here, because the runner envelope already carries `answeredCount` (openapi `RunnerEnvelope.answeredCount`) — recomputing it from `answeredQuestionIds.size` would be a second source of truth for the same number.

**Test seam.** `react-i18next`'s `useTranslation` is mocked with a real, small resource bundle rather than an identity function — an identity mock (`t: (k) => k`) would pass even if a key were misspelled, since the raw key and its "translation" would be indistinguishable. Wrap renders in a real `I18nextProvider` backed by `i18next.createInstance()` initialized in-memory with just the keys this component uses (Step 1), not the full six-locale tree — that tree is exercised by Task 5's parity test and Task 6's sweep, not by component tests.

- [ ] **Step 1: The test harness and the failing tests**

  `packages/app/src/features/runner/QuestionNavigator.test.tsx`:

  ```tsx
  import { render, screen, within } from "@testing-library/react"
  import userEvent from "@testing-library/user-event"
  import i18next from "i18next"
  import { I18nextProvider, initReactI18next } from "react-i18next"
  import { describe, expect, it, vi } from "vitest"
  import { QuestionNavigator } from "./QuestionNavigator.js"
  import type { NavigatorSource } from "./navigator-state.js"

  const i18n = i18next.createInstance()
  await i18n.use(initReactI18next).init({
    lng: "en",
    resources: {
      en: {
        runner: {
          navigator: {
            title: "Questions",
            reviewTitle: "Jump to a question",
            progressSubtitle: "{{answered}} of {{total}} answered",
            sectionListening: "Listening",
            sectionReading: "Reading",
            questionLabel: "Question {{ordinal}}",
          },
        },
      },
    },
  })

  function renderNavigator(source: NavigatorSource, onNavigate = vi.fn()) {
    render(
      <I18nextProvider i18n={i18n}>
        <QuestionNavigator
          open
          onOpenChange={vi.fn()}
          source={source}
          answeredCount={1}
          totalCount={3}
          onNavigate={onNavigate}
        />
      </I18nextProvider>,
    )
    return { onNavigate }
  }

  const forwardOnlySource: NavigatorSource = {
    mode: "runner",
    currentQuestionId: "q2",
    sections: [
      {
        id: "sec-listen",
        type: "listening",
        navigation: "forward_only",
        status: "open",
        questions: [
          { id: "q1", ordinal: 1 },
          { id: "q2", ordinal: 2 },
          { id: "q3", ordinal: 3 },
        ],
      },
    ],
    answeredQuestionIds: new Set(["q1"]),
  }

  describe("QuestionNavigator", () => {
    it("renders a dialog labelled by a visible title", () => {
      renderNavigator(forwardOnlySource)
      expect(
        screen.getByRole("dialog", { name: "Questions" }),
      ).toBeInTheDocument()
    })

    it("disables every cell in a forward_only section", () => {
      renderNavigator(forwardOnlySource)
      const dialog = screen.getByRole("dialog")
      for (const button of within(dialog).getAllByRole("button")) {
        expect(button).toBeDisabled()
      }
    })

    it("does not call onNavigate when a disabled cell is clicked", async () => {
      const { onNavigate } = renderNavigator(forwardOnlySource)
      await userEvent.click(screen.getByRole("button", { name: "Question 2" }))
      expect(onNavigate).not.toHaveBeenCalled()
    })

    it("calls onNavigate with the section and question id when an enabled cell is clicked", async () => {
      const freeSource: NavigatorSource = {
        ...forwardOnlySource,
        sections: [{ ...forwardOnlySource.sections[0], navigation: "free" }],
      }
      const { onNavigate } = renderNavigator(freeSource)
      await userEvent.click(screen.getByRole("button", { name: "Question 3" }))
      expect(onNavigate).toHaveBeenCalledWith("sec-listen", "q3")
    })

    it("shows the progress subtitle with interpolated counts in runner mode", () => {
      renderNavigator(forwardOnlySource)
      expect(screen.getByText("1 of 3 answered")).toBeInTheDocument()
    })
  })
  ```

  If `@testing-library/user-event` is not yet a devDependency of `packages/app`, add it — it is the standard companion to `@testing-library/react` for click simulation and is not a new library-adoption decision (it is a testing utility, not application code, same category as `supertest` in plan 2).

- [ ] **Step 2: Run it to verify it fails**

  Run: `pnpm --filter @pp/app test QuestionNavigator`
  Expected: FAIL — `Cannot find module './QuestionNavigator.js'`.

- [ ] **Step 3: `runner.json` (English only — this task's keys)**

  `packages/app/src/locales/en/runner.json`:

  ```json
  {
    "navigator": {
      "title": "Questions",
      "reviewTitle": "Jump to a question",
      "progressSubtitle": "{{answered}} of {{total}} answered",
      "reviewSubtitle": "Tap any question to see your answer",
      "sectionListening": "Listening",
      "sectionReading": "Reading",
      "sectionVocabulary": "Vocabulary",
      "sectionGrammar": "Grammar",
      "sectionOther": "Other",
      "questionLabel": "Question {{ordinal}}",
      "legendAnswered": "Answered",
      "legendCurrent": "You are here",
      "legendBlank": "Not answered",
      "legendCorrect": "Correct",
      "legendIncorrect": "Wrong",
      "forwardOnlyNote": "This section runs forward only. The navigator shows where you are but cannot move you.",
      "openLabel": "Open the question navigator"
    }
  }
  ```

  If the harvested `packages/app/src/i18n.ts` globs `./locales/*/*.json` the way `packages/web/src/i18n.ts` does (verified: `import.meta.glob("./locales/*/*.json", { eager: true })`), this file is picked up automatically as the `runner` namespace with no change to `i18n.ts` — confirm the glob pattern matches before assuming this.

- [ ] **Step 4: Implement the component**

  `packages/app/src/features/runner/QuestionNavigator.tsx`:

  ```tsx
  import {
    DialogDescription,
    DialogTitle,
    Sheet,
    SheetContent,
  } from "@liam-workspace/browser-react-ui"
  import { useTranslation } from "react-i18next"
  import {
    buildNavigatorGroups,
    type NavigatorSource,
    type SectionKind,
  } from "./navigator-state.js"

  export interface QuestionNavigatorProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    source: NavigatorSource
    answeredCount: number
    totalCount: number
    onNavigate: (sectionId: string, questionId: string) => void
  }

  const SECTION_LABEL_KEY: Record<SectionKind, string> = {
    listening: "navigator.sectionListening",
    reading: "navigator.sectionReading",
    vocabulary: "navigator.sectionVocabulary",
    grammar: "navigator.sectionGrammar",
  }

  export function QuestionNavigator({
    open,
    onOpenChange,
    source,
    answeredCount,
    totalCount,
    onNavigate,
  }: QuestionNavigatorProps): JSX.Element {
    const { t } = useTranslation("runner")
    const groups = buildNavigatorGroups(source)

    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="flex flex-col gap-3">
          <DialogTitle>
            {source.mode === "review"
              ? t("navigator.reviewTitle")
              : t("navigator.title")}
          </DialogTitle>
          <DialogDescription>
            {source.mode === "review"
              ? t("navigator.reviewSubtitle")
              : t("navigator.progressSubtitle", {
                  answered: answeredCount,
                  total: totalCount,
                })}
          </DialogDescription>
          <div className="-mx-1 flex-1 overflow-y-auto px-1">
            {groups.map((group) => (
              <div key={group.sectionId} className="mb-4">
                <div className="mb-2 text-[10.5px] font-extrabold tracking-wide uppercase">
                  {t(
                    SECTION_LABEL_KEY[group.sectionType] ??
                      "navigator.sectionOther",
                  )}
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {group.cells.map((cell) => (
                    <button
                      key={cell.questionId}
                      type="button"
                      disabled={cell.disabled}
                      aria-current={
                        cell.status === "current" ? "true" : undefined
                      }
                      aria-label={t("navigator.questionLabel", {
                        ordinal: cell.ordinal,
                      })}
                      data-status={cell.status}
                      className="size-11 touch-manipulation rounded-md border text-sm font-bold tabular-nums select-none disabled:cursor-not-allowed disabled:opacity-55"
                      onClick={() => {
                        onNavigate(group.sectionId, cell.questionId)
                      }}
                    >
                      {cell.ordinal}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {source.mode === "runner" &&
          source.sections.some((s) => s.navigation === "forward_only") ? (
            <p className="rounded-md bg-[var(--d-surface,theme(colors.slate.100))] p-2 text-xs">
              {t("navigator.forwardOnlyNote")}
            </p>
          ) : null}
        </SheetContent>
      </Sheet>
    )
  }
  ```

  `size-11` (not the kit's default button sizes) per the Global Constraints touch-target note — this is where that arithmetic is spent.

- [ ] **Step 5: Run, gates**

  Run: `pnpm --filter @pp/app test QuestionNavigator` → PASS, all five.

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

  Do NOT run `git add` and do NOT commit.

---

### Task 3: `AppMenu` — the left-hand sheet

Matches the prototype's `#drawer` (`docs/prototype/index.html`, lines 2409–2466): profile, test library, attempt history, leave-test with a note whose wording depends on whether the clock has started, a language switcher, sign out.

**Files:**

- Create: `packages/app/src/features/runner/AppMenu.tsx`
- Create: `packages/app/src/features/runner/AppMenu.test.tsx`
- Modify: `packages/app/src/locales/en/runner.json` (add the `menu` namespace object)

**Interfaces:**

- Consumes: `useAuth` from `@liam-workspace/browser-react-auth` — verified signature `useAuth<User>(): { user: User | undefined; signOut(): Promise<void>; … }` (installed package's `auth-context.tsx`). Plan 3 is assumed to have instantiated `AuthProvider<Student>`, so `user` is typed `Student | undefined`; if plan 3 named the generic differently, adjust the import but keep the shape.
- Produces:

  ```ts
  export interface AppMenuProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    inTest: boolean
    clockStarted: boolean
    onGoLibrary: () => void
    onGoHistory: () => void
    onLeaveTest: () => void
  }
  export function AppMenu(props: AppMenuProps): JSX.Element
  ```

**Test seam.** Same `I18nextProvider` pattern as Task 2. `useAuth` is substituted with `vi.mock("@liam-workspace/browser-react-auth", () => ({ useAuth: () => ({ user: { displayName: "Tom", email: "tom@example.com", level: "primary-step-1" }, signOut: vi.fn() }) }))` — a module mock, not a provider wrapper, because `AuthProvider` needs a real `BrowserAuthClient` this test has no reason to construct.

- [ ] **Step 1: Write the failing tests — six cases**

  `packages/app/src/features/runner/AppMenu.test.tsx`:

  ```tsx
  import { render, screen } from "@testing-library/react"
  import userEvent from "@testing-library/user-event"
  import i18next from "i18next"
  import { I18nextProvider, initReactI18next } from "react-i18next"
  import { describe, expect, it, vi } from "vitest"
  import { AppMenu } from "./AppMenu.js"

  const signOut = vi.fn()
  vi.mock("@liam-workspace/browser-react-auth", () => ({
    useAuth: () => ({
      user: {
        displayName: "Tom",
        email: "tom@example.com",
        level: "primary-step-1",
      },
      signOut,
    }),
  }))

  const i18n = i18next.createInstance()
  await i18n.use(initReactI18next).init({
    lng: "en",
    resources: {
      en: {
        runner: {
          menu: {
            title: "Menu",
            library: "Test library",
            history: "Attempt history",
            leaveTest: "Leave test",
            leaveTestNoteBeforeStart:
              "Nothing has started yet. The clock begins when you tap I'm ready.",
            leaveTestNoteRunning: "The clock keeps running while you are away.",
            language: "Language",
            signOut: "Sign out",
          },
        },
      },
    },
  })

  function renderMenu(props: Partial<Parameters<typeof AppMenu>[0]> = {}) {
    const handlers = {
      onGoLibrary: vi.fn(),
      onGoHistory: vi.fn(),
      onLeaveTest: vi.fn(),
    }
    render(
      <I18nextProvider i18n={i18n}>
        <AppMenu
          open
          onOpenChange={vi.fn()}
          inTest={false}
          clockStarted={false}
          {...handlers}
          {...props}
        />
      </I18nextProvider>,
    )
    return handlers
  }

  describe("AppMenu", () => {
    it("shows the signed-in student's display name", () => {
      renderMenu()
      expect(screen.getByText("Tom")).toBeInTheDocument()
    })

    it("hides Leave test outside an attempt", () => {
      renderMenu({ inTest: false })
      expect(
        screen.queryByRole("button", { name: "Leave test" }),
      ).not.toBeInTheDocument()
    })

    it("shows the pre-clock note when in a test but the clock has not started", () => {
      renderMenu({ inTest: true, clockStarted: false })
      expect(screen.getByText(/clock begins when you tap/i)).toBeInTheDocument()
    })

    it("shows the running-clock note once the clock has started", () => {
      renderMenu({ inTest: true, clockStarted: true })
      expect(
        screen.getByText(/clock keeps running while you are away/i),
      ).toBeInTheDocument()
    })

    it("calls onGoLibrary when Test library is clicked", async () => {
      const handlers = renderMenu()
      await userEvent.click(
        screen.getByRole("button", { name: "Test library" }),
      )
      expect(handlers.onGoLibrary).toHaveBeenCalledOnce()
    })

    it("calls signOut when Sign out is clicked", async () => {
      renderMenu()
      await userEvent.click(screen.getByRole("button", { name: "Sign out" }))
      expect(signOut).toHaveBeenCalledOnce()
    })
  })
  ```

- [ ] **Step 2: Run it to verify it fails**

  Run: `pnpm --filter @pp/app test AppMenu`
  Expected: FAIL — `Cannot find module './AppMenu.js'`.

- [ ] **Step 3: Add the `menu` namespace to `runner.json` (English)**

  Extend `packages/app/src/locales/en/runner.json`'s top level with:

  ```json
  {
    "menu": {
      "title": "Menu",
      "library": "Test library",
      "history": "Attempt history",
      "leaveTest": "Leave test",
      "leaveTestNoteBeforeStart": "Nothing has started yet. The clock begins when you tap I'm ready.",
      "leaveTestNoteRunning": "The clock keeps running while you are away.",
      "language": "Language",
      "signOut": "Sign out",
      "openLabel": "Open menu"
    }
  }
  ```

- [ ] **Step 4: Implement**

  `packages/app/src/features/runner/AppMenu.tsx`:

  ```tsx
  import {
    DialogTitle,
    Sheet,
    SheetContent,
  } from "@liam-workspace/browser-react-ui"
  import { useAuth } from "@liam-workspace/browser-react-auth"
  import i18next from "i18next"
  import { useTranslation } from "react-i18next"
  import type { Student } from "@pp/common"

  export interface AppMenuProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    inTest: boolean
    clockStarted: boolean
    onGoLibrary: () => void
    onGoHistory: () => void
    onLeaveTest: () => void
  }

  const LANGUAGES = ["en", "fr", "de", "es", "it", "ja"] as const

  export function AppMenu({
    open,
    onOpenChange,
    inTest,
    clockStarted,
    onGoLibrary,
    onGoHistory,
    onLeaveTest,
  }: AppMenuProps): JSX.Element {
    const { t } = useTranslation("runner")
    const { user, signOut } = useAuth<Student>()

    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="left"
          aria-describedby={undefined}
          className="flex flex-col gap-1"
        >
          <DialogTitle>{t("menu.title")}</DialogTitle>
          <div className="mb-2 flex items-center gap-2 border-b pb-3">
            <span className="flex size-9 items-center justify-center rounded-full bg-teal-700 font-bold text-white">
              {user?.displayName?.[0] ?? "?"}
            </span>
            <span className="min-w-0">
              <b className="block truncate text-sm">{user?.displayName}</b>
              <span className="block truncate text-xs opacity-70">
                {user?.email}
              </span>
            </span>
          </div>

          <button
            type="button"
            className="size-11 rounded-md px-3 text-left text-sm font-semibold"
            onClick={onGoLibrary}
          >
            {t("menu.library")}
          </button>
          <button
            type="button"
            className="size-11 rounded-md px-3 text-left text-sm font-semibold"
            onClick={onGoHistory}
          >
            {t("menu.history")}
          </button>

          {inTest ? (
            <>
              <hr className="my-2" />
              <button
                type="button"
                className="size-11 rounded-md px-3 text-left text-sm font-semibold"
                onClick={onLeaveTest}
              >
                {t("menu.leaveTest")}
              </button>
              <p className="px-3 text-xs opacity-70">
                {clockStarted
                  ? t("menu.leaveTestNoteRunning")
                  : t("menu.leaveTestNoteBeforeStart")}
              </p>
            </>
          ) : null}

          <div className="mt-auto border-t pt-3">
            <div className="mb-2 text-[11px] font-extrabold tracking-wide uppercase opacity-70">
              {t("menu.language")}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {LANGUAGES.map((lng) => (
                <button
                  key={lng}
                  type="button"
                  aria-pressed={i18next.language === lng}
                  className="h-9 rounded-md border px-2.5 text-xs font-bold uppercase aria-pressed:bg-teal-100"
                  onClick={() => {
                    void i18next.changeLanguage(lng)
                  }}
                >
                  {lng}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="mt-2 size-11 w-full rounded-md px-3 text-left text-sm font-semibold text-red-600"
              onClick={() => {
                void signOut()
              }}
            >
              {t("menu.signOut")}
            </button>
          </div>
        </SheetContent>
      </Sheet>
    )
  }
  ```

  `aria-describedby={undefined}` on `SheetContent` is Radix's own documented suppression for "this dialog genuinely has no description" — used here because, unlike the navigator, the menu has no subtitle text to serve as one; passing it explicitly (rather than omitting a description and getting a silent default) is the deliberate choice, not an oversight.

  `import type { Student } from "@pp/common"` assumes plan 1's domain types export a `Student` shape matching `GET /me`'s response (`displayName`, `email`, `level` — verified fields, `docs/api/openapi.yaml`'s `Student` schema). If `@pp/common` does not export it under that name, use whichever type plan 3 actually bound `useAuth`'s generic to.

- [ ] **Step 5: Run, gates**

  Run: `pnpm --filter @pp/app test AppMenu` → PASS, all six.

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

  Do NOT run `git add` and do NOT commit.

---

### Task 4: Wire both panels into the runner chrome, mutually exclusive

The prototype's `openPanel()` (lines 3247–3259) closes whichever panel is open before opening the requested one — the menu and the navigator are never both visible. Radix's `Sheet` manages its own `open` state per instance, so mutual exclusion is not free; it needs one shared piece of state.

**Files:**

- Create: `packages/app/src/features/runner/usePanelState.ts`
- Create: `packages/app/src/features/runner/RunnerPanels.tsx`
- Create: `packages/app/src/features/runner/RunnerPanels.test.tsx`

**Interfaces:**

- Consumes: `QuestionNavigator` (Task 2), `AppMenu` (Task 3).
- Produces:

  ```ts
  export type RunnerPanel = "menu" | "navigator" | null
  export interface PanelState {
    panel: RunnerPanel
    toggleMenu: () => void
    toggleNavigator: () => void
    close: () => void
  }
  export function usePanelState(): PanelState
  ```

  `RunnerPanels` mounts both `<button>` triggers (app-bar menu icon, nav-bar navigator toggle) plus both sheets, and is meant to be dropped into whichever component already renders the listening/reading app-bar and nav-bar. **Before writing this task's integration point, grep for it**: `grep -rln "sec-chip\|nav-bar\|app-bar" packages/app/src` (or the CSS-module/Tailwind-class equivalent plan 3 actually used). If plan 3 already factored a shared `RunnerLayout`/`RunnerChrome` component, mount `RunnerPanels` there once; if each screen renders its own app-bar, mount it in each screen rather than duplicating the trigger buttons.

- [ ] **Step 1: Write the failing tests — three cases**

  `packages/app/src/features/runner/RunnerPanels.test.tsx`. Reuse the `I18nextProvider` + `useAuth` mock setup from Tasks 2–3 (factor a `test/i18n-test-setup.ts` helper exporting the configured instance if that reduces duplication — not required, but do not silently diverge the two resource bundles).

  ```tsx
  describe("RunnerPanels", () => {
    it("opens the menu when its trigger is clicked", async () => {
      render(<RunnerPanels {...baseProps} />)
      await userEvent.click(screen.getByRole("button", { name: /open menu/i }))
      expect(screen.getByRole("dialog")).toBeInTheDocument()
    })

    it("closes the menu and opens the navigator when the navigator trigger is clicked while the menu is open", async () => {
      render(<RunnerPanels {...baseProps} />)
      await userEvent.click(screen.getByRole("button", { name: /open menu/i }))
      await userEvent.click(
        screen.getByRole("button", { name: /open the question navigator/i }),
      )
      expect(screen.getAllByRole("dialog")).toHaveLength(1)
      expect(
        screen.getByRole("dialog", { name: "Questions" }),
      ).toBeInTheDocument()
    })

    it("closes whichever panel is open on Escape", async () => {
      render(<RunnerPanels {...baseProps} />)
      await userEvent.click(screen.getByRole("button", { name: /open menu/i }))
      await userEvent.keyboard("{Escape}")
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    })
  })
  ```

  The second case is the one that actually tests mutual exclusion — asserting `getAllByRole("dialog")` has length exactly one, not merely that the navigator opened, is what would catch a naive implementation that just adds a second `useState<boolean>` per panel instead of one shared `RunnerPanel` union.

- [ ] **Step 2: Run it to verify it fails**

  Run: `pnpm --filter @pp/app test RunnerPanels`
  Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

  `packages/app/src/features/runner/usePanelState.ts`:

  ```ts
  import { useState } from "react"

  export type RunnerPanel = "menu" | "navigator" | null

  export interface PanelState {
    panel: RunnerPanel
    toggleMenu: () => void
    toggleNavigator: () => void
    close: () => void
  }

  export function usePanelState(): PanelState {
    const [panel, setPanel] = useState<RunnerPanel>(null)
    return {
      panel,
      toggleMenu: () => {
        setPanel((current) => (current === "menu" ? null : "menu"))
      },
      toggleNavigator: () => {
        setPanel((current) => (current === "navigator" ? null : "navigator"))
      },
      close: () => {
        setPanel(null)
      },
    }
  }
  ```

  `RunnerPanels.tsx` mounts the two trigger buttons and both sheets, passing each sheet `open={panel === "menu" | "navigator"}` and `onOpenChange={(next) => { if (!next) close() }}` — Radix only ever calls `onOpenChange(false)` (Escape, overlay click, the close button); opening is exclusively driven by this component's own triggers, never by the sheet itself, so the `if (!next)` guard is what stops a trigger click from being immediately undone by a stale `onOpenChange(true)` that never happens in practice but would be a silent bug if assumed away. Note this in a comment.

- [ ] **Step 4: Run, gates**

  Run: `pnpm --filter @pp/app test RunnerPanels` → PASS, all three.

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

  Do NOT run `git add` and do NOT commit.

---

### Task 5: The i18n gate — before the sweep, not after

`node-i18n-lint` is already installed and already wired as a root script, but `"lint:i18n": "i18n-lint packages/app/src || true"` — verified in the current `package.json` — discards its exit code, and `lint:i18n` is not part of `pnpm lint` in the first place. A gate that cannot fail is not a gate; Task 6's sweep would be a one-time cleanup that decays on the very next PR. This task fixes both defects and adds a second gate `node-i18n-lint` structurally cannot provide (per Global Constraints: it never checks that a key exists in all six locale files). Neither gate is wired into `pnpm lint`/`pnpm test` yet — that is Task 6's last step, once the sweep has actually made both pass.

**Files:**

- Modify: `package.json` (root) — `lint:i18n` script only, not yet `lint`
- Create: `packages/app/test/locale-parity.test.ts`

**Interfaces:**

- Consumes: `packages/app/src/locales/*/*.json` on disk (six directories, however many namespace files exist by the time this task runs).
- Produces: `pnpm lint:i18n` exits non-zero on any hardcoded string; `pnpm --filter @pp/app test locale-parity` exits non-zero on any key present in one locale's namespace file and absent from another's.

- [ ] **Step 1: Prove `lint:i18n` currently cannot fail**

  Run: `pnpm lint:i18n; echo "exit code: $?"`
  Expected: whatever `i18n-lint packages/app/src` prints, followed by `exit code: 0` — even if the tool itself reported findings, `|| true` absorbs its real exit code. Paste the actual output into your report; do not assume it is empty.

- [ ] **Step 2: Fix the script**

  In root `package.json`:

  ```json
  "lint:i18n": "i18n-lint packages/app/src",
  ```

- [ ] **Step 3: Prove it can now fail, with a controlled fixture — not by depending on however much ambient debt happens to exist right now**

  ```bash
  cat > packages/app/src/features/runner/__i18n_probe.tsx <<'EOF'
  export function Probe() {
    return <p>This is an untranslated probe string.</p>
  }
  EOF
  pnpm lint:i18n; echo "exit code: $?"
  rm packages/app/src/features/runner/__i18n_probe.tsx
  ```

  Expected: the finding line `.../features/runner/__i18n_probe.tsx:2:12  [jsx-text]  "This is an untranslated probe string."`, then `exit code: 1`. This is the real red — not "the script exists," but "the script, run against a known violation, refuses to pass." Paste both the finding line and the exit code into your report.

  Then run `pnpm lint:i18n` once more against the real tree (probe already removed) and record however many genuine findings it reports right now — that count is Task 6's actual scope, and it may be large, small, or zero depending on how faithfully plans 3–5 already used `t()`.

- [ ] **Step 4: Write the failing locale-parity test**

  `node-i18n-lint` cannot see this gap — a key present only in `en.json` still passes it. `packages/app/test/locale-parity.test.ts`:

  ```ts
  import { readdirSync, readFileSync } from "node:fs"
  import { join } from "node:path"
  import { describe, expect, it } from "vitest"

  const LOCALES_DIR = join(import.meta.dirname, "..", "src", "locales")
  const LANGUAGES = ["de", "en", "es", "fr", "it", "ja"] as const

  function flattenKeys(obj: unknown, prefix = ""): string[] {
    if (typeof obj !== "object" || obj === null) {
      return [prefix]
    }
    return Object.entries(obj as Record<string, unknown>).flatMap(
      ([key, value]) => flattenKeys(value, prefix ? `${prefix}.${key}` : key),
    )
  }

  describe("locale parity", () => {
    it("gives every namespace file the same key set in all six locales", () => {
      const namespaces = readdirSync(join(LOCALES_DIR, "en")).filter((f) =>
        f.endsWith(".json"),
      )
      expect(namespaces.length).toBeGreaterThan(0)

      for (const namespace of namespaces) {
        const englishKeys = flattenKeys(
          JSON.parse(readFileSync(join(LOCALES_DIR, "en", namespace), "utf8")),
        ).sort()

        for (const lang of LANGUAGES) {
          const path = join(LOCALES_DIR, lang, namespace)
          const keys = flattenKeys(
            JSON.parse(readFileSync(path, "utf8")),
          ).sort()
          expect(keys, `${lang}/${namespace} key set`).toEqual(englishKeys)
        }
      }
    })

    it("translates every key away from the English string, except where a value is genuinely language-neutral", () => {
      const namespaces = readdirSync(join(LOCALES_DIR, "en")).filter((f) =>
        f.endsWith(".json"),
      )
      const english = new Map(
        namespaces.map((ns) => [
          ns,
          JSON.parse(readFileSync(join(LOCALES_DIR, "en", ns), "utf8")),
        ]),
      )
      const identical: string[] = []

      for (const namespace of namespaces) {
        for (const lang of LANGUAGES.filter((l) => l !== "en")) {
          const translated = JSON.parse(
            readFileSync(join(LOCALES_DIR, lang, namespace), "utf8"),
          )
          const flatEn = flattenKeys(english.get(namespace))
          for (const key of flatEn) {
            const en = key
              .split(".")
              .reduce<unknown>(
                (o, k) => (o as Record<string, unknown>)[k],
                english.get(namespace),
              )
            const tr = key
              .split(".")
              .reduce<unknown>(
                (o, k) => (o as Record<string, unknown>)[k],
                translated,
              )
            if (typeof en === "string" && en === tr && /\p{L}{3,}/u.test(en)) {
              identical.push(`${lang}/${namespace}::${key}`)
            }
          }
        }
      }

      expect(identical).toEqual([])
    })
  })
  ```

  The second case is deliberately looser than the first (it flags likely-untranslated copy rather than hard-failing on anything identical, since a handful of words are legitimately the same across languages — "OK", brand names) but still real: it is what would have caught a sweep that copied `en.json` verbatim into the other five files to satisfy the key-parity test without doing the actual translation work.

- [ ] **Step 5: Run it to verify it fails**

  Run: `pnpm --filter @pp/app test locale-parity`
  Expected: FAIL — `runner.json` currently exists only under `en/` (Tasks 2–3 added it there and nowhere else). Paste the actual assertion diff into your report.

- [ ] **Step 6: Gates**

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

  `pnpm test` at this point still fails on `locale-parity` — that failure is expected and correct; Task 6 is the fix, not this one. Confirm the OTHER three gates (`lint`, `format`, `typecheck`) pass, and that `lint:i18n` — run separately, since it is not yet part of `lint` — is whatever Step 3 recorded. Do NOT run `git add` and do NOT commit.

---

### Task 6: The sweep — six locales, for real, then the gate joins `pnpm lint`

**Files:**

- Modify: `packages/app/src/locales/{de,en,es,fr,it,ja}/runner.json` (create the five non-English files; extend `en`'s with the `menu` object Task 3 added separately if not already merged)
- Modify: whatever files `pnpm lint:i18n` names in Task 5 Step 3's final run — unknown in advance; enumerate them here in your report before fixing them
- Modify: root `package.json` — `lint` now runs `lint:i18n` too

**Interfaces:**

- Consumes: Task 5's two gates.
- Produces: `pnpm lint` (not just `pnpm lint:i18n`) fails on a hardcoded string from this point forward.

- [ ] **Step 1: Enumerate the real findings**

  Run: `pnpm lint:i18n`. For each finding, decide: wrap it in `t("namespace:key", …)` and add the key to `en`'s namespace file, or — if `isTranslatable`'s heuristic false-positived on something that is not actually copy (a CSS class fragment it didn't recognize, a code sample) — add an `i18n-ignore` comment on the line above, per the tool's own escape hatch (verified in `scan.ts`: a line containing the literal text `i18n-ignore` suppresses findings on that line and the next). Do not use `i18n-ignore` to skip real copy; it is for the tool being wrong, not for saving translation effort.

- [ ] **Step 2: `runner.json`, all six locales, `navigator` + `menu`**

  `packages/app/src/locales/en/runner.json` (merge of Tasks 2 and 3, final form):

  ```json
  {
    "navigator": {
      "title": "Questions",
      "reviewTitle": "Jump to a question",
      "progressSubtitle": "{{answered}} of {{total}} answered",
      "reviewSubtitle": "Tap any question to see your answer",
      "sectionListening": "Listening",
      "sectionReading": "Reading",
      "sectionVocabulary": "Vocabulary",
      "sectionGrammar": "Grammar",
      "sectionOther": "Other",
      "questionLabel": "Question {{ordinal}}",
      "legendAnswered": "Answered",
      "legendCurrent": "You are here",
      "legendBlank": "Not answered",
      "legendCorrect": "Correct",
      "legendIncorrect": "Wrong",
      "forwardOnlyNote": "This section runs forward only. The navigator shows where you are but cannot move you.",
      "openLabel": "Open the question navigator"
    },
    "menu": {
      "title": "Menu",
      "library": "Test library",
      "history": "Attempt history",
      "leaveTest": "Leave test",
      "leaveTestNoteBeforeStart": "Nothing has started yet. The clock begins when you tap I'm ready.",
      "leaveTestNoteRunning": "The clock keeps running while you are away.",
      "language": "Language",
      "signOut": "Sign out",
      "openLabel": "Open menu"
    }
  }
  ```

  `packages/app/src/locales/fr/runner.json`:

  ```json
  {
    "navigator": {
      "title": "Questions",
      "reviewTitle": "Aller à une question",
      "progressSubtitle": "{{answered}} sur {{total}} répondues",
      "reviewSubtitle": "Touchez une question pour voir votre réponse",
      "sectionListening": "Écoute",
      "sectionReading": "Lecture",
      "sectionVocabulary": "Vocabulaire",
      "sectionGrammar": "Grammaire",
      "sectionOther": "Autre",
      "questionLabel": "Question {{ordinal}}",
      "legendAnswered": "Répondu",
      "legendCurrent": "Vous êtes ici",
      "legendBlank": "Sans réponse",
      "legendCorrect": "Correct",
      "legendIncorrect": "Incorrect",
      "forwardOnlyNote": "Cette section avance uniquement. Le navigateur indique votre position mais ne peut pas vous déplacer.",
      "openLabel": "Ouvrir le navigateur de questions"
    },
    "menu": {
      "title": "Menu",
      "library": "Bibliothèque de tests",
      "history": "Historique des tentatives",
      "leaveTest": "Quitter le test",
      "leaveTestNoteBeforeStart": "Rien n'a encore commencé. Le chronomètre démarre quand vous appuyez sur Je suis prêt.",
      "leaveTestNoteRunning": "Le chronomètre continue pendant votre absence.",
      "language": "Langue",
      "signOut": "Se déconnecter",
      "openLabel": "Ouvrir le menu"
    }
  }
  ```

  `packages/app/src/locales/de/runner.json`:

  ```json
  {
    "navigator": {
      "title": "Fragen",
      "reviewTitle": "Zu einer Frage springen",
      "progressSubtitle": "{{answered}} von {{total}} beantwortet",
      "reviewSubtitle": "Tippe auf eine Frage, um deine Antwort zu sehen",
      "sectionListening": "Hören",
      "sectionReading": "Lesen",
      "sectionVocabulary": "Wortschatz",
      "sectionGrammar": "Grammatik",
      "sectionOther": "Andere",
      "questionLabel": "Frage {{ordinal}}",
      "legendAnswered": "Beantwortet",
      "legendCurrent": "Du bist hier",
      "legendBlank": "Nicht beantwortet",
      "legendCorrect": "Richtig",
      "legendIncorrect": "Falsch",
      "forwardOnlyNote": "Dieser Abschnitt läuft nur vorwärts. Der Navigator zeigt, wo du bist, kann dich aber nicht verschieben.",
      "openLabel": "Fragen-Navigator öffnen"
    },
    "menu": {
      "title": "Menü",
      "library": "Testbibliothek",
      "history": "Versuchsverlauf",
      "leaveTest": "Test verlassen",
      "leaveTestNoteBeforeStart": "Es hat noch nichts begonnen. Die Uhr startet, wenn du auf Ich bin bereit tippst.",
      "leaveTestNoteRunning": "Die Uhr läuft weiter, während du weg bist.",
      "language": "Sprache",
      "signOut": "Abmelden",
      "openLabel": "Menü öffnen"
    }
  }
  ```

  `packages/app/src/locales/es/runner.json`:

  ```json
  {
    "navigator": {
      "title": "Preguntas",
      "reviewTitle": "Ir a una pregunta",
      "progressSubtitle": "{{answered}} de {{total}} respondidas",
      "reviewSubtitle": "Toca una pregunta para ver tu respuesta",
      "sectionListening": "Comprensión auditiva",
      "sectionReading": "Lectura",
      "sectionVocabulary": "Vocabulario",
      "sectionGrammar": "Gramática",
      "sectionOther": "Otro",
      "questionLabel": "Pregunta {{ordinal}}",
      "legendAnswered": "Respondida",
      "legendCurrent": "Estás aquí",
      "legendBlank": "Sin responder",
      "legendCorrect": "Correcta",
      "legendIncorrect": "Incorrecta",
      "forwardOnlyNote": "Esta sección solo avanza. El navegador muestra dónde estás, pero no puede moverte.",
      "openLabel": "Abrir el navegador de preguntas"
    },
    "menu": {
      "title": "Menú",
      "library": "Biblioteca de pruebas",
      "history": "Historial de intentos",
      "leaveTest": "Salir de la prueba",
      "leaveTestNoteBeforeStart": "Todavía no ha comenzado nada. El reloj empieza cuando pulsas Estoy listo.",
      "leaveTestNoteRunning": "El reloj sigue corriendo mientras estás fuera.",
      "language": "Idioma",
      "signOut": "Cerrar sesión",
      "openLabel": "Abrir menú"
    }
  }
  ```

  `packages/app/src/locales/it/runner.json`:

  ```json
  {
    "navigator": {
      "title": "Domande",
      "reviewTitle": "Vai a una domanda",
      "progressSubtitle": "{{answered}} su {{total}} completate",
      "reviewSubtitle": "Tocca una domanda per vedere la tua risposta",
      "sectionListening": "Ascolto",
      "sectionReading": "Lettura",
      "sectionVocabulary": "Vocabolario",
      "sectionGrammar": "Grammatica",
      "sectionOther": "Altro",
      "questionLabel": "Domanda {{ordinal}}",
      "legendAnswered": "Risposto",
      "legendCurrent": "Sei qui",
      "legendBlank": "Senza risposta",
      "legendCorrect": "Corretto",
      "legendIncorrect": "Sbagliato",
      "forwardOnlyNote": "Questa sezione procede solo in avanti. Il navigatore mostra dove ti trovi ma non può spostarti.",
      "openLabel": "Apri il navigatore delle domande"
    },
    "menu": {
      "title": "Menu",
      "library": "Libreria dei test",
      "history": "Cronologia tentativi",
      "leaveTest": "Esci dal test",
      "leaveTestNoteBeforeStart": "Non è ancora iniziato nulla. Il tempo parte quando tocchi Sono pronto.",
      "leaveTestNoteRunning": "Il tempo continua a scorrere mentre sei via.",
      "language": "Lingua",
      "signOut": "Esci",
      "openLabel": "Apri il menu"
    }
  }
  ```

  `packages/app/src/locales/ja/runner.json`:

  ```json
  {
    "navigator": {
      "title": "問題一覧",
      "reviewTitle": "質問を選ぶ",
      "progressSubtitle": "{{total}}問中{{answered}}問回答済み",
      "reviewSubtitle": "質問をタップすると回答が表示されます",
      "sectionListening": "リスニング",
      "sectionReading": "リーディング",
      "sectionVocabulary": "語彙",
      "sectionGrammar": "文法",
      "sectionOther": "その他",
      "questionLabel": "問題 {{ordinal}}",
      "legendAnswered": "回答済み",
      "legendCurrent": "現在の問題",
      "legendBlank": "未回答",
      "legendCorrect": "正解",
      "legendIncorrect": "不正解",
      "forwardOnlyNote": "このセクションは前へしか進めません。ナビゲーターは現在地を示しますが、移動はできません。",
      "openLabel": "問題ナビゲーターを開く"
    },
    "menu": {
      "title": "メニュー",
      "library": "テスト一覧",
      "history": "受験履歴",
      "leaveTest": "テストを終了する",
      "leaveTestNoteBeforeStart": "まだ始まっていません。「準備ができました」をタップすると計測が始まります。",
      "leaveTestNoteRunning": "離れている間も時間は進み続けます。",
      "language": "言語",
      "signOut": "サインアウト",
      "openLabel": "メニューを開く"
    }
  }
  ```

  Note `progressSubtitle`'s Japanese form reorders the interpolated values (`{{total}}問中{{answered}}問`, "of {{total}}, {{answered}} answered" in natural word order) rather than following English's literal order — i18next interpolation does not care about argument position, so this is not a bug, but it is exactly the kind of difference a naive "copy the English structure" sweep would miss. Call it out if you find another like it.

- [ ] **Step 3: Fix whatever else Step 1 of this task enumerated**

  For each finding outside `runner.json`'s scope (plans 3–5's screens), wrap the string in `t()`, add the key to that screen's existing namespace (or a new one, following the same six-file pattern above) with real translations in all six languages — not English copied six times; Task 5's second parity test exists specifically to catch that shortcut.

- [ ] **Step 4: Run both gates to green**

  ```bash
  pnpm lint:i18n; echo "exit: $?"
  pnpm --filter @pp/app test locale-parity
  ```

  Expected: `exit: 0` and PASS. If either still fails, you have not found every finding from Step 1 — go back, do not silence the gate.

- [ ] **Step 5: Wire `lint:i18n` into `pnpm lint`, for real this time**

  Root `package.json`:

  ```json
  "lint": "pnpm build && oxlint && pnpm lint:i18n",
  ```

- [ ] **Step 6: Gates and final proof**

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

  This is the first time in this plan all four gates are green with `lint:i18n` genuinely inside `lint` rather than run alongside it. Do NOT run `git add` and do NOT commit.

---

### Task 7: iPad polish — touch targets, safe areas, orientation, no accidental zoom

Not unit-testable in the way Tasks 1–5 are: this is layout and device behaviour. Every step below ends in a **concrete manual verification procedure with an expected observation**, not "verify it looks right."

**Files:**

- Modify: `packages/app/index.html` (viewport meta)
- Modify: `packages/app/src/index.css` (safe-area padding) — confirm this is the file that `@import "tailwindcss"`s before editing it; if plan 3 named it differently, edit that one instead and say so
- Modify: `packages/app/src/features/runner/QuestionNavigator.tsx`, `AppMenu.tsx`, `RunnerPanels.tsx` (already `size-11`/`touch-manipulation` from Tasks 2–4 — this task is where that is verified against a real device profile, not merely asserted)

- [ ] **Step 1: Viewport and safe-area meta**

  `packages/app/index.html`, inside `<head>`:

  ```html
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover"
  />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta
    name="apple-mobile-web-app-status-bar-style"
    content="black-translucent"
  />
  ```

  `viewport-fit=cover` is load-bearing, not decorative: without it, `env(safe-area-inset-*)` resolves to `0px` on iPadOS regardless of what CSS asks for it, so Step 2's padding would silently do nothing. `maximum-scale=1` combined with `touch-manipulation` (already on the runner's interactive elements from Tasks 2–4) removes the 300ms double-tap-to-zoom delay that would otherwise make a fast double-tap on a choice or a navigator cell register as a zoom gesture instead of two taps.

- [ ] **Step 2: Safe-area padding on the app shell**

  In `packages/app/src/index.css` (or the real Tailwind entry), add:

  ```css
  @layer base {
    body {
      padding-top: env(safe-area-inset-top);
      padding-bottom: env(safe-area-inset-bottom);
      padding-left: env(safe-area-inset-left);
      padding-right: env(safe-area-inset-right);
    }
  }
  ```

  This affects only Safari's chrome-avoidance in standalone/split-view; on a plain browser tab `env()` resolves to `0px` and the rule is inert.

- [ ] **Step 3: Prevent accidental text selection during a timed test**

  Confirm `select-none` is present on `QuestionNavigator`'s cell buttons (added in Task 2) and add it to `AppMenu`'s drawer-item buttons (Task 3) and, if plan 3's choice buttons do not already carry it, flag that as a finding in your report rather than silently editing a file this plan did not create — a long-press-to-select popup interrupting a timed answer tap is exactly the kind of thing that would go unnoticed in a mouse-driven dev environment and only surface on the real device.

- [ ] **Step 4: Real-device verification — touch targets**

  Using `mcp__plugin_chrome-devtools-mcp__emulate` (or the `claude-in-chrome` equivalent) at an iPad Pro 11" profile:

  1. Navigate to the app, sign in (or use whatever stub/dev-auth path plans 3–5 provide), start an attempt, reach the listening screen.
  2. Open the app menu; run `mcp__plugin_chrome-devtools-mcp__evaluate_script` with:
     ```js
     ;[...document.querySelectorAll("button")]
       .map((b) => {
         const r = b.getBoundingClientRect()
         return {
           label: b.textContent?.trim() || b.getAttribute("aria-label"),
           w: r.width,
           h: r.height,
         }
       })
       .filter((b) => b.w > 0 && (b.w < 44 || b.h < 44))
     ```
  3. **Expected observation: an empty array.** Any entry means a real interactive element under 44×44 CSS px — fix its sizing before closing this task, not just the ones this plan created; report every screen you checked and every under-sized element you found, by label.
  4. Repeat for the navigator (open it, run the same script) and for the listening/reading choice buttons.

- [ ] **Step 5: Real-device verification — orientation and overflow**

  1. At the iPad Pro 11" profile, portrait (834×1194): navigate through `signin → home → intro → secintro → listening → reading → confirm → result → review → history` (the eleven screen keys the prototype itself defines — `docs/prototype/index.html` line 1269 onward — use whatever route path plans 3–5 mapped each one to). At each, run `document.documentElement.scrollWidth > document.documentElement.clientWidth` via `evaluate_script`.
  2. **Expected observation: `false` on every screen.** `true` means horizontal overflow — on a fixed-width iPad viewport this is never intentional; find and fix the offending element (usually a `min-width` from harvested Razzia CSS not re-checked for this narrower layout).
  3. Repeat at landscape (1194×834).
  4. With the navigator open, confirm its `SheetContent` does not get clipped at either orientation: `getBoundingClientRect().right <= window.innerWidth` via `evaluate_script`, expected `true`.

  Record the actual numbers (not just pass/fail) for at least one screen at each orientation in your report — a screenshot via `mcp__plugin_chrome-devtools-mcp__take_screenshot` for the listening screen at both orientations is the concrete artifact that makes this verifiable by someone who did not run it themselves.

- [ ] **Step 6: Gates**

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

  Do NOT run `git add` and do NOT commit.

---

### Task 8: Docker deploy — the two-service production stack

Plan 2's Task 13 already built the `api`/`postgres` compose pair and a multi-stage Dockerfile for `packages/{common,db,server}`. **This task does not redo that** — it extends the same image to also build and serve `packages/app`'s SPA, and closes the gap the Global Constraints section names: nothing before this task ever calls `app.setGlobalPrefix`, despite `docs/api/openapi.yaml` declaring `servers: [{ url: /api }]` from the first commit of the contract.

**Files:**

- Modify: `packages/server/src/main.ts`, `src/config.ts`, `package.json` (add `express`, `@types/express` as explicit dependencies)
- Modify: `Dockerfile` (add the `packages/app` build stage and copy its output)
- Create: `packages/server/test/spa.e2e.test.ts`

**Interfaces:**

- Consumes: `loadServerConfig` (plan 2 Task 2); `app.getHttpAdapter().getInstance()` — documented public `@nestjs/core` API, returns the underlying Express app.
- Produces: `ServerConfig` gains `spaRoot: string`; `GET /` and any non-`/api`, non-`/media` path serve the built SPA with `index.html` fallback; every existing route moves under `/api`.

- [ ] **Step 1: Confirm the prefix really is missing**

  Run: `grep -rn "setGlobalPrefix" packages/server/src`
  Expected: no matches. If plan 2 or a later plan already added one, skip Steps 3–4 below and instead verify the existing prefix is exactly `api` with `health` excluded — do not add a second one.

- [ ] **Step 2: Write the failing e2e test**

  `packages/server/test/spa.e2e.test.ts` — reuse `createTestApp` from `test/helpers/app.ts` (plan 2 Task 3), but this test only makes sense against the real HTTP server with the SPA files present, which the unit-test harness does not build. Write it anyway as the executable spec of what Step 3 onward must satisfy, and mark it explicitly conditional:

  ```ts
  import { existsSync } from "node:fs"
  import { describe, expect, it } from "vitest"
  import { createTestApp, type TestApp } from "./helpers/app.js"

  const spaRoot = process.env.SPA_ROOT
  const describeIfSpaBuilt =
    spaRoot && existsSync(spaRoot) ? describe : describe.skip

  describeIfSpaBuilt("SPA serving", () => {
    let app: TestApp

    beforeAll(async () => {
      app = await createTestApp()
    })

    afterAll(async () => {
      await app.close()
    })

    it("serves the SPA shell at /", async () => {
      const res = await request(app.http.getHttpServer()).get("/").expect(200)
      expect(res.text).toContain('<div id="root">')
    })

    it("serves the SAME SPA shell for a client-side route, not a 404", async () => {
      const res = await request(app.http.getHttpServer())
        .get("/library")
        .expect(200)
      expect(res.text).toContain('<div id="root">')
    })

    it("keeps the API reachable under /api, not shadowed by the SPA fallback", async () => {
      await request(app.http.getHttpServer()).get("/api/tests").expect(401)
    })

    it("still answers /health outside the /api prefix", async () => {
      await request(app.http.getHttpServer()).get("/health").expect(200)
    })
  })
  ```

  `describe.skip` when `SPA_ROOT` is unset or the directory does not exist — this test is genuinely un-runnable without a built `packages/app`, and a plain `pnpm --filter @pp/server test` in CI before that build step exists must not report a false failure. This is the honest version of "a red-first step must be able to go red": it is allowed to skip, but never allowed to pass vacuously while claiming to have checked something.

  Before writing the assertion on `<div id="root">`, run `grep -o '<div id="[a-z]*"' packages/app/index.html` and use whatever id is actually there — Vite's default scaffold uses `root`, but do not assume it without checking.

- [ ] **Step 3: `ServerConfig` gains `spaRoot`**

  In `packages/server/src/config.ts`, add to `ServerConfig`:

  ```ts
  spaRoot: string | null
  ```

  and to `loadServerConfig`:

  ```ts
  spaRoot: env.SPA_ROOT ?? null,
  ```

  `null` by default so `pnpm --filter @pp/server start` outside Docker (no built SPA alongside it) does not try to serve a directory that does not exist.

- [ ] **Step 4: Prefix and static serving in `main.ts`**

  Before adding `express` to `packages/server/package.json`, confirm the exact version already resolved transitively: `pnpm why express` (run after `pnpm install`, from a checkout where `@nestjs/platform-express` is already a dependency). Pin `@pp/server`'s own `express`/`@types/express` entries to that exact resolved major/minor — do not guess a version and let pnpm resolve two copies.

  ```ts
  import { existsSync } from "node:fs"
  import { join } from "node:path"
  import type { Express } from "express"
  import express from "express"
  // …existing imports…

  async function bootstrap(): Promise<void> {
    const config = loadServerConfig()
    await waitForDatabase(config.databaseUrl, { retries: 30, delayMs: 1000 })
    await migrateToLatest(config.databaseUrl)

    const app = await NestFactory.create(AppModule)
    app.useGlobalFilters(new AllExceptionsFilter())
    app.setGlobalPrefix("api", { exclude: ["health"] })

    if (config.spaRoot && existsSync(config.spaRoot)) {
      const server = app.getHttpAdapter().getInstance() as Express
      server.use(express.static(config.spaRoot, { index: false }))
      server.get(/^(?!\/api\/|\/media\/).*/, (_req, res) => {
        res.sendFile(join(config.spaRoot as string, "index.html"))
      })
    }

    await app.listen(config.port)
  }

  await bootstrap()
  ```

  Order matters and is why this is added AFTER `NestFactory.create` returns: Nest has already registered every controller route on the same underlying Express instance by then, so Express tries `/api/*` and `/health` first (registration order, not specificity, decides Express matching) and only falls through to the static middleware / wildcard for anything else. Say this in a comment in the actual file — it is the load-bearing ordering fact, and a future refactor that moves this block earlier would silently break it.

- [ ] **Step 5: Run the e2e test (still skipped without `SPA_ROOT`), unit gates**

  ```bash
  pnpm --filter @pp/server test spa
  ```

  Expected: `1 skipped` (no `SPA_ROOT` set locally) — this is correct, not a false pass; the real proof is Step 8's Docker build.

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

- [ ] **Step 6: Extend the Dockerfile's builder stage to also build `packages/app`**

  In the `builder` stage, alongside the existing `COPY packages/{common,db,server}/package.json ./packages/{...}/`:

  ```dockerfile
  COPY packages/app/package.json ./packages/app/
  ```

  and change the build line from `RUN pnpm build` to build the app too — either extend the root `build` script to include `pnpm --filter @pp/app build`, or add an explicit `RUN pnpm --filter @pp/app build` line after the existing `RUN pnpm build`. Prefer the root script change, so `pnpm build` means the same thing in CI and in Docker.

- [ ] **Step 7: Copy the SPA into the runtime stage and set `SPA_ROOT`**

  In the `runner` stage, alongside the existing `COPY --from=builder /app/packages/server/dist ...` (or wherever plan 2 Task 13 landed the server's build output):

  ```dockerfile
  COPY --from=builder /app/packages/app/dist /app/public
  ENV SPA_ROOT=/app/public
  ```

- [ ] **Step 8: Build and verify by running, not by reading**

  ```bash
  docker compose build api
  docker compose up -d
  curl -fsS http://127.0.0.1:3000/health
  curl -fsS http://127.0.0.1:3000/ | grep -o '<div id="[a-z]*"'
  curl -fsS http://127.0.0.1:3000/library | grep -o '<div id="[a-z]*"'
  curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/api/tests
  docker compose down -v
  ```

  Expected, in order: the `/health` body from plan 2's own check; the SPA's root div id printed twice (once for `/`, once for the client route `/library`, proving the fallback works and is not a 404 that happens to also contain that string — check the actual HTTP status alongside the grep, e.g. `curl -sS -o /dev/null -w "%{http_code}\n" ...` for the same two URLs, expecting `200` both times); `401` for `/api/tests` unauthenticated (proves the API is live under the prefix — a `404` here would mean the wildcard fallback is shadowing the API instead of the API taking precedence, which is the failure mode Step 4's ordering comment exists to prevent). Paste all five outputs into your report.

- [ ] **Step 9: Gates and final state**

  ```bash
  pnpm lint && pnpm format && pnpm typecheck && pnpm test
  ```

  Do NOT run `git add` and do NOT commit. Leave the work uncommitted; the reviewer stages by explicit path and writes the commit.

---

## Definition of Done

- [ ] `pnpm lint` (with `lint:i18n` now inside it), `pnpm format`, `pnpm typecheck`, `pnpm test` (with `locale-parity` now inside it) all exit 0
- [ ] `pnpm lint:i18n` run standalone against `packages/app/src` reports zero findings
- [ ] `packages/app/test/locale-parity.test.ts` passes: every namespace file has the same key set across `de`/`en`/`es`/`fr`/`it`/`ja`, and no non-trivial string is left identical to its English source
- [ ] The question navigator disables every cell of an open OR closed `forward_only` section and never disables a cell in review mode — proven by `navigator-state.test.ts`, not by inspection
- [ ] The app menu and the question navigator are never both open — proven by `RunnerPanels.test.tsx`'s `getAllByRole("dialog")` assertion
- [ ] Every interactive element this plan added measures ≥44×44 CSS px on an emulated iPad Pro 11" profile, portrait and landscape, with no horizontal overflow on any of the eleven prototype screens — recorded with actual pixel numbers and at least two screenshots, not asserted
- [ ] `docker compose build api` succeeds; the running container serves `GET /health`, `GET /` and `GET /library` (SPA fallback) all `200`, and `GET /api/tests` unauthenticated `401` — not `404` — proving `/api` is live and not shadowed by the static fallback
- [ ] `grep -rn "new Date()\|Date\.now()" packages/{common,db,server}/src` still reports only comments (unchanged by this plan, re-verified because Task 8 touches `main.ts`)
