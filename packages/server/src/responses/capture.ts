import type { PgQueryable } from "@liam-workspace/node-postgres"
import { HttpStatus } from "@nestjs/common"
import { insertFailedWrite } from "@pp/db"
import { ProblemException } from "../attempts/problem.exception.js"
import type { CapturedRequest } from "../http/raw-body-json.middleware.js"

interface ResponseRequest extends CapturedRequest {
  method?: string
  originalUrl?: string
  url?: string
}

interface CaptureInput {
  attemptId: string
  body: unknown
  now: Date
  reason: string
  clientInstanceId: string
  itemOnly?: boolean
}

function rejectionTitle(reason: string): string {
  switch (reason) {
    case "answer_change_not_allowed":
      return "Answer changes are not allowed in this section."

    case "navigation_locked":
      return "This section runs forward only."

    default:
      return "The response could not be applied."
  }
}

async function captureResponseRejection(
  pool: PgQueryable,
  req: ResponseRequest,
  input: CaptureInput,
): Promise<string> {
  const serializedBody = JSON.stringify(input.body)
  const rawBody = input.itemOnly
    ? serializedBody
    : (req.rawBody?.toString("utf8") ?? serializedBody)

  const captured = await insertFailedWrite(pool, {
    attemptId: input.attemptId,
    route: `${req.method ?? ""} ${req.originalUrl ?? req.url ?? ""}${
      input.itemOnly ? " (item)" : ""
    }`,
    reason: input.reason,
    rawBody,
    byteSize: input.itemOnly
      ? Buffer.byteLength(rawBody)
      : (req.rawBodyByteCount ?? Buffer.byteLength(rawBody)),
    clientVersion:
      typeof req.headers["x-client-version"] === "string"
        ? req.headers["x-client-version"]
        : null,
    clientInstanceId: input.clientInstanceId,
    now: input.now,
  })

  return captured.id
}

export async function captureRejection(
  pool: PgQueryable,
  req: ResponseRequest,
  input: Omit<CaptureInput, "itemOnly">,
): Promise<ProblemException> {
  const capturedAs = await captureResponseRejection(pool, req, input)

  return new ProblemException({
    type: input.reason,
    title: rejectionTitle(input.reason),
    status: HttpStatus.CONFLICT,
    retryable: false,
    capturedAs,
  })
}

export function captureItemRejection(
  pool: PgQueryable,
  req: ResponseRequest,
  input: Omit<CaptureInput, "itemOnly">,
): Promise<string> {
  return captureResponseRejection(pool, req, { ...input, itemOnly: true })
}

export async function captureAttemptNotInProgressWrite(
  pool: PgQueryable,
  req: ResponseRequest,
  input: Omit<CaptureInput, "itemOnly" | "reason">,
): Promise<void> {
  await captureResponseRejection(pool, req, {
    ...input,
    reason: "attempt_expired",
  })
}

/**
 * A database error `writeResponse`/`applyResponse` (`@pp/db`) did not
 * recognise as one of ITS OWN rejection reasons (23503/23505/22P02/22003) --
 * a deadlock, a lock timeout, a serialization failure, or anything else this
 * app has not classified. `rejectionReasonFor` (response.repository.ts)
 * rethrows exactly these, on purpose: the repository's job is classifying
 * KNOWN business rejections, not deciding HTTP shape. Without a catch HERE,
 * at every call site that can throw one, the rethrown error fell straight
 * through `FailedWriteCaptureFilter` (whose `@Catch()` list names three
 * specific body-parsing signals, none of them this) to
 * `AllExceptionsFilter`'s bare `{statusCode, message, error}` 500 -- not
 * `application/problem+json`, and with NO `failed_write` row, breaking the
 * durability guarantee (spec §5 rule 4) for the one case it exists to catch:
 * an unclassified fault.
 *
 * `db_error:<code>` when the driver gives one, so a failed_write row is
 * triageable without opening the raw body; `unexpected_error` as the
 * fallback for anything with no `code` at all.
 */
function dbErrorReason(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error as { code?: unknown }

    if (typeof code === "string") {
      return `db_error:${code}`
    }
  }

  return "unexpected_error"
}

/**
 * Unlike `captureRejection` (409, `retryable: false` -- "never retry
 * identical body, it will be refused identically"), this IS retryable: a
 * deadlock or a lock timeout is exactly what openapi.yaml's rule 5 means by
 * "5xx back off" -- the identical body may well succeed on a later attempt.
 * `type` is always the fixed `unexpected_error` (openapi.yaml
 * `UnexpectedErrorProblem`), not the raw db error code -- that stays in the
 * captured `failed_write` row's `reason` column for triage, not on the wire
 * as a contract the client would have to keep up with as drivers change.
 */
export async function captureUnexpectedWriteError(
  pool: PgQueryable,
  req: ResponseRequest,
  input: {
    attemptId: string
    body: unknown
    now: Date
    clientInstanceId: string
    error: unknown
  },
): Promise<ProblemException> {
  const capturedAs = await captureResponseRejection(pool, req, {
    attemptId: input.attemptId,
    body: input.body,
    now: input.now,
    reason: dbErrorReason(input.error),
    clientInstanceId: input.clientInstanceId,
  })

  return new ProblemException({
    type: "unexpected_error",
    title:
      "The response could not be applied because of an unexpected server error.",
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    retryable: true,
    capturedAs,
  })
}
