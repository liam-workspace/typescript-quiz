/**
 * Test-only: a `fetch` mock's first argument is `RequestInfo | URL`
 * (`string | Request | URL`), and `String(input)` on a `Request` falls
 * back to `Object`'s default `[object Object]` stringification rather
 * than the request's URL -- exactly the mistake oxlint's `no-base-to-string`
 * catches. Every fetch mock in this suite only ever receives a plain
 * string or a `URL` in practice (nothing here constructs a `Request`), but
 * handling `Request` explicitly keeps the helper honest rather than
 * assuming that.
 */
export function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input
  }

  if (input instanceof URL) {
    return input.href
  }

  return input.url
}
