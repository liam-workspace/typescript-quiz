import { describe, expect, it } from "vitest"
import {
  buildNavigatorGroups,
  type NavigatorSource,
} from "../src/lib/navigator-state.js"

function runnerSource(
  overrides: Partial<NavigatorSource> = {},
): NavigatorSource {
  return {
    mode: "runner",
    currentQuestionId: "q2",
    sections: [
      {
        id: "sec-listen",
        type: "listening",
        navigation: "forward_only",
        status: "open",
        questions: [
          { id: "q1", ordinal: 1 },
          { id: "q2", ordinal: 2 },
          { id: "q3", ordinal: 3 },
        ],
      },
    ],
    answeredQuestionIds: new Set(["q1"]),
    ...overrides,
  }
}

describe("buildNavigatorGroups", () => {
  it("marks the current question as current even in a forward_only section", () => {
    const [group] = buildNavigatorGroups(runnerSource())
    expect(group.cells[1]).toMatchObject({
      questionId: "q2",
      status: "current",
    })
  })

  it("disables every cell in an open forward_only section, not just the ones already passed", () => {
    const [group] = buildNavigatorGroups(runnerSource())
    expect(group.cells.every((c) => c.disabled)).toBe(true)
  })

  it("disables every cell in a CLOSED forward_only section too", () => {
    const source = runnerSource({
      sections: [
        {
          ...runnerSource().sections[0],
          status: "closed",
        },
      ],
    })
    const [group] = buildNavigatorGroups(source)
    expect(group.cells.every((c) => c.disabled)).toBe(true)
  })

  it("keeps a free section's cells enabled after a forward_only section closes", () => {
    const source = runnerSource({
      currentQuestionId: "q5",
      sections: [
        {
          id: "sec-listen",
          type: "listening",
          navigation: "forward_only",
          status: "closed",
          questions: [{ id: "q1", ordinal: 1 }],
        },
        {
          id: "sec-read",
          type: "reading",
          navigation: "free",
          status: "open",
          questions: [{ id: "q5", ordinal: 5 }],
        },
      ],
    })
    const [, reading] = buildNavigatorGroups(source)
    expect(reading.cells.every((c) => !c.disabled)).toBe(true)
  })

  // The case that made this rule wrong. "A free section's cells stay
  // clickable throughout" holds only while it is OPEN: setPosition's query
  // requires completed_at IS NULL, so a FINISHED free section refuses a
  // position write exactly as a forward_only one does. Leaving these enabled
  // put a tappable cell in front of a child that could only ever error.
  it("disables a CLOSED free section's cells, because setPosition refuses them", () => {
    const source = runnerSource({
      currentQuestionId: null,
      sections: [
        {
          id: "sec-read",
          type: "reading",
          navigation: "free",
          status: "closed",
          questions: [
            { id: "q5", ordinal: 5 },
            { id: "q6", ordinal: 6 },
          ],
        },
      ],
    })
    const [reading] = buildNavigatorGroups(source)

    expect(reading.cells.every((c) => c.disabled)).toBe(true)
  })

  it("disables a pending section's cells even when its navigation mode is free", () => {
    const source = runnerSource({
      sections: [
        {
          id: "sec-read",
          type: "reading",
          navigation: "free",
          status: "pending",
          questions: [{ id: "q9", ordinal: 9 }],
        },
      ],
    })
    const [group] = buildNavigatorGroups(source)
    expect(group.cells[0].disabled).toBe(true)
  })

  it("colours review cells by outcome and never disables them", () => {
    const source: NavigatorSource = {
      mode: "review",
      currentQuestionId: null,
      sections: [
        {
          id: "sec-read",
          type: "reading",
          navigation: "free",
          status: "closed",
          questions: [
            { id: "q1", ordinal: 1 },
            { id: "q2", ordinal: 2 },
          ],
        },
      ],
      answeredQuestionIds: new Set(["q1", "q2"]),
      outcomeByQuestionId: new Map([
        ["q1", "correct"],
        ["q2", "incorrect"],
      ]),
    }
    const [group] = buildNavigatorGroups(source)
    expect(group.cells).toEqual([
      { questionId: "q1", ordinal: 1, status: "correct", disabled: false },
      { questionId: "q2", ordinal: 2, status: "incorrect", disabled: false },
    ])
  })

  it("marks a question with no recorded response as blank", () => {
    const source = runnerSource({
      currentQuestionId: "q1",
      answeredQuestionIds: new Set(),
    })
    const [group] = buildNavigatorGroups(source)
    expect(group.cells[2]).toMatchObject({
      questionId: "q3",
      status: "blank",
    })
  })
})
