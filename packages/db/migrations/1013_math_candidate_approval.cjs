/* eslint-disable camelcase, typescript/no-unsafe-call, typescript/no-unsafe-member-access */
exports.shorthands = undefined

exports.up = (pgm) => {
  pgm.sql(`
ALTER TABLE ai_generation_candidate ADD COLUMN approved_content_hash text;
-- The deduplication hash identifies the expression. Approval also covers the
-- source, full spec, rendered choices, prompt, and solution the reviewer saw.
CREATE FUNCTION math_candidate_review_hash(c ai_generation_candidate) RETURNS text
LANGUAGE sql STABLE STRICT PARALLEL SAFE AS $$
    SELECT encode(sha256(convert_to(jsonb_build_array(c.request_id, c.canonical_spec,
           c.prompt_blocks, c.choices, c.solution_blocks)::text, 'UTF8')), 'hex');
$$;

CREATE FUNCTION record_math_candidate_approval() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.approved_content_hash := math_candidate_review_hash(NEW);
    RETURN NEW;
END;
$$;

CREATE TRIGGER ai_generation_candidate_approval
    BEFORE UPDATE OF status ON ai_generation_candidate
    FOR EACH ROW WHEN (NEW.status = 'approved' AND OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION record_math_candidate_approval();

-- Current stored content is the earliest snapshot available for prior approvals.
UPDATE ai_generation_candidate c SET approved_content_hash = math_candidate_review_hash(c)
 WHERE status = 'approved';
  `)
}

// Recreating the digest would approve any edits made since the original review.
exports.down = false
