/**
 * Converts one TOEFL Primary source `test.json` (the "Tom's English grade 5"
 * generator's own format) into the app's `TestDocument` interchange shape.
 * Pure and DB/filesystem-free -- `import-toefl-primary.ts` is the only
 * caller, and validates the result with `testDocumentSchema.parse` before
 * it ever reaches `importTestDocument`.
 *
 * The source's shape and this mapping were worked out by inspecting all 5
 * real fixture files; the decisions below are not guesses:
 *
 * - A part with `stimulus` set (a story/conversation/talk/academic
 *   listening passage, or a notice/message/schedule/story/informational
 *   reading passage) becomes ONE group holding every question in the
 *   part. Every question in such a part also repeats the stimulus's own
 *   `audio` field on itself -- that is the SAME file, not a per-question
 *   one, and is ignored here; `part.stimulus` is the only source of truth
 *   for what a shared-stimulus part's media is.
 * - A part with `stimulus: null` puts whatever is per-question (audio for
 *   listen_pick_picture/listen_mcq_short/listen_follow_directions, `pic`
 *   for read_word_picture) onto its OWN group, one question per group. A
 *   part with neither (read_sentence_gap) bundles every question into one
 *   bare group with no stimulus at all.
 * - `listen_pick_picture`, `listen_follow_directions` and
 *   `read_word_picture` questions carry no written prompt at all -- the
 *   real exam has none either, only the part's spoken/printed directions
 *   ("Listen and choose the correct picture..."), so that text is reused
 *   as the prompt. `TestDocument`'s prompt is required and non-blank, so
 *   an empty prompt is not an option.
 * - `part.example` (and any part whose `questions` array is empty because
 *   it exists ONLY to hold that example) is skipped entirely -- the
 *   runner has no unscored/example-question concept, and the source's own
 *   `total_scored` / section `scored` counts already exclude examples, so
 *   dropping them keeps the imported question count matching what the
 *   source itself calls "scored".
 */
import { testDocumentSchema, type TestDocument } from "@pp/common"

export interface SourceChoice {
  label: string
  svg?: string
}

export interface SourceQuestion {
  n: number
  id: string
  type: string
  choices?: SourceChoice[]
  answer?: string
  audio?: string
  prompt?: string
  pic?: string
  is_example?: boolean
}

export interface SourceStimulus {
  kind: string
  title?: string
  audio?: string
  text?: string
}

export interface SourcePart {
  id: string
  name: string
  directions?: string
  type: string
  stimulus?: SourceStimulus | null
  questions: SourceQuestion[]
}

export interface SourceSection {
  id: "listening" | "reading"
  name: string
  minutes: number
  plays_allowed?: number
  parts: SourcePart[]
}

export interface SourceTest {
  meta: {
    id: string
    step: 1 | 2
    title: string
    seed: number
  }
  sections: SourceSection[]
}

/** `sourceStem` (e.g. "a02") -> the mp3 filename it should be transcoded to. */
export type AudioManifest = Map<string, string>

type Group = TestDocument["sections"][number]["groups"][number]
type Question = Group["questions"][number]
type Choice = Question["choices"][number]

function audioFilename(testSlug: string, stem: string): string {
  // The filename column is UNIQUE across the whole database, and the
  // source reuses stems ("a01", "a02"...) across all 5 tests -- so the
  // slug has to be part of the name, not just the stem.
  return `${testSlug}-${stem}.mp3`
}

function toChoice(source: SourceChoice, answer: string | undefined): Choice {
  return {
    label: source.label,
    isCorrect: source.label === answer,
    ...(source.svg ? { imageSvg: source.svg } : {}),
  }
}

function toQuestion(
  source: SourceQuestion,
  fallbackPrompt: string,
): Omit<Question, "choices"> & { choices: SourceChoice[] } {
  const prompt = source.prompt ?? fallbackPrompt

  if (!prompt) {
    throw new Error(
      `question ${source.id} has neither its own prompt nor a part fallback`,
    )
  }

  return {
    questionKey: source.id,
    prompt,
    type: "single_choice",
    points: 1,
    choices: source.choices ?? [],
  }
}

function buildQuestions(part: SourcePart): Question[] {
  return part.questions
    .filter((q) => !q.is_example)
    .map((q) => {
      const built = toQuestion(q, part.directions ?? "")

      return {
        ...built,
        choices: built.choices.map((c) => toChoice(c, q.answer)),
      }
    })
}

/**
 * A shared-stimulus part (story/conversation/talk/academic/notice/message/
 * schedule/informational) -> exactly one group holding every real question.
 */
