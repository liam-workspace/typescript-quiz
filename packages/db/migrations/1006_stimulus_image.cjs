/* eslint-disable camelcase, typescript/no-unsafe-call, typescript/no-unsafe-member-access */
exports.shorthands = undefined

// The same need as migration 1005, one level up: TOEFL Primary's
// read_word_picture questions show a pictogram ABOVE the question (the
// stimulus), with plain-text choices -- the mirror image of
// listen_pick_picture, which has a plain prompt and pictogram CHOICES.
// The source authors this pictogram as inline `<svg>` with
// `stroke="currentColor"` too, for the same reason: only markup rendered
// into the DOM inherits page colour, unlike an `<img src>` to a stored file.
//
// `stimulus_media_has_asset` is loosened rather than dropped: audio still
// always needs a real media_asset (there is no inline-audio equivalent),
// only `image` gains the second, inline path.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE stimulus ADD COLUMN image_svg text;
    ALTER TABLE stimulus ADD CONSTRAINT stimulus_image_svg_shape CHECK (
        image_svg IS NULL
        OR (btrim(image_svg) ILIKE '<svg%' AND length(image_svg) <= 20000)
    );
    ALTER TABLE stimulus DROP CONSTRAINT stimulus_media_has_asset;
    ALTER TABLE stimulus ADD CONSTRAINT stimulus_media_has_asset CHECK (
        type = 'audio' AND media_asset_id IS NOT NULL
        OR type = 'image' AND (media_asset_id IS NOT NULL OR image_svg IS NOT NULL)
        OR type NOT IN ('audio', 'image')
    );
  `)
}

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE stimulus DROP CONSTRAINT stimulus_media_has_asset;
    ALTER TABLE stimulus ADD CONSTRAINT stimulus_media_has_asset CHECK (
        type NOT IN ('audio', 'image') OR media_asset_id IS NOT NULL
    );
    ALTER TABLE stimulus DROP CONSTRAINT stimulus_image_svg_shape;
    ALTER TABLE stimulus DROP COLUMN image_svg;
  `)
}
