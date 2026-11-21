import {
  withTransaction,
  type PgQueryable,
} from "@liam-workspace/node-postgres"
import {
  contentBlockSchema,
  testChoiceSchema,
  testDocumentSchema,
  verifyMathProblem,
  type ContentBlock,
  type MathProblemSpec,
  type MathAnswer,
  type TestDocument,
} from "@pp/common"
import katex from "katex"
import type pg from "pg"

type Section = TestDocument["sections"][number]
type Playback = Section["playback"]
type Group = Section["groups"][number]
type Stimulus = NonNullable<Group["stimulus"]>
type Question = Group["questions"][number]

/**
 * Inserts a document as a DRAFT version. Content must be written before
 * publication: the immutability triggers refuse inserts once published_at is
 * set, so publish is a separate call.
 */
export function importTestDocument(
  pool: pg.Pool,
  doc: TestDocument,
): Promise<{ testId: string; versionId: string; version: number }> {
  return withTransaction(pool, (tx) => insertTestDocument(tx, doc))
}

async function insertTestDocument(tx: PgQueryable, doc: TestDocument) {
  // The inserts below must run in sequence: each one needs the parent id
  // (and, for ordinals, the loop position) produced by the previous one,
  // so this cannot become Promise.all without breaking both the FK chain
  // and the ordinal order that the round trip depends on.
  /* eslint-disable no-await-in-loop */
  const test = await tx.query<{ id: string }>(
    `INSERT INTO test (slug) VALUES ($1)
     ON CONFLICT (slug) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [doc.slug],
  )
  const testId = test.rows[0].id

  const next = await tx.query<{ n: number }>(
    `SELECT COALESCE(MAX(version), 0) + 1 AS n FROM test_version WHERE test_id = $1`,
    [testId],
  )
  const version = next.rows[0].n

  const tv = await tx.query<{ id: string }>(
    `INSERT INTO test_version (test_id, version, title, level, duration_seconds)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [testId, version, doc.title, doc.level ?? null, doc.durationSeconds],
  )
  const versionId = tv.rows[0].id

  // The question ordinal is "position within the whole test" (see
  // migration 1001) and is unique per test_version_id, not per section —
  // so this counter must span every section, not reset at each one.
  let questionOrdinal = 0

  for (const [sIdx, section] of doc.sections.entries()) {
    const sec = await tx.query<{ id: string }>(
      `INSERT INTO test_section (test_version_id, ordinal, title, type, duration_seconds,
                                 navigation, allow_answer_change,
                                 default_max_plays, default_allow_pause, default_allow_seek)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        versionId,
        sIdx + 1,
        section.title,
        section.type,
        section.durationSeconds,
        section.navigation,
        section.allowAnswerChange,
        section.playback?.maxPlays ?? null,
        section.playback ? section.playback.allowPause : null,
        section.playback ? section.playback.allowSeek : null,
      ],
    )
    const sectionId = sec.rows[0].id

    for (const [i, text] of section.instructions.entries()) {
      await tx.query(
        `INSERT INTO section_instruction (test_section_id, ordinal, text) VALUES ($1,$2,$3)`,
        [sectionId, i + 1, text],
      )
    }

    for (const [gIdx, group] of section.groups.entries()) {
      let stimulusId: string | null = null

      if (group.stimulus) {
        const st = group.stimulus
        let mediaAssetId: string | null = null

        if (st.mediaFilename) {
          const asset = await tx.query<{ id: string }>(
            `SELECT id FROM media_asset WHERE filename = $1`,
            [st.mediaFilename],
          )

          if (asset.rows.length === 0) {
            throw new Error(`media asset "${st.mediaFilename}" not found`)
          }

          mediaAssetId = asset.rows[0].id
        }

        const ins = await tx.query<{ id: string }>(
          `INSERT INTO stimulus (test_version_id, type, title, body_text, media_asset_id,
                                 image_svg, max_plays, allow_pause, allow_seek)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [
            versionId,
            st.type,
            st.title ?? null,
            st.bodyText ?? null,
            mediaAssetId,
            st.imageSvg ?? null,
            st.maxPlays ?? null,
            st.allowPause ?? null,
            st.allowSeek ?? null,
          ],
        )
        stimulusId = ins.rows[0].id
      }

      const grp = await tx.query<{ id: string }>(
        `INSERT INTO question_group (test_version_id, test_section_id, stimulus_id, ordinal)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [versionId, sectionId, stimulusId, gIdx + 1],
      )
      const groupId = grp.rows[0].id

      for (const q of group.questions) {
        questionOrdinal += 1
        const qi = await tx.query<{ id: string }>(
          `INSERT INTO question (test_version_id, question_group_id, question_key,
                                 ordinal, prompt, type, points, prompt_blocks)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING id`,
          [
            versionId,
            groupId,
            q.questionKey,
            questionOrdinal,
            q.prompt,
            q.type,
            q.points,
            JSON.stringify(q.promptBlocks),
          ],
        )
        const questionId = qi.rows[0].id

        for (const [cIdx, c] of q.choices.entries()) {
          await tx.query(
            `INSERT INTO choice (question_id, ordinal, label, is_correct, image_svg, label_blocks)
             VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
            [
              questionId,
              cIdx + 1,
              c.label,
              c.isCorrect,
              c.imageSvg ?? null,
              JSON.stringify(c.labelBlocks),
            ],
          )
        }

        for (const [tIdx, tag] of (q.tags ?? []).entries()) {
          await tx.query(
            `INSERT INTO question_tag (question_id, ordinal, tag) VALUES ($1,$2,$3)`,
            [questionId, tIdx + 1, tag],
          )
        }
      }
    }
  }
  /* eslint-enable no-await-in-loop */

  return { testId, versionId, version }
}

