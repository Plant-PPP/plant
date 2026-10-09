SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- Nothing in this transaction uses the new values: plpgsql resolves the casts
-- below when a trigger fires.
ALTER TYPE private.audit_action ADD VALUE 'auth.session.deleted';
ALTER TYPE private.audit_action ADD VALUE 'auth.mfa.verified';
ALTER TYPE private.audit_action ADD VALUE 'auth.mfa.factor_verified';
ALTER TYPE private.audit_action ADD VALUE 'auth.mfa.factor_removed';

-- The INSERT trigger record_session_created follows the function's OID.
ALTER FUNCTION private.record_session_created() RENAME TO record_session_event;

-- One row per session created, raised to aal2 or deleted. Auth's own
-- transaction runs the insert, so a failing insert fails the sign-in, sign-out,
-- TOTP verify, user deletion or session cleanup that fired it. Columns are read
-- through to_jsonb, so a column Auth renames stops the row instead of breaking
-- Auth. n and o hold the whole session, refresh_token_hmac_key included: only
-- the keys below may leave this function. A DELETE covers every way a session
-- ends (sign-out in any scope, the aal1 sessions a TOTP verify deletes, user
-- deletion, Auth's cleanup) without telling them apart.
CREATE OR REPLACE FUNCTION private.record_session_event()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  AS $$
DECLARE
  n jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  o jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  row_data jsonb := coalesce(n, o);
  event private.audit_action;
BEGIN
  IF TG_OP = 'INSERT' THEN
    event := 'auth.session.created';
  ELSIF TG_OP = 'DELETE' THEN
    event := 'auth.session.deleted';
  ELSIF n ->> 'aal' = 'aal2' AND o ->> 'aal' IS DISTINCT FROM 'aal2' THEN
    event := 'auth.mfa.verified';
  ELSE
    -- Every refresh lands here.
    RETURN NULL;
  END IF;
  INSERT INTO private.audit_log (user_id, action, outcome, metadata)
  VALUES ((row_data ->> 'user_id')::uuid, event, 'success',
          jsonb_build_object('session_id', row_data ->> 'id', 'aal', row_data ->> 'aal'));
  RETURN NULL;
END;
$$;

-- One row per factor verified or verified factor removed. n and o hold the
-- factor's secret: only its id and type leave this function.
CREATE FUNCTION private.record_mfa_factor_event()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  AS $$
DECLARE
  n jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  o jsonb := to_jsonb(OLD);
  row_data jsonb := coalesce(n, o);
  event private.audit_action;
BEGIN
  IF TG_OP = 'UPDATE' AND n ->> 'status' = 'verified' AND o ->> 'status' IS DISTINCT FROM 'verified' THEN
    event := 'auth.mfa.factor_verified';
  ELSIF TG_OP = 'DELETE' AND o ->> 'status' = 'verified' THEN
    event := 'auth.mfa.factor_removed';
  ELSE
    RETURN NULL;
  END IF;
  INSERT INTO private.audit_log (user_id, action, outcome, metadata)
  VALUES ((row_data ->> 'user_id')::uuid, event, 'success',
          jsonb_build_object('factor_id', row_data ->> 'id', 'factor_type', row_data ->> 'factor_type'));
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.record_mfa_factor_event() FROM PUBLIC, anon, authenticated;

-- Last, factors before sessions, the order Auth locks them in verify and
-- unenroll. Each takes SHARE ROW EXCLUSIVE (reads go on) under lock_timeout; a
-- request that still crosses the migration is aborted by the deadlock
-- detector on one side, and a failed deploy is re-run. No column list and no
-- WHEN: those would make an Auth migration that changes status or aal fail on
-- a dependency.
CREATE TRIGGER record_mfa_factor_event
  AFTER DELETE OR UPDATE ON auth.mfa_factors
  FOR EACH ROW EXECUTE FUNCTION private.record_mfa_factor_event();

CREATE TRIGGER record_session_change
  AFTER DELETE OR UPDATE ON auth.sessions
  FOR EACH ROW EXECUTE FUNCTION private.record_session_event();
