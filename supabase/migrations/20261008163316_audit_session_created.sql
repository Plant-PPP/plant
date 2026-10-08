SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- Closed, extend-only vocabularies: a new value is ALTER TYPE … ADD VALUE, never a rename.
CREATE TYPE private.audit_action AS ENUM ('auth.session.created');
CREATE TYPE private.audit_outcome AS ENUM ('success', 'failure', 'denied');

ALTER TABLE private.audit_log DROP CONSTRAINT audit_log_action_check;
-- Nothing has written to audit_log yet, so the rewrite is of an empty table.
-- squawk-ignore changing-column-type
ALTER TABLE private.audit_log ALTER COLUMN action TYPE private.audit_action USING action::private.audit_action;
-- No default: every writer states its outcome. The table is empty.
-- squawk-ignore adding-required-field
ALTER TABLE private.audit_log ADD COLUMN outcome private.audit_outcome NOT NULL;

-- Auth inserts one auth.sessions row per new session: every sign-in (code, mail
-- link, Google) and also recovery, email change and identity linking; a
-- refresh updates it. SECURITY DEFINER because the trigger fires as Auth's role,
-- which holds nothing on private.audit_log. The insert runs in Auth's
-- transaction: if it fails, the sign-in fails, so a later change to audit_log
-- must keep this insert valid. aal goes through to_jsonb so a column Auth
-- renames cannot break sign-in.
CREATE FUNCTION private.record_session_created()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  AS $$
BEGIN
  INSERT INTO private.audit_log (user_id, action, outcome, metadata)
  VALUES (NEW.user_id, 'auth.session.created', 'success',
          jsonb_build_object('session_id', NEW.id, 'aal', to_jsonb(NEW) ->> 'aal'));
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.record_session_created() FROM PUBLIC, anon, authenticated;

-- Last, and under lock_timeout: it locks auth.sessions against sign-ins and
-- refreshes until this commits, so a busy table fails the migration fast.
CREATE TRIGGER record_session_created
  AFTER INSERT ON auth.sessions
  FOR EACH ROW EXECUTE FUNCTION private.record_session_created();
