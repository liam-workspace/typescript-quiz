# Integrated Admin Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a protected, deployable `/admin` workspace for candidate review, quiz/draft management, draft-only question editing, learner-result inspection, and the mathematics generation workflow.

**Architecture:** Extend the existing React SPA and the Nest `AdminModule`; use the established OIDC session and server-side `AdminGuard` for every privileged endpoint. Keep normal quiz import/publish and attempt scoring as the authoritative workflows. Add read models and immutable audit records for administration, then add the math candidate workflow behind the same boundaries.

**Tech Stack:** React 19, TanStack Router, Tailwind v4, NestJS 11, PostgreSQL 16, node-pg-migrate, Zod 4, Vitest 4, Testcontainers, KaTeX.

**Spec:**
- `docs/superpowers/specs/2026-11-16-admin-module-design.md`
- `docs/superpowers/specs/2026-11-16-ai-math-generation-design.md`
- `docs/architecture/2026-11-16-ai-math-data-and-api-flows.md`
- `docs/processes/2026-11-16-ai-math-user-journeys-flow.md`

## Global Constraints

- Work on a feature branch in an isolated worktree; preserve unrelated parent-worktree changes.
- `/admin` is served by the existing SPA at `quiz.icovn.me/admin`; all API routes are under `/api`.
- Every `/api/admin/**` endpoint uses `JwksGuard` and `AdminGuard`; client routing is convenience, never authorization.
- `GET /api/me` is only usable after existing session provisioning; an admin must traverse the existing callback/session flow first.
- Roles remain token-derived at the identity provider. Admin may view learner profiles/results and, only if enabled, edit quiz-local level/profile fields—not access or role grants.
- Published `test_version`, question, choice, and math metadata remain immutable. Inline editing is draft-only.
- AI output is never source-of-truth or student-visible until deterministic validation, explicit approval, atomic draft import, and existing publication.
- Student runner payloads never expose answer specs, `is_correct`, canonical AST, provider output, or validator reports.
- `docs/db/schema.sql` is authoritative; migrations transcribe it. New versioned content descendants require published-version immutability protection.
- Do not hand-edit `packages/app/src/route.gen.ts`; Vite's TanStack Router plugin generates it.
- Use TDD per task, make focused commits, and run the task's narrow test command before each commit.

## Review Focus

1. **Authorization bypass:** test an authenticated non-admin on every new admin route; expect `403 admin_required` and no data leakage. Owned by Tasks 5–7.
2. **Draft versus published mutation:** test a draft edit succeeds while the same write against a published version is rejected by DB enforcement. Owned by Task 4.
3. **Atomic provenance import:** force an import-side failure and prove neither `question_math` nor its candidate link persists. Owned by Task 14.
4. **Sensitive result visibility:** verify aggregate listings avoid individual answers by default and attempt detail is admin-only and audit-logged. Owned by Tasks 3 and 6.
5. **Unsafe or wrong math candidate:** cover malformed JSON, invalid TeX, verifier mismatch, and duplicate canonical hash; all must remain non-importable. Owned by Tasks 13–17.

---

## File structure

| Area | Primary responsibility |
| --- | --- |
| `packages/common/src/admin-contract.ts` | Shared admin DTOs and Zod request schemas. |
| `packages/db/src/repositories/admin-*.repository.ts` | Bounded administrative projections, draft mutations, and audit writes. |
| `packages/server/src/admin/admin.controller.ts` / `admin.service.ts` | Existing module extended with admin reads, draft edits, and audit-aware operations. |
| `packages/app/src/pages/admin*.tsx` | Protected admin routes; generated route tree is not edited directly. |
| `packages/app/src/lib/admin-api.ts` | Typed admin HTTP client. |
| `packages/common/src/math/*` | Content blocks, canonical math AST, verification, and provider-independent contracts. |
| `packages/server/src/math/*` | Candidate lifecycle, async worker, and provider adapter. |
| `packages/db/src/repositories/math-*.repository.ts` | Candidate/workflow persistence and atomic math import support. |

## Tasks

### Task 1: Define shared admin contracts

**Files:**
- Create: `packages/common/src/admin-contract.ts`
- Modify: `packages/common/src/index.ts`
- Test: `packages/common/test/admin-contract.test.ts`

