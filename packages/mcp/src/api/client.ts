export interface ApiClient {
  get(path: string): Promise<unknown>
}

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`API request failed with ${status}`)
  }
}

interface ApiConfig {
  readonly apiBaseUrl: string
  readonly apiTimeoutMs: number
}

export function createApiClient(
  config: ApiConfig,
  bearer: string,
  fetchFn: typeof fetch = globalThis.fetch,
): ApiClient {
  return {
    async get(path: string): Promise<unknown> {
      if (!path.startsWith("/api/") || path.startsWith("//")) {
        throw new Error("MCP API path is not allowlisted")
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), config.apiTimeoutMs)

      try {
        const response = await fetchFn(`${config.apiBaseUrl}${path}`, {
          headers: { Authorization: `Bearer ${bearer}` },
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new ApiError(response.status)
        }

        return await response.json()
      } finally {
        clearTimeout(timeout)
      }
    },
  }
}
