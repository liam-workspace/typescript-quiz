-- =====================================================================
--  Primary Practice — database design
--  PostgreSQL 16+
--
--  Serves docs/api/openapi.yaml. Every constraint below exists because
--  some endpoint or rule in that document requires it; where the reason
--  is not obvious it is named in a comment.
--
--  Two ideas carry most of the weight:
--
--  1. A published test_version is IMMUTABLE. Attempts pin a version, so
--     editing a test can never move a score that has already been
--     recorded. Immutability is enforced by triggers, not convention.
--
--  2. Nothing may cross a version boundary. Every content and attempt
--     table carries test_version_id and every parent link is a COMPOSITE
--     foreign key including it, so "an answer to a question from a
--     different version of this test" is unrepresentable rather than
--     merely discouraged.
-- =====================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────── enums ──
-- Values match the OpenAPI enums exactly. Adding a value here without
-- adding it there (or the reverse) is the drift these types exist to
-- make visible.

CREATE TYPE section_type   AS ENUM ('listening', 'reading', 'vocabulary', 'grammar');
CREATE TYPE nav_mode       AS ENUM ('free', 'forward_only');
CREATE TYPE stimulus_type  AS ENUM ('audio', 'passage', 'image', 'mixed');
CREATE TYPE question_type  AS ENUM ('single_choice', 'multi_choice');
CREATE TYPE attempt_status AS ENUM ('in_progress', 'submitted', 'expired');
CREATE TYPE media_kind     AS ENUM ('audio', 'image');
CREATE TYPE student_level  AS ENUM ('primary-step-1', 'primary-step-2');


-- =====================================================================
--  IDENTITY
-- =====================================================================

-- A student profile IS a Google account, one-to-one. Identity lives at
-- auth.icovn.me; this table holds only what the app adds to it.
--
-- There is deliberately no is_admin column: GET /me derives it from the
-- token's role claim, so revoking admin at the identity provider takes
-- effect immediately rather than waiting for a row to be updated here.
CREATE TABLE student (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_claim  text        NOT NULL UNIQUE,     -- OIDC `sub`
    email          text        NOT NULL,
    display_name   text        NOT NULL,
    picture_url    text,
    level          student_level,                   -- null until a parent sets it
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT student_email_not_blank CHECK (length(btrim(email)) > 0),
    CONSTRAINT student_name_not_blank  CHECK (length(btrim(display_name)) > 0)
);


-- =====================================================================
--  MEDIA
-- =====================================================================

-- filename is UNIQUE because TestDocument.mediaFilename must resolve to
-- exactly one asset on import.
CREATE TABLE media_asset (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind        media_kind  NOT NULL,
    filename    text        NOT NULL UNIQUE,
    mime_type   text        NOT NULL,
    byte_size   bigint      NOT NULL,
    checksum    text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT media_size_positive CHECK (byte_size > 0)
);


-- =====================================================================
--  AUTHORED CONTENT
--  Every row below belongs to exactly one test_version and is frozen
--  once that version is published.
-- =====================================================================

CREATE TABLE test (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                text        NOT NULL UNIQUE,
    -- current_version_id is null until the first publication. The FK is
    -- added after test_version exists; a trigger holds the two extra
    -- rules a plain FK cannot: the version must be PUBLISHED and must
    -- belong to THIS test.
    current_version_id  uuid,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT test_slug_not_blank CHECK (length(btrim(slug)) > 0)
);

-- title and level live HERE, not on `test`: an attempt pins a version and
-- GET /result must render the title that version carried, not whatever the
-- test has been renamed to since.
CREATE TABLE test_version (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    test_id           uuid        NOT NULL REFERENCES test (id) ON DELETE RESTRICT,
    version           integer     NOT NULL,
    title             text        NOT NULL,
    level             student_level,
    duration_seconds  integer     NOT NULL,
    published_at      timestamptz,                 -- null while a draft
    created_at        timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT test_version_number_positive   CHECK (version > 0),
    CONSTRAINT test_version_duration_positive CHECK (duration_seconds > 0),
    CONSTRAINT test_version_title_not_blank   CHECK (length(btrim(title)) > 0),
    CONSTRAINT test_version_unique_number     UNIQUE (test_id, version),
    -- discriminator for every composite FK below
    CONSTRAINT test_version_id_self           UNIQUE (id, test_id)
);

