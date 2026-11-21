/* eslint-disable camelcase, typescript/no-unsafe-call, typescript/no-unsafe-member-access */
exports.shorthands = undefined

exports.up = (pgm) => {
  pgm.sql(`
-- Snapshot 1011's hashes before replacing the function. Its original hash can
-- still appear in a duplicate report after a reviewer released the owner.
ALTER TABLE ai_generation_candidate DROP CONSTRAINT ai_generation_candidate_content_hash_key;
CREATE TEMP TABLE prior_math_identity ON COMMIT DROP AS
    SELECT id, content_hash AS old_key, math_candidate_content_hash(canonical_spec) AS old_math_hash
      FROM ai_generation_candidate WHERE canonical_spec ?& ARRAY['family', 'expression'];

-- Rebuild the verified MathAst fields. Provider annotations, including fields
-- attached to nested operands, are evidence only and do not identify the math.
CREATE FUNCTION math_candidate_expression(node jsonb, depth integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE
    kind text := node->>'kind';
    lhs jsonb;
    rhs jsonb;
BEGIN
    IF depth > 32 THEN
        RETURN NULL;
    END IF;
    CASE
        WHEN kind = 'integer' AND jsonb_typeof(node->'value') = 'number' THEN
            RETURN jsonb_build_object('kind', kind, 'value', trim_scale((node->>'value')::numeric));
        WHEN kind = 'fraction' AND jsonb_typeof(node->'numerator') = 'number'
                               AND jsonb_typeof(node->'denominator') = 'number' THEN
            RETURN jsonb_build_object('kind', kind, 'numerator', trim_scale((node->>'numerator')::numeric),
                                      'denominator', trim_scale((node->>'denominator')::numeric));
        WHEN kind = 'variable' AND jsonb_typeof(node->'name') = 'string' THEN
            RETURN jsonb_build_object('kind', kind, 'name', node->'name');
        WHEN kind IN ('add', 'subtract', 'multiply', 'divide', 'power', 'equation') THEN
            lhs := math_candidate_expression(node->'left', depth + 1);
            rhs := math_candidate_expression(node->'right', depth + 1);
            IF lhs IS NOT NULL AND rhs IS NOT NULL THEN
                RETURN jsonb_build_object('kind', kind, 'left', lhs, 'right', rhs);
            END IF;
        ELSE RETURN NULL;
    END CASE;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION math_candidate_content_hash(spec jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT encode(sha256(convert_to(jsonb_build_array(spec->'family', expression)::text, 'UTF8')), 'hex')
      FROM math_candidate_expression(spec->'expression') expression
     WHERE expression IS NOT NULL AND spec->>'family' IN
           ('fraction_addition', 'percentage_of_quantity', 'ratio', 'linear_equation');
$$;

CREATE OR REPLACE FUNCTION apply_math_candidate_review_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status = 'rejected' THEN
        NEW.content_hash := 'failure:' || NEW.id::text;
    ELSIF NEW.status = 'approved' AND NEW.validator_reports #> '{validation,valid}' = 'true'::jsonb
          AND NEW.content_hash IS DISTINCT FROM math_candidate_content_hash(NEW.canonical_spec) THEN
        RAISE EXCEPTION 'candidate does not own its canonical math identity' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TEMP TABLE normalized_math_identity ON COMMIT DROP AS
    SELECT p.*, math_candidate_content_hash(c.canonical_spec) AS math_hash
      FROM prior_math_identity p JOIN ai_generation_candidate c USING (id);

-- 1011 could record failure:<owner id> when the original owner was already
-- rejected. Recover the math from that retained spec independently of status.
WITH aliases AS (
    SELECT old_key AS alias, math_hash FROM normalized_math_identity
    UNION
    SELECT old_math_hash, math_hash FROM normalized_math_identity
)
UPDATE ai_generation_candidate c
   SET validator_reports = jsonb_set(c.validator_reports, '{validation,duplicateContentHash}', to_jsonb(a.math_hash))
  FROM aliases a
 WHERE c.validator_reports #>> '{validation,duplicateContentHash}' = a.alias
   AND a.math_hash IS NOT NULL AND a.alias <> a.math_hash;

WITH ranked AS (
    SELECT c.id, n.math_hash,
           row_number() OVER (PARTITION BY n.math_hash ORDER BY
               CASE c.status WHEN 'approved' THEN 0 WHEN 'in_review' THEN 1 ELSE 2 END,
               c.created_at, c.id) AS rank
      FROM ai_generation_candidate c JOIN normalized_math_identity n USING (id)
     WHERE n.math_hash IS NOT NULL AND (
           c.status = 'approved' OR
           (c.status IN ('draft', 'in_review') AND c.validator_reports #> '{validation,valid}' = 'true'::jsonb) OR
           (c.status = 'regeneration_requested' AND n.old_key = n.old_math_hash))
)
UPDATE ai_generation_candidate c
   SET content_hash = CASE WHEN r.rank = 1 THEN r.math_hash
                           WHEN c.status = 'approved' THEN 'historical:' || c.id::text
                           ELSE 'failure:' || c.id::text END,
       status = CASE WHEN r.rank > 1 AND c.status IN ('draft', 'in_review') THEN 'rejected' ELSE c.status END,
       validator_reports = CASE WHEN r.rank > 1 AND c.status IN ('draft', 'in_review')
           THEN c.validator_reports || jsonb_build_object('previousValidation', c.validator_reports->'validation',
               'validation', jsonb_build_object('valid', false, 'source', 'duplicate',
                   'errors', jsonb_build_array('Duplicate canonical content'), 'duplicateContentHash', r.math_hash))
           ELSE c.validator_reports END
  FROM ranked r WHERE c.id = r.id;

ALTER TABLE ai_generation_candidate ADD UNIQUE (content_hash);
  `)
}

// Reopening pending collisions would undo a recorded review decision.
exports.down = false
