export type StartGate =
  | { readonly enabled: true }
  | {
      readonly enabled: false
      readonly reason: "needs-connection" | "finish-active-first"
    }

export interface StartGateInput {
  readonly online: boolean
  readonly saved: boolean
  /** True when this card's attempt is in progress AND its local state exists on this device. */
  readonly continuableLocally: boolean
  readonly isContinue: boolean
  readonly activeOtherTitle: string | null
}

/**
 * The prototype's `testCard` rule, as a pure function. Order matters: the
 * "one active attempt" rule applies online and offline; the connection rule
 * only bites offline. Continue has its own offline rule because resuming
 * needs the attempt's local state, which only exists if this device loaded it.
 */
export function startGate(input: StartGateInput): StartGate {
  if (!input.isContinue && input.activeOtherTitle !== null) {
    return { enabled: false, reason: "finish-active-first" }
  }

  if (input.online) {
    return { enabled: true }
  }

  const allowedOffline = input.isContinue
    ? input.continuableLocally
    : input.saved

  return allowedOffline
    ? { enabled: true }
    : { enabled: false, reason: "needs-connection" }
}
