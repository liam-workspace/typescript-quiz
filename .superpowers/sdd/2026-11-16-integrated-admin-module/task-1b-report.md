# Task 1b report: draft question mutation contract

## Outcome

Completed the contract correction. `draftQuestionPatchSchema` now requires every supplied choice to have a nonempty stable `id`, a nonblank bounded `label`, and boolean `isCorrect`; choice arrays retain the 2–100 item bounds and strict unknown-key rejection. The submitted array retains its order. Prompt validation remains nonblank and optional. `AdminQuestion.choices` now exposes `isCorrect: boolean` for the admin projection.

## Files changed

- `packages/common/src/admin-contract.ts`
- `packages/common/test/admin-contract.test.ts`

Tests cover valid `isCorrect` acceptance, missing/empty IDs, missing `isCorrect`, unknown choice and patch fields, minimum choice count, blank labels, and the admin projection type.

## Verification

- RED: `pnpm --filter @pp/common test admin-contract` failed on acceptance of choice `id` and `isCorrect` as unknown keys, as expected before the schema change.
- GREEN: `pnpm --filter @pp/common test admin-contract` — 9 tests passed.
- `pnpm --filter @pp/common test` — 58 tests passed across 4 files.
- `pnpm --filter @pp/common build` — passed.
- `git diff --check` — passed.

The package commands emit a warning because `.npmrc` references unset `NODE_AUTH_TOKEN`; it did not affect these runs.

## Commit

`3352599` (`fix(common): complete draft question patch contract`).
