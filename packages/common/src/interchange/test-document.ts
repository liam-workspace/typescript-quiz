import { z } from "zod"

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

const stimulusSchema = z.object({
  type: z.enum(["audio", "passage", "image", "mixed"]),
  title: z.string().optional(),
  bodyText: z.string().optional(),
  mediaFilename: z.string().optional(),
  maxPlays: z.number().int().positive().nullable().optional(),
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
        st.maxPlays !== null &&
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
