import {
  Catch,
  Inject,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common"
import type { PgPool } from "@liam-workspace/node-postgres"
import type { Clock } from "@pp/common"
import { insertFailedWrite } from "@pp/db"
import { REQUEST_POOL, CLOCK } from "../database/tokens.js"
import {
  PayloadTooLargeSignal,
  UnparseableBodySignal,
  type CapturedRequest,
} from "../http/raw-body-json.middleware.js"
import { CapturableBadRequestException } from "../validation/zod-body-validation.pipe.js"

type CaughtException =
  | PayloadTooLargeSignal
  | UnparseableBodySignal
  | CapturableBadRequestException

/**
 * `CapturedRequest` plus the express-supplied fields this filter reads.
 * Structural, not express's `Request`, for the same reason `CapturedRequest`
 * itself is (see below).
 */
interface CapturableRequest extends CapturedRequest {
  params?: Record<string, string>
  method?: string
  originalUrl?: string
  url?: string
}

/**
 * Structural rather than express's Response: @types/express is not a
 * dependency of this package (see raw-body-json.middleware.ts's
 * `CapturedRequest` and session.controller.ts's `StatusSettable` for the
 * same rule applied elsewhere). `status`, `type` and `json` are all this
 * filter needs.
 */
interface JsonResponse {
  status(code: number): this
  type(contentType: string): this
  json(body: unknown): void
}

/**
 * `reason` distinguishes three causes that all land in the same table:
 * the two body-capture signals name their own condition; a schema
 * rejection carries the pipe's own `reason` (`invalid_body` or
 * `empty_batch`).
 */
function reasonFor(exception: CaughtException): string {
  if (exception instanceof PayloadTooLargeSignal) {
    return "payload_too_large"
  }

  if (exception instanceof UnparseableBodySignal) {
    return "unparseable_body"
  }

  return exception.reason
}

/**
 * Registered AFTER AllExceptionsFilter in main.ts's useGlobalFilters call --
 * verified against the installed `@nestjs/core@11.2.1` package rather than
 * assumed (the plan's draft claimed the opposite order; this is the
 * corrected, verified version). `@nestjs/common`'s
 * `selectExceptionFilterMetadata` does pick the first filter in array order
 * whose `@Catch()` list matches (or is empty, which is
 * `AllExceptionsFilter`'s case, matching unconditionally) -- but
 * `@nestjs/core`'s `RouterExceptionFilters.create` (used for BOTH the
 * per-route exception handler in `router-explorer.js` and the
 * middleware-error handler in `routes-resolver.js`) calls
 * `filters.reverse()` on the globally-registered array before handing it to
 * `selectExceptionFilterMetadata`. So the filter that must win has to be
 * registered LAST, not first -- confirmed empirically: registering this
 * filter first made every capture test observe a 500 from
 * `AllExceptionsFilter` instead of this filter's 400/413.
 *
 * Persists the request's raw bytes as a failed_write BEFORE the error
 * response is written -- the mechanism spec §5.4 requires, and the one
 * missing from the predecessor app that lost the answers.
 */
@Catch(
  PayloadTooLargeSignal,
  UnparseableBodySignal,
  CapturableBadRequestException,
)
export class FailedWriteCaptureFilter implements ExceptionFilter {
  constructor(
    @Inject(REQUEST_POOL) private readonly pool: PgPool,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async catch(exception: CaughtException, host: ArgumentsHost): Promise<void> {
    const ctx = host.switchToHttp()
    const req = ctx.getRequest<CapturableRequest>()
    const res = ctx.getResponse<JsonResponse>()

    const isOversized = exception instanceof PayloadTooLargeSignal

    // The parsed body never existed for either failure mode below -- fall
    // back to the raw bytes the middleware captured on the request. Only a
    // schema-rejection (body parsed fine, Zod refused its shape) has a
    // meaningful req.body to fall back on, and even then req.rawBody is the
    // exact bytes the client sent, so prefer it whenever it is present.
    const rawBody =
      req.rawBody !== undefined
        ? req.rawBody.toString("utf8")
        : JSON.stringify(req.body ?? {})

    const reason = reasonFor(exception)

    const captured = await insertFailedWrite(this.pool, {
      attemptId: typeof req.params?.id === "string" ? req.params.id : null,
      route: `${req.method ?? ""} ${req.originalUrl ?? req.url ?? ""}`,
      reason,
      rawBody,
      byteSize: req.rawBodyByteCount ?? null,
      clientVersion:
        typeof req.headers["x-client-version"] === "string"
          ? req.headers["x-client-version"]
          : null,
      clientInstanceId: null,
      now: this.clock.now(),
    })

    const status = isOversized ? 413 : 400

    res
      .status(status)
      .type("application/problem+json")
      .json({
        type: isOversized ? "payload_too_large" : reason,
        title: isOversized
          ? "Payload too large"
          : "The request body could not be applied",
        status,
        retryable: false,
        capturedAs: captured.id,
      })
  }
}