-- POST /admin/tests/{testId}/publish takes no version selector, so at most
-- one draft may be outstanding for it to mean anything unambiguous.
CREATE UNIQUE INDEX test_version_one_draft
    ON test_version (test_id)
    WHERE published_at IS NULL;

ALTER TABLE test
    ADD CONSTRAINT test_current_version_fk
    FOREIGN KEY (current_version_id) REFERENCES test_version (id) ON DELETE RESTRICT;


CREATE TABLE test_section (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    test_version_id  uuid         NOT NULL REFERENCES test_version (id) ON DELETE CASCADE,
    ordinal          integer      NOT NULL,
    title            text         NOT NULL,        -- e.g. 'Listening — Part 1'
    type             section_type NOT NULL,
    duration_seconds integer      NOT NULL,
    navigation       nav_mode     NOT NULL,
    allow_answer_change boolean   NOT NULL,

    -- Section-level playback DEFAULTS. All three null means the OpenAPI
    -- `playback: null` — a section with no timed media. Otherwise both
    -- booleans must be present; max_plays null inside a non-null block
    -- means "unlimited".
    --
    -- These live on the section, not only on stimuli, because the
    -- section-rules screen states the caps BEFORE any stimulus loads.
    default_max_plays   integer,
    default_allow_pause boolean,
    default_allow_seek  boolean,

    CONSTRAINT section_ordinal_positive  CHECK (ordinal > 0),
    CONSTRAINT section_duration_positive CHECK (duration_seconds > 0),
    CONSTRAINT section_max_plays_positive CHECK (default_max_plays IS NULL OR default_max_plays > 0),
    CONSTRAINT section_playback_all_or_nothing CHECK (
        (default_allow_pause IS NULL AND default_allow_seek IS NULL)
        OR (default_allow_pause IS NOT NULL AND default_allow_seek IS NOT NULL)
    ),
    CONSTRAINT section_unique_ordinal UNIQUE (test_version_id, ordinal),
    CONSTRAINT section_id_version     UNIQUE (id, test_version_id)
);

