-- The monthly import quota, and deleting an uploaded file once it is due.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- ── The quota ───────────────────────────────────────────────────────────────
-- Every user is on the beta plan: 20 imports a calendar month in Buenos
-- Aires. A lock per user keeps two uploads at once from both taking the last
-- one.
CREATE FUNCTION private.check_import_quota()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
DECLARE
  v_month_start timestamptz := date_trunc('month', now() AT TIME ZONE 'America/Argentina/Buenos_Aires')
                                 AT TIME ZONE 'America/Argentina/Buenos_Aires';
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('plant.imports:' || NEW.user_id::text, 0));
  IF (SELECT count(*) FROM public.imports i
      WHERE i.user_id = NEW.user_id AND i.created_at >= v_month_start) >= 20 THEN
    RAISE EXCEPTION 'the month''s imports are used up'
      USING ERRCODE = 'PT429', HINT = 'import_quota';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.check_import_quota() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER imports_check_quota
  BEFORE INSERT ON public.imports
  FOR EACH ROW EXECUTE FUNCTION private.check_import_quota();

-- ── Deleting a file ─────────────────────────────────────────────────────────
-- The job removes a file from Storage once its delete_after passes and marks
-- its row; the row, its import and the draft stay.
ALTER TABLE public.uploaded_documents ADD COLUMN file_deleted_at timestamptz;

GRANT SELECT (delete_after, file_deleted_at), UPDATE (file_deleted_at)
  ON TABLE public.uploaded_documents TO service_role;

ALTER TYPE private.audit_action ADD VALUE 'imports.file.deleted' AFTER 'auth.mfa.factor_removed';

-- SECURITY DEFINER because the job writes as service_role, which holds
-- nothing on private.audit_log.
CREATE FUNCTION private.record_file_deletion()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  AS $$
BEGIN
  IF OLD.file_deleted_at IS NULL AND NEW.file_deleted_at IS NOT NULL THEN
    INSERT INTO private.audit_log (user_id, action, outcome, metadata)
    VALUES (NEW.user_id, 'imports.file.deleted', 'success',
            jsonb_build_object('document_id', NEW.id));
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.record_file_deletion() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER uploaded_documents_record_file_deletion
  AFTER UPDATE OF file_deleted_at ON public.uploaded_documents
  FOR EACH ROW EXECUTE FUNCTION private.record_file_deletion();
