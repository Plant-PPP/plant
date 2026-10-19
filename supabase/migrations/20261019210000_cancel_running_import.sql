-- A user may also cancel an import still queued or being read: it is failed
-- with no failure, as a discarded one is, and leaves the list. The import job
-- writes a draft or a status only while the import is queued or being read,
-- so a cancelled one stays as the user left it.
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
     AND NOT (OLD.status IN ('queued', 'reading') AND NEW.status = 'failed') THEN
    RAISE EXCEPTION 'a user only confirms or discards a ready import, or cancels one in flight'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
