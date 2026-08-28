import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { apiFetch, resetApiClientForTests } from "../src/lib/api-client.js"
import { AnswerQueue } from "../src/lib/answerQueue.js"
import { resetAuthClientForTests } from "../src/lib/auth.js"
import { tokenStore } from "../src/lib/tokenStore.js"
import { requestUrl } from "../src/test/requestUrl.js"

const NOW = new Date("2026-08-27T09:00:00.000Z")

/**
 * The risk plan Task 4 Step 3 calls out by name: every other screen was
 * built and tested against the dev bearer token, so nothing has ever
 * exercised a mid-test 401 for real. `apiFetch`'s 401 handler
 * (`clearSessionAndRedirectToSignIn`, `auth.ts`) clears `tokenStore` and
 * navigates away -- it must NOT reach anywhere near IndexedDB. This proves
 * that structurally, not just by absence of a bug today: an answer queued
 * BEFORE a 401 is still readable from a FRESH `AnswerQueue.open()` call
 * (simulating the reload/re-navigation `clearSessionAndRedirectToSignIn`
 * triggers) AFTER the 401 and the session clear have both happened.
 */
describe("a mid-test 401 does not lose queued answers", () => {
  beforeEach(() => {
    indexedDB.deleteDatabase("pp-answer-queue-401-test")
    tokenStore.clear()
    resetAuthClientForTests()
    resetApiClientForTests()
  })

  it("keeps a queued answer in IndexedDB across a 401 that clears the session and bounces to sign-in", async () => {
    const queue = await AnswerQueue.open("pp-answer-queue-401-test")

    await queue.recordAnswer(
      {
        attemptId: "attempt-1",
        sectionId: "section-1",
        questionId: "question-1",
        selectedChoiceIds: ["choice-a"],
        timeSpentMs: 4000,
      },
      NOW,
    )
    await queue.close()

    tokenStore.set("access_token", "expired-access-token")
    tokenStore.set("id_token", "id-token")
    tokenStore.set("refresh_token", "refresh-token")

    vi.stubGlobal("location", {
      assign: vi.fn(),
      pathname: "/attempts/attempt-1/run",
      search: "",
    })
    const handleFetch: typeof fetch = (input) => {
      const url = requestUrl(input)

      if (url.includes("/token")) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: "invalid_grant" }), {
            status: 400,
          }),
        )
      }

      return Promise.resolve(
        new Response(
          JSON.stringify({
            type: "invalid_token",
            title: "Expired",
            status: 401,
          }),
          { status: 401, headers: { "content-type": "application/json" } },
        ),
      )
    }

    vi.stubGlobal("fetch", vi.fn<typeof fetch>(handleFetch))

    await expect(
      apiFetch("/attempts/attempt-1/responses", {
        method: "PATCH",
        body: "{}",
      }),
    ).rejects.toThrow()

    // The session is really gone...
    expect(tokenStore.get("access_token")).toBeNull()

    // ...but a fresh queue instance -- the same recovery path a
    // re-authenticated page load takes -- still finds the answer.
    const reopened = await AnswerQueue.open("pp-answer-queue-401-test")
    const snapshot = await reopened.snapshotForSection("attempt-1", "section-1")

    expect(snapshot).toHaveLength(1)
    expect(snapshot[0]).toMatchObject({
      questionId: "question-1",
      selectedChoiceIds: ["choice-a"],
    })

    vi.unstubAllGlobals()
    await reopened.close()
  })
})
