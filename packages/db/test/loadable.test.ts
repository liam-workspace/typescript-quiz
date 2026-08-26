import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"

const run = promisify(execFile)

/**
 * Node's real resolver, not Vite's. Plan 1 shipped packages that every test
 * could import and no Node process could, because vitest resolved the `.js`
 * specifiers Node takes literally. This test is the only thing that notices.
 */
describe("built output", () => {
  it("loads @pp/db in a plain Node ESM process", async () => {
    const { stdout } = await run("node", [
      "--input-type=module",
      "-e",
      'const m = await import("@pp/db"); console.log(typeof m.migrateToLatest)',
    ])
    expect(stdout.trim()).toBe("function")
  })

  it("loads @pp/common in a plain Node ESM process", async () => {
    const { stdout } = await run("node", [
      "--input-type=module",
      "-e",
      'const m = await import("@pp/common"); console.log(typeof m.asStudentId)',
    ])
    expect(stdout.trim()).toBe("function")
  })
})
