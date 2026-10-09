SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- Nothing in this transaction uses the new values: plpgsql resolves the casts
-- below when a trigger fires.
ALTER TYPE private.audit_action ADD VALUE 'auth.session.deleted' AFTER 'auth.session.created';
ALTER TYPE private.audit_action ADD VALUE 'auth.mfa.verified' AFTER 'auth.session.deleted';
ALTER TYPE private.audit_action ADD VALUE 'auth.mfa.factor_verified' AFTER 'auth.mfa.verified';
ALTER TYPE private.audit_action ADD VALUE 'auth.mfa.factor_removed' AFTER 'auth.mfa.factor_verified';

-- The INSERT trigger record_session_created follows the function's OID.
ALTER FUNCTION private.record_session_created() RENAME TO record_session_event;

-- One row per session created, raised to aal2 or deleted. Auth's own
-- transaction runs the insert, so a failing insert fails the sign-in, sign-out,
-- TOTP verify, user deletion or session cleanup that fired it. id and user_id
-- are read as columns, so an Auth rename of either fails Auth's write rather
-- than writing an ownerless row; aal goes through to_jsonb, so a rename of it
-- only stops the auth.mfa.verified row. n and o hold the whole session,
-- refresh_token_hmac_key included: only the keys below may leave this function.
-- A DELETE covers sign-out in any scope, the aal1 sessions a TOTP verify
-- deletes, user deletion and Auth's cleanup, without telling them apart; a
-- TRUNCATE fires no row trigger.
CREATE OR REPLACE FUNCTION private.record_session_event()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  AS $$
DECLARE
  session auth.sessions := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  n jsonb := to_jsonb(NEW);
  o jsonb := to_jsonb(OLD);
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
  VALUES (session.user_id, event, 'success',
          jsonb_build_object('session_id', session.id, 'aal', coalesce(n, o) ->> 'aal'));
  RETURN NULL;
END;
$$;

-- One row per factor verified or verified factor removed, with id and user_id
-- read as columns like the session's. n and o hold the factor's secret: only
-- its id and type leave this function. A recovery-code factor is inserted
-- already verified, so it would get a removal row and no verified row; those
-- factors are off.
CREATE FUNCTION private.record_mfa_factor_event()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  AS $$
DECLARE
  factor auth.mfa_factors := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  n jsonb := to_jsonb(NEW);
  o jsonb := to_jsonb(OLD);
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
  VALUES (factor.user_id, event, 'success',
          jsonb_build_object('factor_id', factor.id, 'factor_type', coalesce(n, o) ->> 'factor_type'));
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.record_mfa_factor_event() FROM PUBLIC, anon, authenticated;

-- Last, factors before sessions, the order Auth locks them in unenroll and a
-- first verify; a verify of an already verified factor locks sessions first.
-- Each takes SHARE ROW EXCLUSIVE (reads go on) under lock_timeout; a request
-- that crosses the migration in the other order deadlocks, and Postgres aborts
-- one side: that request once, or the deploy, which is re-run. No column list and no
-- WHEN: those would make an Auth migration that changes status or aal fail on
-- a dependency.
CREATE TRIGGER record_mfa_factor_event
  AFTER DELETE OR UPDATE ON auth.mfa_factors
  FOR EACH ROW EXECUTE FUNCTION private.record_mfa_factor_event();

CREATE TRIGGER record_session_change
  AFTER DELETE OR UPDATE ON auth.sessions
  FOR EACH ROW EXECUTE FUNCTION private.record_session_event();
