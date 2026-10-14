-- Account API keys and syncs: what each role holds, that authenticated never
-- reads a sealed key, that each user reads, adds and deletes only their own,
-- on their own open account, and that a sync starts only on an account with a
-- key of that exchange, one at a time, past the month's quota.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(23);

-- The SQLSTATE a statement raises, or NULL if it succeeds.
CREATE FUNCTION pg_temp.error_of(statement text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE statement;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$f$;

-- The privileges a role holds on a table and its columns.
CREATE FUNCTION pg_temp.acl(rel regclass, role regrole) RETURNS SETOF text LANGUAGE sql AS $f$
  SELECT '(table):' || acl.privilege_type
  FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl
  WHERE c.oid = rel AND acl.grantee = role
  UNION ALL
  SELECT a.attname || ':' || acl.privilege_type
  FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl
  WHERE a.attrelid = rel AND acl.grantee = role
$f$;

GRANT EXECUTE ON FUNCTION pg_temp.error_of(text) TO authenticated;

-- A sealed key's shape, made up.
CREATE FUNCTION pg_temp.sealed() RETURNS text LANGUAGE sql AS $f$
  SELECT 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB.CCCCCCCC'
$f$;
GRANT EXECUTE ON FUNCTION pg_temp.sealed() TO authenticated;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at)
VALUES
  ('a0000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ana@pgtap.invalid', '', now(), '{}', '{}', now(), now()),
  ('b0000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'beto@pgtap.invalid', '', now(), '{}', '{}', now(), now());

-- Each has a Binance account; Ana also an archived one.
INSERT INTO public.source_connections (id, user_id, institution, default_portfolio_id)
SELECT CASE user_id WHEN 'a0000000-0000-4000-8000-00000000000a'
                    THEN 'a5000000-0000-4000-8000-0000000000a5'::uuid
                    ELSE 'b5000000-0000-4000-8000-0000000000b5'::uuid END,
       user_id, 'Binance', id
FROM public.portfolios
WHERE user_id IN ('a0000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-00000000000b');
INSERT INTO public.source_connections (id, user_id, institution, default_portfolio_id, archived_at)
SELECT 'a6000000-0000-4000-8000-0000000000a6', user_id, 'Binance viejo', id, now()
FROM public.portfolios WHERE user_id = 'a0000000-0000-4000-8000-00000000000a';

-- Beto connected his.
INSERT INTO public.account_api_keys (user_id, source_connection_id, provider, key_hint, secret_ciphertext)
VALUES ('b0000000-0000-4000-8000-00000000000b', 'b5000000-0000-4000-8000-0000000000b5',
        'binance', 'BETO', pg_temp.sealed());

-- ── What the API roles hold ─────────────────────────────────────────────────
SELECT set_eq(
  $$ SELECT pg_temp.acl('public.account_api_keys', 'authenticated') $$,
  ARRAY['(table):DELETE', 'id:SELECT', 'user_id:SELECT', 'source_connection_id:SELECT',
        'provider:SELECT', 'key_hint:SELECT', 'created_at:SELECT',
        'source_connection_id:INSERT', 'provider:INSERT', 'key_hint:INSERT',
        'secret_ciphertext:INSERT', 'provider:UPDATE', 'key_hint:UPDATE',
        'secret_ciphertext:UPDATE'],
  'a user reads every column of a key but the sealed one, adds, replaces and deletes one, never moving it'
);

SELECT ok(
  NOT has_column_privilege('authenticated', 'public.account_api_keys', 'secret_ciphertext', 'SELECT'),
  'authenticated never reads a sealed key'
);

SELECT set_eq(
  $$ SELECT pg_temp.acl('public.account_api_keys', 'service_role') $$,
  ARRAY['user_id:SELECT', 'source_connection_id:SELECT', 'provider:SELECT',
        'secret_ciphertext:SELECT'],
  'the import job only reads the sealed key of an account'
);

SELECT is_empty(
  $$ SELECT pg_temp.acl('public.account_api_keys', 'anon')
     UNION ALL SELECT acl.privilege_type FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl
     WHERE c.oid = 'public.account_api_keys'::regclass AND acl.grantee = 0 $$,
  'anon and PUBLIC hold nothing on account keys'
);

SELECT ok(
  has_column_privilege('authenticated', 'public.imports', 'source_connection_id', 'INSERT')
    AND has_column_privilege('authenticated', 'public.imports', 'provider', 'INSERT')
    AND NOT has_column_privilege('authenticated', 'public.imports', 'user_id', 'INSERT'),
  'a user starts a sync naming its account and exchange, never its owner'
);

-- ── Signed in as Ana ────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.error_of($$ SELECT secret_ciphertext FROM public.account_api_keys $$),
  '42501',
  'a user cannot read a sealed key, their own included'
);