**Interfaces:**
- Produces `AdminOverview`, `AdminTestPage`, `AdminTestDetail`, `AdminQuestionPage`, `AdminResultPage`, `AdminAttemptDetail`, `AdminLearnerPage`, and `AdminAuditAction`.
- Produces `draftQuestionPatchSchema` accepting prompt/choice block edits only; it must reject answer-key changes for a published version at the service boundary.

- [ ] Write failing schema tests for valid pagination/filter data and rejected unknown or malformed draft patches.
- [ ] Run: `pnpm --filter @pp/common test admin-contract` — expect failure because the module is absent.
- [ ] Implement the DTOs and strict Zod schemas in `admin-contract.ts`; export them from `index.ts`.
- [ ] Run: `pnpm --filter @pp/common test admin-contract` — expect pass.
- [ ] Commit: `feat(common): add admin contracts`.

### Task 2: Add the immutable admin audit log

**Files:**
- Modify: `docs/db/schema.sql: authored-content/audit section and immutability triggers`
- Create: `packages/db/migrations/1007_admin_audit.cjs`
- Test: `packages/db/test/admin-audit.test.ts`

**Interfaces:**
- Produces `admin_audit_log` with `id`, `admin_subject`, `action`, `resource_type`, `resource_id`, JSONB `metadata`, and `created_at`.
- Produces append-only DB enforcement: insert allowed; update/delete rejected.

- [ ] Write failing DB tests for append, immutable update/delete rejection, and required nonblank audit identity/action fields.
- [ ] Run: `pnpm --filter @pp/db test admin-audit` — expect failure before the migration exists.
- [ ] Add the authoritative schema block, matching migration, constraints, and immutability trigger.
- [ ] Run: `pnpm --filter @pp/db test admin-audit` — expect pass.
- [ ] Commit: `feat(db): add immutable admin audit log`.

### Task 3: Build administrative read repositories

**Files:**
- Create: `packages/db/src/repositories/admin-read.repository.ts`
- Modify: `packages/db/src/admin.ts`
- Test: `packages/db/test/admin-read.test.ts`

**Interfaces:**
- Produces `loadAdminOverview(pool, input)`, `listAdminTests(pool, query)`, `loadAdminTestDetail(pool, testId)`, `listAdminResults(pool, query)`, `loadAdminAttemptDetail(pool, attemptId)`, and `listAdminLearners(pool, query)`.
- All list functions consume `{ limit: number; cursor: string | null; ...filters }` and return `{ items; nextCursor }`.

- [ ] Write failing repository tests for version-aware test listings, aggregate-only result list data, learner pagination, and absent-resource handling.
- [ ] Run: `pnpm --filter @pp/db test admin-read` — expect failure.
- [ ] Implement bounded SQL projections that never reuse student-owned result/review queries for admin access.
- [ ] Run: `pnpm --filter @pp/db test admin-read` — expect pass.
- [ ] Commit: `feat(db): add admin read projections`.

### Task 4: Implement draft-only question and choice mutation

**Files:**
- Create: `packages/db/src/repositories/admin-draft.repository.ts`
- Modify: `packages/db/src/admin.ts`
- Test: `packages/db/test/admin-draft.test.ts`

**Interfaces:**
- Produces `patchDraftQuestion(pool, { versionId, questionId, patch }): Promise<AdminQuestion>`.
- The patch accepts prompt/choice text or vetted content blocks, choice order, and correct-choice state. It rejects a question outside the supplied draft version and any published version.

- [ ] Write failing DB tests: valid draft patch, question/version mismatch rejection, and published-version mutation rejection.
- [ ] Run: `pnpm --filter @pp/db test admin-draft` — expect failure.
- [ ] Implement one transaction that locks the draft version, applies ordered choice updates, and relies on/extends published immutability constraints.
- [ ] Run: `pnpm --filter @pp/db test admin-draft` — expect pass.
- [ ] Commit: `feat(db): support draft question editing`.

### Task 5: Expose overview, catalogue, and question read APIs

**Files:**
- Modify: `packages/server/src/admin/admin.controller.ts:31-72`
- Modify: `packages/server/src/admin/admin.service.ts:175-360`
- Test: `packages/server/test/admin.e2e.test.ts`

**Interfaces:**
- Produces guarded `GET /api/admin/overview`, `GET /api/admin/tests`, `GET /api/admin/tests/:id`, and `GET /api/admin/questions`.
- Consumes repository interfaces from Task 3 and returns shared DTOs from Task 1.

