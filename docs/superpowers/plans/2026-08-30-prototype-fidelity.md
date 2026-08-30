# Prototype Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the production React application reproduce the inner device screens in `docs/prototype/index.html` while preserving its real routing, data, accessibility, and offline behavior.

**Architecture:** Treat the prototype's `.device` UI as the visual authority and its outer documentation masthead, rail, stage, and API panel as out of scope. Complete the shared device vocabulary in `index.css`, then migrate routes in user-flow order so every page consumes the same typography, palette, app-bar, body, card, button, passage, audio, progress, and bottom-navigation patterns instead of inventing local `stone`/`slate` styles.

**Tech Stack:** React 19, TypeScript 6, TanStack Router, Tailwind CSS 4, Radix UI, Vitest, Testing Library, i18next.

**Spec:** `docs/prototype/index.html` — only the markup and styles inside `.device`; the documentation shell around it is not part of the application.

## Global Constraints

- Match the prototype's inner `.device` screens at full viewport size; do not port `.masthead`, `.rail`, `.stage`, `.device-shell`, `.api`, or endpoint-documentation UI.
- Use Nunito for application text and IBM Plex Mono only for timers and other tabular numeric chrome, matching the prototype font roles.
- Preserve the exact device palette already registered in `packages/app/src/index.css`: ink `#1c2530`, ink-2 `#55636f`, faint `#8d9aa6`, paper `#ffffff`, surface `#f4f7f9`, line `#dfe6ec`, teal `#0f6e78`, teal-bg `#e4f1f2`, clay `#a8622f`, clay-bg `#f8ede4`, good `#2e9e5b`, good-bg `#e6f4eb`, bad `#c4453f`, bad-bg `#faeae9`, amber `#e8a33d`.
- Preserve all route loaders, API calls, timers, queue durability, navigation rules, translations, and error behavior; this plan changes presentation and semantic layout only.
- Keep `components/` stateless and props-only.
- Keep interactive touch targets at least 44×44 CSS pixels, visible `:focus-visible` treatment, keyboard-operable overlays, and reduced-motion support.
- Use semantic `header`, `main`, `footer`, `nav`, headings, lists, tables, buttons, and links; do not replace accessible controls with non-interactive elements.
- Keep the app responsive from 320px wide through iPad landscape. Content may use the prototype's maximum reading width, but the app itself fills the viewport and does not render a fake tablet frame.
- Follow strict TDD for React markup changes: add a focused assertion that fails because the required semantic region/state/class is absent, run it red, implement, then run it green. Human-only CSS declarations that cannot be behaviorally exercised in jsdom are verified by build plus browser screenshots instead of brittle source-grep tests.
- Do not add a second design system, dependency, icon library, animation system, or documentation-shell feature.

---

### Task 1: Complete the shared device vocabulary and overlays

**Files:**
- Modify: `packages/app/index.html`
- Modify: `packages/app/src/index.css`
- Modify: `packages/app/src/components/AppMenu.tsx`
- Modify: `packages/app/src/components/AppMenu.test.tsx`
- Modify: `packages/app/src/components/QuestionNavigator.tsx`
- Modify: `packages/app/src/components/QuestionNavigator.test.tsx`
- Modify: `packages/app/src/components/QuestionMedia.tsx`
- Modify: `packages/app/src/components/QuestionMedia.test.tsx`
- Modify: `packages/app/src/components/ChoiceList.tsx`
- Modify: `packages/app/src/components/ChoiceList.test.tsx`

**Interfaces:**
- Consumes: the existing `@theme` palette, Radix `Sheet`, `RadioGroup`, and `Checkbox` behavior.
- Produces: reusable CSS component classes `device-page`, `app-bar`, `app-brand`, `section-chip`, `device-main`, `center-main`, `device-footer`, `device-button`, `device-card`, `screen-title`, `screen-subtitle`, `question-count`, `question-prompt`, `choice-stack`, `audio-box`, `play-button`, `passage`, `score-ring`, `score-bar`, `history-table`, plus visually faithful menu/navigator/media/choice markup for later tasks.

- [ ] **Step 1: Write failing component assertions**

  Extend the existing tests to require the observable prototype structure: the menu sheet contains a student header, primary navigation, language group, and sign-out footer; the navigator contains grouped question grids and a legend; passage media uses the `passage` region; audio media exposes a pill-shaped `play-button`; choice lists expose a `choice-stack`. Assert semantic roles/text first and only the shared contract class at the component boundary.

  ```tsx
  expect(screen.getByRole("navigation", { name: /menu/i })).toHaveClass("device-drawer")
  expect(screen.getByRole("dialog", { name: /questions/i })).toHaveClass("question-panel")
  expect(screen.getByText(stimulus.bodyText)).toHaveClass("passage")
  expect(screen.getByRole("button", { name: /play/i })).toHaveClass("play-button")
  expect(screen.getByRole("radiogroup")).toHaveClass("choice-stack")
  ```