-- `instructions` is an ORDERED array in the API ("Put your headphones on
-- now."). An array cannot live in a column and keep its order stable
-- across an import/export round trip, so it is a table.
CREATE TABLE section_instruction (
    test_section_id uuid    NOT NULL REFERENCES test_section (id) ON DELETE CASCADE,
    ordinal         integer NOT NULL,
    text            text    NOT NULL,

    PRIMARY KEY (test_section_id, ordinal),
    CONSTRAINT instruction_ordinal_positive CHECK (ordinal > 0),
    CONSTRAINT instruction_not_blank        CHECK (length(btrim(text)) > 0)
);


CREATE TABLE stimulus (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    test_version_id  uuid          NOT NULL REFERENCES test_version (id) ON DELETE CASCADE,
    type             stimulus_type NOT NULL,
    title            text,
    body_text        text,                          -- passage / mixed
    -- RESTRICT, not CASCADE: deleting an asset a published test cites
    -- would make a child hit Play mid-section and get a 404.
    media_asset_id   uuid REFERENCES media_asset (id) ON DELETE RESTRICT,

    -- Per-stimulus OVERRIDES. Null means "inherit the section default".
    -- Publication validation enforces that an override may only TIGHTEN
    -- the section's cap, never loosen it.
    max_plays        integer,
    allow_pause      boolean,
    allow_seek       boolean,

    CONSTRAINT stimulus_max_plays_positive CHECK (max_plays IS NULL OR max_plays > 0),
    CONSTRAINT stimulus_passage_has_text CHECK (
        type <> 'passage' OR (body_text IS NOT NULL AND media_asset_id IS NULL)
    ),
    CONSTRAINT stimulus_media_has_asset CHECK (
        type NOT IN ('audio', 'image') OR media_asset_id IS NOT NULL
    ),
    CONSTRAINT stimulus_mixed_has_both CHECK (
        type <> 'mixed' OR (body_text IS NOT NULL AND media_asset_id IS NOT NULL)
    ),
    CONSTRAINT stimulus_id_version UNIQUE (id, test_version_id)
);


CREATE TABLE question_group (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    test_version_id  uuid    NOT NULL,
    test_section_id  uuid    NOT NULL,
    stimulus_id      uuid,                          -- optional: a bare question group
    ordinal          integer NOT NULL,

    CONSTRAINT group_ordinal_positive CHECK (ordinal > 0),
    CONSTRAINT group_unique_ordinal   UNIQUE (test_section_id, ordinal),
    CONSTRAINT group_id_version       UNIQUE (id, test_version_id),

    -- Composite FKs: a group's section and stimulus must belong to the
    -- SAME version as the group. Version leakage is unrepresentable.
    CONSTRAINT group_section_fk FOREIGN KEY (test_section_id, test_version_id)
        REFERENCES test_section (id, test_version_id) ON DELETE CASCADE,
    CONSTRAINT group_stimulus_fk FOREIGN KEY (stimulus_id, test_version_id)
        REFERENCES stimulus (id, test_version_id) ON DELETE RESTRICT
);


CREATE TABLE question (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    test_version_id    uuid          NOT NULL,
    question_group_id  uuid          NOT NULL,
    -- Stable across versions, so "how does Tom do on this item over time"
    -- survives a re-publish that changes row ids.
    question_key       text          NOT NULL,
    ordinal            integer       NOT NULL,      -- position within the whole test
    prompt             text          NOT NULL,
    type               question_type NOT NULL,
    points             integer       NOT NULL,

    CONSTRAINT question_points_positive  CHECK (points > 0),
    CONSTRAINT question_ordinal_positive CHECK (ordinal > 0),
    CONSTRAINT question_prompt_not_blank CHECK (length(btrim(prompt)) > 0),
    CONSTRAINT question_unique_ordinal   UNIQUE (test_version_id, ordinal),
    CONSTRAINT question_unique_key       UNIQUE (test_version_id, question_key),
    CONSTRAINT question_id_version       UNIQUE (id, test_version_id),

    CONSTRAINT question_group_fk FOREIGN KEY (question_group_id, test_version_id)
        REFERENCES question_group (id, test_version_id) ON DELETE CASCADE
);

CREATE INDEX question_key_idx ON question (question_key);


CREATE TABLE choice (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id  uuid    NOT NULL REFERENCES question (id) ON DELETE CASCADE,
    ordinal      integer NOT NULL,
    label        text    NOT NULL,
    is_correct   boolean NOT NULL,

    CONSTRAINT choice_ordinal_positive CHECK (ordinal > 0),
    CONSTRAINT choice_label_not_blank  CHECK (length(btrim(label)) > 0),
    CONSTRAINT choice_unique_ordinal   UNIQUE (question_id, ordinal),
    -- discriminator so response_choice can prove a choice belongs to the
    -- question it was selected for
    CONSTRAINT choice_id_question      UNIQUE (id, question_id)
);


-- ordinal preserves the order of TestDocument's tags[] across a round trip.
CREATE TABLE question_tag (
    question_id uuid    NOT NULL REFERENCES question (id) ON DELETE CASCADE,
    ordinal     integer NOT NULL,
    tag         text    NOT NULL,

    PRIMARY KEY (question_id, ordinal),
    CONSTRAINT tag_unique_per_question UNIQUE (question_id, tag),
    CONSTRAINT tag_not_blank           CHECK (length(btrim(tag)) > 0)
);


-- =====================================================================
--  ATTEMPTS
-- =====================================================================

CREATE TABLE attempt (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id       uuid           NOT NULL REFERENCES student (id) ON DELETE RESTRICT,
    -- RESTRICT: a version with attempts against it can never be deleted,
    -- or a recorded score would lose the content it was computed from.
    test_version_id  uuid           NOT NULL REFERENCES test_version (id) ON DELETE RESTRICT,
    status           attempt_status NOT NULL DEFAULT 'in_progress',

    -- created_at is when POST /attempts made the row. started_at is when
    -- the FIRST section was entered — reading the brief and the section
    -- rules is untimed, so both started_at and expires_at stay null until
    -- then. Conflating the two silently charged the last section for the
    -- time spent reading.
    created_at    timestamptz NOT NULL DEFAULT now(),
    started_at    timestamptz,
    expires_at    timestamptz,
    submitted_at  timestamptz,

    current_section_id   uuid,
    current_question_id  uuid,

    -- Score cache. Null while running, non-null once finished. A cache of
    -- a pure function over frozen content, so a rescore is always safe.
    points_earned    integer,
    points_possible  integer,
    percentage       numeric(5,2),
    answered_count   integer,
    unanswered_count integer,
    correct_count    integer,
    incorrect_count  integer,
    question_count   integer,

    CONSTRAINT attempt_id_version UNIQUE (id, test_version_id),

    CONSTRAINT attempt_position_section_fk FOREIGN KEY (current_section_id, test_version_id)
        REFERENCES test_section (id, test_version_id) ON DELETE RESTRICT,
    CONSTRAINT attempt_position_question_fk FOREIGN KEY (current_question_id, test_version_id)
        REFERENCES question (id, test_version_id) ON DELETE RESTRICT,

    -- The clock is all-or-nothing: an attempt is either untimed (not yet
    -- entered) or fully timed. There is no half-started state.
    CONSTRAINT attempt_clock_paired CHECK (
        (started_at IS NULL) = (expires_at IS NULL)
    ),
    CONSTRAINT attempt_expiry_after_start CHECK (
        expires_at IS NULL OR expires_at > started_at
    ),

    CONSTRAINT attempt_running_is_ungraded CHECK (
        status <> 'in_progress' OR (
            submitted_at IS NULL AND points_earned IS NULL AND points_possible IS NULL
            AND percentage IS NULL AND answered_count IS NULL AND unanswered_count IS NULL
            AND correct_count IS NULL AND incorrect_count IS NULL AND question_count IS NULL
        )
    ),
    CONSTRAINT attempt_finished_is_graded CHECK (
        status = 'in_progress' OR (
            submitted_at IS NOT NULL AND points_earned IS NOT NULL AND points_possible IS NOT NULL
            AND percentage IS NOT NULL AND answered_count IS NOT NULL AND unanswered_count IS NOT NULL
            AND correct_count IS NOT NULL AND incorrect_count IS NOT NULL AND question_count IS NOT NULL
        )
    ),
    -- An expired attempt is finalized AT its deadline, never at the moment
    -- the late request happened to arrive.
    CONSTRAINT attempt_expired_pins_deadline CHECK (
        status <> 'expired' OR submitted_at = expires_at
    ),
    CONSTRAINT attempt_counts_reconcile CHECK (
        status = 'in_progress' OR (
            correct_count + incorrect_count = answered_count
            AND answered_count + unanswered_count = question_count
        )
    ),
    CONSTRAINT attempt_points_sane CHECK (
        status = 'in_progress' OR (points_earned BETWEEN 0 AND points_possible)
    )
);

-- "Start" and "resume" are the same call because of this index: a second
-- in-progress attempt cannot exist, so a double-tapped Start button races
-- into a constraint rather than into two attempts.
CREATE UNIQUE INDEX attempt_one_active
    ON attempt (student_id, test_version_id)
    WHERE status = 'in_progress';

-- GET /attempts — finished history, newest first, keyset paginated.
CREATE INDEX attempt_history_idx
    ON attempt (student_id, submitted_at DESC, id)
    WHERE status <> 'in_progress';

-- GET /tests — per-test standing: in-progress lookup and best-attempt.
CREATE INDEX attempt_standing_idx
    ON attempt (student_id, test_version_id, status, percentage DESC, submitted_at DESC);


CREATE TABLE attempt_section (
    attempt_id       uuid NOT NULL,
    test_section_id  uuid NOT NULL,
    test_version_id  uuid NOT NULL,

    entered_at    timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL,
    completed_at  timestamptz,

    points_earned    integer,
    points_possible  integer,
    answered_count   integer,
    unanswered_count integer,
    correct_count    integer,
    incorrect_count  integer,

    PRIMARY KEY (attempt_id, test_section_id),

    CONSTRAINT attempt_section_attempt_fk FOREIGN KEY (attempt_id, test_version_id)
        REFERENCES attempt (id, test_version_id) ON DELETE CASCADE,
    CONSTRAINT attempt_section_section_fk FOREIGN KEY (test_section_id, test_version_id)
        REFERENCES test_section (id, test_version_id) ON DELETE RESTRICT,

    CONSTRAINT attempt_section_expiry_after_entry CHECK (expires_at > entered_at),
    CONSTRAINT attempt_section_counts_reconcile CHECK (
        completed_at IS NULL OR correct_count + incorrect_count = answered_count
    )
);

-- Makes "409 previous section still open" enforceable rather than advisory.
CREATE UNIQUE INDEX attempt_section_one_open
    ON attempt_section (attempt_id)
    WHERE completed_at IS NULL;


CREATE TABLE response (
    attempt_id       uuid NOT NULL,
    question_id      uuid NOT NULL,
    test_version_id  uuid NOT NULL,

    -- Ordering identity. seq is monotonic WITHIN one install and says
    -- nothing across installs; answered_at is display text and is never
    -- consulted for ordering or expiry.
    client_instance_id text    NOT NULL,
    client_seq         bigint  NOT NULL,
    answered_at        timestamptz,
    time_spent_ms      integer,
    updated_at         timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (attempt_id, question_id),

    -- Together these make an answer to a question from a DIFFERENT version
    -- of this test impossible to record. Plain single-column FKs would
    -- happily accept one.
    CONSTRAINT response_attempt_fk FOREIGN KEY (attempt_id, test_version_id)
        REFERENCES attempt (id, test_version_id) ON DELETE CASCADE,
    CONSTRAINT response_question_fk FOREIGN KEY (question_id, test_version_id)
        REFERENCES question (id, test_version_id) ON DELETE RESTRICT,

    CONSTRAINT response_seq_non_negative CHECK (client_seq >= 0),
    CONSTRAINT response_time_non_negative CHECK (time_spent_ms IS NULL OR time_spent_ms >= 0)
);

-- A response row is NEVER deleted, even when the student clears an answer:
-- the row survives with zero response_choice children so the clear itself
-- keeps its place in the sequence. Deleting it would let a stale retry of
-- the previous answer look new.

-- One RESPONSE holds only the winning device's seq. This table remembers
-- every device's high-water mark, so when a second iPad takes over and
-- then the first one flushes a queued write, that write is still correctly
-- judged stale for ITS instance.
CREATE TABLE response_client_cursor (
    attempt_id          uuid   NOT NULL,
    question_id         uuid   NOT NULL,
    client_instance_id  text   NOT NULL,
    last_seq            bigint NOT NULL,
    updated_at          timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (attempt_id, question_id, client_instance_id),
    CONSTRAINT cursor_response_fk FOREIGN KEY (attempt_id, question_id)
        REFERENCES response (attempt_id, question_id) ON DELETE CASCADE,
    CONSTRAINT cursor_seq_non_negative CHECK (last_seq >= 0)
);


CREATE TABLE response_choice (
    attempt_id   uuid NOT NULL,
    question_id  uuid NOT NULL,
    choice_id    uuid NOT NULL,

    PRIMARY KEY (attempt_id, question_id, choice_id),

    CONSTRAINT response_choice_response_fk FOREIGN KEY (attempt_id, question_id)
        REFERENCES response (attempt_id, question_id) ON DELETE CASCADE,
    -- Closes the hole a TEXT[] of choice ids could never close: you cannot
    -- select a choice belonging to a different question.
    CONSTRAINT response_choice_choice_fk FOREIGN KEY (choice_id, question_id)
        REFERENCES choice (id, question_id) ON DELETE RESTRICT
);


-- The counter that makes "each recording plays once" real. It guards the
-- BYTES, not just an endpoint: POST /play increments this and only then
-- issues a signed short-lived URL, and the runner payload carries no
-- mediaUrl for a capped stimulus.
CREATE TABLE stimulus_play (
    attempt_id       uuid    NOT NULL,
    stimulus_id      uuid    NOT NULL,
    test_version_id  uuid    NOT NULL,
    play_count       integer NOT NULL DEFAULT 0,
    last_played_at   timestamptz,

    PRIMARY KEY (attempt_id, stimulus_id),

    CONSTRAINT play_attempt_fk FOREIGN KEY (attempt_id, test_version_id)
        REFERENCES attempt (id, test_version_id) ON DELETE CASCADE,
    CONSTRAINT play_stimulus_fk FOREIGN KEY (stimulus_id, test_version_id)
        REFERENCES stimulus (id, test_version_id) ON DELETE RESTRICT,

    CONSTRAINT play_count_non_negative CHECK (play_count >= 0)
);


-- =====================================================================
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
--  in the 422 `violations[]` array.
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

-- `missing_media_asset` is absent by construction: stimulus.media_asset_id
-- is a real foreign key, so an unresolvable asset cannot be stored in the
-- first place and never reaches publication.

COMMIT;
