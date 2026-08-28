import { beforeEach, describe, expect, it } from "vitest"
import {
  readAndClearPostSignInRedirect,
  savePostSignInRedirect,
} from "../src/lib/postSignInRedirect.js"

describe("postSignInRedirect", () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it("returns null when nothing was remembered", () => {
    expect(readAndClearPostSignInRedirect()).toBeNull()
  })

  it("returns the remembered destination", () => {
    savePostSignInRedirect("/attempts/attempt-1/run")

    expect(readAndClearPostSignInRedirect()).toBe("/attempts/attempt-1/run")
  })

  it("clears the destination once read, so it is not reused on a later sign-in", () => {
    savePostSignInRedirect("/attempts/attempt-1/run")

    readAndClearPostSignInRedirect()

    expect(readAndClearPostSignInRedirect()).toBeNull()
  })
})