- [ ] Add failing E2E cases for admin success, non-admin `403 admin_required`, pagination limits, and missing test `404`.
- [ ] Run: `pnpm --filter @pp/server test admin.e2e` — expect failure.
- [ ] Add controller/service methods without bypassing `JwksGuard` or `AdminGuard`; parse filters centrally and bound every page size.
- [ ] Run: `pnpm --filter @pp/server test admin.e2e` — expect pass.
- [ ] Commit: `feat(server): expose admin catalogue APIs`.

### Task 6: Expose results, learners, and audit-aware attempt detail APIs

**Files:**
- Modify: `packages/server/src/admin/admin.controller.ts:31-72`
- Modify: `packages/server/src/admin/admin.service.ts:175-360`
- Test: `packages/server/test/admin.e2e.test.ts`

**Interfaces:**
- Produces guarded `GET /api/admin/results`, `GET /api/admin/results/attempts/:id`, and `GET /api/admin/learners`.
- `GET /results/attempts/:id` writes `attempt_detail_viewed` to `admin_audit_log` with the admin subject and attempt ID.

- [ ] Add failing E2E cases for aggregate-only result lists, admin-only attempt detail, audit record creation, and non-admin denial.
- [ ] Run: `pnpm --filter @pp/server test admin.e2e` — expect failure.
- [ ] Implement the service/controller operations using Task 3 reads and Task 2 audit persistence.
- [ ] Run: `pnpm --filter @pp/server test admin.e2e` — expect pass.
- [ ] Commit: `feat(server): add admin result and learner APIs`.

### Task 7: Add guarded draft-edit API and audit entry

**Files:**
- Modify: `packages/server/src/admin/admin.controller.ts:31-72`
- Modify: `packages/server/src/admin/admin.service.ts:175-360`
- Test: `packages/server/test/admin.e2e.test.ts`

**Interfaces:**
- Produces `PATCH /api/admin/drafts/:versionId/questions/:questionId`, consuming `draftQuestionPatchSchema` and returning `AdminQuestion`.
- Writes `draft_question_updated` audit rows on success only.

- [ ] Add failing E2E cases for a valid draft edit, published-version rejection, question/version mismatch, and non-admin denial.
- [ ] Run: `pnpm --filter @pp/server test admin.e2e` — expect failure.
- [ ] Implement controller validation, service orchestration, and audit append after the mutation commits.
- [ ] Run: `pnpm --filter @pp/server test admin.e2e` — expect pass.
- [ ] Commit: `feat(server): add audited draft editing`.

### Task 8: Create the protected admin route shell

**Files:**
- Create: `packages/app/src/lib/admin-auth.ts`
- Create: `packages/app/src/pages/admin.tsx`
- Test: `packages/app/src/pages/admin.test.tsx`

**Interfaces:**
- Produces `requireAdmin(): Promise<Student>` using `getCurrentStudent()`.
- Produces a TanStack `/admin` layout route with overview, candidates, quizzes, questions, results, and learners navigation.

- [ ] Write failing route tests for unauthenticated redirect, authenticated non-admin redirect, and admin layout rendering.
- [ ] Run: `pnpm --filter @pp/app test admin.test` — expect failure.
- [ ] Implement the async route guard and accessible layout; do not modify generated `route.gen.ts`.
- [ ] Run: `pnpm --filter @pp/app test admin.test` — expect pass.
- [ ] Commit: `feat(app): add protected admin shell`.

### Task 9: Add typed admin client functions

**Files:**
- Create: `packages/app/src/lib/admin-api.ts`
- Modify: `packages/app/src/lib/api-types.ts: admin DTO section`
- Test: `packages/app/src/lib/admin-api.test.ts`

**Interfaces:**
- Produces `getAdminOverview`, `listAdminTests`, `getAdminTest`, `listAdminQuestions`, `patchDraftQuestion`, `listAdminResults`, `getAdminAttempt`, and `listAdminLearners`.
- All functions use `apiFetch` and the `/api` prefix indirectly; no custom fetch/auth implementation.

- [ ] Write failing client tests for URL/query encoding, PATCH payload, and API error propagation.
- [ ] Run: `pnpm --filter @pp/app test admin-api.test` — expect failure.
- [ ] Implement typed wrappers and matching DTOs.
- [ ] Run: `pnpm --filter @pp/app test admin-api.test` — expect pass.
- [ ] Commit: `feat(app): add admin API client`.

