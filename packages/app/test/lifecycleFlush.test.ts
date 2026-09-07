import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AnswerQueue } from "../src/lib/answerQueue.js"
import { resetAuthClientForTests } from "../src/lib/auth.js"
import {
  buildSubmitRemainder,
  registerPagehideFlush,
} from "../src/lib/lifecycleFlush.js"
import { tokenStore } from "../src/lib/tokenStore.js"

const NOW = new Date("2026-08-27T09:00:00.000Z")

beforeEach(() => {
  indexedDB.deleteDatabase("pp-lifecycle-test")
  tokenStore.clear()
  resetAuthClientForTests()
})

describe("registerPagehideFlush", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    tokenStore.clear()
    resetAuthClientForTests()
  })

  it("sends a keepalive PATCH with the open section's queued snapshot on pagehide, through the SAME /api base every other write uses", async () => {
    const queue = await AnswerQueue.open("pp-lifecycle-test")

    try {
      await queue.recordAnswer(
        {
          attemptId: "a1",
          sectionId: "s1",
          questionId: "q1",
          selectedChoiceIds: ["c1"],
          timeSpentMs: null,
        },
        NOW,
      )

      const fetchSpy = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 200 }))
      const unregister = registerPagehideFlush(
        queue,
        () => ({ attemptId: "a1", sectionId: "s1" }),
        (attemptId) => `/attempts/${attemptId}/responses`,
        fetchSpy,
      )

      try {
        window.dispatchEvent(new Event("pagehide"))

        // Pagehide's handler reads the queue (a real IndexedDB round trip,
        // scheduled on a macrotask by fake-indexeddb, not a microtask) before
        // it fires the fetch, and the handler cannot be awaited by the
        // browser -- so the test polls rather than assuming a fixed number
        // of Promise.resolve() ticks is enough.
        await vi.waitFor(() => {
          expect(fetchSpy).toHaveBeenCalled()
        })

        expect(fetchSpy).toHaveBeenCalledTimes(1)
        const [[url, init]] = fetchSpy.mock.calls
        // Defect A2: this used to be the un-prefixed "/attempts/a1/responses"
        // -- a request that 404s against the server's global `/api` prefix
        // (packages/server/src/main.ts) and was never caught because the
        // send is fire-and-forget. Every other write in this app goes
        // through apiFetch, which adds this same prefix itself.
        expect(url).toBe("/api/attempts/a1/responses")
        expect(init?.method).toBe("PATCH")
        expect(init?.keepalive).toBe(true)

        // The load-bearing assertion: the request body must carry the
        // unacked answer, not merely exist. A handler that sent `{}` would
        // still pass every check above this one.
        const sentBody = JSON.parse(init?.body as string) as {
          clientInstanceId: string
          responses: Array<{ questionId: string; selectedChoiceIds: string[] }>
        }
        expect(sentBody.responses).toHaveLength(1)
        expect(sentBody.responses[0].questionId).toBe("q1")
        expect(sentBody.responses[0].selectedChoiceIds).toEqual(["c1"])
      } finally {
        unregister()
      }
    } finally {
      await queue.close()
    }
  })

  it("attaches the dev bearer token, the same as every other authenticated write", async () => {
    vi.stubEnv("DEV", true)
    vi.stubEnv("VITE_DEV_AUTH", "true")
    vi.stubEnv("VITE_DEV_AUTH_TOKEN", "dev-token")
    tokenStore.clear()

    const queue = await AnswerQueue.open("pp-lifecycle-test")

    try {
      await queue.recordAnswer(
        {
          attemptId: "a1",
          sectionId: "s1",
          questionId: "q1",
          selectedChoiceIds: ["c1"],
          timeSpentMs: null,
        },
        NOW,
      )

      const fetchSpy = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 200 }))
      const unregister = registerPagehideFlush(
        queue,
        () => ({ attemptId: "a1", sectionId: "s1" }),
        (attemptId) => `/attempts/${attemptId}/responses`,
        fetchSpy,
      )

      try {
        window.dispatchEvent(new Event("pagehide"))

        await vi.waitFor(() => {
          expect(fetchSpy).toHaveBeenCalled()
        })

        const [[, init]] = fetchSpy.mock.calls

        // Defect A2, second half: even with a corrected URL, every route on
        // the server requires a bearer token -- a request with only
        // content-type still fails.
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer dev-token",
        )
      } finally {
        unregister()
      }
    } finally {
      await queue.close()
    }
  })

  it("prefers the real signed-in session's token over the dev fallback, same priority as apiFetch", async () => {
    vi.stubEnv("DEV", true)
    vi.stubEnv("VITE_DEV_AUTH", "true")
    vi.stubEnv("VITE_DEV_AUTH_TOKEN", "dev-token")
    tokenStore.set("access_token", "real-access-token")
    tokenStore.set("id_token", "id-token")

    const queue = await AnswerQueue.open("pp-lifecycle-test")

    try {
      await queue.recordAnswer(
        {
          attemptId: "a1",
          sectionId: "s1",
          questionId: "q1",
          selectedChoiceIds: ["c1"],
          timeSpentMs: null,
        },
        NOW,
      )

      const fetchSpy = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 200 }))
      const unregister = registerPagehideFlush(
        queue,
        () => ({ attemptId: "a1", sectionId: "s1" }),
        (attemptId) => `/attempts/${attemptId}/responses`,
        fetchSpy,
      )

      try {
        window.dispatchEvent(new Event("pagehide"))

        await vi.waitFor(() => {
          expect(fetchSpy).toHaveBeenCalled()
        })

        const [[, init]] = fetchSpy.mock.calls

        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer real-access-token",
        )
      } finally {
        unregister()
      }
    } finally {
      await queue.close()
    }
  })

  it("does nothing when no section is open", async () => {
    const queue = await AnswerQueue.open("pp-lifecycle-test")

    try {
      const fetchSpy = vi.fn<typeof fetch>()
      const unregister = registerPagehideFlush(
        queue,
        () => null,
        (attemptId) => `/attempts/${attemptId}/responses`,
        fetchSpy,
      )

      try {
        window.dispatchEvent(new Event("pagehide"))
        await Promise.resolve()

        expect(fetchSpy).not.toHaveBeenCalled()
      } finally {
        unregister()
      }
    } finally {
      await queue.close()
    }
  })

  it("clears nothing from the queue after the fire-and-forget send -- no ack can ever arrive for a keepalive request, so the next session must still find the answer queued", async () => {
    const queue = await AnswerQueue.open("pp-lifecycle-test")

    try {
      await queue.recordAnswer(
        {
          attemptId: "a1",
          sectionId: "s1",
          questionId: "q1",
          selectedChoiceIds: ["c1"],
          timeSpentMs: null,
        },
        NOW,
      )

      const fetchSpy = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 200 }))
      const unregister = registerPagehideFlush(
        queue,
        () => ({ attemptId: "a1", sectionId: "s1" }),
        (attemptId) => `/attempts/${attemptId}/responses`,
        fetchSpy,
      )

      try {
        window.dispatchEvent(new Event("pagehide"))

        await vi.waitFor(() => {
          expect(fetchSpy).toHaveBeenCalled()
        })

        const stillQueued = await queue.snapshotForSection("a1", "s1")
        expect(stillQueued).toHaveLength(1)
        expect(stillQueued[0].questionId).toBe("q1")
      } finally {
        unregister()
      }
    } finally {
      await queue.close()
    }
  })
})

