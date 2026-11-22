import { execFileSync, spawnSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

/**
 * Runs the real docker-entrypoint.sh against a throw-away SPA directory. It
 * needs GNU `sed -i` (what the Alpine image has); BSD/macOS sed reads `-i`
 * differently, so the suite is skipped there rather than failing.
 */
const entrypoint = join(process.cwd(), "../../docker-entrypoint.sh")
const gnuSed = spawnSync("sed", ["--version"]).status === 0
const AUTH = {
  VITE_AUTH_ISSUER: "https://auth.example.test",
  VITE_AUTH_CLIENT_ID: "client",
  VITE_AUTH_REDIRECT_URI: "https://quiz.example.test/callback",
}
const dirs: string[] = []

function run(env: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "pp-entrypoint-"))

  dirs.push(dir)
  mkdirSync(join(dir, "assets"))
  writeFileSync(join(dir, "index.html"), "<html></html>")
  writeFileSync(
    join(dir, "assets", "app.js"),
    'const a="__VITE_AUTH_ISSUER__",b="__VITE_AUTH_CLIENT_ID__",c="__VITE_AUTH_REDIRECT_URI__",k="__VITE_VAPID_PUBLIC_KEY__";',
  )
  execFileSync("sh", [entrypoint, "true"], {
    env: { PATH: process.env.PATH ?? "", SPA_ROOT: dir, ...env },
    stdio: "pipe",
  })

  return readFileSync(join(dir, "assets", "app.js"), "utf8")
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe.skipIf(!gnuSed)("docker-entrypoint.sh — VAPID public key", () => {
  it("falls back to the server's VAPID_PUBLIC_KEY", () => {
    expect(run({ ...AUTH, VAPID_PUBLIC_KEY: "BPub_key-123" })).toContain(
      'k="BPub_key-123"',
    )
  })

  it("prefers an explicit VITE_VAPID_PUBLIC_KEY", () => {
    expect(
      run({
        ...AUTH,
        VITE_VAPID_PUBLIC_KEY: "explicit",
        VAPID_PUBLIC_KEY: "server",
      }),
    ).toContain('k="explicit"')
  })

  it("boots with NO key and ships an empty string, not the placeholder", () => {
    const built = run(AUTH)

    expect(built).toContain('k=""')
    expect(built).not.toContain("__VITE_")
  })

  it("keeps sed-special characters in the value intact", () => {
    expect(run({ ...AUTH, VAPID_PUBLIC_KEY: "a&b|c\\d" })).toContain(
      'k="a&b|c\\d"',
    )
  })

  it("still fails closed on a missing auth variable", () => {
    expect(() => run({ VITE_AUTH_ISSUER: "x" })).toThrow()
  })
})

describe("compose.yml — the api service shuts down cleanly (B6)", () => {
  const compose = readFileSync(join(process.cwd(), "../../compose.yml"), "utf8")
  // The `api:` service block: from its key to the next top-level service.
  const api = /\n {2}api:\n([\s\S]*?)\n {2}[a-z]+:\n/u.exec(compose)?.[1] ?? ""

  it("runs node under an init, so the SIGTERM it re-raises after Nest's shutdown hooks ends it", () => {
    expect(api).toMatch(/\n {4}init: true\n/u)
  })

  it("gives the shutdown hooks time to finish before SIGKILL", () => {
    expect(api).toMatch(/\n {4}stop_grace_period: 30s\n/u)
  })
})