type MathImportInput = Omit<TestDocument, "sections"> & {
  candidateIds: string[]
  adminSubject: string
}

interface ApprovedCandidate {
  id: string
  canonicalSpec: MathProblemSpec
  promptBlocks: ContentBlock[]
  choices: unknown
  solutionBlocks: ContentBlock[]
}

export class InvalidMathCandidateImportError extends Error {
  constructor() {
    super(
      "The selection must contain unchanged, valid, unimported approved candidates.",
    )
  }
}

// Match MathContent's KaTeX policy when checking persisted presentations.
const unsafeCommand =
  /\\(?:href|url|includegraphics|htmlClass|htmlId|htmlStyle|htmlData|def|gdef|edef|xdef|let|futurelet|newcommand|renewcommand|providecommand|global)(?![a-z])/u
const meaningfulText = /[\p{L}\p{N}\p{S}]/u
// Braille Pattern Blank is a symbol and is not Unicode whitespace or ignorable.
const blankCharacters =
  /[\p{White_Space}\p{Default_Ignorable_Code_Point}\u2800]/gu
const transparentColor = /^(?:transparent|#[\da-f]{3}0|#[\da-f]{6}00)$/u
const hexColor = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/u
// CSS Color 4 named and system colors, including legacy system colors.
// https://www.w3.org/TR/css-color-4/#color-keywords
const cssColorKeywords = new Set(
  `
    aliceblue antiquewhite aqua aquamarine azure beige bisque black
    blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate
    coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod
    darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange
    darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray
    darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey
    dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite
    gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo
    ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue
    lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey
    lightpink lightsalmon lightseagreen lightskyblue lightslategray
    lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon
    mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen
    mediumslateblue mediumspringgreen mediumturquoise mediumvioletred
    midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive
    olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise
    palevioletred papayawhip peachpuff peru pink plum powderblue purple
    rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen
    seashell sienna silver skyblue slateblue slategray slategrey snow springgreen
    steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke
    yellow yellowgreen accentcolor accentcolortext activeborder activecaption
    activetext appworkspace background buttonborder buttonface buttonhighlight
    buttonshadow buttontext canvas canvastext captiontext field fieldtext
    graytext highlight highlighttext inactiveborder inactivecaption
    inactivecaptiontext infobackground infotext linktext mark marktext menu
    menutext scrollbar selecteditem selecteditemtext threeddarkshadow threedface
    threedhighlight threedlightshadow threedshadow visitedtext window windowframe
    windowtext transparent
  `
    .trim()
    .split(/\s+/u),
)

function hasVisibleText(text: string): boolean {
  return meaningfulText.test(text.replace(blankCharacters, ""))
}

function hasVisibleMathGlyph(markup: string): boolean {
  // KaTeX includes the source in MathML annotations, even for spacing-only TeX.
  const html = markup.slice(markup.indexOf("</math>") + "</math>".length)
  const transparentSpans: boolean[] = []

  for (const [token, attributes, glyph] of html.matchAll(
    /<\/span>|<span\b([^<>]*)>|<[^>]*>|([^<]+)/gu,
  )) {
    const parentTransparent = transparentSpans.at(-1) ?? false

    if (token.startsWith("<span")) {
      const style = /\sstyle="([^"]*)"/u.exec(attributes)?.[1] ?? ""
      const color = /(?:^|;)\s*color\s*:\s*([^;]+)/iu
        .exec(style)?.[1]
        .trim()
        .toLowerCase()
      // KaTeX accepts unknown alphabetic colors, which CSS ignores.
      transparentSpans.push(
        color && (hexColor.test(color) || cssColorKeywords.has(color))
          ? transparentColor.test(color)
          : parentTransparent,
      )
    } else if (token === "</span>") {
      transparentSpans.pop()
    } else if (glyph && !parentTransparent && hasVisibleText(glyph)) {
      return true
    }
  }

  return false
}