describe("buildSubmitRemainder", () => {
  it("reads the queue live at call time -- the narrower race spec S5 rule 6 names", async () => {
    const queue = await AnswerQueue.open("pp-lifecycle-test")

    try {
      // Simulates: the client's own pre-submit check found the queue empty
      // for this attempt...
      const emptyCheck = await queue.snapshotForSection("a1", "s1")
      expect(emptyCheck).toHaveLength(0)

      // ...but an answer lands in the queue AFTER that check and BEFORE
      // buildSubmitRemainder is actually called -- the race window the
      // client cannot close by checking earlier.
      await queue.recordAnswer(
        {
          attemptId: "a1",
          sectionId: "s1",
          questionId: "q1",
          selectedChoiceIds: ["c1"],
          timeSpentMs: null,
        },
        NOW,
      )

      const remainder = await buildSubmitRemainder(queue, "a1")

      expect(remainder.responses).toHaveLength(1)
      expect(remainder.responses[0].questionId).toBe("q1")
    } finally {
      await queue.close()
    }
  })

  it("carries every section's remainder for the attempt, not just one", async () => {
    const queue = await AnswerQueue.open("pp-lifecycle-test")

    try {
      await queue.recordAnswer(
        {
          attemptId: "a1",
          sectionId: "s1",
          questionId: "q1",
          selectedChoiceIds: ["c1"],
          timeSpentMs: null,
        },
        NOW,
      )
      await queue.recordAnswer(
        {
          attemptId: "a1",
          sectionId: "s2",
          questionId: "q2",
          selectedChoiceIds: ["c2"],
          timeSpentMs: null,
        },
        NOW,
      )

      const remainder = await buildSubmitRemainder(queue, "a1")

      expect(remainder.responses.map((item) => item.questionId).sort()).toEqual(
        ["q1", "q2"],
      )
    } finally {
      await queue.close()
    }
  })

  it("includes clientInstanceId, matching SubmitRequest's shape in docs/api/openapi.yaml", async () => {
    const queue = await AnswerQueue.open("pp-lifecycle-test")

    try {
      await queue.recordAnswer(
        {
          attemptId: "a1",
          sectionId: "s1",
          questionId: "q1",
          selectedChoiceIds: ["c1"],
          timeSpentMs: null,
        },
        NOW,
      )

      const remainder = await buildSubmitRemainder(queue, "a1")

      expect(remainder.clientInstanceId).toBe(queue.clientInstanceId())
    } finally {
      await queue.close()
    }
  })
})
