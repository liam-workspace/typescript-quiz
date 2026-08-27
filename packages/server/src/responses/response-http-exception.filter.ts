import {
  Catch,
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common"

interface JsonResponse {
  status(code: number): this
  json(body: unknown): void
}

/**
 * The global formatter intentionally adds generic diagnostic keys, while
 * the response-write 410 schemas are closed (`additionalProperties: false`).
 * Keep this mapper local to the controller whose contract needs the exact
 * RFC 9457 body rather than changing every existing endpoint at once.
 */
@Catch(HttpException)
export class ResponseHttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<JsonResponse>()

    response.status(exception.getStatus()).json(exception.getResponse())
  }
}