- [ ] **Step 2: Run focused tests and confirm RED**

  Run:

  ```bash
  pnpm --filter @pp/app test -- src/components/AppMenu.test.tsx src/components/QuestionNavigator.test.tsx src/components/QuestionMedia.test.tsx src/components/ChoiceList.test.tsx
  ```

  Expected: failures identify missing shared prototype regions/classes rather than missing text or setup errors.

- [ ] **Step 3: Port the shared prototype rules**

  Add the Nunito and IBM Plex Mono font stylesheet to `packages/app/index.html`. In `index.css`, set a zero-margin Nunito base, global font smoothing, focus ring, and reduced-motion rule. Port the inner-device component rules from the prototype using the existing Tailwind tokens; convert fixed mockup dimensions to responsive production rules and retain 44px minimum targets.

  Restyle the four components without changing their props or event paths. Use data attributes already emitted by Radix and the navigator for state styling. Ensure the menu/navigator sheets keep their focus trap, scrim, Escape behavior, and mutual exclusion owned by the route.

- [ ] **Step 4: Run focused tests and app build**

  Run:

  ```bash
  pnpm --filter @pp/app test -- src/components/AppMenu.test.tsx src/components/QuestionNavigator.test.tsx src/components/QuestionMedia.test.tsx src/components/ChoiceList.test.tsx
  pnpm --filter @pp/app build
  ```

  Expected: all focused tests pass and the app build exits 0 without CSS warnings.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/app/index.html packages/app/src/index.css packages/app/src/components/AppMenu.tsx packages/app/src/components/AppMenu.test.tsx packages/app/src/components/QuestionNavigator.tsx packages/app/src/components/QuestionNavigator.test.tsx packages/app/src/components/QuestionMedia.tsx packages/app/src/components/QuestionMedia.test.tsx packages/app/src/components/ChoiceList.tsx packages/app/src/components/ChoiceList.test.tsx
  git commit -m "style(app): complete prototype device vocabulary"
  ```

### Task 2: Align sign-in, library, test brief, and section rules

**Files:**
- Modify: `packages/app/src/pages/sign-in.tsx`
- Modify: `packages/app/src/pages/sign-in.test.tsx`
- Modify: `packages/app/src/pages/index.tsx`
- Modify: `packages/app/src/pages/index.test.tsx`
- Modify: `packages/app/src/pages/tests.$slug.tsx`
- Modify: `packages/app/src/pages/tests.$slug.test.tsx`
- Modify: `packages/app/src/pages/attempts.$attemptId.sections.$sectionId.rules.tsx`
- Modify: `packages/app/src/pages/attempts.$attemptId.sections.$sectionId.rules.test.tsx`

**Interfaces:**
- Consumes: Task 1's shared `device-page`, app-bar, main, footer, card, title, subtitle, button, and section-chip classes.
- Produces: the prototype-aligned entry flow used before the timed runner begins; no new data or routing interfaces.

- [ ] **Step 1: Add failing entry-flow layout tests**

  Add one layout contract test per route. Require the sign-in screen to use a centered main and restrained provider-neutral secondary button; require library/brief/rules to render a top app bar, prototype-width main, and bottom actions where the prototype has them. Assert listening chips use teal and reading chips use clay through `data-section-type`, not through translated text.

  ```tsx
  expect(screen.getByRole("main")).toHaveClass("device-main")
  expect(screen.getByRole("banner")).toHaveClass("app-bar")
  expect(screen.getByRole("contentinfo")).toHaveClass("device-footer")
  expect(sectionChip).toHaveAttribute("data-section-type", "reading")
  ```

- [ ] **Step 2: Run focused tests and confirm RED**

  Run:

  ```bash
  pnpm --filter @pp/app test -- src/pages/sign-in.test.tsx src/pages/index.test.tsx src/pages/tests.$slug.test.tsx 'src/pages/attempts.$attemptId.sections.$sectionId.rules.test.tsx'
  ```

  Expected: the new structural assertions fail on the old local utility layouts.

- [ ] **Step 3: Migrate entry-flow markup to shared device patterns**

  Preserve all current copy and interactions. Match prototype screen 01's centered hierarchy, screen 02's app bar/cards/stats, screen 03's section summary cards and save notice, and screen 04's centered untimed rules with section-specific chip. Keep real dynamic section counts and instructions rather than copying prototype sample content.

  Remove route-local generic card styling and palette drift. Use teal for listening, clay for reading, the existing amber notice treatment for finalized/expired information, and sticky bottom navigation only where the prototype provides actions.

- [ ] **Step 4: Run focused tests and build**

  Run the Step 2 command, then:

  ```bash
  pnpm --filter @pp/app build
  ```

  Expected: focused tests and build pass.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/app/src/pages/sign-in.tsx packages/app/src/pages/sign-in.test.tsx packages/app/src/pages/index.tsx packages/app/src/pages/index.test.tsx packages/app/src/pages/tests.$slug.tsx packages/app/src/pages/tests.$slug.test.tsx 'packages/app/src/pages/attempts.$attemptId.sections.$sectionId.rules.tsx' 'packages/app/src/pages/attempts.$attemptId.sections.$sectionId.rules.test.tsx'
  git commit -m "style(app): align entry flow with prototype"
  ```

