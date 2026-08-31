import { Card, CardContent } from "@liam-public/browser-react-ui"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { QuestionNavigator } from "../components/QuestionNavigator.js"
import { ApiError } from "../lib/api-client.js"
import type {
  ReviewChoice,
  ReviewItem,
  ReviewPayload,
  ReviewStimulus,
} from "../lib/api-types.js"
import { getAttemptReview } from "../lib/attempts-api.js"
import type { NavigatorSource } from "../lib/navigator-state.js"

export async function loadReview(attemptId: string): Promise<ReviewPayload> {
  try {
    return await getAttemptReview(attemptId)
  } catch (error: unknown) {
    if (error instanceof ApiError && error.problem.status === 409) {
      redirect({
        href: `/attempts/${attemptId}/run`,
        replace: true,
        throw: true,
      })

      throw new Error("TanStack Router did not throw its redirect")
    }

    throw error
  }
}

function outcomeClasses(outcome: ReviewItem["outcome"]): string {
  switch (outcome) {
    case "correct":
      return "bg-good-bg text-good"

    case "incorrect":
      return "bg-bad-bg text-bad"

    case "unanswered":
      return "bg-surface text-ink-2"
  }
}

function choiceVerdict(
  choice: ReviewChoice,
): "correct" | "incorrect" | undefined {
  if (choice.isCorrect) {
    return "correct"
  }

  return choice.selected ? "incorrect" : undefined
}

/**
 * A `mixed` stimulus is text PLUS media, and its own `type` never says which
 * media -- only `mediaKind` does. Branching on `type` alone rendered every
 * mixed stimulus as an audio player, so a mixed passage-and-picture question
 * showed a child a dead audio control and no image.
 *
 * An `image` stimulus itself now has two shapes (a signed mediaUrl, or
 * inline imageSvg -- see Choice.imageSvg for why), so this returns the
 * relevant one rather than narrowing to a single `mediaUrl: string` member
 * the way it used to: `Extract<ReviewStimulus, { mediaUrl: string }>` would
 * silently drop the image variant now that ITS mediaUrl is optional.
 */
function imageSvgOf(stimulus: ReviewStimulus): string | undefined {
  return stimulus.type === "image" ? stimulus.imageSvg : undefined
}

function imageUrlOf(stimulus: ReviewStimulus): string | undefined {
  if (stimulus.type === "image") {
    return stimulus.mediaUrl
  }

  return stimulus.type === "mixed" && stimulus.mediaKind === "image"
    ? stimulus.mediaUrl
    : undefined
}

function audioUrlOf(stimulus: ReviewStimulus): string | undefined {
  if (stimulus.type === "audio") {
    return stimulus.mediaUrl
  }

  return stimulus.type === "mixed" && stimulus.mediaKind === "audio"
    ? stimulus.mediaUrl
    : undefined
}

interface ReviewStimulusViewProps {
  readonly stimulus: ReviewStimulus
}

function ReviewStimulusView({ stimulus }: ReviewStimulusViewProps) {
  const { t } = useTranslation("runner")
  const audioUrl = audioUrlOf(stimulus)

  return (
    <section className={`mb-6 ${audioUrl ? "audio-box" : "device-card"}`}>
      {stimulus.title ? (
        <h2 className="text-ink font-bold">{stimulus.title}</h2>
      ) : null}
      {"bodyText" in stimulus ? (
        <p className="passage mt-2 w-full text-left whitespace-pre-line">
          {stimulus.bodyText}
        </p>
      ) : null}
      {imageSvgOf(stimulus) ? (
        <span
          aria-hidden="true"
          className="stimulus-image mt-3"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: imageSvgOf(stimulus) ?? "" }}
        />
      ) : null}
      {!imageSvgOf(stimulus) && imageUrlOf(stimulus) ? (
        <img
          className="mt-3 max-h-80 rounded-lg object-contain"
          src={imageUrlOf(stimulus)}
          alt={stimulus.title ?? t("review.imageAlt")}
        />
      ) : null}
      {audioUrl ? (
        <audio
          className="mt-3 w-full"
          src={audioUrl}
          controls
          aria-label={t("review.replayAudio")}
        />
      ) : null}
    </section>
  )
}

