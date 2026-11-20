/* eslint-disable camelcase, typescript/no-unsafe-call, typescript/no-unsafe-member-access */
exports.shorthands = undefined

exports.up = (pgm) => {
  pgm.sql(`
ALTER TABLE question_math ADD COLUMN show_solution_after_test boolean NOT NULL DEFAULT false;
-- ALTER takes an exclusive table lock for the transaction. Backfill frozen
-- questions only when the approved import and its worked solution still match.
ALTER TABLE question_math DISABLE TRIGGER question_math_immutable;
UPDATE question_math qm SET show_solution_after_test = true
  FROM ai_generation_candidate c JOIN ai_generation_request r ON r.id = c.request_id,
       question q
 WHERE qm.source_candidate_id = c.id AND qm.question_id = q.id
   AND q.test_version_id = c.test_version_id AND c.status = 'approved'
   AND c.validator_reports #> '{validation,valid}' = 'true'::jsonb
   AND c.content_hash = math_candidate_content_hash(c.canonical_spec)
   AND c.approved_content_hash = math_candidate_review_hash(c)
   AND qm.content_hash = c.content_hash AND qm.answer_spec = c.canonical_spec->'answer'
   AND qm.solution_blocks = c.solution_blocks AND qm.canonical_spec = c.canonical_spec
   AND r.parameters #>> '{curriculumBrief,solutionPolicy}' = 'after_test';
ALTER TABLE question_math ENABLE TRIGGER question_math_immutable;
  `)
}

exports.down = (pgm) => {
  pgm.sql("ALTER TABLE question_math DROP COLUMN show_solution_after_test")
}
