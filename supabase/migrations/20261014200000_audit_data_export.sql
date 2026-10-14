-- The audit row of an export from Ajustes.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TYPE private.audit_action ADD VALUE 'data.exported' AFTER 'assistant.conversation.deleted';

-- SECURITY DEFINER because authenticated holds nothing on private.audit_log.
-- The export reads under RLS from the server action, which calls this after
-- the read with its outcome; the row is always the caller's. plpgsql, so the
-- new action value is resolved when it runs, after this transaction commits.
CREATE FUNCTION public.record_data_export(p_outcome text, p_request_id text DEFAULT NULL)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  AS $$
DECLARE
  v_user uuid := (SELECT auth.uid());
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'no user' USING ERRCODE = '42501';
  END IF;
  INSERT INTO private.audit_log (user_id, action, outcome, request_id)
  VALUES (v_user, 'data.exported', p_outcome::private.audit_outcome, p_request_id);
END;
$$;

REVOKE ALL ON FUNCTION public.record_data_export(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_data_export(text, text) TO authenticated;
