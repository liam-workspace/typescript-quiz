/**
 * Push-service hosts a Web Push endpoint may point at. The server POSTs to a
 * stored endpoint from inside its own network, so a student-supplied URL is an
 * SSRF vector unless it is pinned to the vendors browsers actually use:
 * Chrome/Android/Samsung/Opera/Brave (FCM), Firefox, Safari/Apple and
 * Edge (WNS). Matched on a label boundary, so `evilfcm.googleapis.com` and
 * `fcm.googleapis.com.evil.test` both fail.
 */
export const PUSH_ENDPOINT_HOST_SUFFIXES: readonly string[] = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.apple.com",
  "notify.windows.com",
]

export const MAX_PUSH_ENDPOINT_LENGTH = 2048

/** Lower-case, trimmed, no leading `*.`/`.`; blank entries dropped. */
export function normaliseHostSuffixes(suffixes: readonly string[]): string[] {
  return suffixes
    .map((suffix) =>
      suffix
        .trim()
        .toLowerCase()
        .replace(/^\*?\./, "")
        .replace(/\.$/, ""),
    )
    .filter((suffix) => suffix.length > 0)
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

/**
 * The canonical form of an allowed endpoint (`URL.href`, lower-case scheme and
 * host, no trailing dot, no default port), or `null` when it is not an allowed
 * push-service endpoint. This is the ONE predicate: the PUT validation stores
 * its result, and the scheduler must re-check the stored value with it at send
 * time (config can change, and a stored row outlives the config that admitted
 * it).
 */
export function canonicalPushEndpoint(
  value: string,
  extraSuffixes: readonly string[] = [],
): string | null {
  if (value.length > MAX_PUSH_ENDPOINT_LENGTH) {
    return null
  }

  // Percent-encoding in the authority is only ever an obfuscation attempt.
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*%/i.test(value.trim())) {
    return null
  }

  const url = parseUrl(value)

  if (
    url?.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== ""
  ) {
    return null
  }

  const host = url.hostname.replace(/\.$/, "")
  const suffixes = [
    ...PUSH_ENDPOINT_HOST_SUFFIXES,
    ...normaliseHostSuffixes(extraSuffixes),
  ]
  const allowed = suffixes.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  )

  if (!allowed) {
    return null
  }

  url.hostname = host

  return url.href.length > MAX_PUSH_ENDPOINT_LENGTH ? null : url.href
}

export function isAllowedPushEndpoint(
  value: string,
  extraSuffixes: readonly string[] = [],
): boolean {
  return canonicalPushEndpoint(value, extraSuffixes) !== null
}