interface ReviewChoiceListProps {
  readonly choices: readonly ReviewChoice[]
}

function ReviewChoiceMarker({ choice }: { readonly choice: ReviewChoice }) {
  const { t } = useTranslation("runner")

  if (choice.selected) {
    const markerKey = choice.isCorrect
      ? "review.yourAnswerCorrect"
      : "review.yourAnswerIncorrect"

    return (
      <span
        className={`text-xs font-bold ${choice.isCorrect ? "text-good" : "text-bad"}`}
      >
        {t(markerKey)}
      </span>
    )
  }

  if (choice.isCorrect) {
    return (
      <span className="text-good text-xs font-bold">
        {t("review.correctAnswer")}
      </span>
    )
  }

  return null
}

// Mirrors ChoiceList.tsx's ChoiceImage: inline markup, not a URL, so the
// pictogram's `stroke="currentColor"` still picks up this row's colour
// (including the correct/incorrect `.choice` verdict tint here in review).
function ReviewChoiceImage({ svg }: { readonly svg: string }) {
  return (
    <span
      aria-hidden="true"
      className="choice-image"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

function ReviewChoiceList({ choices }: ReviewChoiceListProps) {
  const { t } = useTranslation("runner")

  return (
    <ul
      aria-label={t("review.answerChoices")}
      className="choice-stack list-none p-0"
    >
      {choices.map((choice) => (
        <li
          key={choice.id}
          className="choice"
          data-locked="true"
          data-verdict={choiceVerdict(choice)}
        >
          <span
            aria-hidden="true"
            className="choice-dot rounded-full"
            data-state={choice.selected ? "checked" : "unchecked"}
          />
          {choice.imageSvg ? <ReviewChoiceImage svg={choice.imageSvg} /> : null}
          <span className="min-w-0 flex-1">{choice.label}</span>
          <ReviewChoiceMarker choice={choice} />
        </li>
      ))}
    </ul>
  )
}

function navigatorSource(review: ReviewPayload): NavigatorSource {
  const sections = new Map<string, NavigatorSource["sections"][number]>()

  for (const item of review.items) {
    const section = sections.get(item.sectionId)

    if (section) {
      section.questions.push({ id: item.questionId, ordinal: item.ordinal })
    } else {
      sections.set(item.sectionId, {
        id: item.sectionId,
        type: item.sectionType,
        navigation: "free",
        status: "closed",
        questions: [{ id: item.questionId, ordinal: item.ordinal }],
      })
    }
  }

  return {
    mode: "review",
    currentQuestionId: null,
    sections: [...sections.values()],
    answeredQuestionIds: new Set(
      review.items
        .filter((item) => item.outcome !== "unanswered")
        .map((item) => item.questionId),
    ),
    outcomeByQuestionId: new Map(
      review.items.map((item) => [item.questionId, item.outcome]),
    ),
  }
}

export interface ReviewScreenProps {
  readonly review: ReviewPayload
}

export function ReviewScreen({ review }: ReviewScreenProps) {
  const { t } = useTranslation("runner")
  const [currentIndex, setCurrentIndex] = useState(0)
  const [navigatorOpen, setNavigatorOpen] = useState(false)

  if (review.items.length === 0) {
    return (
      <div className="device-page">
        <main className="center-main">
          <p role="status" className="device-card">
            {t("review.empty")}
          </p>
        </main>
      </div>
    )
  }

  const current = review.items[currentIndex]

  // The server says which kind of section this is. It used to be guessed
  // from the section's POSITION in the item list -- right only for a
  // two-section test in the expected order, and the enum has four values.
  const sectionKey = current.sectionType
  const outcome = t(`review.outcome.${current.outcome}`)
  const atFirst = currentIndex === 0
  const atLast = currentIndex === review.items.length - 1
  const source = navigatorSource(review)

  return (
    <div className="device-page">
      <header className="app-bar flex-wrap gap-y-1 sm:flex-nowrap">
        <h1 className="app-brand shrink-0">{t("review.title")}</h1>
        <span
          className={`section-chip section-chip--${sectionKey} max-w-full min-w-0`}
          data-section-type={sectionKey}
        >
          {t(`runner.sectionChip.${sectionKey}`)}
        </span>
        <span className="hidden grow sm:block" />
        <span className="text-ink-2 ml-auto shrink-0 text-sm font-bold tabular-nums">
          {t("review.position", {
            current: currentIndex + 1,
            total: review.items.length,
          })}
        </span>
      </header>

      <main className="device-main mx-auto w-full max-w-4xl">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="question-count">
            {t("review.questionLabel", { ordinal: current.ordinal })}
          </span>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${outcomeClasses(current.outcome)}`}
            data-verdict={current.outcome}
          >
            {outcome}
          </span>
        </div>

        {current.stimulus ? (
          <ReviewStimulusView stimulus={current.stimulus} />
        ) : null}

        <p className="question-prompt mt-0">{current.prompt}</p>
        <ReviewChoiceList choices={current.choices} />

        {current.outcome === "unanswered" ? (
          <p className="text-faint mt-3 text-sm font-semibold">
            {t("review.leftBlankNotice", { ordinal: current.ordinal })}
          </p>
        ) : null}
      </main>

      <footer className="device-footer sticky bottom-0 z-10 flex-wrap">
        <a
          href={`/attempts/${review.attemptId}/result`}
          className="device-button"
          data-variant="ghost"
        >
          {t("review.backToResult")}
        </a>
        <button
          type="button"
          aria-expanded={navigatorOpen}
          aria-label={t("review.jumpToQuestion")}
          className="nav-toggle border-line bg-paper text-ink inline-flex min-h-11 touch-manipulation items-center gap-2 rounded-lg border px-3 text-sm font-bold select-none"
          onClick={() => setNavigatorOpen((open) => !open)}
        >
          <span aria-hidden="true">▦</span>
          <span>{t("review.jumpToQuestion")}</span>
        </button>
        <span className="grow" />
        <button
          type="button"
          className="device-button"
          data-variant="ghost"
          disabled={atFirst}
          onClick={() => setCurrentIndex((index) => index - 1)}
        >
          {t("runner.previous")}
        </button>
        <button
          type="button"
          className="device-button"
          disabled={atLast}
          onClick={() => setCurrentIndex((index) => index + 1)}
        >
          {t("runner.next")}
        </button>
      </footer>

      <QuestionNavigator
        open={navigatorOpen}
        onOpenChange={setNavigatorOpen}
        source={source}
        answeredCount={source.answeredQuestionIds.size}
        totalCount={review.items.length}
        onNavigate={(_sectionId, questionId) => {
          const nextIndex = review.items.findIndex(
            (item) => item.questionId === questionId,
          )

          if (nextIndex >= 0) {
            setCurrentIndex(nextIndex)
          }

          setNavigatorOpen(false)
        }}
      />
    </div>
  )
}

export interface ReviewRouteErrorProps {
  readonly error: unknown
}

export function ReviewRouteError({ error }: ReviewRouteErrorProps) {
  const { t } = useTranslation("runner")
  const forbidden = error instanceof ApiError && error.problem.status === 403

  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <Card>
        <CardContent>
          <p role="alert">
            {t(forbidden ? "review.forbidden" : "review.error")}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute("/attempts/$attemptId/review")({
  loader: ({ params }) => loadReview(params.attemptId),
  errorComponent: ReviewRouteError,
  component: RouteComponent,
})

function RouteComponent() {
  const review = Route.useLoaderData()

  return <ReviewScreen review={review} />
}