### Task 3: Align listening, reading, and offline runner states

**Files:**
- Modify: `packages/app/src/pages/attempts.$attemptId.run.tsx`
- Modify: `packages/app/src/pages/attempts.$attemptId.run.test.tsx`
- Modify: `packages/app/src/components/ListeningRunner.tsx`
- Modify: `packages/app/src/components/ListeningRunner.test.tsx`
- Modify: `packages/app/src/components/ReadingRunner.tsx`
- Modify: `packages/app/src/components/ReadingRunner.test.tsx`
- Modify: `packages/app/src/components/OfflineBanner.tsx`
- Modify: `packages/app/src/components/SaveState.tsx`
- Modify: `packages/app/src/components/SaveState.test.tsx`

**Interfaces:**
- Consumes: Task 1's app bar, section chip, timer, body, progress pip, media, question, choice, save-state, and footer contracts.
- Produces: a full-height runner shell where listening and reading provide only the question body and route-owned navigation remains functional.

- [ ] **Step 1: Add failing runner layout tests**

  Require the run route to render `header.app-bar`, `main.device-main`, and `footer.device-footer`. Require runner question counters, pips with `data-state="done|now|future"`, prompt class, choice stack, and separated bottom actions. Require listening to omit Previous, reading to preserve Previous, and offline status to render as the prototype amber notice without replacing answer controls.

  ```tsx
  expect(screen.getByRole("banner")).toHaveClass("app-bar")
  expect(screen.getByRole("main")).toHaveClass("runner-main")
  expect(screen.getAllByTestId("question-pip")[0]).toHaveAttribute("data-state", "done")
  expect(screen.getByRole("alert", { name: /server/i })).toHaveClass("offline-notice")
  ```

  Use an accessible text query rather than `name` if the alert has no accessible name in the existing test fixture.

- [ ] **Step 2: Run runner tests and confirm RED**

  Run:

  ```bash
  pnpm --filter @pp/app test -- 'src/pages/attempts.$attemptId.run.test.tsx' src/components/ListeningRunner.test.tsx src/components/ReadingRunner.test.tsx src/components/SaveState.test.tsx
  ```

  Expected: structural and state-attribute assertions fail while existing behavior tests remain green.

- [ ] **Step 3: Implement the runner presentation**

  Reshape `ListeningRunner` and `ReadingRunner` into prototype body markup: uppercase question count, compact pip strip, media/passage, balanced prompt, choice stack, save-failure notice, and navigation controls. Derive pip `data-state` from the current pip and its order without making pips interactive.

  Update the route shell to match screens 05/06: menu trigger, section chip, save state, mono timer, navigator trigger, and sticky bottom navigation. Preserve all callbacks and lock/expiry paths. Style the offline banner as screen 12's notice embedded above the current question; do not add the prototype's separate diagnostic cards because production exposes only the pending count and retry state.

- [ ] **Step 4: Run runner tests and build**

  Run the Step 2 command, then:

  ```bash
  pnpm --filter @pp/app build
  ```

  Expected: all runner tests pass and build exits 0.

- [ ] **Step 5: Commit**

  ```bash
  git add 'packages/app/src/pages/attempts.$attemptId.run.tsx' 'packages/app/src/pages/attempts.$attemptId.run.test.tsx' packages/app/src/components/ListeningRunner.tsx packages/app/src/components/ListeningRunner.test.tsx packages/app/src/components/ReadingRunner.tsx packages/app/src/components/ReadingRunner.test.tsx packages/app/src/components/OfflineBanner.tsx packages/app/src/components/SaveState.tsx packages/app/src/components/SaveState.test.tsx
  git commit -m "style(app): match prototype runner screens"
  ```

