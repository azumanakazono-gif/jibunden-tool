-- PREVIEW ONLY. Apply to dedicated jibunden-staff-auth-preview database.
-- This is additive. It does not alter the existing registry, audit history, or loan data.
-- Run only after taking a preview backup and verifying the target database and branch.
BEGIN;
CREATE TABLE IF NOT EXISTS public.staff_registration_requests (
  google_sub VARCHAR(255) PRIMARY KEY
    REFERENCES public.staff_registry(google_sub) ON DELETE RESTRICT,
  request_id UUID NOT NULL UNIQUE,
  email_display TEXT NOT NULL CHECK (length(email_display) BETWEEN 3 AND 320),
  name_display TEXT NOT NULL CHECK (length(name_display) BETWEEN 1 AND 120),
  requested_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  last_notice_attempt_at TIMESTAMPTZ,
  last_notice_sent_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS staff_registration_requests_pending_idx
  ON public.staff_registration_requests (requested_at ASC);
COMMIT;

-- Security: before exposing registration APIs, use a dedicated least-privilege
-- runtime database role, not the existing neon_superuser-inheriting role.
-- Runtime registry: SELECT, INSERT, UPDATE (only necessary columns).
-- Runtime audit: INSERT only; runtime request metadata: SELECT, INSERT, UPDATE.
-- A separate audited owner role must handle schema changes.
-- Existing application role has elevated privileges and is NOT approved for
-- serving public staff-auth endpoints until corrected.
