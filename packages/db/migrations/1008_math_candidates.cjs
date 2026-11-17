/* eslint-disable camelcase, typescript/no-unsafe-call, typescript/no-unsafe-member-access */
exports.shorthands = undefined

exports.up = (pgm) => {
  pgm.sql(`
ALTER TYPE section_type ADD VALUE IF NOT EXISTS 'math';
ALTER TABLE question ADD COLUMN prompt_blocks jsonb;
ALTER TABLE choice ADD COLUMN label_blocks jsonb;
-- Published content is immutable: leave its blocks null and retain legacy text.
UPDATE question q
   SET prompt_blocks = jsonb_build_array(jsonb_build_object('kind', 'text', 'value', q.prompt))
  FROM test_version tv
 WHERE tv.id = q.test_version_id AND tv.published_at IS NULL;
UPDATE choice c
   SET label_blocks = jsonb_build_array(jsonb_build_object('kind', 'text', 'value', c.label))
  FROM question q JOIN test_version tv ON tv.id = q.test_version_id
 WHERE q.id = c.question_id AND tv.published_at IS NULL;
-- Math generation workflow records are mutable and never student-visible.
CREATE TABLE math_problem_template (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    version text NOT NULL,
    family text NOT NULL,
    parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (name, version)
);

CREATE TABLE ai_generation_request (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id uuid REFERENCES math_problem_template (id) ON DELETE RESTRICT,
    parameters jsonb NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    prompt_template_version text NOT NULL,
    seed text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_generation_candidate (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id uuid NOT NULL REFERENCES ai_generation_request (id) ON DELETE RESTRICT,
    canonical_spec jsonb NOT NULL,
    content_hash text NOT NULL UNIQUE CHECK (length(btrim(content_hash)) > 0),
    raw_response jsonb,
    validator_reports jsonb,
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_review', 'approved', 'rejected', 'regeneration_requested')),
    reviewer_subject text,
    reviewed_at timestamptz,
    test_version_id uuid REFERENCES test_version (id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION enforce_math_candidate_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'draft' THEN
            RAISE EXCEPTION 'invalid candidate status transition to %', NEW.status USING ERRCODE = 'check_violation';
        END IF;
    ELSIF NEW.status <> OLD.status AND NOT (
        (OLD.status = 'draft' AND NEW.status IN ('in_review', 'rejected')) OR
        (OLD.status = 'in_review' AND NEW.status IN ('approved', 'rejected', 'regeneration_requested')) OR
        (OLD.status = 'regeneration_requested' AND NEW.status = 'draft')
    ) THEN
        RAISE EXCEPTION 'invalid candidate status transition from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER ai_generation_candidate_transition
    BEFORE INSERT OR UPDATE OF status ON ai_generation_candidate
    FOR EACH ROW EXECUTE FUNCTION enforce_math_candidate_transition();

CREATE TABLE question_math (
    question_id uuid PRIMARY KEY REFERENCES question (id) ON DELETE CASCADE,
    source_candidate_id uuid REFERENCES ai_generation_candidate (id) ON DELETE RESTRICT,
    canonical_spec jsonb NOT NULL,
    answer_spec jsonb NOT NULL,
    solution_blocks jsonb NOT NULL,
    verification_version text NOT NULL,
    content_hash text NOT NULL
);

-- Check both parents on UPDATE to prevent moving metadata into or out of a
-- published version by changing question_id.
CREATE FUNCTION reject_published_math_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM question q JOIN test_version tv ON tv.id = q.test_version_id
        WHERE tv.published_at IS NOT NULL AND
          (q.id = CASE WHEN TG_OP <> 'INSERT' THEN OLD.question_id END OR
           q.id = CASE WHEN TG_OP <> 'DELETE' THEN NEW.question_id END)
    ) THEN
        RAISE EXCEPTION 'math content belongs to a published version and is immutable (% on %)', TG_OP, TG_TABLE_NAME
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER question_math_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON question_math
    FOR EACH ROW EXECUTE FUNCTION reject_published_math_change();

  `)
}

exports.down = (pgm) => {
  pgm.sql(`
DROP TABLE question_math;
DROP FUNCTION reject_published_math_change();
DROP TABLE ai_generation_candidate;
DROP FUNCTION enforce_math_candidate_transition();
DROP TABLE ai_generation_request;
DROP TABLE math_problem_template;
ALTER TABLE choice DROP COLUMN label_blocks;
ALTER TABLE question DROP COLUMN prompt_blocks;
-- PostgreSQL cannot remove an enum value in place; retaining math avoids
-- rewriting section_type and all dependent columns during rollback.
  `)
}
