/* eslint-disable camelcase, typescript/no-unsafe-call, typescript/no-unsafe-member-access */
exports.shorthands = undefined

exports.up = (pgm) => {
  pgm.sql(`
-- docs/db/schema.sql lines 509-730, verbatim
--  DURABILITY
-- =====================================================================

-- Everything the server could not apply. Written BEFORE the error is
-- returned, so a validation bug is a visible queue rather than silent
-- data loss.
--
-- Three deliberate departures from the rest of this schema:
--   * raw_body is TEXT, not jsonb — the whole point is retaining bodies
--     that failed to PARSE, which jsonb cannot hold.
--   * attempt_id is text with NO foreign key — a malformed body may name
--     an attempt that does not exist, or nothing resolvable at all.
--   * nothing here is validated. This is the one table whose job is to
--     accept garbage.
CREATE TABLE failed_write (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id      text,
    route           text        NOT NULL,
    reason          text        NOT NULL,
    raw_body        text        NOT NULL,
    byte_size       integer,
    client_version  text,
    client_instance_id text,
    received_at     timestamptz NOT NULL DEFAULT now(),
    replayed_at     timestamptz
);

CREATE INDEX failed_write_recent_idx   ON failed_write (received_at DESC, id);
CREATE INDEX failed_write_attempt_idx  ON failed_write (attempt_id, received_at DESC, id);
CREATE INDEX failed_write_pending_idx  ON failed_write (received_at DESC, id) WHERE replayed_at IS NULL;


-- =====================================================================
--  IMMUTABILITY
--  A published version and every row beneath it are frozen. Without this
--  an author could edit a question after a child had been scored on it.
-- =====================================================================

CREATE OR REPLACE FUNCTION reject_published_content_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_id uuid;
    is_published boolean;
BEGIN
    v_id := COALESCE(
        CASE TG_TABLE_NAME
            WHEN 'test_version' THEN COALESCE(OLD.id, NEW.id)
            ELSE COALESCE(OLD.test_version_id, NEW.test_version_id)
        END,
        NULL
    );

    SELECT published_at IS NOT NULL INTO is_published
      FROM test_version WHERE id = v_id;

    IF is_published THEN
        RAISE EXCEPTION
            'test_version % is published and immutable (attempted % on %)',
            v_id, TG_OP, TG_TABLE_NAME
            USING ERRCODE = 'restrict_violation';
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

-- Publication itself is the one permitted transition on test_version, so
-- that table gets a narrower guard than its children.
CREATE OR REPLACE FUNCTION reject_published_version_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.published_at IS NOT NULL THEN
        RAISE EXCEPTION 'test_version % is published and immutable', OLD.id
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER test_version_immutable
    BEFORE UPDATE OR DELETE ON test_version
    FOR EACH ROW EXECUTE FUNCTION reject_published_version_change();

CREATE TRIGGER test_section_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON test_section
    FOR EACH ROW EXECUTE FUNCTION reject_published_content_change();

CREATE TRIGGER stimulus_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON stimulus
    FOR EACH ROW EXECUTE FUNCTION reject_published_content_change();

CREATE TRIGGER question_group_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON question_group
    FOR EACH ROW EXECUTE FUNCTION reject_published_content_change();

CREATE TRIGGER question_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON question
    FOR EACH ROW EXECUTE FUNCTION reject_published_content_change();


-- section_instruction, choice and question_tag reach their version through
-- a parent, so they get a lookup of their own.
CREATE OR REPLACE FUNCTION reject_published_descendant_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    is_published boolean;
BEGIN
    CASE TG_TABLE_NAME
        WHEN 'section_instruction' THEN
            SELECT tv.published_at IS NOT NULL INTO is_published
              FROM test_section ts JOIN test_version tv ON tv.id = ts.test_version_id
             WHERE ts.id = COALESCE(OLD.test_section_id, NEW.test_section_id);
        ELSE
            SELECT tv.published_at IS NOT NULL INTO is_published
              FROM question q JOIN test_version tv ON tv.id = q.test_version_id
             WHERE q.id = COALESCE(OLD.question_id, NEW.question_id);
    END CASE;

    IF is_published THEN
        RAISE EXCEPTION 'content belongs to a published version and is immutable (% on %)',
            TG_OP, TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER section_instruction_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON section_instruction
    FOR EACH ROW EXECUTE FUNCTION reject_published_descendant_change();

CREATE TRIGGER choice_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON choice
    FOR EACH ROW EXECUTE FUNCTION reject_published_descendant_change();

CREATE TRIGGER question_tag_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON question_tag
    FOR EACH ROW EXECUTE FUNCTION reject_published_descendant_change();


-- current_version_id must point at a PUBLISHED version of the SAME test.
-- A composite FK cannot express the published half.
CREATE OR REPLACE FUNCTION check_current_version() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    ok boolean;
BEGIN
    IF NEW.current_version_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT tv.test_id = NEW.id AND tv.published_at IS NOT NULL INTO ok
      FROM test_version tv WHERE tv.id = NEW.current_version_id;

    IF NOT COALESCE(ok, false) THEN
        RAISE EXCEPTION
            'current_version_id must be a published version of this test'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER test_current_version_check
    BEFORE INSERT OR UPDATE OF current_version_id ON test
    FOR EACH ROW EXECUTE FUNCTION check_current_version();


-- =====================================================================
--  PUBLICATION VALIDATION
--  Cross-row rules no column constraint can express. Run by
--  POST /admin/tests/{testId}/publish; each violation becomes one entry
--  in the 422 \`violations[]\` array.
-- =====================================================================

CREATE OR REPLACE VIEW publication_violation AS
    -- every question needs at least two choices
    SELECT q.test_version_id, q.id AS question_id, NULL::uuid AS section_id,
           'too_few_choices' AS rule,
           'Question ' || q.ordinal || ' has ' || count(c.id) || ' choice(s); at least 2 are required' AS detail
      FROM question q LEFT JOIN choice c ON c.question_id = q.id
     GROUP BY q.test_version_id, q.id, q.ordinal
    HAVING count(c.id) < 2

    UNION ALL
    -- single_choice needs exactly one correct choice; multi_choice at least one
    SELECT q.test_version_id, q.id, NULL::uuid,
           'wrong_correct_count',
           'Question ' || q.ordinal || ' is ' || q.type || ' but has '
           || count(c.id) FILTER (WHERE c.is_correct) || ' correct choice(s)'
      FROM question q LEFT JOIN choice c ON c.question_id = q.id
     GROUP BY q.test_version_id, q.id, q.ordinal, q.type
    HAVING (q.type = 'single_choice' AND count(c.id) FILTER (WHERE c.is_correct) <> 1)
        OR (q.type = 'multi_choice'  AND count(c.id) FILTER (WHERE c.is_correct) < 1)

    UNION ALL
    -- a stimulus override may only TIGHTEN the section default
    SELECT s.test_version_id, NULL::uuid, ts.id,
           'playback_loosened',
           'A stimulus in section ' || ts.title || ' allows more than the section default'
      FROM stimulus s
      JOIN question_group g ON g.stimulus_id = s.id
      JOIN test_section ts  ON ts.id = g.test_section_id
     WHERE (s.max_plays   IS NOT NULL AND ts.default_max_plays IS NOT NULL AND s.max_plays > ts.default_max_plays)
        OR (s.allow_pause IS TRUE AND ts.default_allow_pause IS FALSE)
        OR (s.allow_seek  IS TRUE AND ts.default_allow_seek  IS FALSE)

    UNION ALL
    -- section durations must add up to the test's own duration
    SELECT tv.id, NULL::uuid, NULL::uuid,
           'duration_mismatch',
           'Sections total ' || COALESCE(sum(ts.duration_seconds), 0)
           || 's but the test declares ' || tv.duration_seconds || 's'
      FROM test_version tv LEFT JOIN test_section ts ON ts.test_version_id = tv.id
     GROUP BY tv.id, tv.duration_seconds
    HAVING COALESCE(sum(ts.duration_seconds), 0) <> tv.duration_seconds;

-- \`missing_media_asset\` is absent by construction: stimulus.media_asset_id
-- is a real foreign key, so an unresolvable asset cannot be stored in the
-- first place and never reaches publication.

  `)
}

exports.down = (pgm) => {
  pgm.sql(`
    DROP VIEW publication_violation;
    DROP TRIGGER test_current_version_check ON test;
    DROP TRIGGER question_tag_immutable ON question_tag;
    DROP TRIGGER choice_immutable ON choice;
    DROP TRIGGER section_instruction_immutable ON section_instruction;
    DROP TRIGGER question_immutable ON question;
    DROP TRIGGER question_group_immutable ON question_group;
    DROP TRIGGER stimulus_immutable ON stimulus;
    DROP TRIGGER test_section_immutable ON test_section;
    DROP TRIGGER test_version_immutable ON test_version;
    DROP FUNCTION check_current_version, reject_published_descendant_change,
                  reject_published_version_change, reject_published_content_change;
    DROP TABLE failed_write;
  `)
}
