/**
 * Re-exported so no other package imports @liam-workspace/platform for a
 * clock. Service code takes a Clock; nothing calls new Date() or Date.now()
 * directly. Every deadline in this app is server-authoritative, and
 * createFixedClock is what turns an expiry test into an assertion rather
 * than a 50-minute sleep.
 *
 * Named one by one rather than `export *`: this package's public surface is
 * a deliberate allowlist, not the platform library's whole export list.
 * EntityId in particular is an abstraction this project declined — ids are
 * gen_random_uuid() strings on the wire — so it must not become reachable
 * through this barrel by accident.
 */
import {
  type Clock,
  type Result,
  ConflictError,
  NotFoundError,
  ValidationError,
  createFixedClock,
  err,
  ok,
  systemClock,
} from "@liam-workspace/platform"

export type { Clock, Result }

export {
  ConflictError,
  NotFoundError,
  ValidationError,
  createFixedClock,
  err,
  ok,
  systemClock,
}
