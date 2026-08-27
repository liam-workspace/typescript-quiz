import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import { ApiError } from "../lib/api-client.js"
import { enterSection } from "../lib/attempts-api.js"
import {
  SectionRulesScreen,
  searchSchema,
} from "./attempts.$attemptId.sections.$sectionId.rules.js"

vi.mock("../lib/attempts-api.js", () => ({
  enterSection: vi.fn(),
}))

const mockEnterSection = vi.mocked(enterSection)

// Built by concatenation, not as a string literal -- oxlint's `no-script-url`
// rule flags a literal `"javascript:..."` token even inside a test that
// asserts it gets rejected, and the point of these tests is to keep
// asserting rejection.
// oxlint-disable-next-line no-script-url -- the hostile scheme IS the fixture
const javascriptUrl = "javascript:alert(1)"

const baseProps = {
  attemptId: "attempt-1",
  sectionId: "section-1",
  title: "Listening — Part 1",
  instructions: ["Each recording plays once.", "You cannot pause or rewind."],
  finalizedPriorAttempt: null,
}

describe("SectionRulesScreen", () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it("renders the section's instructions from the SectionEntry it already has via loader data", () => {
    render(<SectionRulesScreen {...baseProps} navigate={vi.fn()} />)

    expect(screen.getByText("Listening — Part 1")).toBeInTheDocument()
    expect(screen.getByText("Each recording plays once.")).toBeInTheDocument()
    expect(screen.getByText("You cannot pause or rewind.")).toBeInTheDocument()
  })

  it("calls enterSection when the ready button is clicked, not on mount", async () => {
    mockEnterSection.mockResolvedValue({
      sectionId: "section-1",
      title: "Listening — Part 1",
      type: "listening",
      questionCount: 20,
      enteredAt: "2026-08-27T09:00:00.000Z",
      expiresAt: "2026-08-27T09:25:00.000Z",
      serverTime: "2026-08-27T09:00:00.000Z",
      navigation: "forward_only",
      allowAnswerChange: false,
      playback: null,
      instructions: baseProps.instructions,
    })
    const user = userEvent.setup()

    render(<SectionRulesScreen {...baseProps} navigate={vi.fn()} />)

    expect(mockEnterSection).not.toHaveBeenCalled()

    await user.click(screen.getByTestId("ready-button"))

    expect(mockEnterSection).toHaveBeenCalledExactlyOnceWith(
      "attempt-1",
      "section-1",
    )
  })

  it("navigates to the runner route on a successful enter", async () => {
    mockEnterSection.mockResolvedValue({
      sectionId: "section-1",
      title: "Listening — Part 1",
      type: "listening",
      questionCount: 20,
      enteredAt: "2026-08-27T09:00:00.000Z",
      expiresAt: "2026-08-27T09:25:00.000Z",
      serverTime: "2026-08-27T09:00:00.000Z",
      navigation: "forward_only",
      allowAnswerChange: false,
      playback: null,
      instructions: baseProps.instructions,
    })
    const navigate = vi.fn()
    const user = userEvent.setup()

    render(<SectionRulesScreen {...baseProps} navigate={navigate} />)

    await user.click(screen.getByTestId("ready-button"))

    expect(navigate).toHaveBeenCalledExactlyOnceWith("/attempts/attempt-1/run")
  })

  it("shows the finalizedPriorAttempt notice with a link to /result when the attempt-start carried one", () => {
    render(
      <SectionRulesScreen
        {...baseProps}
        finalizedPriorAttempt={{
          id: "attempt-0",
          status: "expired",
          submittedAt: "2026-08-27T08:00:00.000Z",
          resultUrl: "/api/attempts/attempt-0/result",
        }}
        navigate={vi.fn()}
      />,
    )

    const link = screen.getByRole("link", { name: "See it" })
    expect(link).toHaveAttribute("href", "/api/attempts/attempt-0/result")
  })

  it("does not show the finalizedPriorAttempt notice when attempt-start carried none", () => {
    render(<SectionRulesScreen {...baseProps} navigate={vi.fn()} />)

    expect(
      screen.queryByRole("link", { name: "See it" }),
    ).not.toBeInTheDocument()
  })

  it("disables the ready button while the enter call is in flight, to prevent a double POST", async () => {
    let resolveEnter: () => void = () => {
      // Replaced once the promise executor below runs.
    }
    mockEnterSection.mockReturnValue(
      new Promise((resolve) => {
        resolveEnter = () =>
          resolve({
            sectionId: "section-1",
            title: "Listening — Part 1",
            type: "listening",
            questionCount: 20,
            enteredAt: "2026-08-27T09:00:00.000Z",
            expiresAt: "2026-08-27T09:25:00.000Z",
            serverTime: "2026-08-27T09:00:00.000Z",
            navigation: "forward_only",
            allowAnswerChange: false,
            playback: null,
            instructions: baseProps.instructions,
          })
      }),
    )
    const user = userEvent.setup()

    render(<SectionRulesScreen {...baseProps} navigate={vi.fn()} />)

    const button = screen.getByTestId("ready-button")
    await user.click(button)

    expect(button).toBeDisabled()
    expect(mockEnterSection).toHaveBeenCalledTimes(1)

    resolveEnter()
  })

  it("surfaces a 409 (a previous section still open) as a refusal, not a retry", async () => {
    mockEnterSection.mockRejectedValue(
      new ApiError({
        type: "section_still_open",
        title: "A previous section is still open.",
        status: 409,
      }),
    )
    const navigate = vi.fn()
    const user = userEvent.setup()

    render(<SectionRulesScreen {...baseProps} navigate={navigate} />)

    await user.click(screen.getByTestId("ready-button"))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A previous section is still open. Finish it before starting this one.",
    )
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.getByTestId("ready-button")).toBeEnabled()
  })

  it("shows the section-expired state on a 410 section_expired without navigating", async () => {
    mockEnterSection.mockRejectedValue(
      new ApiError({
        type: "section_expired",
        title: "The section's clock ran out.",
        status: 410,
      }),
    )
    const navigate = vi.fn()
    const user = userEvent.setup()

    render(<SectionRulesScreen {...baseProps} navigate={navigate} />)

    await user.click(screen.getByTestId("ready-button"))

    expect(
      await screen.findByText("This section's time ran out."),
    ).toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.queryByTestId("ready-button")).not.toBeInTheDocument()
  })

  it("shows the attempt-expired state with a result link on a 410 attempt_expired", async () => {
    mockEnterSection.mockRejectedValue(
      new ApiError({
        type: "attempt_expired",
        title: "The attempt was past its deadline and has been finalized.",
        status: 410,
        attempt: {
          id: "attempt-1",
          status: "expired",
          submittedAt: "2026-08-27T09:25:00.000Z",
          resultUrl: "/api/attempts/attempt-1/result",
        },
      }),
    )
    const navigate = vi.fn()
    const user = userEvent.setup()

    render(<SectionRulesScreen {...baseProps} navigate={navigate} />)

    await user.click(screen.getByTestId("ready-button"))

    expect(
      await screen.findByText(
        "Your test time ran out. Your answers have been submitted.",
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "View result" })).toHaveAttribute(
      "href",
      "/api/attempts/attempt-1/result",
    )
    expect(navigate).not.toHaveBeenCalled()
  })

  // Security: `resultUrl` reaches this screen from the URL query string (the
  // `finalizedPriorAttempt` search param, parsed by the route) and from the
  // server's own `410 attempt_expired` response body. Either source can
  // carry a `javascript:`/`data:`/`//host` value, and React does not
  // sanitise `href` -- it escapes attribute VALUES, and a `javascript:` URL
  // is a syntactically valid one. On a shared, authenticated iPad, a
  // hostile href is a bearer-token theft vector, not a curiosity. Both
  // paths are constrained at the point `resultUrl` is first parsed --
  // `sameOriginPath` in the search schema, and the `.catch` handler for the
  // attempt-expired response -- not at the `<a>` that later renders it.
  describe("resultUrl is constrained where it is parsed, not where it is rendered", () => {
    it("rejects a javascript: resultUrl at the search-param parse boundary", () => {
      const result = searchSchema.safeParse({
        title: "Listening — Part 1",
        instructions: [],
        finalizedPriorAttempt: {
          id: "attempt-0",
          status: "expired",
          submittedAt: "2026-08-27T08:00:00.000Z",
          resultUrl: javascriptUrl,
        },
      })

      expect(result.success).toBe(false)
    })

    it("rejects a protocol-relative resultUrl at the search-param parse boundary", () => {
      const result = searchSchema.safeParse({
        title: "Listening — Part 1",
        instructions: [],
        finalizedPriorAttempt: {
          id: "attempt-0",
          status: "expired",
          submittedAt: "2026-08-27T08:00:00.000Z",
          resultUrl: "//evil.example/steal",
        },
      })

      expect(result.success).toBe(false)
    })

    it("accepts the same-origin path the server actually issues", () => {
      const result = searchSchema.safeParse({
        title: "Listening — Part 1",
        instructions: [],
        finalizedPriorAttempt: {
          id: "attempt-0",
          status: "expired",
          submittedAt: "2026-08-27T08:00:00.000Z",
          resultUrl: "/api/attempts/attempt-0/result",
        },
      })

      expect(result.success).toBe(true)
    })

    it("does not render a result link when the 410 attempt_expired response carries a javascript: resultUrl", async () => {
      mockEnterSection.mockRejectedValue(
        new ApiError({
          type: "attempt_expired",
          title: "The attempt was past its deadline and has been finalized.",
          status: 410,
          attempt: {
            id: "attempt-1",
            status: "expired",
            submittedAt: "2026-08-27T09:25:00.000Z",
            resultUrl: javascriptUrl,
          },
        }),
      )
      const user = userEvent.setup()

      render(<SectionRulesScreen {...baseProps} navigate={vi.fn()} />)

      await user.click(screen.getByTestId("ready-button"))

      expect(
        await screen.findByText(
          "Your test time ran out. Your answers have been submitted.",
        ),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole("link", { name: "View result" }),
      ).not.toBeInTheDocument()
    })
  })
})
