import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import { ApiError } from "../lib/api-client.js"
import { CallbackRouteError, CallbackScreen, loadCallback } from "./callback.js"

describe("loadCallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("calls completeSignIn with the code and navigates to the remembered destination", async () => {
    const completeSignIn = vi.fn().mockResolvedValue({
      id: "student-1",
      created: false,
    })
    const readAndClearPostSignInRedirect = vi
      .fn()
      .mockReturnValue("/attempts/attempt-1/run")

    const target = await loadCallback("auth-code-1", {
      completeSignIn,
      readAndClearPostSignInRedirect,
    })

    expect(completeSignIn).toHaveBeenCalledWith("auth-code-1")
    expect(target).toBe("/attempts/attempt-1/run")
  })

  it("defaults to the library when nothing was remembered", async () => {
    const target = await loadCallback("auth-code-1", {
      completeSignIn: vi.fn().mockResolvedValue({ id: "student-1" }),
      readAndClearPostSignInRedirect: vi.fn().mockReturnValue(null),
    })

    expect(target).toBe("/")
  })

  it("rejects with a dedicated error when there is no code at all", async () => {
    await expect(
      loadCallback(undefined, {
        completeSignIn: vi.fn(),
        readAndClearPostSignInRedirect: vi.fn(),
      }),
    ).rejects.toThrow(/code/i)
  })
})

describe("CallbackRouteError", () => {
  afterEach(() => {
    cleanup()
  })

  it("renders 'this account cannot use this app' on a 403, with no retry control", () => {
    const error = new ApiError({
      type: "email_not_allowed",
      title: "not allowed",
      status: 403,
    })

    render(<CallbackRouteError error={error} />)

    expect(
      screen.getByText("This account cannot use this app."),
    ).toBeInTheDocument()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
  })

  it("offers one honest retry back to sign-in for any other failure", () => {
    render(<CallbackRouteError error={new Error("network down")} />)

    expect(
      screen.getByText("Something went wrong signing you in."),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Back to sign in" }),
    ).toHaveAttribute("href", "/sign-in")
  })
})

describe("CallbackScreen", () => {
  afterEach(() => {
    cleanup()
  })

  it("renders a working/loading state", () => {
    render(<CallbackScreen />)

    expect(screen.getByRole("status")).toHaveTextContent("Signing you in…")
  })
})