### Task 4: Align hand-in confirmation and time-up

**Files:**
- Modify: `packages/app/src/pages/attempts.$attemptId.hand-in.tsx`
- Modify: `packages/app/src/pages/attempts.$attemptId.hand-in.test.tsx`
- Modify: `packages/app/src/pages/attempts.$attemptId.time-up.tsx`
- Modify: `packages/app/src/pages/attempts.$attemptId.time-up.test.tsx`

**Interfaces:**
- Consumes: Task 1's centered main, card, notice, buttons, app bar, timer, and footer classes.
- Produces: prototype screens 07 and 11 using current live counts and result URLs.

- [ ] **Step 1: Add failing completion-state layout tests**

  Require hand-in to show the prototype hierarchy: app bar, centered confirmation title, unanswered-warning notice when applicable, summary card, and footer actions. Require time-up to use the low timer state, centered title/reassurance, answer summary card, and primary result link.

  ```tsx
  expect(screen.getByRole("heading", { level: 1 })).toHaveClass("screen-title")
  expect(screen.getByText(/still blank/i)).toHaveClass("notice")
  expect(screen.getByText("00:00")).toHaveClass("timer", "timer-low")
  ```

- [ ] **Step 2: Run focused tests and confirm RED**

  Run:

  ```bash
  pnpm --filter @pp/app test -- 'src/pages/attempts.$attemptId.hand-in.test.tsx' 'src/pages/attempts.$attemptId.time-up.test.tsx'
  ```

  Expected: the new hierarchy/class assertions fail against the current generic card layout.

- [ ] **Step 3: Implement prototype completion-state layouts**

  Preserve submit/retry/expired branches and safe result URLs. Use real unanswered ordinals and counts; keep Hand in enabled while durable queued answers exist as required by existing behavior tests. Do not turn screen 07 into a browser modal—the route is already the production confirmation boundary and should visually reproduce the prototype screen.

- [ ] **Step 4: Run focused tests and build**

  Run the Step 2 command, then `pnpm --filter @pp/app build`.

- [ ] **Step 5: Commit**

  ```bash
  git add 'packages/app/src/pages/attempts.$attemptId.hand-in.tsx' 'packages/app/src/pages/attempts.$attemptId.hand-in.test.tsx' 'packages/app/src/pages/attempts.$attemptId.time-up.tsx' 'packages/app/src/pages/attempts.$attemptId.time-up.test.tsx'
  git commit -m "style(app): align submission states with prototype"
  ```

### Task 5: Align result and answer review

**Files:**
- Modify: `packages/app/src/pages/attempts.$attemptId.result.tsx`
- Modify: `packages/app/src/pages/attempts.$attemptId.result.test.tsx`
- Modify: `packages/app/src/pages/attempts.$attemptId.review.tsx`
- Modify: `packages/app/src/pages/attempts.$attemptId.review.test.tsx`

**Interfaces:**
- Consumes: Task 1's score ring, score bar, app bar, section chips, choice verdicts, navigator, device main, and footer classes.
- Produces: prototype screens 08 and 09 using the existing result/review API payloads.

- [ ] **Step 1: Add failing result/review layout tests**

  Require result to expose a CSS-variable-driven score ring, summary heading/callout, listening teal bar, reading clay bar, disclaimer, and bottom actions. Require review to use the prototype app bar/chip/count, question badge, prototype choice verdict states, blank notice, navigator trigger, and previous/next footer.

  ```tsx
  expect(screen.getByTestId("score-ring")).toHaveClass("score-ring")
  expect(screen.getByText("Listening").closest("section")).toHaveAttribute("data-section-type", "listening")
  expect(screen.getByText(/your answer/i).closest("li")).toHaveAttribute("data-verdict", "correct")
  ```

  Use translated test fixtures and existing accessible queries rather than hard-coding English where current tests already provide a key-safe query.

- [ ] **Step 2: Run focused tests and confirm RED**

  Run:

  ```bash
  pnpm --filter @pp/app test -- 'src/pages/attempts.$attemptId.result.test.tsx' 'src/pages/attempts.$attemptId.review.test.tsx'
  ```

  Expected: failures show the current `stone`/`emerald` card hierarchy does not expose the shared device contracts.

