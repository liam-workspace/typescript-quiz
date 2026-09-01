import { describe, expect, it } from "vitest"
import {
  signMediaUrl,
  verifyMediaSignature,
} from "../src/media/media-signing.js"

const SECRET = "test-signing-secret"
const NOW = new Date("2026-08-27T10:00:00.000Z")
const EXPIRES_AT = new Date("2026-08-27T10:05:00.000Z")

/** Splits a signed `/api/media/<filename>?exp=..&sig=..` URL into its parts. */
function parseSignedUrl(url: string): {
  filename: string
  exp: string | undefined
  sig: string | undefined
} {
  const parsed = new URL(url, "http://media.test")
  const filename = parsed.pathname.replace(/^\/api\/media\//, "")

  return {
    filename,
    exp: parsed.searchParams.get("exp") ?? undefined,
    sig: parsed.searchParams.get("sig") ?? undefined,
  }
}

describe("signMediaUrl / verifyMediaSignature", () => {
  it("round-trips: a URL signed for a filename verifies for that filename", () => {
    const url = signMediaUrl("l07.mp3", EXPIRES_AT, SECRET)
    const { filename, exp, sig } = parseSignedUrl(url)

    expect(verifyMediaSignature(filename, exp, sig, SECRET, NOW)).toBe(true)
  })

  it("rejects a signature for a DIFFERENT filename", () => {
    const url = signMediaUrl("l07.mp3", EXPIRES_AT, SECRET)
    const { exp, sig } = parseSignedUrl(url)

    expect(verifyMediaSignature("other.mp3", exp, sig, SECRET, NOW)).toBe(false)
  })

  it("rejects once now is past the embedded expiry", () => {
    const url = signMediaUrl("l07.mp3", EXPIRES_AT, SECRET)
    const { filename, exp, sig } = parseSignedUrl(url)
    const afterExpiry = new Date(EXPIRES_AT.getTime() + 1)

    expect(verifyMediaSignature(filename, exp, sig, SECRET, afterExpiry)).toBe(
      false,
    )
  })

  it("rejects a tampered signature of the same length", () => {
    const url = signMediaUrl("l07.mp3", EXPIRES_AT, SECRET)
    const { filename, exp, sig } = parseSignedUrl(url)

    if (!sig) {
      throw new Error("signed URL carried no sig")
    }

    // Flip the last hex character to a different, still-valid hex digit --
    // same length, different signature.
    const lastChar = sig.at(-1)
    const flipped = lastChar === "0" ? "1" : "0"
    const tampered = `${sig.slice(0, -1)}${flipped}`

    expect(verifyMediaSignature(filename, exp, tampered, SECRET, NOW)).toBe(
      false,
    )
  })

  /**
   * The one case here that tampers with the PAYLOAD the signature protects,
   * not the signature itself: take a valid signed URL, push `exp` far into
   * the future, and replay the ORIGINAL `sig`. This only fails because
   * `signMediaUrl`'s HMAC covers the expiry as well as the filename --
   * every other case above tampers with `sig`, which would still pass this
   * one if a future refactor ever signed only the filename.
   */
  it("rejects an extended exp carrying the original signature", () => {
    const url = signMediaUrl("l07.mp3", EXPIRES_AT, SECRET)
    const { filename, sig } = parseSignedUrl(url)
    const farFuture = String(new Date("2099-01-01T00:00:00.000Z").getTime())

    expect(verifyMediaSignature(filename, farFuture, sig, SECRET, NOW)).toBe(
      false,
    )
  })

  it("rejects a missing exp or sig query param", () => {
    const url = signMediaUrl("l07.mp3", EXPIRES_AT, SECRET)
    const { filename, exp, sig } = parseSignedUrl(url)

    expect(verifyMediaSignature(filename, undefined, sig, SECRET, NOW)).toBe(
      false,
    )
    expect(verifyMediaSignature(filename, exp, undefined, SECRET, NOW)).toBe(
      false,
    )
  })
})
