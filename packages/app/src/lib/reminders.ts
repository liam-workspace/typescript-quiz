export type ReminderState =
  | "off"
  | "on"
  | "denied"
  | "needs-install"
  | "unsupported"

/**
 * Task 6 ships the Profile row against this interface with no push backend:
 * every method answers "unsupported", which renders the row disabled with
 * an honest reason. Task 25 replaces these bodies (permission → subscribe
 * → PUT /api/me/reminders) without changing the shape.
 */
export const reminders: {
  state(): Promise<ReminderState>
  enable(): Promise<ReminderState>
  disable(): Promise<ReminderState>
} = {
  state: () => Promise.resolve("unsupported"),
  enable: () => Promise.resolve("unsupported"),
  disable: () => Promise.resolve("unsupported"),
}