### Task 10: Build overview and quiz catalogue screens

**Files:**
- Create: `packages/app/src/pages/admin.index.tsx`
- Create: `packages/app/src/pages/admin.quizzes.tsx`
- Test: `packages/app/src/pages/admin.quizzes.test.tsx`

**Interfaces:**
- Consumes `getAdminOverview` and `listAdminTests` from Task 9.
- Produces `/admin` overview and `/admin/quizzes` paginated catalogue routes.

- [ ] Write failing component tests for loading, empty, error, and draft/published lifecycle labels.
- [ ] Run: `pnpm --filter @pp/app test admin.quizzes.test` — expect failure.
- [ ] Implement responsive, accessible data views with links to quiz detail; no answer keys in list cells.
- [ ] Run: `pnpm --filter @pp/app test admin.quizzes.test` — expect pass.
- [ ] Commit: `feat(app): add admin overview and quiz catalogue`.

### Task 11: Build draft quiz and question editor

**Files:**
- Create: `packages/app/src/pages/admin.quizzes.$testId.tsx`
- Create: `packages/app/src/components/AdminQuestionEditor.tsx`
- Test: `packages/app/src/components/AdminQuestionEditor.test.tsx`

**Interfaces:**
- Consumes `getAdminTest` and `patchDraftQuestion` from Task 9.
- Produces draft edit controls for prompt, choices, order, and correct choice; published versions render read-only.

- [ ] Write failing component tests for editable draft, read-only published version, validation errors, and successful save refresh.
- [ ] Run: `pnpm --filter @pp/app test AdminQuestionEditor.test` — expect failure.
- [ ] Implement learner-preview first, explicit correct-answer controls, save feedback, and read-only published states.
- [ ] Run: `pnpm --filter @pp/app test AdminQuestionEditor.test` — expect pass.
- [ ] Commit: `feat(app): add draft question editor`.

### Task 12: Build result and learner screens

**Files:**
- Create: `packages/app/src/pages/admin.results.tsx`
- Create: `packages/app/src/pages/admin.learners.tsx`
- Test: `packages/app/src/pages/admin.results.test.tsx`

**Interfaces:**
- Consumes Task 9 result/attempt/learner functions.
- Produces `/admin/results` aggregate-first view and `/admin/learners` local-profile/result-history view.

- [ ] Write failing tests for aggregate defaults, filter changes, no-results state, and attempt-detail navigation.
- [ ] Run: `pnpm --filter @pp/app test admin.results.test` — expect failure.
- [ ] Implement pagination/filter UI and clearly label individual attempt detail as audited/read-only.
- [ ] Run: `pnpm --filter @pp/app test admin.results.test` — expect pass.
- [ ] Commit: `feat(app): add admin result and learner views`.

### Task 13: Add math content and candidate schema persistence

**Files:**
- Modify: `docs/db/schema.sql: section enum/content block/math workflow sections`
- Create: `packages/db/migrations/1008_math_candidates.cjs`
- Test: `packages/db/test/math-candidates.test.ts`

**Interfaces:**
- Adds `math` `section_type`, nullable `prompt_blocks`/`label_blocks`, `question_math`, `math_problem_template`, `ai_generation_request`, and `ai_generation_candidate`.
- Enforces candidate status transitions, canonical content-hash uniqueness, provenance linkage, and `question_math` published-version immutability.

- [ ] Write failing DB tests for candidate lifecycle, duplicate canonical hash, draft-only math metadata mutation, and published metadata rejection.
- [ ] Run: `pnpm --filter @pp/db test math-candidates` — expect failure.
- [ ] Implement the authoritative schema and matching migration; retain legacy flat prompt/label fields during dual-read/write.
- [ ] Run: `pnpm --filter @pp/db test math-candidates` — expect pass.
- [ ] Commit: `feat(db): add math candidate workflow schema`.

### Task 14: Implement canonical math contracts and deterministic verifier

**Files:**
- Modify: `packages/common/src/interchange/test-document.ts: choice/question schemas and exported types`
- Modify: `packages/common/src/index.ts`
- Create: `packages/common/src/math/verify.ts`
- Test: `packages/common/test/math-verify.test.ts`

