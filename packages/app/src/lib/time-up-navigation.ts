import type { FinalizedAttempt } from "./api-types.js"
import { z } from "zod"

const finalizedAttemptSchema = z.object({
  id: z.string(),
  status: z.literal("expired"),
  submittedAt: z.string(),
  resultUrl: z.string(),
})

function storageKey(attemptId: string): string {
  return `time-up:${attemptId}`
}

export function storeTimeUpAttempt(
  storage: Storage,
  attempt: FinalizedAttempt,
): void {
  storage.setItem(storageKey(attempt.id), JSON.stringify(attempt))
}

export function takeTimeUpAttempt(
  storage: Storage,
  attemptId: string,
): FinalizedAttempt | undefined {
  const key = storageKey(attemptId)
  const serialized = storage.getItem(key)

  storage.removeItem(key)

  if (!serialized) {
    return undefined
  }

  try {
    const parsed = finalizedAttemptSchema.safeParse(JSON.parse(serialized))

    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}
