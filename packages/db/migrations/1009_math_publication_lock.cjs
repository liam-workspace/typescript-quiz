/* eslint-disable camelcase, typescript/no-unsafe-call, typescript/no-unsafe-member-access */
exports.shorthands = undefined

exports.up = (pgm) => {
  pgm.sql(`
CREATE OR REPLACE FUNCTION reject_published_math_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    has_published_parent boolean;
BEGIN
    -- Lock both parents in version ID order when metadata moves. FOR SHARE
    -- conflicts with publication and reads its committed timestamp after waiting.
    SELECT bool_or(parent.published_at IS NOT NULL) INTO has_published_parent
      FROM (
          SELECT tv.published_at
            FROM test_version tv
           WHERE tv.id IN (
               SELECT q.test_version_id FROM question q
                WHERE q.id = CASE WHEN TG_OP <> 'INSERT' THEN OLD.question_id END
                   OR q.id = CASE WHEN TG_OP <> 'DELETE' THEN NEW.question_id END
           )
           ORDER BY tv.id
           FOR SHARE OF tv
      ) parent;

    IF has_published_parent THEN
        RAISE EXCEPTION 'math content belongs to a published version and is immutable (% on %)', TG_OP, TG_TABLE_NAME
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;
  `)
}

exports.down = () => {
  // The current 1008 schema already uses the same locking function.
}
