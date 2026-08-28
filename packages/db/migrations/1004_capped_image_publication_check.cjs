/* eslint-disable camelcase, typescript/no-unsafe-call, typescript/no-unsafe-member-access */
exports.shorthands = undefined

// B6 (external review): the import schema and the `stimulus` table both let
// `maxPlays`/`max_plays` sit on ANY stimulus type, including `image` and a
// `mixed` stimulus whose media happens to be an image -- the play-cap
// concept only ever made sense for audio (`spec 1.4`, "audio plays once").
// `QuestionMedia.tsx` only ever renders a plain image when its cap is null,
// and a capped MIXED image renders its body text but neither the image nor
// any claim control (there is no image-claim UI anywhere in the runner).
// That let a draft accept content the runner can never present.
//
// The chosen contract is REJECTION, not a new capped-image reveal feature:
// a capped image conveys no product value this app has designed for (no
// "claim to reveal" interaction exists, unlike audio's claim-then-play),
// and inventing one now would be scope the review did not ask for. This
// mirrors `missing_media_asset`'s own reasoning in publish.repository.ts --
// checked here, at the LAST gate before immutability, rather than only at
// import time, so a row that reaches `stimulus` by any other path (a manual
// psql session, a future admin editor) is still caught.
exports.up = (pgm) => {
  pgm.sql(`
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
    HAVING COALESCE(sum(ts.duration_seconds), 0) <> tv.duration_seconds

    UNION ALL
    -- B6: an image (plain, or mixed-media resolving to an image) that ends
    -- up capped can never be viewed. The runner only ever grants access to
    -- a CAPPED stimulus's bytes through the claim-then-play flow
    -- (\`POST /play\`, \`QuestionMedia\`'s Play button), which no image UI
    -- implements -- a capped plain image renders nothing at all, and a
    -- capped mixed image renders its text with neither the image nor any
    -- claim control. The effective cap (stimulus override, else section
    -- default -- the same \`COALESCE\` \`media-play.repository.ts\`'s
    -- \`isFilenameCapped\` already uses) is what matters, not the stimulus's
    -- own \`max_plays\` column alone: a section-level default can cap an
    -- image just as easily as a stimulus-level override.
    SELECT s.test_version_id, NULL::uuid, ts.id,
           'capped_image_unviewable',
           'A capped image stimulus in section ' || ts.title || ' cannot be presented by the runner'
      FROM stimulus s
      JOIN question_group g   ON g.stimulus_id = s.id
      JOIN test_section ts    ON ts.id = g.test_section_id
      LEFT JOIN media_asset ma ON ma.id = s.media_asset_id
     WHERE COALESCE(s.max_plays, ts.default_max_plays) IS NOT NULL
       AND (s.type = 'image' OR (s.type = 'mixed' AND ma.kind = 'image'));

-- \`missing_media_asset\` is absent by construction: stimulus.media_asset_id
-- is a real foreign key, so an unresolvable asset cannot be stored in the
-- first place and never reaches publication.
  `)
}

exports.down = (pgm) => {
  pgm.sql(`
CREATE OR REPLACE VIEW publication_violation AS
    SELECT q.test_version_id, q.id AS question_id, NULL::uuid AS section_id,
           'too_few_choices' AS rule,
           'Question ' || q.ordinal || ' has ' || count(c.id) || ' choice(s); at least 2 are required' AS detail
      FROM question q LEFT JOIN choice c ON c.question_id = q.id
     GROUP BY q.test_version_id, q.id, q.ordinal
    HAVING count(c.id) < 2

    UNION ALL
    SELECT q.test_version_id, q.id, NULL::uuid,
           'wrong_correct_count',
           'Question ' || q.ordinal || ' is ' || q.type || ' but has '
           || count(c.id) FILTER (WHERE c.is_correct) || ' correct choice(s)'
      FROM question q LEFT JOIN choice c ON c.question_id = q.id
     GROUP BY q.test_version_id, q.id, q.ordinal, q.type
    HAVING (q.type = 'single_choice' AND count(c.id) FILTER (WHERE c.is_correct) <> 1)
        OR (q.type = 'multi_choice'  AND count(c.id) FILTER (WHERE c.is_correct) < 1)

    UNION ALL
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
    SELECT tv.id, NULL::uuid, NULL::uuid,
           'duration_mismatch',
           'Sections total ' || COALESCE(sum(ts.duration_seconds), 0)
           || 's but the test declares ' || tv.duration_seconds || 's'
      FROM test_version tv LEFT JOIN test_section ts ON ts.test_version_id = tv.id
     GROUP BY tv.id, tv.duration_seconds
    HAVING COALESCE(sum(ts.duration_seconds), 0) <> tv.duration_seconds;
  `)
}
