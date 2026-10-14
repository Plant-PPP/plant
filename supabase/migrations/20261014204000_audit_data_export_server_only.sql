-- The export's audit row is written by the server alone: a session that
-- could call record_data_export wrote any outcome, as often as it liked.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- Kept, unexecutable, until production no longer calls it.
REVOKE EXECUTE ON FUNCTION public.record_data_export(text, text) FROM authenticated;

-- SECURITY DEFINER because service_role holds nothing on private.audit_log.
-- p_user_id is trusted: the caller is the export's server action, which takes
-- it from the session's verified claims.
CREATE FUNCTION public.audit_data_export(p_user_id uuid, p_outcome text, p_request_id text DEFAULT NULL)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'no user' USING ERRCODE = '22004';
  END IF;
  INSERT INTO private.audit_log (user_id, action, outcome, request_id)
  VALUES (p_user_id, 'data.exported', p_outcome::private.audit_outcome, p_request_id);
END;
$$;

REVOKE ALL ON FUNCTION public.audit_data_export(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_data_export(uuid, text, text) TO service_role;
