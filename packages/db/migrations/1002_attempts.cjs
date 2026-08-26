/* eslint-disable camelcase, typescript/no-unsafe-call, typescript/no-unsafe-member-access */
exports.shorthands = undefined

exports.up = (pgm) => {
  pgm.sql(`
-- docs/db/schema.sql lines 286-542, verbatim
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
    -- Completion implies the WHOLE breakdown exists and reconciles. Without
    -- the IS NOT NULL half, all-NULL columns make the arithmetic evaluate to
    -- NULL, and a CHECK evaluating to NULL passes -- so a section the
    -- database called complete could carry no numbers at all. All six are
    -- guarded, not only the three the arithmetic mentions: the per-section
    -- breakdown reads points_earned off a completed section, and a guard
    -- covering half its columns is the same fail-open shape three columns
    -- over. Mirrors attempt_finished_is_graded on the attempt table above.
    --
    -- answered_count + unanswered_count is NOT reconciled against a total
    -- here the way attempt_counts_reconcile uses question_count: this table
    -- has no per-section question total to check against, and inventing a
    -- column to make the symmetry work would be adding schema to satisfy a
    -- constraint rather than a requirement.
    CONSTRAINT attempt_section_counts_reconcile CHECK (
        completed_at IS NULL OR (
            points_earned IS NOT NULL AND points_possible IS NOT NULL
            AND answered_count IS NOT NULL AND unanswered_count IS NOT NULL
            AND correct_count IS NOT NULL AND incorrect_count IS NOT NULL
            AND correct_count + incorrect_count = answered_count
        )
    ),
    -- The pair above guards a COMPLETED section's breakdown; these two guard
    -- the OPEN side, mirroring attempt_running_is_ungraded and
    -- attempt_points_sane on the attempt table. Without them an open
    -- attempt_section (completed_at IS NULL) could carry any numbers at all
    -- -- verified accepted before this pair existed: correct_count=9,
    -- incorrect_count=9, answered_count=1 on a section nobody has finished.
    CONSTRAINT attempt_section_running_is_ungraded CHECK (
        completed_at IS NOT NULL OR (
            points_earned IS NULL AND points_possible IS NULL
            AND answered_count IS NULL AND unanswered_count IS NULL
            AND correct_count IS NULL AND incorrect_count IS NULL
        )
    ),
    CONSTRAINT attempt_section_points_sane CHECK (
        completed_at IS NULL OR (points_earned BETWEEN 0 AND points_possible)
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


  `)
}

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE stimulus_play, response_choice, response_client_cursor,
               response, attempt_section, attempt;
  `)
}
