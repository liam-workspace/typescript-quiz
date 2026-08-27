import type { PgPool } from "@liam-public/node-postgres"

/**
 * Wraps a real `PgPool` so any query whose SQL text matches `shouldFail`
 * rejects with `error` instead of running -- everything else (fixture
 * setup, unrelated reads/writes, including whatever else the SAME request
 * does before or after the poisoned query) passes straight through to the
 * real pool untouched.
 *
 * Built for exactly one thing: proving `captureUnexpectedWriteError`'s wire
 * behaviour (packages/server/src/responses/capture.ts) against a database
 * error `response.repository.ts`'s `rejectionReasonFor` does not
 * recognise -- a deadlock, a lock timeout, a serialization failure, or (as
 * used here) anything else this API has not classified. Structural, not a
 * subclass of `pg.Pool`: `pg.Pool`'s own methods internally call
 * `this.connect()`, so wrapping via `Object.create`/prototype delegation
 * would hijack every query through this pool, not just the one this test
 * means to poison. Interception happens at the single seam
 * `withTransaction` (`@liam-public/node-postgres`) and `pg.Pool.query`
 * actually use: `.connect()` returns a client, and every query -- explicit
 * or the implicit one behind `pool.query()` -- ultimately runs as
 * `client.query()`.
 */
export function createFaultInjectingPool(
  realPool: PgPool,
  shouldFail: (sql: string) => boolean,
  error: Error,
): PgPool {
  function sqlOf(args: unknown[]): string | undefined {
    const [first] = args

    if (typeof first === "string") {
      return first
    }

    if (
      typeof first === "object" &&
      first !== null &&
      "text" in first &&
      typeof (first as { text: unknown }).text === "string"
    ) {
      return (first as { text: string }).text
    }

    return undefined
  }

  function poisonedQuery(
    target: { query: (...args: unknown[]) => unknown },
    args: unknown[],
  ): unknown {
    const sql = sqlOf(args)

    if (sql !== undefined && shouldFail(sql)) {
      return Promise.reject(error)
    }

    return target.query(...args)
  }

  const wrapped = {
    query: (...args: unknown[]) => poisonedQuery(realPool, args),
    connect: async (...args: unknown[]) => {
      const client = (await (realPool.connect as (...a: unknown[]) => unknown)(
        ...args,
      )) as {
        query: (...a: unknown[]) => unknown
        release: (...a: unknown[]) => unknown
      }

      return {
        query: (...queryArgs: unknown[]) => poisonedQuery(client, queryArgs),
        release: (...releaseArgs: unknown[]) => client.release(...releaseArgs),
      }
    },
  }

  return wrapped as unknown as PgPool
}
