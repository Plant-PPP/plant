-- A user may also discard a ready import they will not confirm: it is failed
-- with no failure, as a superseded sync is, and leaves the list of imports.
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
     AND NOT (OLD.status = 'ready' AND NEW.status IN ('confirmed', 'failed'))
     AND NOT (OLD.document_id IS NULL AND OLD.status = 'queued' AND NEW.status = 'failed') THEN
    RAISE EXCEPTION 'a user only confirms or discards a ready import, or fails a queued sync'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
