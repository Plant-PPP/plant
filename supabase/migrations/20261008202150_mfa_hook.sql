SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- The role an enrolled user's aal1 token gets instead of authenticated
-- (custom_access_token_hook). It holds no grant, so PostgREST answers 42501 on
-- every table, view and function, and Storage and Realtime refuse it too. Roles
-- are cluster-wide, hence the guard. NOINHERIT: a later grant of another role to
-- it gives nothing without SET ROLE. PostgREST switches to it through
-- authenticator, like authenticated, with the same statement timeout.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated_aal1') THEN
    CREATE ROLE authenticated_aal1 NOLOGIN NOINHERIT;
  END IF;
END
$$;

GRANT authenticated_aal1 TO authenticator;
ALTER ROLE authenticated_aal1 SET statement_timeout = '8s';

-- Supabase Auth calls this before it issues every access token (sign-in,
-- refresh, MFA verify), as supabase_auth_admin, inside its own transaction and
-- with a 2 s timeout: an error here fails the sign-in or refresh. It adds
-- mfa_enrolled (a JSON boolean: any verified factor, of any type) and demotes an
-- enrolled user's token below aal2. The rule is the truth table in
-- supabase/tests/mfa_gate_test.sql. Only an authenticated role is rewritten, so
-- anon and service_role tokens keep theirs.
CREATE FUNCTION private.custom_access_token_hook(event jsonb)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path = ''
  AS $$
  SELECT jsonb_set(
    event,
    '{claims}',
    event->'claims'
      || jsonb_build_object('mfa_enrolled', f.enrolled)
      || CASE
           WHEN f.enrolled
                AND event->'claims'->>'aal' IS DISTINCT FROM 'aal2'
                AND event->'claims'->>'role' = 'authenticated'
           THEN jsonb_build_object('role', 'authenticated_aal1')
           ELSE '{}'::jsonb
         END
  )
  FROM (
    SELECT EXISTS (
      SELECT 1 FROM auth.mfa_factors m
      WHERE m.user_id = (event->>'user_id')::uuid AND m.status = 'verified'
    ) AS enrolled
  ) f
$$;

REVOKE ALL ON FUNCTION private.custom_access_token_hook(jsonb)
  FROM PUBLIC, anon, authenticated, authenticated_aal1;
GRANT USAGE ON SCHEMA private TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.custom_access_token_hook(jsonb) TO supabase_auth_admin;
