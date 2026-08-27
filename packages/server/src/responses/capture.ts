import type { PgPool } from "@liam-public/node-postgres"
import { HttpException, HttpStatus } from "@nestjs/common"
import { insertFailedWrite } from "@pp/db"
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
  pool: PgPool,
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
  pool: PgPool,
  req: ResponseRequest,
  input: Omit<CaptureInput, "itemOnly">,
): Promise<HttpException> {
  const capturedAs = await captureResponseRejection(pool, req, input)

  return new HttpException(
    {
      type: input.reason,
      title: rejectionTitle(input.reason),
      status: HttpStatus.CONFLICT,
      retryable: false,
      capturedAs,
    },
    HttpStatus.CONFLICT,
  )
}

export function captureItemRejection(
  pool: PgPool,
  req: ResponseRequest,
  input: Omit<CaptureInput, "itemOnly">,
): Promise<string> {
  return captureResponseRejection(pool, req, { ...input, itemOnly: true })
}
