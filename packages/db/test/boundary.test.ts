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

// `exportTestDocument` emits isCorrect on every choice (test-import.repository.ts),
// the same disclosure risk that sent loadForScoring behind @pp/db/scoring above.
// AdminGuard protects the route; nothing stopped a student-facing route from
// importing the function directly until this case (and the barrel change it
// pins) closed that off.
it("does not expose exportTestDocument from the default entry point", async () => {
  const surface = await import("@pp/db")

  expect(Object.keys(surface)).not.toContain("exportTestDocument")
})

// `importTestDocument` carries no disclosure risk on its own, but it shares a
// module and an admin-only lifecycle with exportTestDocument, so it is
// fenced alongside it rather than split out.
it("does not expose importTestDocument from the default entry point", async () => {
  const surface = await import("@pp/db")

  expect(Object.keys(surface)).not.toContain("importTestDocument")
})

it("exposes both from the admin entry point", async () => {
  const admin = await import("@pp/db/admin")

  expect(typeof admin.importTestDocument).toBe("function")
  expect(typeof admin.exportTestDocument).toBe("function")
})
