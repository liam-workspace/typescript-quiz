import type { TestCard } from "./api-types.js"

export type TestCardAction =
  | { kind: "continue"; attemptId: string }
  | { kind: "start" }
  | { kind: "tryAgain" }
  | { kind: "seeResult"; attemptId: string }

type TestCardStanding = Pick<
  TestCard,
  "inProgressAttemptId" | "attemptCount" | "bestAttempt"
>

export function testCardActions(card: TestCardStanding): TestCardAction[] {
  if (card.inProgressAttemptId !== null) {
    return [{ kind: "continue", attemptId: card.inProgressAttemptId }]
  }

  const primaryAction: TestCardAction =
    card.attemptCount === 0 ? { kind: "start" } : { kind: "tryAgain" }

  if (card.bestAttempt === null) {
    return [primaryAction]
  }

  return [
    { kind: "seeResult", attemptId: card.bestAttempt.attemptId },
    primaryAction,
  ]
}
