import { apiFetch } from "./api-client.js"
import type { Student } from "./api-types.js"

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