function buildSharedStimulusGroup(
  part: SourcePart & { stimulus: SourceStimulus },
  manifest: AudioManifest,
  testSlug: string,
): Group | null {
  const { stimulus } = part
  const questions = buildQuestions(part)

  if (questions.length === 0) {
    return null
  }

  if (stimulus.audio) {
    const filename = audioFilename(testSlug, stimulus.audio)
    manifest.set(stimulus.audio, filename)

    return {
      stimulus: {
        type: "audio",
        ...(stimulus.title ? { title: stimulus.title } : {}),
        mediaFilename: filename,
      },
      questions,
    }
  }

  if (stimulus.text) {
    return {
      stimulus: {
        type: "passage",
        ...(stimulus.title ? { title: stimulus.title } : {}),
        bodyText: stimulus.text,
      },
      questions,
    }
  }

  throw new Error(`part ${part.id}'s stimulus has neither audio nor text`)
}

/**
 * A no-stimulus part -- each question with its OWN audio/pic gets its own
 * one-question group; the rest (read_sentence_gap) share one bare group.
 */
function buildPerQuestionGroups(
  part: SourcePart,
  manifest: AudioManifest,
  testSlug: string,
): Group[] {
  const real = part.questions.filter((q) => !q.is_example)
  const bare: Question[] = []
  const groups: Group[] = []

  for (const q of real) {
    const built = toQuestion(q, part.directions ?? "")
    const question: Question = {
      ...built,
      choices: built.choices.map((c) => toChoice(c, q.answer)),
    }

    if (q.audio) {
      const filename = audioFilename(testSlug, q.audio)
      manifest.set(q.audio, filename)
      groups.push({
        stimulus: { type: "audio", mediaFilename: filename },
        questions: [question],
      })

      continue
    }

    if (q.pic) {
      groups.push({
        stimulus: { type: "image", imageSvg: q.pic },
        questions: [question],
      })

      continue
    }

    bare.push(question)
  }

  if (bare.length > 0) {
    groups.push({ questions: bare })
  }

  return groups
}

function buildGroups(
  part: SourcePart,
  manifest: AudioManifest,
  testSlug: string,
): Group[] {
  if (part.stimulus) {
    const group = buildSharedStimulusGroup(
      { ...part, stimulus: part.stimulus },
      manifest,
      testSlug,
    )

    return group ? [group] : []
  }

  return buildPerQuestionGroups(part, manifest, testSlug)
}

function dedupeConsecutive(values: string[]): string[] {
  return values.filter((v, i) => i === 0 || values[i - 1] !== v)
}

function buildSection(
  section: SourceSection,
  manifest: AudioManifest,
  testSlug: string,
): TestDocument["sections"][number] {
  const groups = section.parts.flatMap((part) =>
    buildGroups(part, manifest, testSlug),
  )
  const instructions = dedupeConsecutive(
    section.parts
      .map((p) => p.directions)
      .filter((d): d is string => Boolean(d)),
  )
  const isListening = section.id === "listening"

  return {
    title: section.name,
    type: section.id,
    durationSeconds: section.minutes * 60,
    navigation: isListening ? "forward_only" : "free",
    allowAnswerChange: !isListening,
    playback: isListening
      ? {
          maxPlays: section.plays_allowed ?? null,
          allowPause: false,
          allowSeek: false,
        }
      : null,
    instructions,
    groups,
  }
}

/**
 * Returns the (unvalidated) document alongside the audio manifest -- the
 * caller validates with `testDocumentSchema.parse` and transcodes exactly
 * the files the manifest names, no more.
 */
export function transformSourceTest(source: SourceTest): {
  document: unknown
  audioManifest: AudioManifest
} {
  const manifest: AudioManifest = new Map()
  const sections = source.sections.map((s) =>
    buildSection(s, manifest, source.meta.id),
  )
  const durationSeconds = sections.reduce(
    (sum, s) => sum + s.durationSeconds,
    0,
  )

  return {
    document: {
      title: `${source.meta.title} (Practice ${source.meta.seed})`,
      slug: source.meta.id,
      level: source.meta.step === 1 ? "primary-step-1" : "primary-step-2",
      durationSeconds,
      sections,
    },
    audioManifest: manifest,
  }
}

export function parseSourceTest(source: SourceTest): {
  document: TestDocument
  audioManifest: AudioManifest
} {
  const { document, audioManifest } = transformSourceTest(source)

  return { document: testDocumentSchema.parse(document), audioManifest }
}