function hasReviewedContent(blocks: ContentBlock[]): boolean {
  let meaningful = false

  for (const block of blocks) {
    if (block.kind === "text") {
      meaningful ||= hasVisibleText(block.value)

      continue
    }

    const { tex, display } = block

    if (tex.length > 4096 || !tex.trim() || unsafeCommand.test(tex)) {
      return false
    }

    try {
      const markup = katex.renderToString(tex, {
        displayMode: display,
        trust: false,
        throwOnError: true,
        strict: "error",
        maxExpand: 100,
        maxSize: 10,
        output: "htmlAndMathml",
      })
      meaningful ||= hasVisibleMathGlyph(markup)
    } catch {
      return false
    }
  }

  return meaningful
}

const reviewedBlocks = contentBlockSchema
  .array()
  .min(1)
  .refine(hasReviewedContent)

const reviewedChoices = testChoiceSchema
  .extend({ labelBlocks: reviewedBlocks })
  .array()
  .min(2)

function blockText(blocks: ContentBlock[]): string {
  return blocks
    .map((block) => (block.kind === "text" ? block.value : block.tex))
    .join(" ")
    .trim()
}

// Candidate templates display integers, plain fractions/ratios, or TeX fractions.
// Parse just those literals, without evaluating expressions from the presentation.
function displayedAnswer(text: string): MathAnswer {
  const literal = text
    .trim()
    .replace(/^\\frac\{(-?\d+)\}\{(-?\d+)\}$/u, "$1/$2")
  const parts = /^(-?\d+)(?:[/:](-?\d+))?$/u.exec(literal)
  const numerator = Number(parts?.[1])
  const denominator = Number(parts?.[2] ?? 1)

  if (
    !Number.isSafeInteger(numerator) ||
    !Number.isSafeInteger(denominator) ||
    denominator === 0
  ) {
    throw new InvalidMathCandidateImportError()
  }

  return {
    kind: denominator === 1 ? "integer" : "rational",
    numerator,
    denominator,
  }
}

function equivalentAnswer(left: MathAnswer, right: MathAnswer): boolean {
  return (
    BigInt(left.numerator) * BigInt(right.denominator) ===
    BigInt(right.numerator) * BigInt(left.denominator)
  )
}

