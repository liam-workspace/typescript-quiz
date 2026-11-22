import { z } from "zod"
import { loadServerConfig } from "../config.js"
import { canonicalPushEndpoint } from "./push-endpoint.js"

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

/**
 * `subscription` is `PushSubscription.toJSON()`: `{ endpoint, expirationTime,
 * keys: { p256dh, auth } }`. The endpoint must be an allow-listed push-service
 * https host (see push-endpoint.ts): the server requests it later.
 */
export const ReminderSubscriptionSchema = z.strictObject({
  subscription: z.strictObject({
    // Stored canonical (lower-case scheme/host), so the UNIQUE endpoint index
    // compares canonical forms and the DB https check never sees `HTTPS://`.
    endpoint: z
      .string()
      .max(2048)
      .transform((value, ctx) => {
        const canonical = canonicalPushEndpoint(
          value,
          loadServerConfig().pushEndpointHosts,
        )

        if (canonical === null) {
          ctx.addIssue({
            code: "custom",
            message: "endpoint_host_not_allowed",
          })

          return z.NEVER
        }

        return canonical
      }),
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
