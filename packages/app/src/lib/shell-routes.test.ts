import { describe, expect, it } from "vitest"
import { TAB_HREF, isAttemptPath, tabForPath } from "./shell-routes.js"

describe("tabForPath", () => {
  it.each([
    ["/", "library"],
    ["/history", "history"],
    ["/history/", "history"],
    ["/profile", "profile"],
  ])("%s → %s", (path, tab) => {
    expect(tabForPath(path)).toBe(tab)
  })

  it.each([
    "/sign-in",
    "/callback",
    "/tests/practice-1",
    "/attempts/a1/run",
    "/attempts/a1/result",
    "/admin",
    "/admin/quizzes",
  ])("%s shows no tab bar", (path) => {
    expect(tabForPath(path)).toBeNull()
  })
})

describe("isAttemptPath", () => {
  it("is true only under /attempts/", () => {
    expect(isAttemptPath("/attempts/a1/run")).toBe(true)
    expect(isAttemptPath("/history")).toBe(false)
    expect(isAttemptPath("/attemptsx")).toBe(false)
  })
})

describe("TAB_HREF", () => {
  it("maps every tab to its route", () => {
    expect(TAB_HREF).toEqual({
      library: "/",
      history: "/history",
      profile: "/profile",
    })
  })
})
