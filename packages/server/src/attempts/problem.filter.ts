import { Catch, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common"
import { ProblemException } from "./problem.exception.js"

/** Structural, not express's Response -- see test/helpers/app.ts's own note. */
interface ProblemHttpResponse {
  status(code: number): ProblemHttpResponse
  type(contentType: string): ProblemHttpResponse
  json(body: unknown): void
}

/**
 * Controller-scoped only -- `@UseFilters(ProblemExceptionFilter)`, never
 * `app.useGlobalFilters`. Catching only `ProblemException` (not
 * `HttpException` broadly) means an ordinary NestJS exception thrown on a
 * route this filter is attached to still falls through to
 * `AllExceptionsFilter`'s shape, unaffected -- the same guarantee the
 * negative case in problem.e2e.test.ts proves.
 */
@Catch(ProblemException)
export class ProblemExceptionFilter implements ExceptionFilter {
  catch(exception: ProblemException, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<ProblemHttpResponse>()

    res
      .status(exception.getStatus())
      .type("application/problem+json")
      .json(exception.getResponse())
  }
}
