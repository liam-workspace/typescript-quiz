import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import type { AdminQuestion, AdminTestDetail } from "../lib/api-types.js"
import {
  Route as QuizzesRoute,
  loadAdminQuizzes,
} from "../pages/admin.quizzes.js"
import {
  AdminQuizDetailScreen,
  loadAdminQuizDetail,
  Route as DetailRoute,
} from "../pages/admin.quizzes.$testId.js"

const question: AdminQuestion = {
  id: "question-1",
  prompt: "Which number is even?",
  choices: [
    { id: "choice-1", label: "Two", isCorrect: true },
    { id: "choice-2", label: "Three", isCorrect: false },
  ],
}

const quiz: AdminTestDetail = {
  id: "quiz-1",
  title: "Number practice",
  status: "draft",
  versionId: "draft-version",
  currentVersionId: "published-version",
  updatedAt: "2026-11-16T08:00:00.000Z",
  description: null,
  durationSeconds: 600,
  sections: [{ id: "section-1", title: "Numbers", questionCount: 1 }],
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function renderEditor(detail: AdminTestDetail = quiz) {
  return render(
    <AdminQuizDetailScreen
      initialData={{ quiz: detail, questions: [question], nextCursor: null }}
    />,
  )
}

describe("draft question editor", () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("previews a draft before controls and edits prompt, choice order and answer key", async () => {
    const user = userEvent.setup()
    renderEditor()
    const preview = screen.getByRole("region", { name: "Learner preview" })
    expect(within(preview).getByText(question.prompt)).toBeInTheDocument()
    expect(within(preview).queryByText(/correct/i)).not.toBeInTheDocument()
    expect(
      screen.getByRole("textbox", { name: "Question prompt" }),
    ).toBeEnabled()
    await user.clear(screen.getByRole("textbox", { name: "Question prompt" }))
    await user.type(
      screen.getByRole("textbox", { name: "Question prompt" }),
      "Pick an odd number.",
    )
    await user.clear(screen.getByRole("textbox", { name: "Choice 2 label" }))
    await user.type(
      screen.getByRole("textbox", { name: "Choice 2 label" }),
      "Five",
    )
    await user.click(
      screen.getByRole("checkbox", { name: "Choice 1 is correct" }),
    )
    await user.click(
      screen.getByRole("checkbox", { name: "Choice 2 is correct" }),
    )
    await user.click(screen.getByRole("button", { name: "Move choice 2 up" }))
    expect(within(preview).getByText("Pick an odd number.")).toBeInTheDocument()
    expect(within(preview).getAllByRole("listitem")[0]).toHaveTextContent(
      "Five",
    )
    expect(
      screen.getByRole("checkbox", { name: "Choice 1 is correct" }),
    ).toBeChecked()
    expect(screen.getByRole("textbox", { name: "Choice 1 label" })).toHaveValue(
      "Five",
    )
  })

  it("renders published versions read-only", () => {
    renderEditor({ ...quiz, status: "published" })
    expect(screen.getByText(/published.*read.only/i)).toBeInTheDocument()
    expect(
      screen.getByRole("textbox", { name: "Question prompt" }),
    ).toHaveAttribute("readonly")
    expect(
      screen.getByRole("textbox", { name: "Choice 1 label" }),
    ).toHaveAttribute("readonly")
    expect(
      screen.getByRole("checkbox", { name: "Choice 1 is correct" }),
    ).toBeDisabled()
    expect(
      screen.queryByRole("button", { name: "Save question" }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /move choice/i }),
    ).not.toBeInTheDocument()
  })

  it("keeps invalid draft values visible and blocks saving empty prompts, labels and answer keys", async () => {
    const user = userEvent.setup()
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    renderEditor()
    const prompt = screen.getByRole("textbox", { name: "Question prompt" })
    await user.clear(prompt)
    await user.click(screen.getByRole("button", { name: "Save question" }))
    expect(screen.getByRole("alert")).toHaveTextContent(/prompt/i)
    expect(prompt).toHaveValue("")
    await user.type(prompt, "Choose a number.")
    const label = screen.getByRole("textbox", { name: "Choice 1 label" })
    await user.clear(label)
    await user.click(screen.getByRole("button", { name: "Save question" }))
    expect(screen.getByRole("alert")).toHaveTextContent(/label/i)
    await user.type(label, "Two")
    await user.click(
      screen.getByRole("checkbox", { name: "Choice 1 is correct" }),
    )
    await user.click(screen.getByRole("button", { name: "Save question" }))
    expect(screen.getByRole("alert")).toHaveTextContent(/correct choice/i)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("saves to the draft version and refreshes the visible question from the server", async () => {
    const user = userEvent.setup()
    let saved = false
    vi.stubGlobal("fetch", (input: unknown, init?: RequestInit) => {
      if (
        input === "/api/admin/drafts/draft-version/questions/question-1" &&
        init?.method === "PATCH"
      ) {
        expect(JSON.parse(init.body as string)).toEqual({
          prompt: "Choose an even number.",
          choices: [
            { id: "choice-2", label: "Three", isCorrect: false },
            { id: "choice-1", label: "Two", isCorrect: true },
          ],
        })
        saved = true

        return Promise.resolve(response(question))
      }

      if (saved && input === "/api/admin/tests/quiz-1") {
        return Promise.resolve(response({ ...quiz, title: "Refreshed quiz" }))
      }

      if (saved && input === "/api/admin/questions?limit=20&testId=quiz-1") {
        return Promise.resolve(
          response({
            items: [{ ...question, prompt: "Server-confirmed prompt" }],
            nextCursor: null,
          }),
        )
      }

      throw new Error(`Unexpected request: ${String(input)}`)
    })
    renderEditor()
    await user.clear(screen.getByRole("textbox", { name: "Question prompt" }))
    await user.type(
      screen.getByRole("textbox", { name: "Question prompt" }),
      "Choose an even number.",
    )
    await user.click(screen.getByRole("button", { name: "Move choice 2 up" }))
    await user.click(screen.getByRole("button", { name: "Save question" }))
    expect(
      await screen.findByRole("heading", { name: "Refreshed quiz" }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("textbox", { name: "Question prompt" }),
    ).toHaveValue("Server-confirmed prompt")
    expect(screen.getByRole("status")).toHaveTextContent(/saved/i)
  })

  it("shows rich text conflicts as save feedback and preserves unsaved edits", async () => {
    const user = userEvent.setup()
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        response(
          {
            type: "rich_text_edit_ambiguous",
            title: "Ambiguous rich text",
            status: 409,
          },
          409,
        ),
      ),
    )
    renderEditor()
    await user.clear(screen.getByRole("textbox", { name: "Question prompt" }))
    await user.type(
      screen.getByRole("textbox", { name: "Question prompt" }),
      "My unsaved edit",
    )
    await user.click(screen.getByRole("button", { name: "Save question" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not save/i,
    )
    expect(
      screen.getByRole("textbox", { name: "Question prompt" }),
    ).toHaveValue("My unsaved edit")
    expect(screen.getByRole("button", { name: "Save question" })).toBeEnabled()
  })

  it("loads every question page before displaying quiz details", async () => {
    vi.stubGlobal("fetch", (input: unknown) => {
      if (input === "/api/admin/tests/quiz-1") {
        return Promise.resolve(response(quiz))
      }

      if (input === "/api/admin/questions?limit=20&testId=quiz-1") {
        return Promise.resolve(
          response({ items: [question], nextCursor: "page-2" }),
        )
      }

      if (
        input === "/api/admin/questions?limit=20&testId=quiz-1&cursor=page-2"
      ) {
        return Promise.resolve(
          response({
            items: [
              { ...question, id: "question-2", prompt: "Second question" },
            ],
            nextCursor: null,
          }),
        )
      }

      throw new Error(`Unexpected request: ${String(input)}`)
    })
    render(
      <AdminQuizDetailScreen
        initialData={await loadAdminQuizDetail("quiz-1")}
      />,
    )
    expect(
      screen.getAllByRole("region", { name: "Learner preview" }),
    ).toHaveLength(2)
    expect(
      screen.getAllByRole("textbox", { name: "Question prompt" })[1],
    ).toHaveValue("Second question")
  })

  it("preserves another question's unsaved edits when one question is saved", async () => {
    const user = userEvent.setup()
    const second = { ...question, id: "question-2", prompt: "Second question" }
    vi.stubGlobal("fetch", (input: unknown, init?: RequestInit) => {
      if (
        input === "/api/admin/drafts/draft-version/questions/question-1" &&
        init?.method === "PATCH"
      ) {
        return Promise.resolve(response(question))
      }

      if (input === "/api/admin/tests/quiz-1") {
        return Promise.resolve(response(quiz))
      }

      if (input === "/api/admin/questions?limit=20&testId=quiz-1") {
        return Promise.resolve(
          response({ items: [question, second], nextCursor: null }),
        )
      }

      throw new Error(`Unexpected request: ${String(input)}`)
    })
    render(
      <AdminQuizDetailScreen
        initialData={{ quiz, questions: [question, second], nextCursor: null }}
      />,
    )
    const prompts = screen.getAllByRole("textbox", { name: "Question prompt" })
    await user.clear(prompts[1])
    await user.type(prompts[1], "Unsaved second question")
    await user.click(
      screen.getAllByRole("button", { name: "Save question" })[0],
    )
    expect(await screen.findByRole("status")).toHaveTextContent(/saved/i)
    expect(
      screen.getAllByRole("textbox", { name: "Question prompt" })[1],
    ).toHaveValue("Unsaved second question")
  })

  it("renders the nested detail route instead of the parent catalogue", async () => {
    vi.stubGlobal("scrollTo", vi.fn())
    vi.stubGlobal("fetch", (input: unknown) => {
      if (input === "/api/admin/tests?limit=20") {
        return Promise.resolve(response({ items: [quiz], nextCursor: null }))
      }

      if (input === "/api/admin/tests/quiz-1") {
        return Promise.resolve(response(quiz))
      }

      if (input === "/api/admin/questions?limit=20&testId=quiz-1") {
        return Promise.resolve(
          response({ items: [question], nextCursor: null }),
        )
      }

      throw new Error(`Unexpected request: ${String(input)}`)
    })
    const root = createRootRoute({ component: Outlet })
    const parent = createRoute({
      getParentRoute: () => root,
      path: "/admin/quizzes",
      loader: loadAdminQuizzes,
      component: QuizzesRoute.options.component,
    })
    const detail = createRoute({
      getParentRoute: () => parent,
      path: "$testId",
      loader: ({ params }) => loadAdminQuizDetail(params.testId),
      component: DetailRoute.options.component,
    })
    const router = createRouter({
      routeTree: root.addChildren([parent.addChildren([detail])]),
      history: createMemoryHistory({
        initialEntries: ["/admin/quizzes/quiz-1"],
      }),
    })
    render(<RouterProvider router={router} />)
    expect(
      await screen.findByRole("heading", { name: "Number practice" }),
    ).toBeInTheDocument()
    expect(screen.queryByRole("table")).not.toBeInTheDocument()
    await router.navigate({ to: "/admin/quizzes" })
    expect(await screen.findByRole("table")).toBeInTheDocument()
    expect(
      screen.queryByRole("region", { name: "Learner preview" }),
    ).not.toBeInTheDocument()
  })
})
