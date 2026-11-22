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

/**
 * Letters, digits and hyphens only, 1-63 characters, no leading or trailing
 * hyphen (punycode `xn--` labels are ASCII, so they pass). WHATWG `URL`
 * accepts far more in a hostname (`; ' " { } ` ! $ & ( ) * + , = ~ _`), and
 * the legacy `url.parse` that web-push 3.x uses reads some of those as the end
 * of the host, so `evil.test;.push.apple.com` would pass a suffix check yet be
 * requested as `evil.test`. Refusing every non-DNS character removes the
 * disagreement between parsers.
 */
const DNS_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/
const MAX_HOST_LENGTH = 253

function isDnsName(host: string): boolean {
  return (
    host.length <= MAX_HOST_LENGTH &&
    host.split(".").every((label) => DNS_LABEL.test(label))
  )
}

/**
 * A configured extra suffix opens the allow-list, so it must itself be a real
 * registrable-looking name: two or more DNS labels and an alphabetic top
 * label (refuses `com`, `localhost`, `internal`, `0.1`).
 */
export function isValidHostSuffix(suffix: string): boolean {
  const labels = suffix.split(".")

  return (
    labels.length >= 2 &&
    isDnsName(suffix) &&
    /^[a-z]/.test(labels[labels.length - 1])
  )
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

  // Defence in depth only: percent-encoding in the authority is an
  // obfuscation attempt. It does not catch every spelling (`https:%66cm...`,
  // `https:\\%66cm...`); those are safe regardless because every check below
  // runs on the DECODED `url.hostname` and the decoded form is what is stored.
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

  if (!isDnsName(host)) {
    return null
  }

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
