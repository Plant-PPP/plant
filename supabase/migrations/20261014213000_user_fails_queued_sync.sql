-- A user may fail their own sync still queued, whose job may be lost, so a
-- sync of another draft or period can start on the account: the app does it
-- only with status = 'queued' in the predicate, so a sync the job started
-- reading stays. Every other move stays the job's, and a user still moves a
-- ready import only to confirmed.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

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
     AND NOT (OLD.status = 'ready' AND NEW.status = 'confirmed')
     AND NOT (OLD.document_id IS NULL AND OLD.status = 'queued' AND NEW.status = 'failed') THEN
    RAISE EXCEPTION 'a user only confirms a ready import or fails a queued sync' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_import_status() FROM PUBLIC, anon, authenticated;
