import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import { ApiError } from "../lib/api-client.js"
import { claimPlay, setPosition } from "../lib/attempts-api.js"
import type { CappedStimulusWire, RunnerEnvelope } from "../lib/api-types.js"
import { RunScreen } from "./attempts.$attemptId.run.js"

vi.mock("../lib/attempts-api.js", () => ({
  claimPlay: vi.fn(),
  setPosition: vi.fn(),
  getRunnerEnvelope: vi.fn(),
}))

const mockClaimPlay = vi.mocked(claimPlay)
const mockSetPosition = vi.mocked(setPosition)

const cappedAudio: CappedStimulusWire = {
  id: "stim-1",
  type: "audio",
  maxPlays: 2,
  playsUsed: 0,
  allowPause: false,
  allowSeek: false,
}

const listeningEnvelope: RunnerEnvelope = {
  id: "attempt-1",
  status: "in_progress",
  expiresAt: "2026-08-27T10:00:00.000Z",
  serverTime: "2026-08-27T09:00:00.000Z",
  questionCount: 20,
  answeredCount: 0,
  unansweredOrdinals: [3, 4],
  currentSectionId: "section-listening",
  currentQuestionId: "q-1",
  sections: [
    {
      id: "section-listening",
      type: "listening",
      status: "open",
      completedAt: null,
      navigation: "forward_only",
      allowAnswerChange: false,
      expiresAt: "2026-08-27T09:25:00.000Z",
      groups: [
        {
          id: "group-1",
          stimulus: cappedAudio,
          questions: [
            {
              id: "q-1",
              ordinal: 3,
              type: "single_choice",
              prompt: "What did the boy see?",
              choices: [
                { id: "c-1", label: "A dog" },
                { id: "c-2", label: "A cat" },
              ],
            },
            {
              id: "q-2",
              ordinal: 4,
              type: "single_choice",
              prompt: "Where was he?",
              choices: [
                { id: "c-3", label: "The park" },
                { id: "c-4", label: "School" },
              ],
            },
          ],
        },
      ],
    },
  ],
  responses: [],
}

const passageOne: RunnerEnvelope["sections"][number]["groups"][number]["stimulus"] =
  {
    id: "stim-r1",
    type: "passage",
    bodyText: "Once there was a curious fox who lived at the edge of a forest.",
    maxPlays: null,
  }

const passageTwo: RunnerEnvelope["sections"][number]["groups"][number]["stimulus"] =
  {
    id: "stim-r2",
    type: "passage",
    bodyText: "The city library opens at nine every morning.",
    maxPlays: null,
  }

const readingEnvelope: RunnerEnvelope = {
  id: "attempt-1",
  status: "in_progress",
  expiresAt: "2026-08-27T10:00:00.000Z",
  serverTime: "2026-08-27T09:00:00.000Z",
  questionCount: 20,
  answeredCount: 0,
  unansweredOrdinals: [5, 6, 7, 8],
  currentSectionId: "section-reading",
  currentQuestionId: "q-r2",
  sections: [
    {
      id: "section-reading",
      type: "reading",
      status: "open",
      completedAt: null,
      navigation: "free",
      allowAnswerChange: true,
      expiresAt: "2026-08-27T09:30:00.000Z",
      groups: [
        {
          id: "group-r1",
          stimulus: passageOne,
          questions: [
            {
              id: "q-r1",
              ordinal: 5,
              type: "single_choice",
              prompt: "What animal is in the story?",
              choices: [
                { id: "cr-1", label: "A fox" },
                { id: "cr-2", label: "A bear" },
              ],
            },
            {
              id: "q-r2",
              ordinal: 6,
              type: "single_choice",
              prompt: "Where does the fox live?",
              choices: [
                { id: "cr-3", label: "A forest" },
                { id: "cr-4", label: "A city" },
              ],
            },
          ],
        },
        {
          id: "group-r2",
          stimulus: passageTwo,
          questions: [
            {
              id: "q-r3",
              ordinal: 7,
              type: "single_choice",
              prompt: "What time does the library open?",
              choices: [
                { id: "cr-5", label: "Nine" },
                { id: "cr-6", label: "Ten" },
              ],
            },
            {
              id: "q-r4",
              ordinal: 8,
              type: "single_choice",
              prompt: "What kind of building is it?",
              choices: [
                { id: "cr-7", label: "A library" },
                { id: "cr-8", label: "A school" },
              ],
            },
          ],
        },
      ],
    },
  ],
  responses: [],
}

function renderRunScreen(
  envelope: RunnerEnvelope = listeningEnvelope,
  navigate = vi.fn(),
) {
  const utils = render(
    <RunScreen attemptId="attempt-1" envelope={envelope} navigate={navigate} />,
  )

  return { ...utils, navigate }
}

