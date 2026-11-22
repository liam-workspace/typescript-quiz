import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "../src/lib/api-client.js"
import * as api from "../src/lib/attempts-api.js"
import {
  OfflineError,
  type AttemptGateway,
  type FlushContext,
} from "../src/lib/attempt/attempt-gateway.js"
import {
  attemptGateway,
  gatewayFor,
  setAttemptGateway,
} from "../src/lib/attempt/gateway-selector.js"
import { RemoteAttemptGateway } from "../src/lib/attempt/remote-gateway.js"

vi.mock("../src/lib/attempts-api.js", () => ({
  startAttempt: vi.fn(),
  getRunnerEnvelope: vi.fn(),
  enterSection: vi.fn(),
  setPosition: vi.fn(),
  claimPlay: vi.fn(),
  finishSection: vi.fn(),
  submitAttempt: vi.fn(),
}))

describe("RemoteAttemptGateway", () => {
  const gateway = new RemoteAttemptGateway()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("forwards each lifecycle call to the attempts API unchanged", async () => {
    const started = { id: "a1" }
    const envelope = { id: "a1" }
    const entry = { sectionId: "s1" }
    const grant = { mediaUrl: "/m" }
    const finished = { nextSectionId: null }
    const submitted = { attemptId: "a1" }
    vi.mocked(api.startAttempt).mockResolvedValue(started as never)
    vi.mocked(api.getRunnerEnvelope).mockResolvedValue(envelope as never)
    vi.mocked(api.enterSection).mockResolvedValue(entry as never)
    vi.mocked(api.setPosition).mockResolvedValue()
    vi.mocked(api.claimPlay).mockResolvedValue(grant as never)
    vi.mocked(api.finishSection).mockResolvedValue(finished as never)
    vi.mocked(api.submitAttempt).mockResolvedValue(submitted as never)

    await expect(
      gateway.start("p3", { inProgressAttemptId: null }),
    ).resolves.toBe(started)
    await expect(gateway.loadEnvelope("a1")).resolves.toBe(envelope)
    await expect(gateway.enterSection("a1", "s1")).resolves.toBe(entry)
    await expect(gateway.setPosition("a1", "s1", "q1")).resolves.toBeUndefined()
    await expect(gateway.claimPlay("a1", "st1")).resolves.toBe(grant)
    await expect(
      gateway.finishSection("a1", "s1", {
        clientInstanceId: "i",
        responses: [],
      }),
    ).resolves.toBe(finished)
    await expect(
      gateway.submit("a1", { clientInstanceId: "i", responses: [] }),
    ).resolves.toBe(submitted)

    expect(api.startAttempt).toHaveBeenCalledWith("p3")
    expect(api.getRunnerEnvelope).toHaveBeenCalledWith("a1")
    expect(api.enterSection).toHaveBeenCalledWith("a1", "s1")
    expect(api.setPosition).toHaveBeenCalledWith("a1", "s1", "q1")
    expect(api.claimPlay).toHaveBeenCalledWith("a1", "st1")
    expect(api.finishSection).toHaveBeenCalledWith("a1", "s1", {
      clientInstanceId: "i",
      responses: [],
    })
    expect(api.submitAttempt).toHaveBeenCalledWith("a1", {
      clientInstanceId: "i",
      responses: [],
    })
  })

  it("propagates an ApiError from every lifecycle call unchanged", async () => {
    const refusal = new ApiError({
      type: "attempt_expired",
      title: "Attempt expired",
      status: 410,
    })
    vi.mocked(api.startAttempt).mockRejectedValue(refusal)
    vi.mocked(api.getRunnerEnvelope).mockRejectedValue(refusal)
    vi.mocked(api.enterSection).mockRejectedValue(refusal)
    vi.mocked(api.setPosition).mockRejectedValue(refusal)
    vi.mocked(api.claimPlay).mockRejectedValue(refusal)
    vi.mocked(api.finishSection).mockRejectedValue(refusal)
    vi.mocked(api.submitAttempt).mockRejectedValue(refusal)
    const body = { clientInstanceId: "i", responses: [] }

    await expect(gateway.start("p3")).rejects.toBe(refusal)
    await expect(gateway.loadEnvelope("a1")).rejects.toBe(refusal)
    await expect(gateway.enterSection("a1", "s1")).rejects.toBe(refusal)
    await expect(gateway.setPosition("a1", "s1", "q1")).rejects.toBe(refusal)
    await expect(gateway.claimPlay("a1", "st1")).rejects.toBe(refusal)
    await expect(gateway.finishSection("a1", "s1", body)).rejects.toBe(refusal)
    await expect(gateway.submit("a1", body)).rejects.toBe(refusal)
  })

  it("flushAnswers flushes the section through the controller to the attempt's responses URL", async () => {
    const flushed = { flushed: true }
    const flushSection = vi.fn().mockResolvedValue(flushed)
    const ctx = {
      controller: { flushSection },
      queue: {},
      attemptId: "a1",
      sectionId: "s1",
    } as unknown as FlushContext

    await expect(gateway.flushAnswers(ctx)).resolves.toBe(flushed)

    expect(flushSection).toHaveBeenCalledWith(
      "a1",
      "s1",
      "/attempts/a1/responses",
    )
  })

  it("noteAnswer is a no-op and a remote attempt is never local-only", async () => {
    await expect(gateway.noteAnswer("a1", {} as never)).resolves.toBeUndefined()
    await expect(gateway.isLocalOnly("a1")).resolves.toBe(false)
  })

  it("OfflineError carries a discriminating kind and reason", () => {
    const error = new OfflineError("media_missing")

    expect(error).toBeInstanceOf(Error)
    expect(error.kind).toBe("offline")
    expect(error.reason).toBe("media_missing")
  })
})

