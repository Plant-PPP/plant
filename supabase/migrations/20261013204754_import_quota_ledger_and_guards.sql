-- The import quota counts every import started, and a confirmed import stays
-- confirmed.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- ── The quota ───────────────────────────────────────────────────────────────
-- One row per import started, kept when the import or its file is deleted, so
-- deleting a file gives no import back. Only the quota trigger reads or
-- writes it.
CREATE TABLE private.import_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL
);

CREATE INDEX import_requests_user_id_created_at_idx
  ON private.import_requests (user_id, created_at);

ALTER TABLE private.import_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.import_requests FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO private.import_requests (user_id, created_at)
SELECT i.user_id, i.created_at FROM public.imports i;

-- SECURITY DEFINER because a user starts an import as authenticated, which
-- holds nothing on private.import_requests. The import's user_id and
-- created_at are their defaults: authenticated inserts only document_id.
CREATE OR REPLACE FUNCTION private.check_import_quota()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  AS $$
DECLARE
  v_month_start timestamptz := date_trunc('month', now() AT TIME ZONE 'America/Argentina/Buenos_Aires')
                                 AT TIME ZONE 'America/Argentina/Buenos_Aires';
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('plant.imports:' || NEW.user_id::text, 0));
  IF (SELECT count(*) FROM private.import_requests r
      WHERE r.user_id = NEW.user_id AND r.created_at >= v_month_start) >= 20 THEN
    RAISE EXCEPTION 'the month''s imports are used up'
      USING ERRCODE = 'PT429', HINT = 'import_quota';
  END IF;
  INSERT INTO private.import_requests (user_id, created_at) VALUES (NEW.user_id, NEW.created_at);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.check_import_quota() FROM PUBLIC, anon, authenticated;

-- ── Import status ───────────────────────────────────────────────────────────
-- Nobody moves a confirmed import, the job included: a read retried after the
-- user confirmed would make it ready to confirm again. A user moves an import
-- only from ready to confirmed, which confirm_import does.
CREATE OR REPLACE FUNCTION private.guard_import_status()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
BEGIN
  IF OLD.status = 'confirmed' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'a confirmed import stays confirmed' USING ERRCODE = '42501';
  END IF;
  IF current_user = 'authenticated'
     AND NOT (OLD.status = 'ready' AND NEW.status = 'confirmed') THEN
    RAISE EXCEPTION 'a user only confirms a ready import' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_import_status() FROM PUBLIC, anon, authenticated;