describe("RunScreen", () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it("renders ListeningRunner when the current section's type is listening", () => {
    renderRunScreen()

    expect(screen.getByTestId("listening-runner")).toBeInTheDocument()
  })

  it("redirects to the section-rules route when currentSectionId is null", () => {
    const { navigate } = renderRunScreen({
      ...listeningEnvelope,
      currentSectionId: null,
      currentQuestionId: null,
    })

    expect(navigate).toHaveBeenCalledExactlyOnceWith(
      "/attempts/attempt-1/sections/section-listening/rules",
    )
    expect(screen.queryByTestId("listening-runner")).not.toBeInTheDocument()
  })

  it("renders the current question's prompt and choices from currentQuestionId", () => {
    renderRunScreen()

    expect(screen.getByText("What did the boy see?")).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "A dog" })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "A cat" })).toBeInTheDocument()
  })

  it("hides the play button's disabled state until playsUsed reaches maxPlays", async () => {
    mockClaimPlay.mockResolvedValue({
      stimulusId: "stim-1",
      playsUsed: 2,
      playsRemaining: 0,
      mediaUrl: "/api/media/audio1.mp3?exp=1&sig=x",
      urlExpiresAt: "2026-08-27T09:01:00.000Z",
    })
    const user = userEvent.setup()

    renderRunScreen()

    const button = screen.getByRole("button", { name: "Play recording" })
    expect(button).toBeEnabled()

    await user.click(button)

    await waitFor(() => {
      expect(button).toBeDisabled()
    })
  })

  it("calls claimPlay when the play button is clicked, and only then sets the audio src", async () => {
    mockClaimPlay.mockResolvedValue({
      stimulusId: "stim-1",
      playsUsed: 1,
      playsRemaining: 1,
      mediaUrl: "/api/media/audio1.mp3?exp=1&sig=x",
      urlExpiresAt: "2026-08-27T09:01:00.000Z",
    })
    const user = userEvent.setup()

    renderRunScreen()

    expect(screen.queryByTestId("audio-player")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Play recording" }))

    expect(mockClaimPlay).toHaveBeenCalledExactlyOnceWith("attempt-1", "stim-1")
    expect(await screen.findByTestId("audio-player")).toHaveAttribute(
      "src",
      "/api/media/audio1.mp3?exp=1&sig=x",
    )
  })

  it("holds a new choice selection in local state only -- no network call fires on select", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const user = userEvent.setup()

    renderRunScreen()

    await user.click(screen.getByRole("radio", { name: "A cat" }))

    expect(screen.getByRole("radio", { name: "A cat" })).toHaveAttribute(
      "aria-checked",
      "true",
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockSetPosition).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })

  it("locks the choice list once a response already exists for this question and allowAnswerChange is false", () => {
    renderRunScreen({
      ...listeningEnvelope,
      responses: [
        {
          questionId: "q-1",
          selectedChoiceIds: ["c-1"],
          clientInstanceId: "device-1",
          seq: 1,
        },
      ],
    })

    expect(
      screen.getByText("Answer locked — this section does not allow changes."),
    ).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "A dog" })).toBeDisabled()
  })

  it("shows no Previous button in a forward_only section", () => {
    renderRunScreen()

    expect(
      screen.queryByRole("button", { name: "Previous" }),
    ).not.toBeInTheDocument()
  })

  it("calls setPosition with the next question's id when Next is clicked", async () => {
    mockSetPosition.mockResolvedValue(undefined)
    const user = userEvent.setup()

    renderRunScreen()

    await user.click(screen.getByRole("button", { name: "Next" }))

    expect(mockSetPosition).toHaveBeenCalledExactlyOnceWith(
      "attempt-1",
      "section-listening",
      "q-2",
    )
  })

  it("renders the pip/progress strip from questionCount and the section's own question ordinals, read-only", () => {
    renderRunScreen()

    expect(screen.getByText("Question 3 of 20")).toBeInTheDocument()

    const pips = screen.getAllByTestId("question-pip")
    expect(pips.map((pip) => pip.textContent)).toEqual(["3", "4"])
    for (const pip of pips) {
      expect(pip.tagName).not.toBe("BUTTON")
    }
  })

  // Carried over from Task 9: a capped stimulus's signed URL expires, and
  // openapi.yaml gives claimPlay exactly one way to report that -- the same
  // `SectionOrAttemptExpired` 410 every other runner call uses
  // (`section_expired` leaves the attempt running; `attempt_expired`
  // finalizes it and carries the finalized attempt). Before this task,
  // QuestionMedia swallowed the rejection and the student saw nothing.
  describe("a claimPlay 410 surfaces an actionable expired state, not silence", () => {
    it("shows the section-expired message on a 410 section_expired", async () => {
      mockClaimPlay.mockRejectedValue(
        new ApiError({
          type: "section_expired",
          title: "The section's clock ran out.",
          status: 410,
        }),
      )
      const user = userEvent.setup()

      renderRunScreen()

      await user.click(screen.getByRole("button", { name: "Play recording" }))

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "This section's time ran out.",
      )
    })

    it("shows the attempt-expired message with a result link on a 410 attempt_expired", async () => {
      mockClaimPlay.mockRejectedValue(
        new ApiError({
          type: "attempt_expired",
          title: "The attempt was past its deadline and has been finalized.",
          status: 410,
          attempt: {
            id: "attempt-1",
            status: "expired",
            submittedAt: "2026-08-27T09:25:00.000Z",
            resultUrl: "/attempts/attempt-1/result",
          },
        }),
      )
      const user = userEvent.setup()

      renderRunScreen()

      await user.click(screen.getByRole("button", { name: "Play recording" }))

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Your test time ran out. Your answers have been submitted.",
      )
      expect(screen.getByRole("link", { name: "View result" })).toHaveAttribute(
        "href",
        "/attempts/attempt-1/result",
      )
    })

    // oxlint-disable-next-line no-script-url -- the hostile scheme IS the fixture
    it("does not render a result link when the 410 attempt_expired response carries a javascript: resultUrl", async () => {
      const javascriptUrl = ["java", "script:alert(1)"].join("")
      mockClaimPlay.mockRejectedValue(
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

      renderRunScreen()

      await user.click(screen.getByRole("button", { name: "Play recording" }))

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Your test time ran out. Your answers have been submitted.",
      )
      expect(
        screen.queryByRole("link", { name: "View result" }),
      ).not.toBeInTheDocument()
    })
  })

  describe("reading section", () => {
    it("renders ReadingRunner when the current section's type is reading", () => {
      renderRunScreen(readingEnvelope)

      expect(screen.getByTestId("reading-runner")).toBeInTheDocument()
    })

    it("renders the current question's prompt and the shared passage text", () => {
      renderRunScreen(readingEnvelope)

      expect(screen.getByText("Where does the fox live?")).toBeInTheDocument()
      expect(
        screen.getByText(
          "Once there was a curious fox who lived at the edge of a forest.",
        ),
      ).toBeInTheDocument()
    })

    it("shows a Previous button, enabled -- unlike the forward_only listening section", () => {
      renderRunScreen(readingEnvelope)

      expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled()
    })

    it("calls setPosition with a PRIOR question's id when Previous is clicked", async () => {
      mockSetPosition.mockResolvedValue(undefined)
      const user = userEvent.setup()

      renderRunScreen(readingEnvelope)

      await user.click(screen.getByRole("button", { name: "Previous" }))

      expect(mockSetPosition).toHaveBeenCalledExactlyOnceWith(
        "attempt-1",
        "section-reading",
        "q-r1",
      )
      expect(
        await screen.findByText("What animal is in the story?"),
      ).toBeInTheDocument()
    })

    it("calls setPosition with the next question's id when Next is clicked", async () => {
      mockSetPosition.mockResolvedValue(undefined)
      const user = userEvent.setup()

      renderRunScreen(readingEnvelope)

      await user.click(screen.getByRole("button", { name: "Next" }))

      expect(mockSetPosition).toHaveBeenCalledExactlyOnceWith(
        "attempt-1",
        "section-reading",
        "q-r3",
      )
    })

    it("allows changing an already-selected choice, unlike listening", async () => {
      const user = userEvent.setup()

      renderRunScreen({
        ...readingEnvelope,
        responses: [
          {
            questionId: "q-r2",
            selectedChoiceIds: ["cr-3"],
            clientInstanceId: "device-1",
            seq: 1,
          },
        ],
      })

      expect(screen.getByRole("radio", { name: "A forest" })).toBeEnabled()
      expect(
        screen.queryByText(
          "Answer locked — this section does not allow changes.",
        ),
      ).not.toBeInTheDocument()

      await user.click(screen.getByRole("radio", { name: "A city" }))

      expect(screen.getByRole("radio", { name: "A city" })).toHaveAttribute(
        "aria-checked",
        "true",
      )
    })

    it("renders 'Passage N · questions X–Y' from the current group's own ordinals", async () => {
      const user = userEvent.setup()

      renderRunScreen(readingEnvelope)

      expect(screen.getByText("Passage 1 · questions 5–6")).toBeInTheDocument()

      mockSetPosition.mockResolvedValue(undefined)
      await user.click(screen.getByRole("button", { name: "Next" }))

      expect(
        await screen.findByText("Passage 2 · questions 7–8"),
      ).toBeInTheDocument()
    })

    it("navigates to the hand-in dialog when Hand in is tapped", async () => {
      const { navigate } = renderRunScreen(readingEnvelope)

      await userEvent.click(screen.getByRole("button", { name: "Hand in" }))

      expect(navigate).toHaveBeenCalledWith(expect.stringContaining("/hand-in"))
    })

    // Mirrors the claimPlay 410 coverage above: reading has no claimPlay
    // flow (its stimulus is always a passage), so `PUT /position` from
    // Previous/Next is the only way this attempt/section can discover its
    // own expiry client-side. Same SectionOrAttemptExpired shape, same
    // run-shell-owned expired state -- just reached through a different call.
    it("shows the section-expired message on a 410 section_expired from Previous", async () => {
      mockSetPosition.mockRejectedValue(
        new ApiError({
          type: "section_expired",
          title: "The section's clock ran out.",
          status: 410,
        }),
      )
      const user = userEvent.setup()

      renderRunScreen(readingEnvelope)

      await user.click(screen.getByRole("button", { name: "Previous" }))

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "This section's time ran out.",
      )
    })
  })
})
