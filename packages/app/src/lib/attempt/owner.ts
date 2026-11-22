import { currentAccessToken } from "../auth.js"

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
