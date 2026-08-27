export type SectionKind = "listening" | "reading" | "vocabulary" | "grammar"

export type NavigationMode = "free" | "forward_only"

export type SectionStatus = "pending" | "open" | "closed"

export type NavigatorCellStatus =
  | "current"
  | "answered"
  | "blank"
  | "correct"
  | "incorrect"

export interface NavigatorCell {
  questionId: string
  ordinal: number
  status: NavigatorCellStatus
  disabled: boolean
}

export interface NavigatorGroup {
  sectionId: string
  sectionType: SectionKind
  cells: NavigatorCell[]
}

export interface NavigatorSource {
  mode: "runner" | "review"
  currentQuestionId: string | null
  sections: Array<{
    id: string
    type: SectionKind
    navigation: NavigationMode
    status: SectionStatus
    questions: Array<{ id: string; ordinal: number }>
  }>
  answeredQuestionIds: ReadonlySet<string>
  outcomeByQuestionId?: ReadonlyMap<
    string,
    "correct" | "incorrect" | "unanswered"
  >
}

export function buildNavigatorGroups(
  source: NavigatorSource,
): NavigatorGroup[] {
  return source.sections.map((section) => ({
    sectionId: section.id,
    sectionType: section.type,
    cells: section.questions.map((q) => {
      const outcome = source.outcomeByQuestionId?.get(q.id)
      let status: NavigatorCellStatus = "blank"

      if (source.mode === "review") {
        if (outcome === "correct" || outcome === "incorrect") {
          status = outcome
        }
      } else if (q.id === source.currentQuestionId) {
        status = "current"
      } else if (source.answeredQuestionIds.has(q.id)) {
        status = "answered"
      }

      // The contract states the rule this encodes: PUT /position is
      // "accepted where `navigation` is `free` and refused where it is
      // `forward_only` -- the navigator's disabled cells are a rendering of
      // what this call would reject". So every case the server refuses must
      // be disabled here, or a child taps a cell and gets an error instead
      // of nothing happening.
      //
      // `closed` is one of those cases and is easy to miss: setPosition's
      // query requires the attempt_section row to have completed_at IS NULL,
      // so a FINISHED free section refuses a position write exactly as a
      // forward_only one does. "A free section's cells stay clickable
      // throughout" is true only while that section is still open.
      const disabled =
        source.mode === "review"
          ? false
          : section.status !== "open" || section.navigation === "forward_only"

      return { questionId: q.id, ordinal: q.ordinal, status, disabled }
    }),
  }))
}
