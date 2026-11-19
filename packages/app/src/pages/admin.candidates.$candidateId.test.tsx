import {
  RouterProvider,
  createMemoryHistory,
  createRouter,
} from "@tanstack/react-router"
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import "../i18n.js"
import type { MathCandidateDetail } from "../lib/math-candidates-api.js"
import { routeTree } from "../route.gen.js"

vi.mock("../lib/auth-guard.js", () => ({ requireAuth: vi.fn() }))

const requestId = "d460b234-21ac-4210-8ef4-914b415fe618"
const candidateId = "27ea263b-43ad-471d-89c2-2ecd5c0fe545"
const candidatesUrl = `/api/admin/math/generation-requests/${requestId}/candidates`
const detailUrl = `/api/admin/math/candidates/${candidateId}`
const createdAt = "2026-11-16T08:00:00.000Z"
const markup = '<img src="x" onerror="alert(1)">'
const rawMarkup = '<img src="audit" onerror="alert(2)">'
const text = (value: string) => ({ kind: "text" as const, value })
const math = (tex: string, display = false) => ({
  kind: "math" as const,
  tex,
  display,
})
const answer = (numerator: number) => ({
  kind: "rational" as const,
  numerator,
  denominator: 4,
})
const request = {
  id: requestId,
  templateId: "template-1",
  parameters: { templateCode: "fraction-addition-v1" },
  provider: "local",
  model: "template-v1",
  promptTemplateVersion: "1",
  seed: "recorded-seed",
  status: "completed",
  createdAt,
}
const candidate = {
  id: candidateId,
  requestId,
  status: "in_review",
  promptBlocks: [text("Add the fractions."), math("\\frac{1}{4}+\\frac{1}{4}")],
  choices: [
    { label: "2/4", labelBlocks: [math("\\frac{2}{4}")], isCorrect: true },
    { label: "3/4", labelBlocks: [math("\\frac{3}{4}")], isCorrect: false },
  ],
  solutionBlocks: [text("Add the numerators."), math("\\frac{2}{4}", true)],
  contentHash: "recorded-hash",
  validation: { valid: true, source: "math", errors: [] as string[] },
  reviewReason: null,
  reviewerSubject: null,
  reviewedAt: null,
  testVersionId: null,
  createdAt,
  canonicalSpec: {
    family: "fraction_addition",
    seed: "recorded-seed:0",
    variables: {},
    expression: {
      kind: "add",
      left: { kind: "fraction", numerator: 1, denominator: 4 },
      right: { kind: "fraction", numerator: 1, denominator: 4 },
    },
    answer: answer(2),
    constraints: { min: 0, max: 200, nonNegative: true },
    choices: [
      { answer: answer(2), isCorrect: true },
      { answer: answer(3), isCorrect: false },
    ],
  },
  provenance: {
    templateId: request.templateId,
    provider: request.provider,
    model: request.model,
    promptTemplateVersion: request.promptTemplateVersion,
    seed: request.seed,
  },
} satisfies MathCandidateDetail
const profile = {
  id: "student-admin",
  displayName: "Admin",
  email: "admin@example.test",
  isAdmin: true,
  level: null,
}

function respondTo(overrides: Record<string, unknown> = {}) {
  const {
    canonicalSpec: _spec,
    provenance: _provenance,
    ...summary
  } = candidate
  const routes: Record<string, unknown> = {
    "/api/me": profile,
    "/api/admin/math/generation-requests?limit=10": {
      items: [request],
      nextCursor: null,
    },
    [candidatesUrl]: [summary],
    [detailUrl]: candidate,
    ...overrides,
  }
  const fetch = vi.fn((input: string, _init?: RequestInit) => {
    const body = routes[input]

    if (body === undefined) {
      throw new Error(`Unexpected request: ${input}`)
    }

    return Promise.resolve(body).then((value) =>
      value instanceof Response ? value : Response.json(value),
    )
  })
  vi.stubGlobal("fetch", fetch)

  return fetch
}

function visit(path = `/admin/candidates/${candidateId}`) {
  vi.stubGlobal("scrollTo", vi.fn())
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    defaultHashScrollIntoView: false,
  })

  return {
    router,
    ...render(<RouterProvider router={router} />),
  }
}

