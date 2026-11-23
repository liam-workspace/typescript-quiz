# New-session prompt — Implement the Integrated Admin Module

Copy the prompt below into a fresh Codex session.

```text
Implement the approved Integrated Admin Module using subagent-driven development.

Repository: /Users/liam/projects/typescript-quiz
Plan: docs/superpowers/plans/2026-11-16-integrated-admin-module.md
Specs:
- docs/superpowers/specs/2026-11-16-admin-module-design.md
- docs/superpowers/specs/2026-11-16-ai-math-generation-design.md
- docs/architecture/2026-11-16-ai-math-data-and-api-flows.md
- docs/processes/2026-11-16-ai-math-user-journeys-flow.md

Execution method is fixed: use the superpowers:subagent-driven-development skill. Read its complete SKILL.md, the complete plan, and every linked spec before implementation. Also use superpowers:using-git-worktrees before changing code.

Create an isolated worktree on a new feature branch named feature/integrated-admin-module. Do not work directly on main. Preserve all unrelated uncommitted files in the parent checkout. If the plan/spec files are untracked and absent from the new worktree, read them from the parent checkout by absolute path; do not delete, overwrite, or reset parent-worktree files.

Execute tasks strictly in plan order. For every task:
1. Use the plan task brief as the source of requirements.
2. Dispatch one fresh implementer subagent only; do not parallelize implementation tasks.
3. Require a focused commit and its narrow test evidence.
4. Dispatch a fresh task reviewer with the diff package, implementer report, and task brief.
5. Resolve critical/important review findings through the skill's fix loop before advancing.
6. Keep the skill ledger in this plan's SDD workspace.

Keep client-side checks as navigation UX only. Every /api/admin/** endpoint must enforce JwksGuard and AdminGuard. Preserve draft-only editing and published-version immutability. Keep role/access changes outside the quiz database. Do not expose answer keys, canonical AST, provider output, or validator reports through learner APIs. Do not hand-edit packages/app/src/route.gen.ts.

Before any merge, push, deployment, or other external side effect, stop and ask for explicit approval. At task completion, run the plan's final review and use superpowers:finishing-a-development-branch to present integration choices; do not merge or push automatically.
```
