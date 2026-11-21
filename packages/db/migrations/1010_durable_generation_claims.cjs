/* eslint-disable camelcase, typescript/no-unsafe-call, typescript/no-unsafe-member-access */
exports.shorthands = undefined

exports.up = (pgm) => {
  pgm.sql(`
ALTER TABLE ai_generation_request
    ADD COLUMN status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed')),
    ADD COLUMN claim_token uuid,
    ADD COLUMN lease_expires_at timestamptz,
    ADD CONSTRAINT ai_generation_request_lease CHECK (
        (status = 'processing' AND claim_token IS NOT NULL AND lease_expires_at IS NOT NULL)
        OR (status <> 'processing' AND claim_token IS NULL AND lease_expires_at IS NULL)
    );

-- Previously the worker committed an entire batch atomically, including failures.
UPDATE ai_generation_request r
   SET status = 'completed'
 WHERE EXISTS (SELECT 1 FROM ai_generation_candidate c WHERE c.request_id = r.id);

CREATE INDEX ai_generation_request_pending_idx ON ai_generation_request (created_at, id)
    WHERE status <> 'completed';

-- Only a validated presentation can populate these fields. Leave all three
-- null for existing candidates: raw_response is untrusted audit evidence.
ALTER TABLE ai_generation_candidate
    ADD COLUMN prompt_blocks jsonb CHECK (jsonb_typeof(prompt_blocks) = 'array'),
    ADD COLUMN choices jsonb CHECK (jsonb_typeof(choices) = 'array'),
    ADD COLUMN solution_blocks jsonb CHECK (jsonb_typeof(solution_blocks) = 'array'),
    ADD CONSTRAINT ai_generation_candidate_presentation CHECK (
        num_nonnulls(prompt_blocks, choices, solution_blocks) IN (0, 3)
    );
  `)
}

exports.down = (pgm) => {
  pgm.sql(`
ALTER TABLE ai_generation_candidate
    DROP CONSTRAINT ai_generation_candidate_presentation,
    DROP COLUMN solution_blocks,
    DROP COLUMN choices,
    DROP COLUMN prompt_blocks;
DROP INDEX ai_generation_request_pending_idx;
ALTER TABLE ai_generation_request
    DROP CONSTRAINT ai_generation_request_lease,
    DROP COLUMN lease_expires_at,
    DROP COLUMN claim_token,
    DROP COLUMN status;
  `)
}