function candidateQuestion(
  candidate: ApprovedCandidate,
  ordinal: number,
): Question {
  const prompt = reviewedBlocks.safeParse(candidate.promptBlocks)
  const presentation = reviewedChoices.safeParse(candidate.choices)

  if (
    !prompt.success ||
    !presentation.success ||
    !reviewedBlocks.safeParse(candidate.solutionBlocks).success ||
    !verifyMathProblem(candidate.canonicalSpec).valid
  ) {
    throw new InvalidMathCandidateImportError()
  }

  const canonical = candidate.canonicalSpec.choices

  if (canonical && canonical.length !== presentation.data.length) {
    throw new InvalidMathCandidateImportError()
  }

  const choices = presentation.data.map((choice, index) => {
    const answer = displayedAnswer(choice.label)

    if (
      !equivalentAnswer(
        answer,
        displayedAnswer(blockText(choice.labelBlocks)),
      ) ||
      (canonical &&
        (choice.isCorrect !== canonical[index].isCorrect ||
          !equivalentAnswer(answer, canonical[index].answer)))
    ) {
      throw new InvalidMathCandidateImportError()
    }

    return { answer, isCorrect: choice.isCorrect }
  })

  // Older reviewed candidates can predate canonical choice arrays. Verify their
  // actual display values and keys against the deterministic problem as well.
  if (!verifyMathProblem({ ...candidate.canonicalSpec, choices }).valid) {
    throw new InvalidMathCandidateImportError()
  }

  return {
    questionKey: `q${ordinal}`,
    prompt: blockText(prompt.data),
    promptBlocks: prompt.data,
    choices: presentation.data,
    type: "single_choice",
    points: 1,
  }
}

export function importApprovedMathCandidates(
  pool: pg.Pool,
  input: MathImportInput,
) {
  return withTransaction(pool, async (tx) => {
    // Lock overlapping selections in the same order, then restore the admin's
    // chosen order when building the draft. Concurrent imports recheck eligibility.
    const { rows } = await tx.query<ApprovedCandidate>(
      `SELECT id, canonical_spec AS "canonicalSpec", prompt_blocks AS "promptBlocks",
              choices, solution_blocks AS "solutionBlocks"
         FROM ai_generation_candidate c
        WHERE id=ANY($1::uuid[]) AND status='approved' AND test_version_id IS NULL
          AND validator_reports #> '{validation,valid}' = 'true'::jsonb
          AND content_hash = math_candidate_content_hash(canonical_spec)
          AND approved_content_hash = math_candidate_review_hash(c)
        ORDER BY id FOR UPDATE`,
      [input.candidateIds],
    )

    if (!rows.length || rows.length !== input.candidateIds.length) {
      throw new InvalidMathCandidateImportError()
    }

    const byId = new Map(rows.map((row) => [row.id, row]))
    const questions = input.candidateIds.map((id, index) => {
      const candidate = byId.get(id.toLowerCase())

      if (!candidate) {
        throw new InvalidMathCandidateImportError()
      }

      return candidateQuestion(candidate, index + 1)
    })
    const doc = testDocumentSchema.safeParse({
      ...input,
      sections: [
        {
          title: input.title,
          type: "math",
          durationSeconds: input.durationSeconds,
          navigation: "free",
          allowAnswerChange: true,
          playback: null,
          instructions: [],
          groups: [{ questions }],
        },
      ],
    })

    if (!doc.success) {
      throw new InvalidMathCandidateImportError()
    }

    const result = await insertTestDocument(tx, doc.data)
    await tx.query(
      `INSERT INTO question_math (question_id, source_candidate_id, canonical_spec, answer_spec,
                                   solution_blocks, after_test_solution_hash, verification_version, content_hash)
       SELECT q.id, c.id, c.canonical_spec, c.canonical_spec->'answer', c.solution_blocks,
              CASE WHEN r.parameters #>> '{curriculumBrief,solutionPolicy}' = 'after_test'
                   THEN math_question_solution_hash(q, c.solution_blocks) END, 'v1', c.content_hash
         FROM unnest($2::uuid[]) WITH ORDINALITY AS selected(id, ordinal)
         JOIN ai_generation_candidate c ON c.id=selected.id
         JOIN ai_generation_request r ON r.id=c.request_id
         JOIN question q ON q.ordinal=selected.ordinal AND q.test_version_id=$1`,
      [result.versionId, input.candidateIds],
    )
    await tx.query(
      `UPDATE ai_generation_candidate SET test_version_id=$1, updated_at=now() WHERE id=ANY($2::uuid[])`,
      [result.versionId, input.candidateIds],
    )
    await tx.query(
      `INSERT INTO admin_audit_log (admin_subject,action,resource_type,resource_id,metadata)
       VALUES ($1,'math_candidates_imported','test_version',$2,$3::jsonb)`,
      [
        input.adminSubject,
        result.versionId,
        JSON.stringify({ candidateIds: input.candidateIds }),
      ],
    )

    return result
  })
}

