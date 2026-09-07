import type { NavigationMode } from "./domain/test.js"

/**
 * `forward_only` refuses a BACKWARD move only -- forward moves, and moves
 * to the question already current, succeed. A stray null `currentOrdinal`
 * (no position set yet, e.g. a section just entered) has nothing to be
 * backward from, so it never locks. This mirrors the two live decisions it
 * replaces: `setPositionInTransaction` (packages/db attempt.repository.ts)
 * and `resolveSectionRules`'s `navigationLocked` (packages/server
 * responses/section-rules.ts) -- both compared `target_ordinal <
 * current_ordinal` under `navigation === 'forward_only'`, not `navigation`
 * alone. A predicate keyed on `navigation` by itself cannot express "block
 * backward, allow forward" and would make a forward_only section
 * unnavigable if ever used for real gating.
 */
export function canSetPosition(
  navigation: NavigationMode,
  currentOrdinal: number | null,
  targetOrdinal: number,
): boolean {
  return !(
    navigation === "forward_only" &&
    currentOrdinal !== null &&
    targetOrdinal < currentOrdinal
  )
}

/**
 * `maxPlays === null` means unlimited, never zero -- no cap in this app is
 * ever 0 (`stimulus_max_plays_positive` / `section_max_plays_positive` both
 * require `> 0`). This is a read-only view of the decision; the actual
 * claim (`claimPlay` in packages/db media-play.repository.ts) makes the
 * same call atomically inside one SQL statement's WHERE clause, because a
 * separate read-then-write here would race two concurrent taps into
 * over-spending the cap.
 *
 * WHAT IT IS FOR, since nothing calls it yet: a CLIENT-SIDE affordance --
 * greying out the Play button once the cap is spent, so a child is not
 * invited to tap something that will be refused. It is deliberately NOT a
 * server-side gate.
 *
 * Do not "helpfully" wire this in front of `claimPlay`. Checking here and
 * writing there is exactly the read-then-write the SQL WHERE clause exists
 * to avoid, and it would let two concurrent taps both pass a cap of 3 at
 * playsUsed = 2. The atomic statement must remain the only decision-maker.
 */
export function canClaimPlay(
  maxPlays: number | null,
  playsUsed: number,
): boolean {
  return maxPlays === null || playsUsed < maxPlays
}

export function remainingPlays(
  maxPlays: number | null,
  playsUsed: number,
): number | null {
  return maxPlays === null ? null : Math.max(maxPlays - playsUsed, 0)
}

function sameSelection(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false
  }

  const sortedA = a.map((id) => id.toLowerCase()).sort()
  const sortedB = b.map((id) => id.toLowerCase()).sort()

  return sortedA.every((id, i) => id === sortedB[i])
}

/**
 * Tests the SELECTION, not the mere existence of a prior answer (openapi
 * saveResponse description) -- re-sending identical content under
 * allowAnswerChange: false is an idempotent no-op, or every network retry
 * would 409. Comparison is case-insensitive: choice ids are UUIDs, and a
 * client re-sending an uppercase UUID for the same choice must not be
 * treated as a different selection.
 */
export function canAcceptAnswerChange(
  allowAnswerChange: boolean,
  existingSelection: readonly string[] | null,
  incomingSelection: readonly string[],
): boolean {
  if (allowAnswerChange || existingSelection === null) {
    return true
  }

  return sameSelection(existingSelection, incomingSelection)
}

/**
 * Inclusive of the boundary: attempt_expired_pins_deadline requires
 * submitted_at = expires_at exactly, so "now === deadline" must count as
 * past, not still-running.
 */
export function isPastDeadline(deadline: Date | null, now: Date): boolean {
  return deadline !== null && now.getTime() >= deadline.getTime()
}
