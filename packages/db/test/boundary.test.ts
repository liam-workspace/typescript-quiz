// @ts-expect-error -- ScoringChoice must NOT be reachable from the default barrel
import type { ScoringChoice as _Leaked } from "@pp/common"
import { expect, it } from "vitest"

it("does not expose the scoring projection from the default entry point", async () => {
  const surface = await import("@pp/db")

  expect(Object.keys(surface)).not.toContain("loadForScoring")
})

it("exposes it from the scoring entry point", async () => {
  const scoring = await import("@pp/db/scoring")

  expect(typeof scoring.loadForScoring).toBe("function")
})
