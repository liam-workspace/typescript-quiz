import { z } from "zod"

// Both a choice and a stimulus can carry inline <svg> markup rather than a
// filename (migrations 1005/1006) -- the source pictograms use
// `stroke="currentColor"`, which only resolves rendered straight into the
// DOM, and the runner does that with dangerouslySetInnerHTML.
//
// That makes THIS the one XSS-relevant boundary in the import pipeline, and
// it is checked with an ALLOWLIST, not a denylist: enumerating the small,
// deliberately inert vocabulary a decorative line-art icon actually needs
// (a handful of shape tags, a handful of geometry/style attributes) and
// rejecting anything outside it fails CLOSED on whatever was not
// anticipated -- <script>, <foreignObject>, <use>/<image> with a hostile
// href, any `on*` handler under any spelling or quoting. A denylist
// (reject known-bad substrings) fails OPEN the same way and was the
// earlier draft here; it is bypassable by construction, an allowlist is
// not.
const SVG_ALLOWED_TAGS = new Set([
  "svg",
  "g",
  "path",
  "circle",
  "ellipse",
  "rect",
  "line",
  "polyline",
  "polygon",
  "text",
])

const SVG_ALLOWED_ATTRS = new Set([
  "viewbox",
  "xmlns",
  "role",
  "aria-hidden",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "d",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "points",
  "transform",
  "width",
  "height",
  "font-size",
  "text-anchor",
])

const SVG_TAG_PATTERN = /<\/?([a-zA-Z][\w-]*)/gu
// Double-quoted, single-quoted AND unquoted values -- an allowlist that
// only recognised one quoting style would silently skip (not reject) an
// attribute written another way, which defeats the point of an allowlist.
const SVG_ATTR_PATTERN =
  /([a-zA-Z_:][-\w:.]*)\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+)/gu

function isSafeInlineSvg(svg: string): boolean {
  if (/<!|<\?/u.test(svg)) {
    return false
  }

  for (const match of svg.matchAll(SVG_TAG_PATTERN)) {
    if (!SVG_ALLOWED_TAGS.has(match[1].toLowerCase())) {
      return false
    }
  }

  for (const match of svg.matchAll(SVG_ATTR_PATTERN)) {
    if (!SVG_ALLOWED_ATTRS.has(match[1].toLowerCase())) {
      return false
    }
  }

  return true
}

const svgImageSchema = z
  .string()
  .min(1)
  .max(20_000)
  .regex(/^\s*<svg[\s>]/iu, "must be an <svg> element")
  .refine(
    isSafeInlineSvg,
    "contains a tag or attribute outside the safe SVG allowlist",
  )

const playbackSchema = z
  .object({
    maxPlays: z.number().int().positive().nullable(),
    allowPause: z.boolean(),
    allowSeek: z.boolean(),
  })
  .nullable()

const choiceSchema = z.object({
  label: z.string().min(1),
  isCorrect: z.boolean(),
  // Inline <svg> for a picture choice (TOEFL Primary's listen_pick_picture)
  // -- see migration 1005 and svgImageSchema above.
  imageSvg: svgImageSchema.optional(),
})

const questionSchema = z
  .object({
    questionKey: z.string().min(1),
    prompt: z.string().min(1),
    type: z.enum(["single_choice", "multi_choice"]),
    points: z.number().int().positive(),
    tags: z.array(z.string().min(1)).optional(),
    choices: z
      .array(choiceSchema)
      .min(2, "a question needs at least 2 choices"),
  })
  .superRefine((q, ctx) => {
    const correct = q.choices.filter((c) => c.isCorrect).length

    if (q.type === "single_choice" && correct !== 1) {
      ctx.addIssue({
        code: "custom",
        message: `a single_choice question needs exactly one correct choice, found ${correct}`,
      })
    }

    if (q.type === "multi_choice" && correct < 1) {
      ctx.addIssue({
        code: "custom",
        message: "a multi_choice question needs a correct choice",
      })
    }
  })

// `.min(1)` on the three text fields, and no `.nullable()` on maxPlays, both
// keep ONE spelling of "absent". Export omits an empty column rather than
// emitting "", and omits an inherited cap rather than emitting null, so
// accepting either on import would make the round trip lossy. Note maxPlays
// here means "inherit the section default when absent" -- a different meaning
// from playbackSchema.maxPlays above, where null means "unlimited".
const stimulusSchema = z.object({
  type: z.enum(["audio", "passage", "image", "mixed"]),
  title: z.string().min(1).optional(),
  bodyText: z.string().min(1).optional(),
  mediaFilename: z.string().min(1).optional(),
  // An `image` stimulus's alternative to mediaFilename -- inline <svg>,
  // for the same reason as choiceSchema.imageSvg (TOEFL Primary's
  // read_word_picture: a pictogram above the question, text choices below,
  // the mirror image of listen_pick_picture). See migration 1006.
  imageSvg: svgImageSchema.optional(),
  maxPlays: z.number().int().positive().optional(),
  allowPause: z.boolean().optional(),
  allowSeek: z.boolean().optional(),
})

const groupSchema = z.object({
  stimulus: stimulusSchema.optional(),
  questions: z.array(questionSchema).min(1),
})

const sectionSchema = z
  .object({
    title: z.string().min(1),
    type: z.enum(["listening", "reading", "vocabulary", "grammar"]),
    durationSeconds: z.number().int().positive(),
    navigation: z.enum(["free", "forward_only"]),
    allowAnswerChange: z.boolean(),
    playback: playbackSchema,
    instructions: z.array(z.string().min(1)).default([]),
    groups: z.array(groupSchema).min(1),
  })
  .superRefine((s, ctx) => {
    // A stimulus override may TIGHTEN the section default, never loosen it.
    for (const g of s.groups) {
      const st = g.stimulus

      if (!st || !s.playback) {
        continue
      }

      if (
        st.maxPlays !== undefined &&
        s.playback.maxPlays !== null &&
        st.maxPlays > s.playback.maxPlays
      ) {
        ctx.addIssue({
          code: "custom",
          message: `a stimulus may only tighten the section cap (${st.maxPlays} > ${s.playback.maxPlays})`,
        })
      }

      if (st.allowPause === true && !s.playback.allowPause) {
        ctx.addIssue({
          code: "custom",
          message: "a stimulus may only tighten allowPause",
        })
      }

      if (st.allowSeek === true && !s.playback.allowSeek) {
        ctx.addIssue({
          code: "custom",
          message: "a stimulus may only tighten allowSeek",
        })
      }
    }
  })

export const testDocumentSchema = z
  .object({
    title: z.string().min(1),
    slug: z.string().min(1),
    level: z.enum(["primary-step-1", "primary-step-2"]).optional(),
    durationSeconds: z.number().int().positive(),
    sections: z.array(sectionSchema).min(1),
  })
  .superRefine((doc, ctx) => {
    const total = doc.sections.reduce((n, s) => n + s.durationSeconds, 0)

    if (total !== doc.durationSeconds) {
      ctx.addIssue({
        code: "custom",
        message: `sections total ${total}s but the test declares ${doc.durationSeconds}s`,
      })
    }
  })

export type TestDocument = z.infer<typeof testDocumentSchema>
