import { HttpStatus } from "@nestjs/common"
import { ProblemException } from "./attempts/problem.exception.js"

const MIN_LIMIT = 1
const MAX_LIMIT = 50
const DEFAULT_LIMIT = 20

/**
 * Shared by every keyset-paginated student endpoint. A silently clamped
 * limit would make a client's pagination arithmetic wrong with no signal,
 * so anything outside 1..50 is a 400.
 */
export function parseLimit(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_LIMIT
  }

  const value = Number(raw)

  if (!Number.isInteger(value) || value < MIN_LIMIT || value > MAX_LIMIT) {
    throw new ProblemException({
      type: "bad_limit",
      title: "The limit query parameter is invalid.",
      status: HttpStatus.BAD_REQUEST,
    })
  }

  return value
}