describe("attemptGateway (selector)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    setAttemptGateway(new RemoteAttemptGateway())
  })

  it("defaults to the remote gateway", async () => {
    vi.mocked(api.getRunnerEnvelope).mockResolvedValue({ id: "a1" } as never)

    await attemptGateway.loadEnvelope("a1")

    expect(api.getRunnerEnvelope).toHaveBeenCalledWith("a1")
  })

  it("forwards every call to whichever gateway is installed at call time", async () => {
    const installed = {
      start: vi.fn().mockResolvedValue("start"),
      loadEnvelope: vi.fn().mockResolvedValue("envelope"),
      enterSection: vi.fn().mockResolvedValue("entry"),
      setPosition: vi.fn().mockResolvedValue(undefined),
      claimPlay: vi.fn().mockResolvedValue("grant"),
      finishSection: vi.fn().mockResolvedValue("finished"),
      submit: vi.fn().mockResolvedValue("submitted"),
      noteAnswer: vi.fn().mockResolvedValue(undefined),
      flushAnswers: vi.fn().mockResolvedValue("flushed"),
      isLocalOnly: vi.fn().mockResolvedValue(true),
    } satisfies Record<keyof AttemptGateway, unknown>
    const hint = { inProgressAttemptId: "a0" }
    const body = { clientInstanceId: "i", responses: [] }
    const answer = { questionId: "q1" } as never
    const ctx = { attemptId: "a1" } as unknown as FlushContext

    setAttemptGateway(installed as unknown as AttemptGateway)

    await expect(attemptGateway.start("p3", hint)).resolves.toBe("start")
    await expect(attemptGateway.loadEnvelope("a1")).resolves.toBe("envelope")
    await expect(attemptGateway.enterSection("a1", "s1")).resolves.toBe("entry")
    await attemptGateway.setPosition("a1", "s1", "q1")
    await expect(attemptGateway.claimPlay("a1", "st1")).resolves.toBe("grant")
    await expect(attemptGateway.finishSection("a1", "s1", body)).resolves.toBe(
      "finished",
    )
    await expect(attemptGateway.submit("a1", body)).resolves.toBe("submitted")
    await attemptGateway.noteAnswer("a1", answer)
    await expect(attemptGateway.flushAnswers(ctx)).resolves.toBe("flushed")
    await expect(attemptGateway.isLocalOnly("a1")).resolves.toBe(true)

    expect(installed.start).toHaveBeenCalledWith("p3", hint)
    expect(installed.loadEnvelope).toHaveBeenCalledWith("a1")
    expect(installed.enterSection).toHaveBeenCalledWith("a1", "s1")
    expect(installed.setPosition).toHaveBeenCalledWith("a1", "s1", "q1")
    expect(installed.claimPlay).toHaveBeenCalledWith("a1", "st1")
    expect(installed.finishSection).toHaveBeenCalledWith("a1", "s1", body)
    expect(installed.submit).toHaveBeenCalledWith("a1", body)
    expect(installed.noteAnswer).toHaveBeenCalledWith("a1", answer)
    expect(installed.flushAnswers).toHaveBeenCalledWith(ctx)
    expect(installed.isLocalOnly).toHaveBeenCalledWith("a1")
    expect(api.startAttempt).not.toHaveBeenCalled()
  })

  it("gatewayFor returns the forwarding singleton", () => {
    expect(gatewayFor("a1")).toBe(attemptGateway)
  })
})
