/* eslint-disable camelcase, typescript/no-unsafe-call, typescript/no-unsafe-member-access */
exports.shorthands = undefined

exports.up = (pgm) => {
  pgm.sql(`
-- Where an attempt came from. 'offline' attempts were started with no network
-- and adopted at sync time: attempt.id IS the client-minted uuid, so an
-- offline attempt's routes and answer queue never need remapping.
ALTER TABLE attempt
    ADD COLUMN origin text NOT NULL DEFAULT 'server',
    ADD CONSTRAINT attempt_origin_known CHECK (origin IN ('server', 'offline'));

-- Idempotency for POST /attempts/offline-sync: the highest journal eventSeq
-- already applied to this attempt. Events at or below it are never replayed,
-- so a retried or overlapping sync cannot double-count a play or an answer.
CREATE TABLE offline_journal_cursor (
    attempt_id      uuid PRIMARY KEY REFERENCES attempt (id) ON DELETE CASCADE,
    last_event_seq  integer     NOT NULL,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT journal_cursor_non_negative CHECK (last_event_seq >= 0)
);
  `)
}

exports.down = (pgm) => {
  pgm.sql(`
DROP TABLE offline_journal_cursor;
ALTER TABLE attempt DROP CONSTRAINT attempt_origin_known,
                    DROP COLUMN origin;
  `)
}
