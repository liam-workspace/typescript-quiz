import type { PgPool } from "@liam-workspace/node-postgres"
import { randomUUID } from "node:crypto"
import request from "supertest"
import type { App } from "supertest/types.js"
import type { TestApp } from "./app.js"

export interface WriteFixture {
  attemptId: string
  versionId: string
  sectionId: string
  appliedQuestionId: string
  staleQuestionId: string
  choiceIds: [string, string, string, string]
  otherSection?: {
    sectionId: string
    questionId: string
    choiceIds: [string, string]
  }
}

export interface SeedWriteFixtureOptions {
  navigation?: "free" | "forward_only"
  allowAnswerChange?: boolean
  sectionType?: "listening" | "reading"
  includeOtherSection?: boolean
}

export async function provisionStudent(
  app: TestApp,
  subjectClaim: string,
): Promise<{ studentId: string; token: string }> {
  const token = await app.mint({
    sub: subjectClaim,
    email: "response-write@example.com",
  })

  const session = await request(app.http.getHttpServer() as App)
    .post("/api/session")
    .set("Authorization", `Bearer ${token}`)
    .expect(201)

  return {
    studentId: (session.body as { id: string }).id,
    token,
  }
}

export async function seedWriteFixture(
  pool: PgPool,
  studentId: string,
  options: SeedWriteFixtureOptions = {},
): Promise<WriteFixture> {
  const testId = randomUUID()
  const versionId = randomUUID()
  const sectionId = randomUUID()
  const groupId = randomUUID()
  const appliedQuestionId = randomUUID()
  const staleQuestionId = randomUUID()
  const choiceIds: WriteFixture["choiceIds"] = [
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
  ]
  const attemptId = randomUUID()

  await pool.query(`INSERT INTO test (id, slug) VALUES ($1, $2)`, [
    testId,
    `response-write-${testId}`,
  ])
  await pool.query(
    `INSERT INTO test_version
       (id, test_id, version, title, duration_seconds)
     VALUES ($1, $2, 1, 'Response write test', 3000)`,
    [versionId, testId],
  )
  await pool.query(
    `INSERT INTO test_section
       (id, test_version_id, ordinal, title, type, duration_seconds,
        navigation, allow_answer_change)
     VALUES ($1, $2, 1, 'Section', $3, 1500, $4, $5)`,
    [
      sectionId,
      versionId,
      options.sectionType ?? "reading",
      options.navigation ?? "free",
      options.allowAnswerChange ?? true,
    ],
  )
  await pool.query(
    `INSERT INTO question_group
       (id, test_version_id, test_section_id, ordinal)
     VALUES ($1, $2, $3, 1)`,
    [groupId, versionId, sectionId],
  )
  await pool.query(
    `INSERT INTO question
       (id, test_version_id, question_group_id, question_key, ordinal,
        prompt, type, points)
     VALUES ($1, $3, $4, 'applied', 1, 'Applied?', 'single_choice', 1),
            ($2, $3, $4, 'stale', 2, 'Stale?', 'single_choice', 1)`,
    [appliedQuestionId, staleQuestionId, versionId, groupId],
  )
  await pool.query(
    `INSERT INTO choice (id, question_id, ordinal, label, is_correct)
     VALUES ($1, $5, 1, 'A', true),
            ($2, $5, 2, 'B', false),
            ($3, $6, 1, 'C', true),
            ($4, $6, 2, 'D', false)`,
    [...choiceIds, appliedQuestionId, staleQuestionId],
  )

  let otherSection: WriteFixture["otherSection"] = undefined

  if (options.includeOtherSection) {
    const otherSectionId = randomUUID()
    const otherGroupId = randomUUID()
    const otherQuestionId = randomUUID()
    const otherChoiceIds: [string, string] = [randomUUID(), randomUUID()]
    const otherSectionType =
      (options.sectionType ?? "reading") === "reading" ? "listening" : "reading"

    await pool.query(
      `INSERT INTO test_section
         (id, test_version_id, ordinal, title, type, duration_seconds,
          navigation, allow_answer_change)
       VALUES ($1, $2, 2, 'Other section', $3, 1500, 'free', true)`,
      [otherSectionId, versionId, otherSectionType],
    )
    await pool.query(
      `INSERT INTO question_group
         (id, test_version_id, test_section_id, ordinal)
       VALUES ($1, $2, $3, 1)`,
      [otherGroupId, versionId, otherSectionId],
    )
    await pool.query(
      `INSERT INTO question
         (id, test_version_id, question_group_id, question_key, ordinal,
          prompt, type, points)
       VALUES ($1, $2, $3, 'other', 3, 'Other?', 'single_choice', 1)`,
      [otherQuestionId, versionId, otherGroupId],
    )
    await pool.query(
      `INSERT INTO choice (id, question_id, ordinal, label, is_correct)
       VALUES ($1, $3, 1, 'E', true), ($2, $3, 2, 'F', false)`,
      [...otherChoiceIds, otherQuestionId],
    )

    otherSection = {
      sectionId: otherSectionId,
      questionId: otherQuestionId,
      choiceIds: otherChoiceIds,
    }
  }

  await pool.query(
    `INSERT INTO attempt (id, student_id, test_version_id, status)
     VALUES ($1, $2, $3, 'in_progress')`,
    [attemptId, studentId, versionId],
  )

  return {
    attemptId,
    versionId,
    sectionId,
    appliedQuestionId,
    staleQuestionId,
    choiceIds,
    otherSection,
  }
}
