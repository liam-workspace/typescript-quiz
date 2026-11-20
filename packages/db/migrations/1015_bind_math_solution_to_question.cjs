/* eslint-disable camelcase, typescript/no-unsafe-call, typescript/no-unsafe-member-access */
exports.shorthands = undefined

exports.up = (pgm) => {
  pgm.sql(`
-- Previously migrated rows can carry a flag inferred from mutable request
-- history. Only a new approved import can record the permitted content.
ALTER TABLE question_math DROP COLUMN show_solution_after_test,
                          ADD COLUMN after_test_solution_hash bytea;

CREATE FUNCTION math_question_solution_hash(q question, solution jsonb) RETURNS bytea
LANGUAGE sql STABLE STRICT PARALLEL SAFE AS $$
    SELECT sha256(convert_to(jsonb_build_array(q.prompt, q.prompt_blocks, q.type,
               (SELECT jsonb_agg(jsonb_build_array(c.label, c.label_blocks, c.image_svg, c.is_correct)
                                 ORDER BY c.ordinal) FROM choice c WHERE c.question_id = q.id),
               solution)::text, 'UTF8'));
$$;
  `)
}

exports.down = (pgm) => {
  pgm.sql(`
DROP FUNCTION math_question_solution_hash(question, jsonb);
ALTER TABLE question_math DROP COLUMN after_test_solution_hash,
                          ADD COLUMN show_solution_after_test boolean NOT NULL DEFAULT false;
  `)
}
