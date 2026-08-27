# Task 5 Report: Single-Response Write

## Outcome

Implemented `PUT /api/attempts/{id}/responses/{questionId}` on `develop`, starting from `342f652f668e9b28cd7e8be15fa75f63fff0f638`.

The endpoint now:

- validates the single-response body with a strict Zod DTO;
- requires a valid bearer token and an already-provisioned student;
- verifies attempt ownership through the existing owned/running attempt path;
- lazily finalizes a past-deadline attempt before returning the contract's `attempt_expired` 410;
- rejects an expired section with `section_expired` 410;
- rejects backward writes in a forward-only section with a captured `navigation_locked` 409;
- delegates answer-change enforcement and per-client sequence ordering to `@pp/db`'s existing atomic `writeResponse` repository function;
- persists valid-but-rejected writes with `insertFailedWrite` before returning a 409; and
- maps repository dates and outcomes to the OpenAPI wire shape.

No response ordering comparison was reimplemented in the server package. No raw-body middleware, global Zod pipe, failed-write repository sanitization, or global filter registration order was changed.

## TDD Evidence

The first test run failed during fixture setup because the test initially misread the existing flat `/api/session` response. That was corrected without adding production code. The required behavior red was then observed:

```text
$ pnpm --filter @pp/server test single-response

FAIL  test/single-response.e2e.test.ts > PUT /attempts/:id/responses/:questionId > applies a valid write and stores the acknowledged answer
AssertionError: expected 404 to be 200

- Expected
+ Received

- 200
+ 404

FAIL  test/single-response.e2e.test.ts > PUT /attempts/:id/responses/:questionId > 200s a stale write without replacing the winning answer
AssertionError: expected 404 to be 200

Test Files  1 failed (1)
Tests  2 failed (2)
Exit status 1
```

After the remaining contract branches were added to the same e2e suite, all eight cases failed against the missing route with HTTP 404. This confirmed that the tests exercised the application route rather than a repository mock or test-only handler.

## Stored-State Proof

The applied-write test sends sequence `1`, receives `200` with `status: "applied"`, then reads the response through `loadResponse`. It verifies the stored device id, numeric sequence, and winning choice id. It also asserts `typeof stored.seq === "number"`, covering the repository boundary conversion from PostgreSQL `bigint` string output.

The stale-write test sends sequence `50` and verifies that request is applied. It then replays sequence `1` for the same client instance with a different choice. The replay receives `200` with `status: "ignored_stale"`. A final `loadResponse` verifies that sequence `50` and its choice remain stored. This test fails if a handler acknowledges every request without writing, or if the stale request overwrites the winner.

The two 409 tests also assert database state:

- a forbidden answer change leaves the first answer stored and verifies the failed-write row's exact raw body, true byte size, reason, and client instance id;
- a backward response in a forward-only section creates no response row and returns a named capture id.

The expiry tests verify that no response is stored after section expiry and that attempt expiry changes the attempt row to `expired` with `submitted_at` pinned to the deadline.

## Files

Created:

- `packages/server/src/responses/dto.ts`
- `packages/server/src/responses/response-http-exception.filter.ts`
- `packages/server/src/responses/response-write.service.ts`
- `packages/server/src/responses/responses.module.ts`
- `packages/server/src/responses/single-response.controller.ts`
- `packages/server/test/single-response.e2e.test.ts`

Modified:

- `packages/server/src/app.module.ts`

The controller-scoped HTTP exception filter is required because the installed global formatter adds generic diagnostic keys to exception bodies. Both 410 schemas are closed with `additionalProperties: false`; the local filter returns the endpoint's declared problem body exactly while leaving malformed and oversized body signals to the existing global `FailedWriteCaptureFilter`.

## Verification

Focused verification:

```text
$ pnpm --filter @pp/server test single-response
Test Files  1 passed (1)
Tests  8 passed (8)
Exit status 0
```

The complete required command was run as one shell chain and its final exit code was checked:

```text
$ pnpm lint && pnpm format && pnpm typecheck && pnpm test
Exit status 0
```

Observed test totals:

- common: 16 passed;
- database: 140 passed;
- server: 98 passed;
- app: 92 passed;
- total: 346 passed.

No compiled `.js`, `.js.map`, or `.d.ts` files were found under `packages/server/src` or `packages/server/test`.

## Disagreements and Concerns

1. The brief's final step says Task 5 cannot become green independently, imports the not-yet-created Task 6 snapshot controller, and says not to commit. The execution requirements require a green, committed Task 5. The response module therefore registers only the single-response controller, and the shared service/helper behavior needed by this endpoint was implemented without adding Task 6's snapshot route.
2. The brief's interface summary describes `assertOwnsAttempt(pool, attemptId, studentId)`, while its code sample uses an injected pool and accepts `(subjectClaim, attemptId)`. The implementation follows the existing server pattern and the sample: the pool is injected, the subject resolves the student, and `loadRunningOwnedAttempt` performs ownership plus lazy expiry.
3. OpenAPI describes this operation's 409 as only `answer_change_not_allowed` or `navigation_locked`, while the existing repository also returns `unknown_question` as a rejected write and the brief maps every repository rejection to 409. The endpoint captures and maps that repository outcome to 409 to remain within the operation's declared status family, but the 409 description and repository outcome vocabulary still disagree.
4. OpenAPI does not list a 400 response for this operation, while the required global Zod pipe returns a captured 400 for an invalid DTO body. This pre-existing contract-versus-global-pipeline mismatch was not changed in Task 5.
