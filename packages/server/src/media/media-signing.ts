import { createHmac, timingSafeEqual } from "node:crypto"

/**
 * The HMAC covers BOTH the filename and the expiry -- never just one. That
 * is what makes `verifyMediaSignature`'s exp-tampering case fail: a caller
 * who edits `?exp=` without also forging a matching `sig` is asking this
 * function to verify a signature over a payload it was never computed for.
 */
function computeSignature(
  filename: string,
  exp: string,
  secret: string,
): string {
  return createHmac("sha256", secret).update(`${filename}:${exp}`).digest("hex")
}

/**
 * Pure and synchronous -- no DB, no Clock injection. `now`/`expiresAt` are
 * taken directly so callers (and tests) control time explicitly rather than
 * this module reaching for a clock of its own.
 */
export function signMediaUrl(
  filename: string,
  expiresAt: Date,
  secret: string,
): string {
  const exp = String(expiresAt.getTime())
  const sig = computeSignature(filename, exp, secret)

  return `/media/${filename}?exp=${exp}&sig=${sig}`
}

/**
 * Constant-time signature comparison via `timingSafeEqual` -- a `===` here
 * would let an attacker recover the correct signature one byte at a time by
 * timing failed guesses, which defeats the entire point of signing the URL.
 *
 * `timingSafeEqual` throws on a length mismatch rather than returning
 * false, so a tampered `sig` of a different length is checked and rejected
 * BEFORE the call, not left to become an uncaught 500.
 */
export function verifyMediaSignature(
  filename: string,
  expQuery: string | undefined,
  sigQuery: string | undefined,
  secret: string,
  now: Date,
): boolean {
  if (!expQuery || !sigQuery) {
    return false
  }

  const expected = Buffer.from(
    computeSignature(filename, expQuery, secret),
    "hex",
  )
  const actual = Buffer.from(sigQuery, "hex")

  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return false
  }

  const expiresAtMs = Number(expQuery)

  if (!Number.isFinite(expiresAtMs)) {
    return false
  }

  return now.getTime() <= expiresAtMs
}
