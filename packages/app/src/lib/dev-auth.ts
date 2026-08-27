export function getDevBearerToken(): string | null {
  return (
    (import.meta.env as { readonly VITE_DEV_BEARER_TOKEN?: string })
      .VITE_DEV_BEARER_TOKEN ?? null
  )
}
