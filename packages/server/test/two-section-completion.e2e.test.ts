import { testDocumentSchema, type TestDocument } from "@pp/common"
import { randomUUID } from "node:crypto"
import request from "supertest"
import type { App } from "supertest/types.js"
import { describe, expect, it } from "vitest"
import { createTestApp } from "./helpers/app.js"

const NOW = new Date("2026-08-28T09:00:00.000Z")

function completionJourneyDoc(slug: string): TestDocument {
  return testDocumentSchema.parse({
    title: "Two-section completion journey",
    slug,
    level: "primary-step-1",
    durationSeconds: 3000,
    sections: [
      {
        title: "Listening — Part 1",
        type: "listening",
        durationSeconds: 1500,
        navigation: "forward_only",
        allowAnswerChange: false,
        playback: null,
        instructions: ["Listen carefully."],
        groups: [
          {
            questions: [
              {
                questionKey: "listening-1",
                prompt: "What did the child hear?",
                type: "single_choice",
                points: 1,
                choices: [
                  { label: "A bell", isCorrect: true },
                  { label: "A whistle", isCorrect: false },
                ],
              },
            ],
          },
        ],
      },
      {
        title: "Reading",
        type: "reading",
        durationSeconds: 1500,
        navigation: "free",
        allowAnswerChange: true,
        playback: null,
        instructions: ["Read the passage."],
        groups: [
          {
            questions: [
              {
                questionKey: "reading-1",
                prompt: "Where did the class go?",
                type: "single_choice",
                points: 1,
                choices: [
                  { label: "The library", isCorrect: true },
                  { label: "The station", isCorrect: false },
                ],
              },
            ],
          },
        ],
      },
    ],
  })
}

interface JourneySection {
  id: string
  type: "listening" | "reading"
  status: "pending" | "open" | "closed"
  groups: Array<{
    questions: Array<{
      id: string
      choices: Array<{ id: string; label: string }>
    }>
  }>
}

interface JourneyEnvelope {
  attemptNumber: number
  sections: JourneySection[]
}

function sectionOf(
  envelope: JourneyEnvelope,
  type: JourneySection["type"],
): JourneySection {
  const section = envelope.sections.find((candidate) => candidate.type === type)

  if (!section) {
    throw new Error(`journey envelope has no ${type} section`)
  }

  return section
}

function onlyQuestion(section: JourneySection) {
  const question = section.groups
    .flatMap((group) => group.questions)
    .find((_candidate, index) => index === 0)

  if (!question) {
    throw new Error(`journey section ${section.id} has no question`)
  }

  return question
}

function choiceId(question: ReturnType<typeof onlyQuestion>, label: string) {
  const choice = question.choices.find((candidate) => candidate.label === label)

  if (!choice) {
    throw new Error(`journey question has no choice ${label}`)
  }

  return choice.id
}

describe("two-section completion journey", () => {
  it("walks Listening → finish → Reading → hand in → a non-zero result", async () => {
    const app = await createTestApp({ now: NOW })

    try {
      const http = app.http.getHttpServer() as App
      const slug = `completion-journey-${randomUUID()}`
      const adminToken = await app.mint({
        sub: `completion-admin-${randomUUID()}`,
        email: "completion-admin@example.test",
        isAdmin: true,
      })
      const imported = await request(http)
        .post("/api/admin/tests/import")
        .set("Authorization", `Bearer ${adminToken}`)
        .send(completionJourneyDoc(slug))
        .expect(201)
      const { testId } = imported.body as { testId: string }

      await request(http)
        .post(`/api/admin/tests/${testId}/publish`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200)

      const studentToken = await app.mint({
        sub: `completion-student-${randomUUID()}`,
        email: "tom@example.com",
      })
      await request(http)
        .post("/api/session")
        .set("Authorization", `Bearer ${studentToken}`)
        .expect(201)

      const started = await request(http)
        .post("/api/attempts")
        .set("Authorization", `Bearer ${studentToken}`)
        .send({ slug })
        .expect(201)
      const { id: attemptId } = started.body as { id: string }
      const initial = await request(http)
        .get(`/api/attempts/${attemptId}`)
        .set("Authorization", `Bearer ${studentToken}`)
        .expect(200)
      const initialEnvelope = initial.body as JourneyEnvelope
      const listening = sectionOf(initialEnvelope, "listening")
      const reading = sectionOf(initialEnvelope, "reading")
      const listeningQuestion = onlyQuestion(listening)
      const readingQuestion = onlyQuestion(reading)

      expect(initialEnvelope.attemptNumber).toBe(1)

      await request(http)
        .post(`/api/attempts/${attemptId}/sections/${listening.id}/enter`)
        .set("Authorization", `Bearer ${studentToken}`)
        .expect(200)

      const finishedListening = await request(http)
        .post(`/api/attempts/${attemptId}/sections/${listening.id}/finish`)
        .set("Authorization", `Bearer ${studentToken}`)
        .send({
          clientInstanceId: "journey-ipad",
          responses: [
            {
              questionId: listeningQuestion.id,
              seq: 1,
              selectedChoiceIds: [choiceId(listeningQuestion, "A bell")],
              answeredAt: NOW.toISOString(),
            },
          ],
        })
        .expect(200)

      expect(finishedListening.body).toMatchObject({
        sectionId: listening.id,
        status: "finished",
        nextSectionId: reading.id,
        finalFlush: [{ questionId: listeningQuestion.id, status: "applied" }],
      })

      await request(http)
        .post(`/api/attempts/${attemptId}/sections/${reading.id}/enter`)
        .set("Authorization", `Bearer ${studentToken}`)
        .expect(200)

      const submitted = await request(http)
        .post(`/api/attempts/${attemptId}/submit`)
        .set("Authorization", `Bearer ${studentToken}`)
        .send({
          clientInstanceId: "journey-ipad",
          responses: [
            {
              questionId: readingQuestion.id,
              seq: 2,
              selectedChoiceIds: [choiceId(readingQuestion, "The library")],
              answeredAt: NOW.toISOString(),
            },
          ],
        })
        .expect(201)

      expect(submitted.body).toMatchObject({
        status: "submitted",
        finalFlush: [{ questionId: readingQuestion.id, status: "applied" }],
      })

      const result = await request(http)
        .get(`/api/attempts/${attemptId}/result`)
        .set("Authorization", `Bearer ${studentToken}`)
        .expect(200)

      expect(result.body).toMatchObject({
        attemptId,
        status: "submitted",
        score: {
          pointsEarned: 2,
          pointsPossible: 2,
          answered: 2,
          correct: 2,
        },
      })
      expect(
        (result.body as { score: { pointsEarned: number } }).score.pointsEarned,
      ).toBeGreaterThan(0)
    } finally {
      await app.close()
    }
  }, 120_000)
})
