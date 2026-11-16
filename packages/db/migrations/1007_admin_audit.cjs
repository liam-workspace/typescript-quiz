/* eslint-disable camelcase, typescript/no-unsafe-call, typescript/no-unsafe-member-access */
exports.shorthands = undefined

exports.up = (pgm) => {
  pgm.sql(`
-- Matches the ADMIN AUDIT table and its IMMUTABILITY guard in docs/db/schema.sql.
CREATE TABLE admin_audit_log (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_subject  text        NOT NULL,
    action         text        NOT NULL,
    resource_type  text        NOT NULL,
    resource_id    text        NOT NULL,
    metadata       jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT admin_audit_admin_subject_not_blank CHECK (length(btrim(admin_subject)) > 0),
    CONSTRAINT admin_audit_action_not_blank        CHECK (length(btrim(action)) > 0),
    CONSTRAINT admin_audit_resource_type_not_blank CHECK (length(btrim(resource_type)) > 0),
    CONSTRAINT admin_audit_resource_id_not_blank   CHECK (length(btrim(resource_id)) > 0)
);

CREATE OR REPLACE FUNCTION reject_admin_audit_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'admin audit records are immutable (attempted %)', TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER admin_audit_log_immutable
    BEFORE UPDATE OR DELETE ON admin_audit_log
    FOR EACH ROW EXECUTE FUNCTION reject_admin_audit_change();
  `)
}

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE admin_audit_log;
    DROP FUNCTION reject_admin_audit_change();
  `)
}