describe("admin math candidate review", () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("opens a candidate from the review queue on the admin routes", async () => {
    respondTo()
    const { router } = visit("/admin/candidates")
    const user = userEvent.setup()

    expect(
      await screen.findByRole("heading", { name: "Candidate review queue" }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: /fraction-addition-v1/iu }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole("link", { name: "Add the fractions." }))

    expect(
      await screen.findByRole("heading", { name: "Review candidate" }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(
      `/admin/candidates/${candidateId}`,
    )
  })

  it.each(["/admin/candidates", `/admin/candidates/${candidateId}`])(
    "redirects a learner away from %s before requesting candidate data",
    async (path) => {
      const fetch = respondTo({
        "/api/me": { ...profile, isAdmin: false },
        "/api/tests": { tests: [], nextCursor: null },
      })
      const { router } = visit(path)

      await waitFor(() => expect(router.state.location.pathname).toBe("/"))
      expect(
        fetch.mock.calls.some(([url]) => url.startsWith("/api/admin/math/")),
      ).toBe(false)
    },
  )

  it("renders learner presentation and canonical math with HTML and MathML", async () => {
    respondTo({
      [detailUrl]: {
        ...candidate,
        promptBlocks: [...candidate.promptBlocks, text(markup)],
      },
    })
    visit()

    const preview = await screen.findByRole("region", {
      name: "Learner preview",
    })
    expect(within(preview).getByText("Add the fractions.")).toBeInTheDocument()
    expect(within(preview).getByText(markup)).toBeInTheDocument()
    expect(preview.querySelector("img")).toBeNull()
    expect(preview.querySelectorAll(".katex-html")).toHaveLength(3)
    expect(preview.querySelectorAll("math")).toHaveLength(3)
    expect(screen.getByText("Correct answer")).toBeInTheDocument()
    const solution = screen.getByRole("region", { name: "Worked solution" })
    expect(solution.querySelector(".katex-display math")?.namespaceURI).toBe(
      "http://www.w3.org/1998/Math/MathML",
    )
    const provenance = screen.getByRole("region", { name: "Provenance" })
    expect(within(provenance).getByText("template-v1")).toBeInTheDocument()
    expect(within(provenance).getByText("recorded-hash")).toBeInTheDocument()
    const canonical = screen.getByRole("region", { name: "Canonical math" })
    expect(canonical.querySelector("math")?.namespaceURI).toBe(
      "http://www.w3.org/1998/Math/MathML",
    )
  })

  it.each([
    "\\frac{1}{",
    "\\href{javascript:alert(1)}{click}",
    "\\gdef\\A{9}\\A",
  ])(
    "shows a rendering error for invalid or disallowed TeX %s",
    async (tex) => {
      respondTo({
        [detailUrl]: { ...candidate, promptBlocks: [math(tex)] },
      })
      const { container } = visit()

      expect(
        await screen.findByText("This formula could not be rendered."),
      ).toBeInTheDocument()
      expect(screen.queryByRole("button", { name: "Approve" })).toBeNull()
      expect(screen.getByRole("button", { name: "Reject" })).toBeEnabled()
      expect(container.querySelector('a[href^="javascript:"]')).toBeNull()
    },
  )

  it("submits approval with a trimmed reason and presents the saved decision", async () => {
    const fetch = respondTo({
      [`${detailUrl}/review`]: {
        ...candidate,
        status: "approved",
        reviewReason: "Checked the arithmetic.",
        reviewerSubject: "student-admin",
        reviewedAt: createdAt,
      },
    })
    visit()
    const user = userEvent.setup()

    await user.type(
      await screen.findByRole("textbox", { name: /review reason/iu }),
      " Checked the arithmetic. ",
    )
    await user.click(screen.getByRole("button", { name: "Approve" }))

    expect(await screen.findByText("Approved")).toBeInTheDocument()
    expect(screen.getByText("Checked the arithmetic.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull()
    expect(fetch).toHaveBeenCalledWith(
      `${detailUrl}/review`,
      expect.objectContaining({
        method: "PATCH",
        body: '{"decision":"approved","reason":"Checked the arithmetic."}',
      }),
    )
  })

  it("allows rejection of a draft that lacks deterministic validation", async () => {
    const draft = { ...candidate, status: "draft", validation: null }
    const fetch = respondTo({
      [detailUrl]: draft,
      [`${detailUrl}/review`]: { ...draft, status: "rejected" },
    })
    visit()

    const reject = await screen.findByRole("button", { name: "Reject" })
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull()
    await userEvent.setup().click(reject)

    expect(await screen.findByText("Rejected")).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith(
      `${detailUrl}/review`,
      expect.objectContaining({
        method: "PATCH",
        body: '{"decision":"rejected"}',
      }),
    )
  })

  it("presents validator failures and hides actions for a rejected candidate", async () => {
    respondTo({
      [detailUrl]: {
        ...candidate,
        status: "rejected",
        promptBlocks: null,
        choices: null,
        solutionBlocks: null,
        canonicalSpec: null,
        validation: {
          valid: false,
          source: "provider",
          errors: ["Provider request failed"],
        },
      },
    })
    visit()

    const validation = await screen.findByRole("region", { name: "Validation" })
    expect(
      within(validation).getByText("Provider request failed"),
    ).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull()
  })

  it("requests raw output only after opening the audit view and escapes it as JSON", async () => {
    const auditUrl = `${detailUrl}?includeAudit=true`
    const fetch = respondTo({
      [detailUrl]: {
        ...candidate,
        audit: { rawResponse: { markup: rawMarkup } },
      },
      [auditUrl]: {
        ...candidate,
        audit: { rawResponse: { markup: rawMarkup } },
      },
    })
    const { container } = visit()
    const user = userEvent.setup()
    const show = await screen.findByRole("button", {
      name: "Show raw provider output",
    })

    expect(screen.queryByText(/alert\(2\)/u)).toBeNull()
    expect(fetch.mock.calls.some(([url]) => url === auditUrl)).toBe(false)
    await user.click(show)

    expect(await screen.findByText(/alert\(2\)/u)).toBeInTheDocument()
    expect(container.querySelector('img[src="audit"]')).toBeNull()
    expect(fetch).toHaveBeenCalledWith(
      auditUrl,
      expect.objectContaining({ cache: "no-store" }),
    )
    await user.click(
      screen.getByRole("button", { name: "Hide raw provider output" }),
    )
    expect(screen.queryByText(/alert\(2\)/u)).toBeNull()
  })
})
