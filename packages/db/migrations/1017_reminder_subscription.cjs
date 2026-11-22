/* eslint-disable camelcase, typescript/no-unsafe-call, typescript/no-unsafe-member-access */
exports.shorthands = undefined

exports.up = (pgm) => {
  pgm.sql(`
-- docs/db/schema.sql, "REMINDER SUBSCRIPTION", verbatim.
CREATE TABLE reminder_subscription (
    student_id    uuid        PRIMARY KEY REFERENCES student (id) ON DELETE CASCADE,
    endpoint      text        NOT NULL,
    p256dh        text        NOT NULL,
    auth          text        NOT NULL,
    timezone      text        NOT NULL,
    locale        text        NOT NULL DEFAULT 'en',
    hour          smallint    NOT NULL,
    minute        smallint    NOT NULL,
    -- The student's LOCAL calendar date of the last reminder sent (or claimed).
    -- A date, not a timestamp: "once per local day" is the rule.
    last_sent_on  date,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT reminder_endpoint_https     CHECK (endpoint LIKE 'https://%'),
    CONSTRAINT reminder_keys_not_blank     CHECK (length(btrim(p256dh)) > 0 AND length(btrim(auth)) > 0),
    CONSTRAINT reminder_timezone_not_blank CHECK (length(btrim(timezone)) > 0),
    CONSTRAINT reminder_locale_known       CHECK (locale IN ('de', 'en', 'es', 'fr', 'it', 'ja')),
    CONSTRAINT reminder_hour_range         CHECK (hour BETWEEN 0 AND 23),
    CONSTRAINT reminder_minute_range       CHECK (minute BETWEEN 0 AND 59)
);

-- One browser belongs to one student at a time; the repository evicts the
-- previous holder when a second student subscribes from the same phone.
CREATE UNIQUE INDEX reminder_subscription_endpoint_key ON reminder_subscription (endpoint);
  `)
}

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE reminder_subscription;`)
}
