import { HttpException } from "@nestjs/common"

/**
 * The wire shape openapi.yaml's `Problem` (RFC 9457) declares, plus room for
 * the specialised extensions that `allOf`-compose onto it:
 * `AttemptExpiredProblem`'s `attempt`, `PayloadCaptured`'s `capturedAs`, the
 * publish 422's `violations`. Those extra keys are NOT flattened away --
 * whatever is passed to the constructor IS the response body, verbatim.
 */
export interface ProblemBody {
  type: string
  title: string
  status: number
  detail?: string
  retryable?: false
  [extra: string]: unknown
}

/**
 * A Problem-shaped HttpException. Its body IS the wire body, verbatim -- no
 * merging with AllExceptionsFilter's `{error, message, statusCode}` default.
 * Every route this plan owns throws this, never a bare NestJS
 * `HttpException`, for any 4xx the contract shapes as a `Problem`.
 */
export class ProblemException extends HttpException {
  constructor(body: ProblemBody) {
    super(body, body.status)
  }
}
