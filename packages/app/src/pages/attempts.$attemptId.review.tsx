import { Card, CardContent } from "@liam-workspace/browser-react-ui"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { choiceLabel } from "../components/ChoiceList.js"
import { Icon } from "../components/Icon.js"
import { MathContent } from "../components/MathContent.js"
import { QuestionNavigator } from "../components/QuestionNavigator.js"
import { ApiError } from "../lib/api-client.js"
import type {
  ReviewChoice,
  ReviewItem,
  ReviewPayload,
  ReviewStimulus,
  SectionType,
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

export const reviewSearchSchema = z.object({
  q: z.coerce.number().int().min(1).catch(1),
})

const OUTCOME_CHIP: Record<
  ReviewItem["outcome"],
  {
    readonly tone: "good" | "bad" | "warn"
    readonly icon: "check" | "x" | "minus"
  }
> = {
  correct: { tone: "good", icon: "check" },
  incorrect: { tone: "bad", icon: "x" },
  unanswered: { tone: "warn", icon: "minus" },
}

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) {
    return 0
  }

  return Math.min(Math.max(index, 0), Math.max(length - 1, 0))
}

const sectionTypes = new Set<SectionType>([
  "listening",
  "reading",
  "vocabulary",
  "grammar",
  "math",
])

type ReviewSectionKind = SectionType | "other"

function validSectionType(value: unknown): value is SectionType {
  return typeof value === "string" && sectionTypes.has(value as SectionType)
}

