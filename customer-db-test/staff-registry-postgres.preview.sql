-- PREVIEW DESIGN ONLY. Do not run against any customer or production database.
-- Apply only to a NEW, dedicated staff-auth preview PostgreSQL database.
-- Run as schema owner; application runtime must use a different least-privilege role.
BEGIN;

CREATE TABLE IF NOT EXISTS staff_registry (
  google_sub VARCHAR(255) PRIMARY KEY
    CHECK (length(trim(google_sub)) > 0 AND google_sub !~ '[[:space:]]'),
  status TEXT NOT NULL CHECK (status IN ('pending','approved','suspended','rejected')),
  role TEXT NOT NULL CHECK (role IN ('staff','admin')),
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CHECK (updated_at >= created_at)
);

CREATE TABLE IF NOT EXISTS staff_audit_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL,
  actor_sub VARCHAR(255) NOT NULL,
  target_sub VARCHAR(255) NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('register','approve','suspend','reject','bootstrap')),
  from_status TEXT CHECK (from_status IS NULL OR from_status IN ('pending','approved','suspended','rejected')),
  to_status TEXT NOT NULL CHECK (to_status IN ('pending','approved','suspended','rejected')),
  record_version INTEGER NOT NULL CHECK (record_version >= 1),
  CHECK (length(actor_sub) > 0 AND length(target_sub) > 0)
);

CREATE INDEX IF NOT EXISTS staff_audit_target_at_idx
  ON staff_audit_log (target_sub, at DESC);

-- Audit entries must be append-only. The separate migration/owner role can
-- manage schema, but the runtime account must not be granted DELETE/UPDATE.
CREATE OR REPLACE FUNCTION prevent_staff_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'staff audit log is append-only';
END;
$$;

DROP TRIGGER IF EXISTS staff_audit_no_mutation ON staff_audit_log;
CREATE TRIGGER staff_audit_no_mutation
BEFORE UPDATE OR DELETE ON staff_audit_log
FOR EACH ROW EXECUTE FUNCTION prevent_staff_audit_mutation();

COMMIT;

-- BEFORE INTEGRATION: provisioning operator must grant the runtime login only
-- SELECT/INSERT/UPDATE on staff_registry, SELECT/INSERT on staff_audit_log,
-- and USAGE on the staff_audit_log_id_seq sequence. No TRUNCATE/DELETE/DDL.
-- Initial admin bootstrap must be a separately reviewed, audited migration,
-- using the verified immutable Google sub and an independently confirmed owner.
