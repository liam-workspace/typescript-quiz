# Task 5 Report: `PUT /attempts/{id}/position`

## Status

Implemented the position endpoint on `develop` from HEAD `98b1c4b`. The endpoint accepts the flat OpenAPI body `{ sectionId, questionId }`, returns `204` without a body on success, and exposes only the declared `401`, `403`, `409`, and `410` rule outcomes.

## Contract implementation

- Added `setPosition` to the attempt repository and the default `@pp/db` barrel.
- The repository locks the attempt row while comparing whole-test question ordinals. Free-navigation sections accept forward and backward moves. Forward-only sections accept higher and equal ordinals and return `navigation_locked` only for a lower ordinal.
- The target question is joined through its question group to the supplied section, and both must belong to the attempt's pinned test version before the position can be updated.
- The same row-locked decision reads the open section deadline using the injected clock. An elapsed section returns `section_expired` without changing the attempt's `in_progress` status or bookmark.
- Added `AttemptsService.setPosition`, which calls `loadRunningOwnedAttempt` before mutation. This preserves the existing ownership collapse to `403` and delegates attempt lazy-expiry grading to `finalizeExpiredAttempt` through the existing loader.
- Added `PUT /attempts/:id/position` with `@HttpCode(204)`. The controller awaits the service and returns `void`, so a successful response has no body.
- The repository operation receives the same injected-clock timestamp used by the ownership/expiry check. No database-side timestamp is written by this operation.

## TDD evidence

The endpoint e2e tests were written before production code. The red command was:

```text
pnpm --filter @pp/server exec vitest run test/attempts-position.e2e.test.ts
```

Actual red output:

```text
❯ test/attempts-position.e2e.test.ts (4 tests | 4 failed) 340ms
    × 204s with no body for a forward move and 409s navigation_locked for a backward move 83ms
    × 403s for another student's attempt and 204s the same move for its owner 26ms
    × 401s with no token 1ms
    × 410s and fully grades an attempt expired according to the injected clock 76ms

FAIL  test/attempts-position.e2e.test.ts > PUT /attempts/:id/position > 204s with no body for a forward move and 409s navigation_locked for a backward move
Error: expected 204 "No Content", got 404 "Not Found"

FAIL  test/attempts-position.e2e.test.ts > PUT /attempts/:id/position > 403s for another student's attempt and 204s the same move for its owner
Error: expected 403 "Forbidden", got 404 "Not Found"

FAIL  test/attempts-position.e2e.test.ts > PUT /attempts/:id/position > 401s with no token
Error: expected 401 "Unauthorized", got 404 "Not Found"

FAIL  test/attempts-position.e2e.test.ts > PUT /attempts/:id/position > 410s and fully grades an attempt expired according to the injected clock
Error: expected 410 "Gone", got 404 "Not Found"

Test Files  1 failed (1)
Tests       4 failed (4)
```

A review then identified the distinct `section_expired` branch in the OpenAPI `SectionOrAttemptExpired` response. Its fixed-clock test was also run before implementation and failed for the intended reason:

```text
FAIL  test/attempts-position.e2e.test.ts > PUT /attempts/:id/position > 410s section_expired without finalizing an attempt whose section clock elapsed
Error: expected 410 "Gone", got 204 "No Content"

Test Files  1 failed (1)
Tests       1 failed | 4 passed (5)
```

Focused green runs:

```text
packages/db/test/position-repository.test.ts: 5 passed
packages/server/test/attempts-position.e2e.test.ts: 5 passed
```

The repository cases cover free navigation forward and backward, forward-only movement forward, same-question re-confirmation, backward refusal, and persistence of both position columns. The e2e cases cover empty-body `204`, both forward-only directions, `401`, owner/stranger `403` bracketing, fixed-clock attempt-expiry finalization with all score columns populated, and fixed-clock section expiry that leaves the attempt running. The attempt-expiry assertion also verifies that node-postgres returns the `numeric` percentage as a string before conversion.

## Verification

The complete suite contains 228 tests: 16 common, 128 database, and 84 server tests.

The expanded server suite exposed an existing pagination race in the seed e2e: it searched only the default 20-item catalog page in a shared test database with more than 20 published fixtures. The test now requests the API's supported `limit=50`; the seed-plus-position pair and the complete 84-test server suite both pass with that deterministic boundary.

Final required gate command:

```text
pnpm lint && pnpm format && pnpm typecheck && pnpm test
```

Result: all four gates exited 0. The final test gate reported 228 passing tests and no failures.

## Concerns

None.
