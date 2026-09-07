import { z } from "zod"

/**
 * A same-origin relative path, and nothing else.
 *
 * `resultUrl` reaches this app from more than one place a student does not
 * control the server for: the `finalizedPriorAttempt` search param (parsed
 * straight out of the URL a child taps into on a shared iPad) and the
 * `410 attempt_expired` response body. Either can, in principle, carry
 * `javascript:alert(1)` -- and rendering that into an `<a href>` executes
 * script in this app's origin, where the signed-in child's bearer token
 * lives.
 *
 * React does not stop this on its own. It escapes text nodes and attribute
 * VALUES, but `javascript:...` IS a syntactically valid attribute value --
 * there is nothing for that escaping to catch. (Recent React versions do
 * neutralise the literal `javascript:` scheme by rewriting it to a stub that
 * throws on click, but that is a single-scheme safety net, not a general
 * `href` sanitiser -- it does nothing for `data:`, `vbscript:`, or a
 * protocol-relative `//host/...` phishing redirect.)
 *
 * Constrained HERE, at the point each `resultUrl` is first parsed out of
 * untrusted input, rather than at each `<a>` that later renders it -- one
 * rule instead of one per render site, so a render site added later cannot
 * forget it. The server only ever issues paths like
 * `/api/attempts/<id>/result`; anything else did not come from the server.
 *
 * A leading `//` is rejected alongside the obvious cases: it is
 * protocol-relative, resolves off-origin, and still "starts with a slash".
 */
export const sameOriginPath = z
  .string()
  .refine(
    (value) => value.startsWith("/") && !value.startsWith("//"),
    "must be a same-origin relative path",
  )
