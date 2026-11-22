import { currentAccessToken } from "../auth.js"
import type { LocalAttemptState } from "./journal-types.js"

/**
 * Whether `state` belongs to the student `sub`. Fails CLOSED: an attempt
 * with no recorded owner (or nobody signed in) is nobody's -- never
 * resumed, counted or synced -- so it can never be sent under the wrong
 * student (the server would 403 it and the journal would be stuck).
 */
export function isOwnedBy(
  state: Pick<LocalAttemptState, "ownerSub">,
  sub: string | null,
): boolean {
  return sub !== null && state.ownerSub === sub
}

/**
 * The signed-in student's JWT `sub`, read from the access token WITHOUT
 * verifying it: this is a local routing key (which student's offline work
 * this phone acts on), not a security decision -- the server re-verifies
 * every request and refuses a foreign attempt id. Null when signed out or
 * unreadable. An expired token still names its student, which is what an
 * offline phone needs.
 */
export function currentSubject(): string | null {
  const payload = currentAccessToken()?.split(".")[1]

  if (!payload) {
    return null
  }

  try {
    const json = atob(payload.replace(/-/gu, "+").replace(/_/gu, "/"))
    const claims: unknown = JSON.parse(json)
    const sub =
      typeof claims === "object" && claims !== null && "sub" in claims
        ? claims.sub
        : null

    return typeof sub === "string" ? sub : null
  } catch {
    return null
  }
}
