import { describe, expect, it } from "vitest"
import { startGate } from "../src/lib/offline/start-gate.js"

const base = {
  online: true,
  saved: false,
  continuableLocally: false,
  isContinue: false,
  activeOtherTitle: null,
}

describe("startGate", () => {
  it("allows everything while online", () => {
    expect(startGate(base)).toEqual({ enabled: true })
  })

  it("blocks a different test while another attempt is active, even online", () => {
    expect(startGate({ ...base, activeOtherTitle: "Practice Test 3" })).toEqual(
      { enabled: false, reason: "finish-active-first" },
    )
  })

  it("finish-first wins over needs-connection when both apply", () => {
    expect(
      startGate({
        ...base,
        online: false,
        activeOtherTitle: "Practice Test 3",
      }),
    ).toEqual({ enabled: false, reason: "finish-active-first" })
  })

  it("offline: an unsaved test needs a connection", () => {
    expect(startGate({ ...base, online: false })).toEqual({
      enabled: false,
      reason: "needs-connection",
    })
  })

  it("offline: a saved test can start", () => {
    expect(startGate({ ...base, online: false, saved: true })).toEqual({
      enabled: true,
    })
  })

  it("offline: Continue needs local state on this device, saved or not", () => {
    expect(
      startGate({ ...base, online: false, isContinue: true, saved: true }),
    ).toEqual({ enabled: false, reason: "needs-connection" })
    expect(
      startGate({
        ...base,
        online: false,
        isContinue: true,
        continuableLocally: true,
      }),
    ).toEqual({ enabled: true })
  })
})