interface ExportRow {
  s_ordinal: number
  s_title: string
  s_type: string
  s_duration: number
  s_navigation: string
  s_allow_change: boolean
  s_max_plays: number | null
  s_allow_pause: boolean | null
  s_allow_seek: boolean | null
  g_ordinal: number
  st_type: string | null
  st_title: string | null
  st_body: string | null
  st_filename: string | null
  st_image_svg: string | null
  st_max_plays: number | null
  st_allow_pause: boolean | null
  st_allow_seek: boolean | null
  q_ordinal: number
  q_key: string
  q_prompt_blocks: ContentBlock[] | null
  q_prompt: string
  q_type: string
  q_points: number
  c_ordinal: number
  c_label_blocks: ContentBlock[] | null
  c_label: string
  c_correct: boolean
  c_image_svg: string | null
}

// Both booleans are checked together so TypeScript narrows them together:
// the DB's "all or nothing" constraint on the three playback columns means
// they are either both non-null or both null, but that constraint is not
// visible to the type checker from two independently-typed row fields.
function toPlayback(
  maxPlays: number | null,
  allowPause: boolean | null,
  allowSeek: boolean | null,
): Playback {
  if (allowPause === null || allowSeek === null) {
    return null
  }

  return { maxPlays, allowPause, allowSeek }
}

function toStimulus(row: ExportRow): Group["stimulus"] {
  if (!row.st_type) {
    return undefined
  }

  return {
    type: row.st_type as Stimulus["type"],
    ...(row.st_title ? { title: row.st_title } : {}),
    ...(row.st_body ? { bodyText: row.st_body } : {}),
    ...(row.st_filename ? { mediaFilename: row.st_filename } : {}),
    ...(row.st_image_svg ? { imageSvg: row.st_image_svg } : {}),
    ...(row.st_max_plays !== null ? { maxPlays: row.st_max_plays } : {}),
    ...(row.st_allow_pause !== null ? { allowPause: row.st_allow_pause } : {}),
    ...(row.st_allow_seek !== null ? { allowSeek: row.st_allow_seek } : {}),
  }
}

function toSection(
  row: ExportRow,
  instructions: string[],
): Omit<Section, "groups"> {
  return {
    title: row.s_title,
    type: row.s_type as Section["type"],
    durationSeconds: row.s_duration,
    navigation: row.s_navigation as Section["navigation"],
    allowAnswerChange: row.s_allow_change,
    playback: toPlayback(row.s_max_plays, row.s_allow_pause, row.s_allow_seek),
    instructions,
  }
}

function toQuestion(row: ExportRow, tags: string[]): Question {
  return {
    questionKey: row.q_key,
    prompt: row.q_prompt,
    ...(row.q_prompt_blocks ? { promptBlocks: row.q_prompt_blocks } : {}),
    type: row.q_type as Question["type"],
    points: row.q_points,
    ...(tags.length ? { tags } : {}),
    choices: [],
  }
}

