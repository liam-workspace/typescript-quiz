/* eslint-disable camelcase, typescript/no-unsafe-call, typescript/no-unsafe-member-access */
exports.shorthands = undefined

// Some TOEFL Primary picture-choice questions (listen_pick_picture,
// read_word_picture) offer a small line-art pictogram per choice, not just
// text. The source content authors these as inline `<svg>` markup using
// `stroke="currentColor"` so the icon can inherit `.choice`'s ink/selected
// colour -- a benefit only inline DOM markup gets: an `<img src>` to a
// stored file loses `currentColor` entirely, resolving it to black. That
// rules out the existing `media_asset` file pattern (built for stimulus
// audio/images) for this case; a text column carrying the markup directly
// is the shape that matches the content.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE choice ADD COLUMN image_svg text;
    ALTER TABLE choice ADD CONSTRAINT choice_image_svg_shape CHECK (
        image_svg IS NULL
        OR (btrim(image_svg) ILIKE '<svg%' AND length(image_svg) <= 20000)
    );
  `)
}

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE choice DROP CONSTRAINT choice_image_svg_shape;
    ALTER TABLE choice DROP COLUMN image_svg;
  `)
}
