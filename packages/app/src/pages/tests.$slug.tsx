import { createFileRoute, defaultStringifySearch } from "@tanstack/react-router"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ApiError } from "../lib/api-client.js"
import { startAttempt } from "../lib/attempts-api.js"
import type { AttemptStart, TestBrief } from "../lib/api-types.js"
import { getTest } from "../lib/catalog-api.js"

export interface TestBriefScreenProps {
  readonly brief: TestBrief
  readonly navigate: (path: string) => void
}

function sectionRulesPath(attempt: AttemptStart, sectionId: string): string {
  const search = attempt.finalizedPriorAttempt
    ? defaultStringifySearch({
        finalizedPriorAttempt: attempt.finalizedPriorAttempt,
      })
    : ""

  return `/attempts/${attempt.id}/sections/${sectionId}/rules${search}`
}

export function TestBriefScreen({ brief, navigate }: TestBriefScreenProps) {
  const { t } = useTranslation("runner")
  const startingRef = useRef(false)
  const [starting, setStarting] = useState(false)
  const [startFailed, setStartFailed] = useState(false)
  const durationMinutes = Math.round(brief.durationSeconds / 60)
  const attemptNumber = brief.attemptCount + 1
  const firstSection = brief.sections.reduce<
    TestBrief["sections"][number] | undefined
  >(
    (first, section) =>
      !first || section.ordinal < first.ordinal ? section : first,
    undefined,
  )
  const step = t(
    brief.level === "primary-step-1" ? "library.step.1" : "library.step.2",
  )

  async function handleStart(): Promise<void> {
    if (startingRef.current || !firstSection) {
      return
    }

    startingRef.current = true
    setStarting(true)
    setStartFailed(false)

    try {
      const attempt = await startAttempt(brief.slug)
      navigate(sectionRulesPath(attempt, firstSection.id))
    } catch {
      startingRef.current = false
      setStarting(false)
      setStartFailed(true)
    }
  }

  return (
    <div className="device-page">
      <header className="app-bar">
        <span className="app-brand">{t("library.brand")}</span>
      </header>

      <main className="device-main">
        <h1 className="screen-title">{brief.title}</h1>
        <p className="screen-subtitle mb-4">
          {t("brief.summary", {
            step,
            sectionCount:
              brief.sections.length === 2
                ? t("brief.sectionCount.two")
                : t("brief.sectionCount", { count: brief.sections.length }),
            duration: t("brief.durationMinutes", {
              count: durationMinutes,
            }),
            attempt: t("brief.attempt", { number: attemptNumber }),
          })}
        </p>

        <div className="mt-4 space-y-[11px]">
          {brief.sections.map((section) => {
            const titleId = `brief-section-${section.id}`
            const sectionMinutes = Math.round(section.durationSeconds / 60)

            return (
              <article
                key={section.id}
                aria-labelledby={titleId}
                className="device-card"
              >
                <div className="flex flex-wrap items-center gap-x-[11px] gap-y-2">
                  <span
                    className={`section-chip section-chip--${section.type}`}
                    data-section-type={section.type}
                  >
                    {t(`library.section.${section.type}`)}
                  </span>
                  <h2 id={titleId} className="text-sm font-bold">
                    {section.title}
                  </h2>
                  <span className="text-ink text-sm font-bold">
                    {t("brief.questionCount", {
                      count: section.questionCount,
                    })}
                  </span>
                  <span className="grow" />
                  <span className="text-ink-2 text-[13.5px]">
                    {t("brief.durationMinutesShort", {
                      count: sectionMinutes,
                    })}
                  </span>
                </div>
                <ul className="text-ink-2 mt-2 space-y-1 text-[13px] leading-relaxed">
                  {section.instructions.map((instruction) => (
                    <li key={instruction}>{instruction}</li>
                  ))}
                </ul>
              </article>
            )
          })}
        </div>

        <p className="border-amber bg-amber/15 text-ink-2 mt-[15px] rounded-[9px] border px-4 py-3 text-sm leading-relaxed font-semibold">
          {t("brief.saveNotice")}
        </p>
        {startFailed ? (
          <p role="alert" className="text-bad mt-3 text-sm font-semibold">
            {t("brief.startError")}
          </p>
        ) : null}
      </main>

      <footer className="device-footer sticky bottom-0">
        <a href="/" className="device-button" data-variant="secondary">
          {t("brief.back")}
        </a>
        <span className="grow" />
        <button
          type="button"
          className="device-button"
          disabled={starting || !firstSection}
          aria-busy={starting}
          onClick={() => void handleStart()}
        >
          {t(starting ? "brief.starting" : "brief.start")}
        </button>
      </footer>
    </div>
  )
}

export function loadTestBrief(slug: string): Promise<TestBrief> {
  return getTest(slug)
}

export interface TestBriefRouteErrorProps {
  readonly error: unknown
}

export function TestBriefRouteError({ error }: TestBriefRouteErrorProps) {
  const { t } = useTranslation("runner")
  const notFound = error instanceof ApiError && error.problem.status === 404

  return (
    <div className="device-page">
      <main className="center-main">
        <section className="device-card">
          <p role="alert">
            {t(notFound ? "brief.unavailable" : "brief.error")}
          </p>
          <p>
            <a href="/" className="device-button" data-variant="ghost">
              {t("brief.backToLibrary")}
            </a>
          </p>
        </section>
      </main>
    </div>
  )
}

export const Route = createFileRoute("/tests/$slug")({
  loader: ({ params }) => loadTestBrief(params.slug),
  errorComponent: TestBriefRouteError,
  component: RouteComponent,
})

function RouteComponent() {
  const brief = Route.useLoaderData()

  const navigate = (path: string): void => {
    window.location.assign(path)
  }

  return <TestBriefScreen brief={brief} navigate={navigate} />
}
