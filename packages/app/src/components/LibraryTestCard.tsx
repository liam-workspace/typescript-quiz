import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import type { TestCard } from "../lib/api-types.js"
import { testCardActions } from "../lib/testCardState.js"
import { Icon } from "./Icon.js"

export interface LibraryTestCardProps {
  readonly test: TestCard
  readonly highlighted: boolean
  readonly starting: boolean
  /** Already-translated reason Start is unavailable, or null. */
  readonly disabledReason: string | null
  readonly onStart: (test: TestCard) => void
  /** Slot below the actions (Part C: "Save offline" control / "Available offline" chip). */
  readonly extras?: ReactNode
}

export function LibraryTestCard({
  test,
  highlighted,
  starting,
  disabledReason,
  onStart,
  extras,
}: LibraryTestCardProps) {
  const { t } = useTranslation("runner")
  const titleId = `test-card-${test.id}`
  const reasonId = `test-card-reason-${test.id}`
  const isMath = test.sections.length === 1 && test.sections[0]?.type === "math"
  const running = test.inProgressAttemptId !== null
  const sectionLabels = test.sections.map((section) =>
    t("library.sectionCount", {
      section: t(`library.section.${section.type}`),
      count: section.questionCount,
    }),
  )
  const currentSection = test.sections[0]?.type ?? "listening"
  const startLabel = t(
    test.attemptCount === 0
      ? "library.action.start"
      : "library.action.tryAgain",
  )

  return (
    <article
      aria-labelledby={titleId}
      className="m-card"
      data-highlight={highlighted}
    >
      <div className="m-row" data-align="start">
        <span className="m-ticon" data-kind={isMath ? "math" : "audio"}>
          <Icon name={isMath ? "calc" : "headphones"} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-[16.5px] font-extrabold">
            {test.title}
          </h2>
          <p className="m-meta">
            {[
              t(
                test.level === "primary-step-1"
                  ? "library.step.1"
                  : "library.step.2",
              ),
              ...sectionLabels,
              t("library.durationMinutes", {
                count: Math.round(test.durationSeconds / 60),
              }),
            ].join(" · ")}
          </p>
          {running || test.bestAttempt ? (
            <div className="m-chips">
              {running ? (
                <span className="m-chip" data-tone="clay">
                  {t("library.statusInProgress", {
                    section: t(`library.section.${currentSection}`),
                  })}
                </span>
              ) : null}
              {test.bestAttempt ? (
                <span className="m-chip" data-tone="teal">
                  {t("library.statusBest", {
                    percentage: Math.round(test.bestAttempt.percentage),
                  })}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="m-actions">
        {testCardActions(test).map((action) => {
          switch (action.kind) {
            case "continue":
              // A reason (offline, no local state) turns the link into a
              // disabled button: a link cannot be disabled.
              return disabledReason ? (
                <button
                  key="continue"
                  type="button"
                  className="m-btn"
                  disabled
                  aria-describedby={reasonId}
                >
                  {t("library.action.continue")}
                </button>
              ) : (
                <Link
                  key="continue"
                  to="/attempts/$attemptId/run"
                  params={{ attemptId: action.attemptId }}
                  className="m-btn"
                >
                  {t("library.action.continue")}
                </Link>
              )

            case "seeResult":
              return (
                <Link
                  key="seeResult"
                  to="/attempts/$attemptId/result"
                  params={{ attemptId: action.attemptId }}
                  className="m-btn"
                  data-variant="secondary"
                >
                  {t("library.action.seeResult")}
                </Link>
              )

            default:
              return (
                <button
                  key={action.kind}
                  type="button"
                  className="m-btn"
                  data-variant={
                    action.kind === "tryAgain" ? "secondary" : undefined
                  }
                  disabled={starting || disabledReason !== null}
                  aria-busy={starting}
                  aria-describedby={disabledReason ? reasonId : undefined}
                  onClick={() => {
                    onStart(test)
                  }}
                >
                  {starting ? t("brief.starting") : startLabel}
                </button>
              )
          }
        })}
      </div>
      {disabledReason ? (
        <p id={reasonId} className="m-reason">
          {disabledReason}
        </p>
      ) : null}
      {extras}
    </article>
  )
}
