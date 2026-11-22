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
