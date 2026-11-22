import { z } from "zod"

export const REMINDER_LOCALES = ["de", "en", "es", "fr", "it", "ja"] as const

function isTimeZone(value: string): boolean {
  try {
    return (
      new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions()
        .timeZone.length > 0
    )
  } catch {
    return false
  }
}

const Base64Url = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+={0,2}$/, "invalid_base64url")

function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

/**
 * The endpoint is later requested by this server, so refuse hosts that are
 * never a push service: IP literals, `localhost` and credentials in the URL.
 */
function isPushServiceUrl(value: string): boolean {
  const url = parseUrl(value)

  if (url?.protocol !== "https:") {
    return false
  }

  const host = url.hostname

  return (
    url.username === "" &&
    url.password === "" &&
    host !== "localhost" &&
    !host.endsWith(".localhost") &&
    !host.startsWith("[") &&
    !/^\d+(\.\d+){3}$/.test(host)
  )
}

/**
 * `subscription` is `PushSubscription.toJSON()`: `{ endpoint, expirationTime,
 * keys: { p256dh, auth } }`. https-only because the push service is always
 * https and an `http://` endpoint would be a server-side request to a
 * client-chosen plain-text URL.
 */
export const ReminderSubscriptionSchema = z.strictObject({
  subscription: z.strictObject({
    endpoint: z
      .url()
      .max(2048)
      .refine(isPushServiceUrl, "endpoint_must_be_a_public_https_url"),
    expirationTime: z.number().nullable().optional(),
    keys: z.strictObject({
      p256dh: Base64Url,
      auth: Base64Url,
    }),
  }),
  timezone: z.string().min(1).max(64).refine(isTimeZone, "invalid_timezone"),
  locale: z.enum(REMINDER_LOCALES).default("en"),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
})

export class ReminderSubscriptionDto implements z.infer<
  typeof ReminderSubscriptionSchema
> {
  static readonly schema = ReminderSubscriptionSchema
  declare subscription: {
    endpoint: string
    expirationTime?: number | null
    keys: { p256dh: string; auth: string }
  }
  declare timezone: string
  declare locale: (typeof REMINDER_LOCALES)[number]
  declare hour: number
  declare minute: number
}
