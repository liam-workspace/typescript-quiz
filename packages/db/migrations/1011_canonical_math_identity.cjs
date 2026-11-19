/* eslint-disable camelcase, typescript/no-unsafe-call, typescript/no-unsafe-member-access */
exports.shorthands = undefined

exports.up = (pgm) => {
  pgm.sql(`
-- The family and normalized expression identify a problem. Verification derives
-- its answer. Seeds, validation bounds and randomized choices vary by request.
CREATE FUNCTION math_candidate_content_hash(spec jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT encode(sha256(convert_to(jsonb_build_array(spec->'family', spec->'expression')::text, 'UTF8')), 'hex');
$$;

-- Migrate candidate hashes and their audit references atomically. Rebuilding
-- the unique constraint allows an old hash to coincide with a new identity.
ALTER TABLE ai_generation_candidate DROP CONSTRAINT ai_generation_candidate_content_hash_key;
CREATE TEMP TABLE math_candidate_rekey ON COMMIT DROP AS
WITH eligible AS (
    SELECT id, status, created_at, math_candidate_content_hash(canonical_spec) AS math_hash
      FROM ai_generation_candidate
     WHERE canonical_spec ?& ARRAY['family', 'expression']
       AND (status = 'approved' OR (
               status IN ('draft', 'in_review') AND validator_reports #> '{validation,valid}' = 'true'::jsonb))
), ranked AS (
    SELECT id, math_hash,
           row_number() OVER (PARTITION BY math_hash ORDER BY
               CASE status WHEN 'approved' THEN 0 WHEN 'in_review' THEN 1 ELSE 2 END, created_at, id) AS rank
      FROM eligible
)
SELECT c.id, c.content_hash AS old_hash, ranked.math_hash,
       CASE WHEN rank = 1 THEN math_hash
            WHEN c.status = 'approved' THEN 'historical:' || c.id::text
            ELSE 'failure:' || c.id::text END AS new_hash,
       rank > 1 AND c.status IN ('in_review', 'draft') AS reject_duplicate
  FROM ai_generation_candidate c LEFT JOIN ranked USING (id);

UPDATE ai_generation_candidate c
   SET validator_reports = jsonb_set(c.validator_reports, '{validation,duplicateContentHash}',
                                     to_jsonb(coalesce(m.math_hash, m.new_hash)))
  FROM math_candidate_rekey m
 WHERE c.validator_reports #>> '{validation,duplicateContentHash}' = m.old_hash;

-- Keep prior reviews, original specs, presentations and published links intact.
-- Only still-pending collisions receive a new rejection decision.
UPDATE ai_generation_candidate c
   SET content_hash = m.new_hash,
       status = CASE WHEN m.reject_duplicate THEN 'rejected' ELSE c.status END,
       validator_reports = CASE WHEN m.reject_duplicate THEN c.validator_reports || jsonb_build_object(
           'previousValidation', c.validator_reports->'validation',
           'validation', jsonb_build_object('valid', false, 'source', 'duplicate',
               'errors', jsonb_build_array('Duplicate canonical content'), 'duplicateContentHash', m.math_hash))
           ELSE c.validator_reports END
  FROM math_candidate_rekey m WHERE c.id = m.id;

ALTER TABLE ai_generation_candidate ADD UNIQUE (content_hash);

-- Review decisions are written by both the standalone repository and the HTTP
-- audit transaction. Enforce ownership and release rejected problems for both.
CREATE FUNCTION apply_math_candidate_review_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status = 'rejected' THEN
        NEW.content_hash := 'failure:' || NEW.id::text;
    ELSIF NEW.status = 'approved' AND NEW.validator_reports #> '{validation,valid}' = 'true'::jsonb
          AND NEW.content_hash <> math_candidate_content_hash(NEW.canonical_spec) THEN
        RAISE EXCEPTION 'candidate does not own its canonical math identity' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER ai_generation_candidate_review_identity
    BEFORE UPDATE OF status ON ai_generation_candidate
    FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION apply_math_candidate_review_identity();

  `)
}

// Reopening pending collisions would undo a recorded review decision.
exports.down = false