SELECT is_empty(
  $$ SELECT id FROM public.account_api_keys $$,
  'a user reads no other user''s key'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.imports (source_connection_id, provider)
                      VALUES ('a5000000-0000-4000-8000-0000000000a5', 'binance') $$),
  'PT404',
  'a sync does not start on an account with no key'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.account_api_keys (source_connection_id, provider, key_hint, secret_ciphertext)
                      VALUES ('a5000000-0000-4000-8000-0000000000a5', 'binance', 'ANA1', pg_temp.sealed()) $$),
  NULL,
  'a user connects a key to their own account'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.account_api_keys (source_connection_id, provider, key_hint, secret_ciphertext)
                      VALUES ('a5000000-0000-4000-8000-0000000000a5', 'binance', 'ANA2', pg_temp.sealed()) $$),
  '23505',
  'an account holds one key'
);

UPDATE public.account_api_keys SET key_hint = 'ANA5', secret_ciphertext = pg_temp.sealed();

SELECT results_eq(
  $$ SELECT key_hint FROM public.account_api_keys $$,
  $$ VALUES ('ANA5') $$,
  'a user replaces their own key in place'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.account_api_keys SET source_connection_id = 'b5000000-0000-4000-8000-0000000000b5' $$),
  '42501',
  'a user never moves a key to another account'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.account_api_keys (source_connection_id, provider, key_hint, secret_ciphertext)
                      VALUES ('b5000000-0000-4000-8000-0000000000b5', 'binance', 'ANA3', pg_temp.sealed()) $$),
  '23503',
  'a user cannot connect a key to another user''s account'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.account_api_keys (source_connection_id, provider, key_hint, secret_ciphertext)
                      VALUES ('a6000000-0000-4000-8000-0000000000a6', 'binance', 'ANA4', 'the secret itself') $$),
  '23514',
  'only a sealed key is stored'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.imports (source_connection_id, provider)
                      VALUES ('a5000000-0000-4000-8000-0000000000a5', 'binance') $$),
  NULL,
  'a sync starts on an account with a key of that exchange'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.imports (source_connection_id, provider)
                      VALUES ('a5000000-0000-4000-8000-0000000000a5', 'binance') $$),
  'PT409',
  'one sync at a time per account'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.imports (source_connection_id, provider)
                      VALUES ('b5000000-0000-4000-8000-0000000000b5', 'binance') $$),
  'PT404',
  'a user cannot sync another user''s account'
);

DELETE FROM public.account_api_keys;

RESET ROLE;

-- Past the sync guard, which refuses it first.
ALTER TABLE public.imports DISABLE TRIGGER imports_guard_sync;
SELECT is(
  pg_temp.error_of($$ INSERT INTO public.imports (user_id, provider)
                      VALUES ('a0000000-0000-4000-8000-00000000000a', 'binance') $$),
  '23514',
  'an import reads a document or an account'
);
ALTER TABLE public.imports ENABLE TRIGGER imports_guard_sync;

SELECT results_eq(
  $$ SELECT user_id::text, key_hint FROM public.account_api_keys $$,
  $$ VALUES ('b0000000-0000-4000-8000-00000000000b', 'BETO') $$,
  'deleting removes only the user''s own key'
);

SELECT is(
  (SELECT count(*)::int FROM private.import_requests
   WHERE user_id = 'a0000000-0000-4000-8000-00000000000a'),
  0,
  'a sync counts against no month''s quota'
);

-- ── An archived account ─────────────────────────────────────────────────────
INSERT INTO public.account_api_keys (user_id, source_connection_id, provider, key_hint, secret_ciphertext)
VALUES ('a0000000-0000-4000-8000-00000000000a', 'a6000000-0000-4000-8000-0000000000a6',
        'binance', 'OLD1', pg_temp.sealed());

SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.imports (source_connection_id, provider)
                      VALUES ('a6000000-0000-4000-8000-0000000000a6', 'binance') $$),
  'PT404',
  'an archived account does not sync'
);

RESET ROLE;

-- ── Enrolled in MFA but signed in at aal1 ───────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'b0000000-0000-4000-8000-00000000000b', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', true)::text, true);
SET LOCAL ROLE authenticated;

SELECT is_empty(
  $$ SELECT id FROM public.account_api_keys $$,
  'a user enrolled in MFA reads no key before the second factor'
);

RESET ROLE;

-- ── An account's key goes with it ───────────────────────────────────────────
DELETE FROM public.source_connections WHERE id = 'a6000000-0000-4000-8000-0000000000a6';

SELECT is(
  (SELECT count(*)::int FROM public.account_api_keys
   WHERE user_id = 'a0000000-0000-4000-8000-00000000000a'),
  0,
  'deleting an account removes its key'
);

SELECT * FROM finish();
ROLLBACK;