/** The inverse of importTestDocument. Round-trip equality is a tested contract. */
export async function exportTestDocument(
  pool: pg.Pool,
  versionId: string,
): Promise<TestDocument> {
  const head = await pool.query<{
    title: string
    slug: string
    level: string | null
    duration_seconds: number
  }>(
    `SELECT tv.title, t.slug, tv.level, tv.duration_seconds
       FROM test_version tv JOIN test t ON t.id = tv.test_id
      WHERE tv.id = $1`,
    [versionId],
  )

  if (head.rows.length === 0) {
    throw new Error(`test_version ${versionId} not found`)
  }

  const { rows } = await pool.query<ExportRow>(
    `SELECT ts.ordinal s_ordinal, ts.title s_title, ts.type::text s_type,
            ts.duration_seconds s_duration, ts.navigation::text s_navigation,
            ts.allow_answer_change s_allow_change,
            ts.default_max_plays s_max_plays, ts.default_allow_pause s_allow_pause,
            ts.default_allow_seek s_allow_seek,
            g.ordinal g_ordinal,
            st.type::text st_type, st.title st_title, st.body_text st_body,
            ma.filename st_filename, st.image_svg st_image_svg, st.max_plays st_max_plays,
            st.allow_pause st_allow_pause, st.allow_seek st_allow_seek,
            q.ordinal q_ordinal, q.question_key q_key, q.prompt q_prompt, q.prompt_blocks q_prompt_blocks,
            q.type::text q_type, q.points q_points,
            c.ordinal c_ordinal, c.label c_label, c.label_blocks c_label_blocks, c.is_correct c_correct,
            c.image_svg c_image_svg
       FROM test_section ts
       JOIN question_group g ON g.test_section_id = ts.id
       JOIN question q       ON q.question_group_id = g.id
       JOIN choice c         ON c.question_id = q.id
  LEFT JOIN stimulus st      ON st.id = g.stimulus_id
  LEFT JOIN media_asset ma   ON ma.id = st.media_asset_id
      WHERE ts.test_version_id = $1
      ORDER BY ts.ordinal, g.ordinal, q.ordinal, c.ordinal`,
    [versionId],
  )

  const instructions = await pool.query<{ s_ordinal: number; text: string }>(
    `SELECT ts.ordinal s_ordinal, si.text
       FROM section_instruction si JOIN test_section ts ON ts.id = si.test_section_id
      WHERE ts.test_version_id = $1 ORDER BY ts.ordinal, si.ordinal`,
    [versionId],
  )

  const tags = await pool.query<{ q_key: string; tag: string }>(
    `SELECT q.question_key q_key, qt.tag
       FROM question_tag qt JOIN question q ON q.id = qt.question_id
      WHERE q.test_version_id = $1 ORDER BY q.ordinal, qt.ordinal`,
    [versionId],
  )

  const sections: Section[] = []

  for (const r of rows) {
    // Explicit `| undefined` because indexing an array is not narrowed by
    // TypeScript from the element type alone (this project does not enable
    // noUncheckedIndexedAccess) — sections/groups are filled in as their
    // rows are encountered, so an out-of-range read is real, not a type
    // artifact.
    let section = sections[r.s_ordinal - 1] as Section | undefined

    if (!section) {
      const sectionInstructions = instructions.rows
        .filter((i) => i.s_ordinal === r.s_ordinal)
        .map((i) => i.text)

      section = {
        ...toSection(r, sectionInstructions),
        groups: [],
      }
      sections[r.s_ordinal - 1] = section
    }

    let group = section.groups[r.g_ordinal - 1] as Group | undefined

    if (!group) {
      const stimulus = toStimulus(r)

      group = {
        ...(stimulus ? { stimulus } : {}),
        questions: [],
      }
      section.groups[r.g_ordinal - 1] = group
    }

    let question = group.questions.find((q) => q.questionKey === r.q_key)

    if (!question) {
      const qTags = tags.rows
        .filter((t) => t.q_key === r.q_key)
        .map((t) => t.tag)

      question = toQuestion(r, qTags)
      group.questions.push(question)
    }

    question.choices.push({
      label: r.c_label,
      ...(r.c_label_blocks ? { labelBlocks: r.c_label_blocks } : {}),
      isCorrect: r.c_correct,
      ...(r.c_image_svg ? { imageSvg: r.c_image_svg } : {}),
    })
  }

  return {
    title: head.rows[0].title,
    slug: head.rows[0].slug,
    ...(head.rows[0].level
      ? { level: head.rows[0].level as TestDocument["level"] }
      : {}),
    durationSeconds: head.rows[0].duration_seconds,
    sections,
  }
}
