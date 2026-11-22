import { apiFetch } from "../api-client.js"
import type { OfflineBundle } from "../api-types.js"

export function getOfflineBundle(slug: string): Promise<OfflineBundle> {
  return apiFetch<OfflineBundle>(
    `/tests/${encodeURIComponent(slug)}/offline-bundle`,
  )
}
