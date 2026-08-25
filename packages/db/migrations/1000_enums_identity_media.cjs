/* eslint-disable camelcase, typescript/no-unsafe-call, typescript/no-unsafe-member-access */
exports.shorthands = undefined

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE section_type   AS ENUM ('listening', 'reading', 'vocabulary', 'grammar');
    CREATE TYPE nav_mode       AS ENUM ('free', 'forward_only');
    CREATE TYPE stimulus_type  AS ENUM ('audio', 'passage', 'image', 'mixed');
    CREATE TYPE question_type  AS ENUM ('single_choice', 'multi_choice');
    CREATE TYPE attempt_status AS ENUM ('in_progress', 'submitted', 'expired');
    CREATE TYPE media_kind     AS ENUM ('audio', 'image');
    CREATE TYPE student_level  AS ENUM ('primary-step-1', 'primary-step-2');

    CREATE TABLE student (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      subject_claim text        NOT NULL UNIQUE,
      email         text        NOT NULL,
      display_name  text        NOT NULL,
      picture_url   text,
      level         student_level,
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT student_email_not_blank CHECK (length(btrim(email)) > 0),
      CONSTRAINT student_name_not_blank  CHECK (length(btrim(display_name)) > 0)
    );

    CREATE TABLE media_asset (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      kind       media_kind  NOT NULL,
      filename   text        NOT NULL UNIQUE,
      mime_type  text        NOT NULL,
      byte_size  bigint      NOT NULL,
      checksum   text        NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT media_size_positive CHECK (byte_size > 0)
    );
  `)
}

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE media_asset;
    DROP TABLE student;
    DROP TYPE student_level, media_kind, attempt_status,
              question_type, stimulus_type, nav_mode, section_type;
  `)
}
