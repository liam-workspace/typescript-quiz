import { apiFetch } from "./api-client.js"
import type { TestBrief, TestCatalogPage } from "./api-types.js"

export function listTests(
  cursor: string | null = null,
): Promise<TestCatalogPage> {
  if (cursor === null) {
    return apiFetch<TestCatalogPage>("/tests")
  }

  const query = new URLSearchParams({ cursor })

  return apiFetch<TestCatalogPage>(`/tests?${query.toString()}`)
}

export function getTest(slug: string): Promise<TestBrief> {
  return apiFetch<TestBrief>(`/tests/${encodeURIComponent(slug)}`)
}
