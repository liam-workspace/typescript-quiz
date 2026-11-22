import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const SRC = join(import.meta.dirname, "..", "src")

function isPageSource(path: string): boolean {
  return path.endsWith(".tsx") && !path.endsWith(".test.tsx")
}

function sourceFiles(dir: string): string[] {
  const files: string[] = []

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)

    if (entry.isDirectory()) {
      files.push(...sourceFiles(path))
    } else if (isPageSource(path)) {
      files.push(path)
    }
  }

  return files
}

// An opening tag runs to the first `>` that is not the arrow of `=>` inside an
// attribute expression.
const H1_OPEN_TAG = /<h1\b(?:=>|[^>])*>/g

function isUnmarked(tag: string): boolean {
  return !tag.includes("data-page-title") || !tag.includes("tabIndex={-1}")
}

function unmarkedH1s(file: string): string[] {
  return [...readFileSync(file, "utf8").matchAll(H1_OPEN_TAG)]
    .map((match) => match[0])
    .filter(isUnmarked)
    .map((tag) => `${file}: ${tag}`)
}

// AppLayout's usePageTitleFocus moves focus to `[data-page-title]` on every
// route change; a page h1 without the marker silently loses that announcement.
describe("page titles", () => {
  it("marks every h1 as a focusable page title", () => {
    const files = sourceFiles(SRC)

    expect(files.length).toBeGreaterThan(0)
    expect(files.flatMap(unmarkedH1s)).toEqual([])
  })

  it("actually finds the h1s it guards", () => {
    const total = sourceFiles(SRC).reduce(
      (count, file) =>
        count + [...readFileSync(file, "utf8").matchAll(H1_OPEN_TAG)].length,
      0,
    )

    expect(total).toBeGreaterThan(5)
  })
})
