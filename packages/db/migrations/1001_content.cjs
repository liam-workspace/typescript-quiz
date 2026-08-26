/* eslint-disable camelcase, typescript/no-unsafe-call, typescript/no-unsafe-member-access */
exports.shorthands = undefined

exports.up = (pgm) => {
  pgm.sql(`
-- docs/db/schema.sql lines 83-284, verbatim (backticks in comments escaped for the JS template literal)
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

-- title and level live HERE, not on \`test\`: an attempt pins a version and
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
    -- \`playback: null\` — a section with no timed media. Otherwise both
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

-- \`instructions\` is an ORDERED array in the API ("Put your headphones on
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



  `)
}

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE question_tag, choice, question, question_group,
               section_instruction, stimulus, test_section;
    ALTER TABLE test DROP CONSTRAINT test_current_version_fk;
    DROP TABLE test_version, test;
  `)
}
