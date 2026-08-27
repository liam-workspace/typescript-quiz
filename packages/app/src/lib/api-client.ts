import { getDevBearerToken } from "./dev-auth.js"

export class ApiError extends Error {
  public readonly problem: {
    type: string
    title: string
    status: number
    detail?: string
  }

  public constructor(problem: ApiError["problem"]) {
    super(problem.type)
    this.problem = problem
  }
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = getDevBearerToken()
  const headers = new Headers(init.headers)

  if (token && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${token}`)
  }

  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json")
  }

  const response = await fetch(`/api${path}`, {
    ...init,
    headers,
  })

  if (response.status === 204) {
    return undefined as T
  }

  const body: unknown = await response.json()

  if (!response.ok) {
    throw new ApiError(body as ApiError["problem"])
  }

  return body as T
}