**Interfaces:**
- Produces root-exported `MathAst`, `MathProblemSpec`, `ContentBlock`, `verifyMathProblem(spec): ValidationResult`, `deriveDistractors(spec)`, and `renderCanonicalLatex(ast)`.
- Extends `testDocumentSchema` with optional `promptBlocks` and `labelBlocks` while retaining required legacy `prompt` and `label` during dual-read/write migration.
- Supports only fraction addition, percentage of quantity, ratio, and one-variable linear equation families initially.

- [ ] Write failing tests for each supported family, equivalent/duplicate choices, invalid answer specs, and deterministic seed repeatability.
- [ ] Run: `pnpm --filter @pp/common test math-verify` — expect failure.
- [ ] Implement the allowlisted AST evaluator/verifier and interchange-schema extension; never parse TeX as the mathematical authority.
- [ ] Run: `pnpm --filter @pp/common test math-verify` — expect pass.
- [ ] Commit: `feat(common): add deterministic math verifier`.

### Task 15: Add candidate workflow repository

**Files:**
- Create: `packages/db/src/repositories/math-generation.repository.ts`
- Modify: `packages/db/src/admin.ts`
- Test: `packages/db/test/math-generation.repository.test.ts`

**Interfaces:**
- Produces `createGenerationRequest`, `claimQueuedGenerationRequest`,
  `insertGenerationCandidate`, `listGenerationRequests`, `listCandidates`,
  `loadCandidateDetail`, and `reviewCandidate`.
- `reviewCandidate` consumes `{ candidateId, reviewerSubject, decision,
  reason? }`, locks the candidate, allows approval only from `valid`, and
  returns the new lifecycle projection.

- [ ] Write failing repository tests for request claiming, provider-failure
  reports, valid-only approval, rejection reason persistence, and race-safe
  one-reviewer transition.
- [ ] Run: `pnpm --filter @pp/db test math-generation.repository` — expect
  failure.
- [ ] Implement workflow persistence using the Task 13 status constraints;
  raw provider output remains in the audit-only column.
- [ ] Run: `pnpm --filter @pp/db test math-generation.repository` — expect
  pass.
- [ ] Commit: `feat(db): add math generation workflow repository`.

### Task 16: Implement candidate generation and review API

**Files:**
- Create: `packages/server/src/math/math-generation.service.ts`
- Create: `packages/server/src/math/math-generation.controller.ts`
- Modify: `packages/server/src/admin/admin.module.ts: controller/provider registration`
- Test: `packages/server/test/math-generation.e2e.test.ts`

**Interfaces:**
- Produces guarded generation request, request-list, candidate-list/detail, and review endpoints defined in the math flow specification.
- Candidate review accepts `{ decision: "approved" | "rejected"; reason?: string }`; approval is allowed only from a deterministic-valid state and writes audit records.

- [ ] Write failing E2E cases for non-admin denial, request receipt, invalid candidate rejection, approve/reject lifecycle guards, and raw-output access audit records.
- [ ] Run: `pnpm --filter @pp/server test math-generation.e2e` — expect failure.
- [ ] Implement service/controller calls, register them in the existing `AdminModule`, and use a provider-independent adapter; run generation asynchronously and persist provider failures as candidate reports.
- [ ] Run: `pnpm --filter @pp/server test math-generation.e2e` — expect pass.
- [ ] Commit: `feat(server): add math generation review API`.

### Task 17: Build the candidate review UI and safe math rendering

**Files:**
- Modify: `packages/app/package.json: add KaTeX runtime dependency`
- Create: `packages/app/src/components/MathContent.tsx`
- Create: `packages/app/src/pages/admin.candidates.$candidateId.tsx`
- Test: `packages/app/src/pages/admin.candidates.$candidateId.test.tsx`

**Interfaces:**
- `MathContent({ blocks: ContentBlock[] })` renders text and vetted TeX using KaTeX with `trust: false`, `throwOnError: true`, bounded expansion/size, and `htmlAndMathml` output.
- Candidate detail consumes proposed candidate APIs and presents approve/reject only when the validation state permits it.

- [ ] Write failing tests for learner-faithful rendering, TeX error state, approve/reject affordances, and a hidden-by-default raw audit drawer.
- [ ] Run: `pnpm --filter @pp/app test admin.candidates` — expect failure.
- [ ] Implement candidate review page and reusable renderer; do not render provider raw output as HTML.
- [ ] Run: `pnpm --filter @pp/app test admin.candidates` — expect pass.
- [ ] Commit: `feat(app): add math candidate review`.

