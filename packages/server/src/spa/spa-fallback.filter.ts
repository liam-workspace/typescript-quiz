import {
  Catch,
  NotFoundException,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common"
import { AllExceptionsFilter } from "@liam-workspace/node-nest-common"
import type { Request, Response } from "express"

const PWA_FILE =
  /^\/(?:sw\.js|push-sw\.js|manifest\.webmanifest|workbox-[\w-]+\.js)$/u

/**
 * A missing worker/manifest must be a real 404: answering `/sw.js` with
 * index.html makes the browser reject registration with a MIME error that
 * is far harder to diagnose than a plain 404. The same goes for push-sw.js,
 * which the worker pulls in with importScripts: HTML there aborts the
 * worker's install.
 */
export function shouldServeSpaShell(method: string, path: string): boolean {
  return (
    method === "GET" &&
    !path.startsWith("/api/") &&
    !path.startsWith("/media/") &&
    !PWA_FILE.test(path)
  )
}

/**
 * Serves the built SPA's `index.html` for any GET request that doesn't match
 * a route under `/api` or `/media`.
 *
 * This is a NestJS exception filter, not Express middleware, because it has
 * to be: `@nestjs/core`'s `RoutesResolver.registerNotFoundHandler` installs
 * an UNCONDITIONAL `app.use(handler)` on the underlying Express instance as
 * the very last step of `app.init()` (verified against the installed
 * `@nestjs/core@11.2.1` source, `router/routes-resolver.js`). That handler
 * throws a `NotFoundException` for literally every request that reaches it
 * and never calls `next()`, so any Express middleware or route added to the
 * same instance AFTER `app.init()`/`app.listen()` -- a `server.use(...)`, a
 * wildcard `server.get(...)` -- is dead code; it is never reached. (This was
 * confirmed empirically: an earlier version of this file added a wildcard
 * `server.get()` after `app.init()` and every non-API path 404'd instead of
 * serving the SPA shell.) The one place left in the request lifecycle where
 * a fallback can still run is exactly here -- catching the
 * `NotFoundException` Nest's own not-found handler throws, which flows
 * through the same global-filter pipeline as every other exception.
 *
 * Registration order matters: `main.ts` must register this AFTER
 * `AllExceptionsFilter` (which `@Catch()`es everything) in the
 * `useGlobalFilters` call. `@nestjs/core`'s `RouterExceptionFilters.create`
 * reverses the globally-registered filter array before selecting a match
 * (see the verified note on `FailedWriteCaptureFilter`), so the filter
 * checked FIRST is the one registered LAST -- this filter's narrower
 * `@Catch(NotFoundException)` must win that check before the broad
 * `AllExceptionsFilter` ever gets a look, or every 404 -- SPA fallback and
 * genuine "no such API route" alike -- would go through `AllExceptionsFilter`
 * instead.
 *
 * Real 404s that are NOT the SPA's concern -- an unmatched `/api/*` or
 * `/media/*` path, or a non-GET request -- delegate to `AllExceptionsFilter`
 * so the response shape for those is unchanged by this filter's existence.
 */
@Catch(NotFoundException)
export class SpaFallbackFilter implements ExceptionFilter {
  private readonly delegate = new AllExceptionsFilter()

  constructor(private readonly spaRoot: string) {}

  catch(exception: NotFoundException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const req = ctx.getRequest<Request>()
    const res = ctx.getResponse<Response>()

    const servesSpa = shouldServeSpaShell(req.method, req.path)

    if (servesSpa) {
      // Keep hidden ancestors (e.g. .worktrees) outside dotfile checks.
      res.sendFile("index.html", {
        root: this.spaRoot,
        headers: { "Cache-Control": "no-cache" },
      })

      return
    }

    this.delegate.catch(exception, host)
  }
}