function reviewSectionType(
  current: ReviewItem,
  items: readonly ReviewItem[],
): ReviewSectionKind {
  const suppliedType: unknown = current.sectionType

  if (validSectionType(suppliedType)) {
    return suppliedType
  }

  // A rolling deployment can briefly mix legacy and current cached items.
  // A valid sibling is reliable because sectionId defines the section; media
  // is not reliable because vocabulary/grammar can contain audio or text too.
  const siblingType: unknown = items.find(
    (item) =>
      item.sectionId === current.sectionId &&
      validSectionType(item.sectionType),
  )?.sectionType

  if (validSectionType(siblingType)) {
    return siblingType
  }

  // Truly legacy payloads carry no type at all. Keep that compatibility
  // optional and honest with a neutral label instead of guessing reading for
  // every non-audio question (which mislabels vocabulary and grammar).
  return "other"
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
        className={`inline-flex items-center gap-1 text-xs font-bold ${choice.isCorrect ? "text-good" : "text-bad"}`}
      >
        <Icon name={choice.isCorrect ? "check" : "x"} small />
        {t(markerKey)}
      </span>
    )
  }

  if (choice.isCorrect) {
    return (
      <span className="text-good inline-flex items-center gap-1 text-xs font-bold">
        <Icon name="check" small />
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
      {choices.map((choice, index) => (
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
          >
            {choiceLabel(index)}
          </span>
          {choice.imageSvg ? <ReviewChoiceImage svg={choice.imageSvg} /> : null}
          <span className="min-w-0 flex-1">
            {choice.labelBlocks?.length ? (
              <MathContent blocks={choice.labelBlocks} />
            ) : (
              choice.label
            )}
          </span>
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
        type: reviewSectionType(item, review.items),
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
  /** 1-based question to open on; out-of-range values are clamped. */
  readonly initialOrdinal?: number
}

export function ReviewScreen({
  review,
  initialOrdinal = 1,
}: ReviewScreenProps) {
  const { t } = useTranslation("runner")
  const [currentIndex, setCurrentIndex] = useState(() =>
    clampIndex(initialOrdinal - 1, review.items.length),
  )
  const [navigatorOpen, setNavigatorOpen] = useState(false)
  const navigatorTriggerRef = useRef<HTMLButtonElement>(null)
  const firstRender = useRef(true)

  useEffect(() => {
    const url = new URL(window.location.href)

    url.searchParams.set("q", String(currentIndex + 1))
    // Deliberately bypasses TanStack Router: a router navigation would re-run
    // the loader and remount; the router's own `search.q` goes stale instead.
    window.history.replaceState(window.history.state, "", url)

    if (firstRender.current) {
      firstRender.current = false

      return
    }

    document
      .querySelector<HTMLElement>("[data-qtitle]")
      ?.focus({ preventScroll: true })
  }, [currentIndex])

  if (review.items.length === 0) {
    return (
      <div className="m-page">
        <main className="m-hero">
          <p role="status" className="m-card">
            {t("review.empty")}
          </p>
        </main>
      </div>
    )
  }

  const current = review.items[currentIndex]
  const chip = OUTCOME_CHIP[current.outcome]
  const atFirst = currentIndex === 0
  const atLast = currentIndex === review.items.length - 1
  const source = navigatorSource(review)

  return (
    <div className="m-page">
      <header className="m-appbar">
        <a
          href={`/attempts/${review.attemptId}/result`}
          className="m-iconbtn"
          aria-label={t("review.backToResult")}
        >
          <Icon name="back" />
        </a>
        <span className="m-brand">{t("review.title")}</span>
      </header>

      <main className="m-body">
        <div className="m-row mb-2 justify-between">
          <span className="m-qmeta" style={{ margin: 0 }}>
            {t("runner.questionCount", {
              current: currentIndex + 1,
              total: review.items.length,
            })}
          </span>
          <span
            className="m-chip"
            data-tone={chip.tone}
            data-verdict={current.outcome}
          >
            <Icon name={chip.icon} small />
            {t(`review.outcome.${current.outcome}`)}
          </span>
        </div>

        {current.stimulus ? (
          <ReviewStimulusView stimulus={current.stimulus} />
        ) : null}

        <h1
          className="question-prompt"
          tabIndex={-1}
          data-qtitle
          data-page-title
        >
          {current.promptBlocks?.length ? (
            <MathContent blocks={current.promptBlocks} />
          ) : (
            current.prompt
          )}
        </h1>
        {current.outcome === "unanswered" ? (
          <p className="m-notice" role="status">
            {t("review.leftBlankNotice", { ordinal: current.ordinal })}
          </p>
        ) : null}
        <ReviewChoiceList choices={current.choices} />
        {current.solutionBlocks?.length ? (
          <section className="bg-teal-bg mt-3.5 rounded-[14px] px-3.5 py-3">
            <h2 className="text-teal text-xs font-extrabold tracking-[0.07em] uppercase">
              {t("review.workedSolution")}
            </h2>
            <MathContent blocks={current.solutionBlocks} />
          </section>
        ) : null}
      </main>

      <footer className="m-actionbar" data-sticky="true">
        <button
          type="button"
          className="m-btn"
          data-variant="secondary"
          aria-label={t("runner.previousQuestion")}
          style={{ flex: "0 0 56px" }}
          disabled={atFirst}
          onClick={() => {
            setCurrentIndex((index) => index - 1)
          }}
        >
          <Icon name="back" />
        </button>
        <button
          ref={navigatorTriggerRef}
          type="button"
          aria-expanded={navigatorOpen}
          aria-haspopup="dialog"
          aria-label={t("review.jumpToQuestion")}
          className="m-btn"
          data-variant="secondary"
          style={{ flex: "0 0 auto" }}
          onClick={() => {
            setNavigatorOpen((open) => !open)
          }}
        >
          <Icon name="grid" />
          <span aria-hidden="true" className="m-jump-label">
            {t("review.jumpToQuestion")}
          </span>
        </button>
        <button
          type="button"
          className="m-btn"
          disabled={atLast}
          onClick={() => {
            setCurrentIndex((index) => index + 1)
          }}
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
        returnFocusRef={navigatorTriggerRef}
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
  validateSearch: reviewSearchSchema,
  loader: ({ params }) => loadReview(params.attemptId),
  errorComponent: ReviewRouteError,
  component: RouteComponent,
})

function RouteComponent() {
  const review = Route.useLoaderData()
  const { q } = Route.useSearch()

  return <ReviewScreen review={review} initialOrdinal={q} />
}
