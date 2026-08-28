import { apiFetch } from "./api-client.js"
import type { SessionResult, Student } from "./api-types.js"

/**
 * `POST /session` (openapi.yaml `establishSession`, session.controller.ts).
 * Called once by the OIDC callback route, after a token exists -- never
 * before, since the claims it provisions from come from the Bearer token,
 * not the request body (the body is empty). Upserts the student row and
 * returns it; `created` tells the callback whether this was a first sign-in
 * (`201`) or an existing student (`200`) -- both are success. A `403`
 * (email not on the allowlist) surfaces as an ordinary `ApiError`, exactly
 * like `getCurrentStudent`'s `404` -- the caller decides what to render.
 */
export function establishSession(): Promise<SessionResult> {
  return apiFetch<SessionResult>("/session", { method: "POST" })
}

/**
 * `GET /me` (openapi.yaml `/me`, served by session.controller.ts).
 *
 * A pure read of the signed-in student's profile. Its `404` is ordinary
 * rather than exceptional -- the contract says "No profile for this `sub`
 * -- call `POST /session` first", which is exactly the state of a fresh
 * install. Callers must treat a failure here as "we do not know the child's
 * name yet", never as a reason to fail the screen: the menu renders without
 * a student, and a runner that will not load is far worse than a menu that
 * cannot name you.
 */
export function getCurrentStudent(): Promise<Student> {
  return apiFetch<Student>("/me")
}
