import { AnswerQueue } from "../answerQueue.js"
import type { LocalAttemptState } from "./journal-types.js"
import { currentSubject, isOwnedBy } from "./owner.js"
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
 * Null unless THIS device holds work of the signed-in student's own attempt
 * that the server has not seen (unsent events, or a journal it refused) -- so
 * a genuine server failure is never disguised as "waiting", and another
 * student's attempt on a shared phone is never described.
 */
export async function loadWaitingSummary(
  attemptId: string,
): Promise<WaitingSummary | null> {
  const { journal } = await getAttemptRuntime()
  const state = await journal.getAttempt(attemptId)

  if (!state || !isOwnedBy(state, currentSubject())) {
    return null
  }

  if (
    state.serverKnown &&
    state.syncError === null &&
    (await journal.pendingCount(attemptId)) === 0
  ) {
    return null
  }

  const queue = await AnswerQueue.open()

  try {
    const items = await queue.snapshotForAttempt(attemptId)

    return summarizeWaiting(
      state,
      new Set(
        items
          .filter((item) => item.selectedChoiceIds.length > 0)
          .map((item) => item.questionId),
      ),
    )
  } finally {
    void queue.close()
  }
}
