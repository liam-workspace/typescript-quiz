import { describe, expect, it } from "vitest"
import { reminders } from "./reminders.js"

describe("reminders (before Web Push exists)", () => {
  it("reports unsupported and cannot be switched on", async () => {
    await expect(reminders.state()).resolves.toBe("unsupported")
    await expect(reminders.enable()).resolves.toBe("unsupported")
    await expect(reminders.disable()).resolves.toBe("unsupported")
  })
})
