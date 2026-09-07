import type { PgQueryable } from "@liam-public/node-postgres"

export interface QuestionSectionInfo {
  sectionId: string
  allowAnswerChange: boolean
  navigation: "free" | "forward_only"
}

export async function loadQuestionSectionInfo(
  db: PgQueryable,
  input: { testVersionId: string; questionIds: string[] },
): Promise<Map<string, QuestionSectionInfo>> {
  if (input.questionIds.length === 0) {
    return new Map()
  }

  const { rows } = await db.query<{
    question_id: string
    section_id: string
    allow_answer_change: boolean
    navigation: "free" | "forward_only"
  }>(
    `SELECT question.id AS question_id,
            test_section.id AS section_id,
            test_section.allow_answer_change,
            test_section.navigation::text AS navigation
       FROM question
       JOIN question_group
         ON question_group.id = question.question_group_id
        AND question_group.test_version_id = question.test_version_id
       JOIN test_section
         ON test_section.id = question_group.test_section_id
        AND test_section.test_version_id = question.test_version_id
      WHERE question.test_version_id = $1
        AND question.id = ANY($2::uuid[])`,
    [input.testVersionId, input.questionIds],
  )

  return new Map(
    rows.map((row) => [
      row.question_id,
      {
        sectionId: row.section_id,
        allowAnswerChange: row.allow_answer_change,
        navigation: row.navigation,
      },
    ]),
  )
}