### Task 18: Atomically import approved candidates and expose math to the runner

**Files:**
- Modify: `packages/db/src/repositories/test-import.repository.ts:16-340`
- Modify: `packages/server/src/admin/admin.service.ts:175-360`
- Test: `packages/server/test/admin.e2e.test.ts`

**Interfaces:**
- Produces `importApprovedMathCandidates(input): Promise<ImportResult>` through a shared importer transaction.
- It creates draft `test_version`, questions/choices/blocks, `question_math`, and `source_candidate_id` together. Any validation or insert failure rolls back every row.

- [ ] Write failing E2E tests proving approved candidates import to a draft, question provenance exists, invalid/changed candidates cannot import, and a forced insert failure leaves no partial data.
- [ ] Run: `pnpm --filter @pp/server test admin.e2e` — expect failure.
- [ ] Refactor the importer into a shared transaction primitive used by ordinary and math imports; preserve existing exact import/export tests.
- [ ] Run: `pnpm --filter @pp/server test admin.e2e` and `pnpm --filter @pp/db test import-export` — expect pass.
- [ ] Commit: `feat(admin): import approved math candidates atomically`.

### Task 19: Complete runner blocks, API contract, and integration verification

**Files:**
- Modify: `packages/db/src/repositories/runner.repository.ts:132-205`
- Modify: `docs/api/openapi.yaml: admin and runner schemas`
- Test: `packages/server/test/attempts-runner.e2e.test.ts`

**Interfaces:**
- Extends runner/review DTOs with vetted content blocks and, only when solution policy permits, approved solution blocks after completion.
- Documents every new admin endpoint and its `401`/`403`/validation responses in OpenAPI.

- [ ] Write failing runner E2E cases that math blocks reach only published student runner payloads, answer keys/AST/provenance remain absent, and solution policy gates review output.
- [ ] Run: `pnpm --filter @pp/server test attempts-runner.e2e` — expect failure.
- [ ] Implement safe projections and contract changes; update app API types/routes as generated contract consumers require.
- [ ] Run: `pnpm --filter @pp/server test attempts-runner.e2e`, `pnpm lint:api`, and `pnpm --filter @pp/app test` — expect pass.
- [ ] Commit: `feat(runner): deliver published math content blocks`.

### Task 20: Whole-feature verification and deployment readiness

**Files:**
- Modify: `docs/superpowers/specs/2026-11-16-admin-module-design.md: success criteria/decisions`
- Modify: `docs/architecture/2026-11-16-ai-math-data-and-api-flows.md: implementation status`
- Test: existing targeted suites from Tasks 2–18

**Interfaces:**
- Produces an updated, evidence-backed implementation status and records any intentionally deferred local-profile editing, provider retention, or solution-policy decision.

- [ ] Run the targeted DB, server, and app suites from every task; record exact failures rather than masking baseline failures.
- [ ] Run `pnpm build`, `pnpm lint`, and `pnpm test`; investigate any regression introduced by this branch.
- [ ] Manually smoke-test an admin token at `/admin`, a non-admin token denial, draft editing, candidate review, import/publish, and a student math runner/review flow in the deployment-equivalent environment.
- [ ] Commit documentation/status updates only after evidence is recorded.

## Self-review

- **Spec coverage:** Tasks 1–12 cover the integrated admin access, quiz/draft management, result/learner visibility, and audit requirements. Tasks 13–19 cover the candidate workflow, deterministic math boundary, atomic import, and learner-safe rendering. Task 20 verifies all success criteria.
- **Type consistency:** Task 1 owns shared DTOs; Tasks 3–7 consume them; Task 9 mirrors them in the browser. Math types originate in Task 14 and are consumed by Tasks 15–19.
- **Review focus coverage:** authorization is tested in Tasks 5–7; draft mutation in Task 4/7; atomic import in Task 18; result privacy in Tasks 3/6; candidate validity in Tasks 13–17.
- **Proportion:** Tasks are layer-bounded and use narrow tests. Task 20 reaches the session threshold; begin a fresh session before adding further work. Split any task that grows beyond the listed files or introduces a second migration.

