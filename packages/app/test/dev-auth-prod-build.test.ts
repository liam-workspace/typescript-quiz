import { execFileSync } from "node:child_process"
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * "VITE_DEV_AUTH must be impossible to enable in a deployed build --
 * assert that, do not merely intend it" (plan, "Facts that constrain this
 * work"). `dev-auth.test.ts` pins the runtime logic
 * (`getDevBearerToken()` returns null outside `import.meta.env.DEV`), but
 * that only proves the FUNCTION is gated -- not that a real `vite build`
 * actually drops the branch and the secret from what ships. This runs an
 * actual production build with `VITE_DEV_AUTH=true` and a canary token set
 * (exactly the misconfiguration this gate exists to survive) and greps the
 * real output for both. Slower than a unit test; that cost buys the only
 * assertion that cannot be fooled by a refactor of `dev-auth.ts` that
 * keeps the unit test green while breaking the actual guarantee.
 */
describe("production build with VITE_DEV_AUTH misconfigured on", () => {
  // `vitest run` (this package's `test` script) always executes with cwd
  // set to `packages/app` -- same assumption `vite build` itself relies on
  // for its default config resolution.
  const appRoot = process.cwd()
  const canaryToken = "canary-build-secret-do-not-ship"
  let outDir = ""
  let builtSource = ""

  beforeAll(() => {
    outDir = mkdtempSync(join(tmpdir(), "pp-app-prod-build-"))

    // `NODE_ENV` (and `VITEST`) are already "test" in THIS process because
    // vitest set them -- inherited uncorrected, that makes the spawned
    // `vite build` resolve `import.meta.env.DEV` as true even with
    // `--mode production` passed, defeating the entire point of this test
    // (confirmed empirically: the canary token showed up in the bundle
    // until these were overridden). A real `vite build` invoked from a
    // plain shell never has this problem; this override makes the child
    // process match that real-world condition instead of vitest's own.
    execFileSync(
      "pnpm",
      ["exec", "vite", "build", "--mode", "production", "--outDir", outDir],
      {
        cwd: appRoot,
        env: {
          ...process.env,
          NODE_ENV: "production",
          VITEST: undefined,
          VITE_DEV_AUTH: "true",
          VITE_DEV_AUTH_TOKEN: canaryToken,
          VITE_DEV_EMAIL: "dev-canary@example.com",
        },
        stdio: "pipe",
      },
    )

    const assetsDir = join(outDir, "assets")

    builtSource = readdirSync(assetsDir)
      .filter((name) => name.endsWith(".js"))
      .map((name) => readFileSync(join(assetsDir, name), "utf8"))
      .join("\n")
  }, 60_000)

  afterAll(() => {
    if (outDir && process.env.KEEP_PROD_BUILD_TEST_OUTPUT !== "1") {
      rmSync(outDir, { recursive: true, force: true })
    }
  })

  it("does not ship the dev auth token, even a canary one that was actually set", () => {
    expect(builtSource).not.toContain(canaryToken)
  })

  it("does not ship the VITE_DEV_AUTH gate string at all -- the branch is dead code, not just false", () => {
    expect(builtSource).not.toContain("VITE_DEV_AUTH")
  })
})
