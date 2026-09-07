import {
  Catch,
  HttpStatus,
  PayloadTooLargeException,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common"

/** Structural, not express's Response -- see problem.filter.ts's own note. */
interface ProblemHttpResponse {
  status(code: number): ProblemHttpResponse
  type(contentType: string): ProblemHttpResponse
  json(body: unknown): void
}

/**
 * `FileInterceptor`'s multer wrapper throws its OWN `PayloadTooLargeException`
 * (see `@nestjs/platform-express`'s `multer.utils.js#transformException`)
 * BEFORE `AdminService.uploadMedia` ever runs -- application code never gets
 * a chance to throw a `ProblemException` for this one case, so
 * `ProblemExceptionFilter`'s narrow `@Catch(ProblemException)` cannot reach
 * it. This is the one framework-native exception `POST /admin/media`'s
 * contracted 413 (`Problem`) still needs converting, hence a second,
 * equally narrow, controller-scoped filter rather than widening
 * `ProblemExceptionFilter`'s catch class.
 */
@Catch(PayloadTooLargeException)
export class MulterPayloadTooLargeFilter implements ExceptionFilter {
  catch(_exception: PayloadTooLargeException, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<ProblemHttpResponse>()

    res
      .status(HttpStatus.PAYLOAD_TOO_LARGE)
      .type("application/problem+json")
      .json({
        type: "file_too_large",
        title: "File too large.",
        status: HttpStatus.PAYLOAD_TOO_LARGE,
      })
  }
}