- [ ] **Step 3: Implement result and review presentation**

  Replace `stone`, `emerald`, `rose`, and default component-card styling with the device palette and shared classes. Drive the ring with an inline `--score-pct` custom property and `conic-gradient`, keeping the numeric text as the accessible result. Use `data-section-type` and `data-verdict` so style follows API semantics rather than item order or translated labels. Preserve signed media rendering, local previous/next navigation, review navigator behavior, and every current redirect/error branch.

- [ ] **Step 4: Run focused tests and build**

  Run the Step 2 command, then `pnpm --filter @pp/app build`.

- [ ] **Step 5: Commit**

  ```bash
  git add 'packages/app/src/pages/attempts.$attemptId.result.tsx' 'packages/app/src/pages/attempts.$attemptId.result.test.tsx' 'packages/app/src/pages/attempts.$attemptId.review.tsx' 'packages/app/src/pages/attempts.$attemptId.review.test.tsx'
  git commit -m "style(app): match prototype results and review"
  ```

### Task 6: Align history and close visual parity gaps

**Files:**
- Modify: `packages/app/src/pages/history.tsx`
- Modify: `packages/app/src/pages/history.test.tsx`
- Modify as required by verified parity gaps: files already touched in Tasks 1–5

**Interfaces:**
- Consumes: all shared device contracts from Task 1 and route layouts from Tasks 2–5.
- Produces: prototype screen 10 and a repository-wide production UI with no remaining unrelated `stone`/`slate`/numeric Tailwind palette on successful student-facing screens.

- [ ] **Step 1: Add failing history layout tests**

  Require an app bar, prototype title/subtitle, horizontally scrollable semantic table, score badges, distinct time-up status, full-width terminal pagination state, and library footer. Preserve dynamic section columns and missing-section labels.

  ```tsx
  expect(screen.getByRole("table")).toHaveClass("history-table")
  expect(screen.getByText(/time ran out/i)).toHaveAttribute("data-ended", "expired")
  expect(screen.getByRole("contentinfo")).toHaveClass("device-footer")
  ```

- [ ] **Step 2: Run history tests and confirm RED**

  Run:

  ```bash
  pnpm --filter @pp/app test -- src/pages/history.test.tsx
  ```

  Expected: new shared-layout assertions fail against the current generic card/table skin.

- [ ] **Step 3: Implement history presentation**

  Match prototype screen 10 while retaining pagination, dynamic columns, empty state, retry alert, and typed library navigation. Use device palette badges and status data attributes instead of `stone`, `teal-100`, or `amber-700` utilities.

- [ ] **Step 4: Audit successful-screen palette and structure**

  Search only student-facing successful layouts, not neutral error fallbacks, for stale generic palette classes:

  ```bash
  rg -n 'stone-|slate-|emerald-|rose-|teal-[0-9]|amber-[0-9]' packages/app/src/pages packages/app/src/components -g '*.tsx'
  ```

  For each hit in a successful screen, replace it with the shared device token/class that carries the same semantic state. Do not mechanically rewrite error states or third-party component internals without inspecting the context.

- [ ] **Step 5: Run the complete app verification**

  Run:

  ```bash
  pnpm --filter @pp/app test
  pnpm --filter @pp/app typecheck
  pnpm --filter @pp/app build
  pnpm lint:frontend
  ```

  Expected: every command exits 0 with pristine test output.

- [ ] **Step 6: Compare browser screenshots**

  Start the production-like app and compare at 390×844 and 1024×768 against the corresponding inner-device prototype screens. Verify at minimum sign-in, library, listening, reading, hand-in, result, review, history, time-up, open menu, open navigator, and offline banner. Record any deliberate data-driven difference; fix spacing, typography, overflow, and state-color gaps found during comparison.

- [ ] **Step 7: Re-run complete verification after screenshot fixes**

  Re-run all four Step 5 commands and confirm 0 failures.

- [ ] **Step 8: Commit**

  ```bash
  git add packages/app/src
  git commit -m "style(app): finish prototype fidelity pass"
  ```

## Final Acceptance

- [ ] Production pages reproduce the prototype's inner device UI, not its documentation shell.
- [ ] All twelve prototype states have a production counterpart or a documented data-contract limitation.
- [ ] Listening, reading, correctness, expiry, offline, selected, and current states use their prototype semantic colors.
- [ ] Menu and navigator overlays retain focus, Escape, scrim, and mutual-exclusion behavior.
- [ ] No API, timer, durable queue, route, i18n, or navigation behavior regresses.
- [ ] App tests, typecheck, build, and frontend lint all exit 0 after the final visual comparison.
