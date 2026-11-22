import { describe, expect, it } from "vitest"
import {
  TAB_HREF,
  isInTestPath,
  isRunPath,
  tabForPath,
} from "./shell-routes.js"

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

describe("isInTestPath (D1)", () => {
  it.each([
    "/attempts/a1/run",
    "/attempts/a1/sections/s1/rules",
    "/attempts/a1/hand-in",
    "/attempts/a1/hand-in/",
  ])("is true while a test is being taken: %s", (path) => {
    expect(isInTestPath(path)).toBe(true)
  })

  it.each([
    "/attempts/a1/result",
    "/attempts/a1/review",
    "/attempts/a1/time-up",
    "/history",
    "/attemptsx/a1/run",
  ])("is false once the test is over or outside one: %s", (path) => {
    expect(isInTestPath(path)).toBe(false)
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

describe("isRunPath", () => {
  it("is true only for the run route", () => {
    expect(isRunPath("/attempts/a1/run")).toBe(true)
    expect(isRunPath("/attempts/a1/run/")).toBe(true)
    expect(isRunPath("/attempts/a1/result")).toBe(false)
    expect(isRunPath("/attempts/a1/sections/s1/rules")).toBe(false)
    expect(isRunPath("/history")).toBe(false)
  })
})
