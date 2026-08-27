import type { IncomingMessage, ServerResponse } from "node:http"

/**
 * Structural, not express's `Request`: @types/express is not a dependency
 * of this package (see session.controller.ts's `StatusSettable` for the
 * same rule applied to the response side). `IncomingMessage` plus the two
 * fields this middleware adds is everything a consumer needs.
 */
export interface CapturedRequest extends IncomingMessage {
  body?: unknown
  rawBody?: Buffer
  rawBodyByteCount?: number
}

/**
 * Thrown when the streamed body exceeds `maxBytes`. `req.rawBody` holds a
 * truncated prefix (up to `maxBytes`) captured before the connection was
 * dropped; `req.rawBodyByteCount` holds the true count observed, which may
 * exceed the prefix's length.
 */
export class PayloadTooLargeSignal extends Error {
  constructor() {
    super("payload_too_large")
  }
}

/**
 * Thrown when the body was within the size limit but is not valid JSON.
 * `req.rawBody` holds the complete body.
 */
export class UnparseableBodySignal extends Error {
  constructor() {
    super("unparseable_body")
  }
}

/**
 * True only for an exact `application/json` media type (parameters such as
 * `; charset=utf-8` are ignored, matching how a JSON body is actually
 * declared by every client this API expects). No express `req.is()`: see
 * the note on `CapturedRequest` above.
 */
function isJsonContentType(req: CapturedRequest): boolean {
  const header = req.headers["content-type"]

  if (!header) {
    return false
  }

  const mediaType = header.split(";")[0]?.trim().toLowerCase()

  return mediaType === "application/json"
}

/**
 * Replaces Nest's default body parser for the whole app (main.ts creates
 * the app with `bodyParser: false`). Captures every request's raw bytes
 * onto `req.rawBody` BEFORE attempting to parse them, so
 * FailedWriteCaptureFilter always has something to persist -- including the
 * oversized case, which Nest's own `rawBody: true` option cannot cover
 * (body-parser aborts before its `verify` hook runs).
 *
 * Assumes every request this app accepts declares `application/json`. A
 * request that does not is passed through unread -- there is no other
 * content type any route in this API accepts (media upload streams through
 * multer's own `multipart/form-data` parsing instead, and GET/DELETE
 * requests carry no body).
 */
export function createRawBodyJsonMiddleware(
  maxBytes: number,
): (
  req: CapturedRequest,
  res: ServerResponse,
  next: (err?: unknown) => void,
) => void {
  return function rawBodyJsonMiddleware(
    req: CapturedRequest,
    _res: ServerResponse,
    next: (err?: unknown) => void,
  ): void {
    if (!isJsonContentType(req)) {
      next()

      return
    }

    const chunks: Buffer[] = []
    let total = 0

    const onData = (chunk: Buffer): void => {
      total += chunk.length

      if (total > maxBytes) {
        // The chunk that pushed the total over the limit may itself carry
        // most (or all) of the bytes -- on a small request the whole body
        // often arrives in one "data" event, so `chunks` can still be empty
        // here. Slice the overflowing chunk down to whatever room is left
        // so the capture is a real truncated prefix up to maxBytes, not
        // whatever happened to be buffered from PRIOR whole chunks alone.
        const bufferedSoFar = chunks.reduce((sum, c) => sum + c.length, 0)
        const remainingCapacity = maxBytes - bufferedSoFar

        if (remainingCapacity > 0) {
          chunks.push(chunk.subarray(0, remainingCapacity))
        }

        req.rawBody = Buffer.concat(chunks)
        req.rawBodyByteCount = total
        // Stop consuming, but do not `req.destroy()` here: destroying the
        // request stream tears down the underlying socket immediately, and
        // an in-flight `next(err)` never gets the chance to write a
        // response on it -- the client sees a connection reset, not a 413.
        // Removing the only "data" listener pauses the stream instead, and
        // because the request body is then left unconsumed, Node's own
        // http server closes the connection once the error response has
        // been written (it will not risk keep-alive framing on a request it
        // never fully drained).
        req.off("data", onData)
        req.off("end", onEnd)
        next(new PayloadTooLargeSignal())

        return
      }

      chunks.push(chunk)
    }

    const onEnd = (): void => {
      const raw = Buffer.concat(chunks)
      req.rawBody = raw
      req.rawBodyByteCount = raw.length

      if (raw.length === 0) {
        req.body = {}
        next()

        return
      }

      try {
        req.body = JSON.parse(raw.toString("utf8")) as unknown
        next()
      } catch {
        next(new UnparseableBodySignal())
      }
    }

    req.on("data", onData)
    req.on("end", onEnd)
    req.on("error", next)
  }
}
