-- Account API keys and syncs: what each role holds; that credentials go to
-- Supabase Vault, never stay in the row, and are written only for an open
-- account of the caller's; that authenticated never reads Vault, and only
-- service_role reads one account's credentials back; that each user reads,
-- replaces and deletes only their own key, its Vault secret with it; and that
-- a sync starts only on an account with a key of that provider, one at a
-- time, past the month's quota.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(43);

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

-- Signs in as a user, at aal1 with no second factor enrolled.
CREATE FUNCTION pg_temp.sign_in(sub text) RETURNS void LANGUAGE sql AS $f$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', sub, 'role', 'authenticated', 'aal', 'aal1',
                      'mfa_enrolled', false)::text, true);
$f$;

GRANT EXECUTE ON FUNCTION pg_temp.error_of(text) TO authenticated, service_role;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at)
VALUES
  ('a0000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ana@pgtap.invalid', '', now(), '{}', '{}', now(), now()),
  ('b0000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'beto@pgtap.invalid', '', now(), '{}', '{}', now(), now());

-- Each has a Binance account; Ana also one she archives below.
INSERT INTO public.source_connections (id, user_id, institution, default_portfolio_id)
SELECT CASE user_id WHEN 'a0000000-0000-4000-8000-00000000000a'
                    THEN 'a5000000-0000-4000-8000-0000000000a5'::uuid
                    ELSE 'b5000000-0000-4000-8000-0000000000b5'::uuid END,
       user_id, 'Binance', id
FROM public.portfolios
WHERE user_id IN ('a0000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-00000000000b');
INSERT INTO public.source_connections (id, user_id, institution, default_portfolio_id)
SELECT 'a6000000-0000-4000-8000-0000000000a6', user_id, 'Binance viejo', id
FROM public.portfolios WHERE user_id = 'a0000000-0000-4000-8000-00000000000a';

-- Beto connects his, and Ana her second account's before archiving it.
-- Made-up credentials.
SELECT pg_temp.sign_in('b0000000-0000-4000-8000-00000000000b');
SET LOCAL ROLE authenticated;
INSERT INTO public.account_api_keys (source_connection_id, provider, key_hint, credentials)
VALUES ('b5000000-0000-4000-8000-0000000000b5', 'binance', 'BETO',
        '{"apiKey": "BetoKey000000001", "apiSecret": "BetoSecret000001"}');
RESET ROLE;
SELECT pg_temp.sign_in('a0000000-0000-4000-8000-00000000000a');
SET LOCAL ROLE authenticated;
INSERT INTO public.account_api_keys (source_connection_id, provider, key_hint, credentials)
VALUES ('a6000000-0000-4000-8000-0000000000a6', 'binance', 'OLD1',
        '{"apiKey": "AnaOldKey0000001", "apiSecret": "AnaOldSecret0001"}');
RESET ROLE;
UPDATE public.source_connections SET archived_at = now()
WHERE id = 'a6000000-0000-4000-8000-0000000000a6';

-- ── What the API roles hold ─────────────────────────────────────────────────
SELECT set_eq(
  $$ SELECT pg_temp.acl('public.account_api_keys', 'authenticated') $$,
  ARRAY['(table):DELETE', 'id:SELECT', 'user_id:SELECT', 'source_connection_id:SELECT',
        'provider:SELECT', 'key_hint:SELECT', 'created_at:SELECT',
        'source_connection_id:INSERT', 'provider:INSERT', 'key_hint:INSERT',
        'credentials:INSERT', 'provider:UPDATE', 'key_hint:UPDATE', 'credentials:UPDATE'],
  'a user reads a key''s provider and hint, writes its credentials, replaces and deletes it, never moving it'
);

SELECT ok(
  NOT has_column_privilege('authenticated', 'public.account_api_keys', 'credentials', 'SELECT')
    AND NOT has_column_privilege('authenticated', 'public.account_api_keys', 'vault_secret', 'SELECT')
    AND NOT has_column_privilege('authenticated', 'public.account_api_keys', 'vault_secret', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.account_api_keys', 'secret_ciphertext', 'SELECT')
    AND NOT has_column_privilege('authenticated', 'public.account_api_keys', 'secret_ciphertext', 'INSERT'),
  'authenticated never reads credentials or which Vault secret holds them'
);

SELECT set_eq(
  $$ SELECT pg_temp.acl('public.account_api_keys', 'service_role') $$,
  ARRAY['user_id:SELECT', 'source_connection_id:SELECT', 'provider:SELECT'],
  'the import job reads which provider an account holds a key of, and its credentials only through account_credentials'
);

SELECT is_empty(
  $$ SELECT pg_temp.acl('public.account_api_keys', 'anon')
     UNION ALL SELECT acl.privilege_type FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl
     WHERE c.oid = 'public.account_api_keys'::regclass AND acl.grantee = 0 $$,
  'anon and PUBLIC hold nothing on account keys'
);

SELECT ok(
  NOT has_schema_privilege('authenticated', 'vault', 'USAGE')
    AND NOT has_schema_privilege('anon', 'vault', 'USAGE')
    AND NOT has_table_privilege('authenticated', 'vault.decrypted_secrets', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'vault.secrets', 'SELECT'),
  'neither authenticated nor anon can use Vault'
);

SELECT ok(
  (SELECT p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=""']
   FROM pg_proc p WHERE p.oid = 'public.account_credentials(uuid,uuid,text)'::regprocedure)
    AND has_function_privilege('service_role', 'public.account_credentials(uuid,uuid,text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.account_credentials(uuid,uuid,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.account_credentials(uuid,uuid,text)', 'EXECUTE'),
  'account_credentials is a stable definer only service_role executes, with an empty search_path'
);

SELECT ok(
  has_column_privilege('authenticated', 'public.imports', 'source_connection_id', 'INSERT')
    AND has_column_privilege('authenticated', 'public.imports', 'provider', 'INSERT')
    AND has_column_privilege('authenticated', 'public.imports', 'sync_draft', 'INSERT')
    AND has_column_privilege('authenticated', 'public.imports', 'sync_from', 'INSERT')
    AND has_column_privilege('authenticated', 'public.imports', 'sync_to', 'INSERT')
    AND NOT has_column_privilege('authenticated', 'public.imports', 'user_id', 'INSERT'),
  'a user starts a sync naming its account, provider, draft and period, never its owner'
);

-- ── Signed in as Ana ────────────────────────────────────────────────────────
SELECT pg_temp.sign_in('a0000000-0000-4000-8000-00000000000a');
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.error_of($$ SELECT decrypted_secret FROM vault.decrypted_secrets $$),
  '42501',
  'a user cannot read Vault'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.account_credentials('b0000000-0000-4000-8000-00000000000b',
                        'b5000000-0000-4000-8000-0000000000b5', 'binance') $$),
  '42501',
  'a user cannot read anyone''s credentials back, through the job''s function either'
);

SELECT results_eq(
  $$ SELECT key_hint FROM public.account_api_keys $$,
  $$ VALUES ('OLD1') $$,
  'a user reads only their own keys'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.imports (source_connection_id, provider)
                      VALUES ('a5000000-0000-4000-8000-0000000000a5', 'binance') $$),
  'PT404',
  'a sync does not start on an account with no key'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.account_api_keys (source_connection_id, provider, key_hint, credentials)
                      VALUES ('a5000000-0000-4000-8000-0000000000a5', 'binance', 'ANA1',
                              '{"apiKey": "AnaKey0000000001", "apiSecret": "AnaSecret0000001"}') $$),
  NULL,
  'a user connects a key to their own account'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.account_api_keys (source_connection_id, provider, key_hint, credentials)
                      VALUES ('a5000000-0000-4000-8000-0000000000a5', 'binance', 'ANA2', '{"apiKey": "x"}') $$),
  '23505',
  'an account holds one key'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.account_api_keys (source_connection_id, provider, key_hint)
                      VALUES ('a5000000-0000-4000-8000-0000000000a5', 'binance', 'ANA3') $$),
  '22023',
  'a key needs its credentials'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.account_api_keys (source_connection_id, provider, key_hint, credentials)
                      VALUES ('b5000000-0000-4000-8000-0000000000b5', 'binance', 'ANA4', '{"apiKey": "x"}') $$),
  '42501',
  'a user cannot store credentials for another user''s account'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.account_api_keys SET credentials = '{"apiKey": "x"}'
                      WHERE source_connection_id = 'a6000000-0000-4000-8000-0000000000a6' $$),
  '42501',
  'nor for an archived account'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.account_api_keys SET key_hint = 'ANA5',
                        credentials = '{"apiKey": "AnaKey0000000002", "apiSecret": "AnaSecret0000002"}'
                      WHERE source_connection_id = 'a5000000-0000-4000-8000-0000000000a5' $$),
  NULL,
  'a user replaces their own key''s credentials'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.account_api_keys SET source_connection_id = 'b5000000-0000-4000-8000-0000000000b5' $$),
  '42501',
  'a user never moves a key to another account'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.imports (source_connection_id, provider, sync_draft, sync_from)
                      VALUES ('a5000000-0000-4000-8000-0000000000a5', 'binance', 'holdings', '2026-01-01') $$),
  '23514',
  'only a sync of operations reads a period'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.imports (source_connection_id, provider, sync_draft, sync_from, sync_to)
                      VALUES ('a5000000-0000-4000-8000-0000000000a5', 'binance', 'operations', '2026-02-01', '2026-01-01') $$),
  '23514',
  'a period never ends before it starts'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.imports (source_connection_id, provider, sync_draft, sync_from, sync_to)
                      VALUES ('a5000000-0000-4000-8000-0000000000a5', 'binance', 'operations', '2026-01-01', 'infinity') $$),
  '23514',
  'nor ends at infinity'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.imports (source_connection_id, provider, sync_draft, sync_to)
                      VALUES ('a5000000-0000-4000-8000-0000000000a5', 'binance', 'operations', '1999-12-31') $$),
  '23514',
  'nor ends before 2000'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.imports (source_connection_id, provider, sync_draft)
                      VALUES ('a5000000-0000-4000-8000-0000000000a5', 'binance', 'holdings') $$),
  NULL,
  'a sync starts on an account with a key of that provider'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.imports (source_connection_id, provider, sync_draft)
                      VALUES ('a5000000-0000-4000-8000-0000000000a5', 'binance', 'operations') $$),
  'PT409',
  'one sync at a time per account'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.imports SET status = 'reading'
                      WHERE source_connection_id = 'a5000000-0000-4000-8000-0000000000a5' $$),
  '42501',
  'a user does not start reading a queued sync'
);

RESET ROLE;
SELECT pg_temp.sign_in('b0000000-0000-4000-8000-00000000000b');
SET LOCAL ROLE authenticated;
UPDATE public.imports SET status = 'failed'
WHERE source_connection_id = 'a5000000-0000-4000-8000-0000000000a5';
RESET ROLE;
SELECT pg_temp.sign_in('a0000000-0000-4000-8000-00000000000a');
SET LOCAL ROLE authenticated;

SELECT results_eq(
  $$ SELECT status::text FROM public.imports
     WHERE source_connection_id = 'a5000000-0000-4000-8000-0000000000a5' $$,
  $$ VALUES ('queued') $$,
  'another user cannot fail a user''s queued sync'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.imports SET status = 'failed'
                      WHERE source_connection_id = 'a5000000-0000-4000-8000-0000000000a5'
                        AND status = 'queued' $$),
  NULL,
  'a user fails their own queued sync'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.imports (source_connection_id, provider, sync_draft)
                      VALUES ('a5000000-0000-4000-8000-0000000000a5', 'binance', 'operations') $$),
  NULL,
  'and then another sync starts on the account'
);

RESET ROLE;
UPDATE public.imports SET status = 'reading'
WHERE source_connection_id = 'a5000000-0000-4000-8000-0000000000a5' AND status = 'queued';
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.error_of($$ UPDATE public.imports SET status = 'failed'
                      WHERE source_connection_id = 'a5000000-0000-4000-8000-0000000000a5'
                        AND status = 'reading' $$),
  '42501',
  'but not a sync being read'
);

-- Beto's: Ana's file imports would count against her month's quota below.
RESET ROLE;
INSERT INTO public.uploaded_documents (id, user_id, source_connection_id, storage_path,
                                       file_name, mime_type, size_bytes, sha256)
VALUES ('b8000000-0000-4000-8000-0000000000f1', 'b0000000-0000-4000-8000-00000000000b',
        'b5000000-0000-4000-8000-0000000000b5',
        'b0000000-0000-4000-8000-00000000000b/imports/b8000000-0000-4000-8000-0000000000f1/b8000000-0000-4000-8000-0000000000f1',
        'resumen.pdf', 'application/pdf', 1024, repeat('f', 64));
INSERT INTO public.imports (id, user_id, document_id)
VALUES ('b9000000-0000-4000-8000-0000000000f1', 'b0000000-0000-4000-8000-00000000000b',
        'b8000000-0000-4000-8000-0000000000f1');
SELECT pg_temp.sign_in('b0000000-0000-4000-8000-00000000000b');
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.error_of($$ UPDATE public.imports SET status = 'failed'
                      WHERE id = 'b9000000-0000-4000-8000-0000000000f1'
                        AND status = 'queued' $$),
  '42501',
  'nor their own queued file import'
);

RESET ROLE;
SELECT pg_temp.sign_in('a0000000-0000-4000-8000-00000000000a');
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.imports (source_connection_id, provider)
                      VALUES ('b5000000-0000-4000-8000-0000000000b5', 'binance') $$),
  'PT404',
  'a user cannot sync another user''s account'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.imports (source_connection_id, provider)
                      VALUES ('a6000000-0000-4000-8000-0000000000a6', 'binance') $$),
  'PT404',
  'an archived account does not sync'
);

RESET ROLE;

-- ── In Vault, never in the row ──────────────────────────────────────────────
SELECT results_eq(
  $$ SELECT k.credentials IS NULL, k.vault_secret IS NOT NULL, d.decrypted_secret::jsonb
     FROM public.account_api_keys k JOIN vault.decrypted_secrets d ON d.id = k.vault_secret
     WHERE k.source_connection_id = 'a5000000-0000-4000-8000-0000000000a5' $$,
  $$ VALUES (true, true, '{"apiKey": "AnaKey0000000002", "apiSecret": "AnaSecret0000002"}'::jsonb) $$,
  'credentials are kept in Vault, the replacement in the same secret, and the row holds none'
);

SELECT is(
  (SELECT count(*)::int FROM vault.secrets s
   WHERE s.secret LIKE '%AnaKey0000000001%' OR s.secret LIKE '%AnaSecret%'),
  0,
  'Vault stores them encrypted'
);

SET LOCAL ROLE service_role;

SELECT is(
  public.account_credentials('a0000000-0000-4000-8000-00000000000a',
                             'a5000000-0000-4000-8000-0000000000a5', 'binance'),
  '{"apiKey": "AnaKey0000000002", "apiSecret": "AnaSecret0000002"}'::jsonb,
  'the job reads an account''s credentials for its user and provider'
);

SELECT ok(
  public.account_credentials('a0000000-0000-4000-8000-00000000000a',
                             'b5000000-0000-4000-8000-0000000000b5', 'binance') IS NULL
    AND public.account_credentials('b0000000-0000-4000-8000-00000000000b',
                                   'b5000000-0000-4000-8000-0000000000b5', 'wallbit') IS NULL,
  'and none for another user''s account or another provider'
);

RESET ROLE;

-- ── Deleting a key deletes its secret ───────────────────────────────────────
CREATE TEMP TABLE ana_secret AS
  SELECT vault_secret FROM public.account_api_keys
  WHERE source_connection_id = 'a5000000-0000-4000-8000-0000000000a5';

SELECT pg_temp.sign_in('a0000000-0000-4000-8000-00000000000a');
SET LOCAL ROLE authenticated;
DELETE FROM public.account_api_keys;
RESET ROLE;

SELECT results_eq(
  $$ SELECT user_id::text, key_hint FROM public.account_api_keys $$,
  $$ VALUES ('b0000000-0000-4000-8000-00000000000b', 'BETO') $$,
  'deleting removes only the user''s own keys'
);

SELECT ok(
  NOT EXISTS (SELECT 1 FROM vault.secrets s JOIN ana_secret a ON a.vault_secret = s.id)
    AND EXISTS (SELECT 1 FROM vault.secrets s JOIN public.account_api_keys k ON k.vault_secret = s.id),
  'a deleted key''s Vault secret goes with it, and no other'
);

-- Past the sync guard, which refuses it first.
ALTER TABLE public.imports DISABLE TRIGGER imports_guard_sync;
SELECT is(
  pg_temp.error_of($$ INSERT INTO public.imports (user_id, provider)
                      VALUES ('a0000000-0000-4000-8000-00000000000a', 'binance') $$),
  '23514',
  'an import reads a document or an account'
);
ALTER TABLE public.imports ENABLE TRIGGER imports_guard_sync;

SELECT is(
  (SELECT count(*)::int FROM private.import_requests
   WHERE user_id = 'a0000000-0000-4000-8000-00000000000a'),
  0,
  'a sync counts against no month''s quota'
);

-- ── Enrolled in MFA but signed in at aal1 ───────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'b0000000-0000-4000-8000-00000000000b', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', true)::text, true);
SET LOCAL ROLE authenticated;

SELECT is_empty(
  $$ SELECT id FROM public.account_api_keys $$,
  'a user enrolled in MFA reads no key before the second factor'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.account_api_keys (source_connection_id, provider, key_hint, credentials)
                      VALUES ('b5000000-0000-4000-8000-0000000000b5', 'wallbit', 'BET2', '{"apiKey": "x"}') $$),
  '42501',
  'nor writes credentials'
);

RESET ROLE;

-- ── An account's key goes with it ───────────────────────────────────────────
CREATE TEMP TABLE beto_secret AS SELECT vault_secret FROM public.account_api_keys;
DELETE FROM public.imports WHERE user_id = 'b0000000-0000-4000-8000-00000000000b';
DELETE FROM public.source_connections WHERE id = 'b5000000-0000-4000-8000-0000000000b5';

SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.account_api_keys)
    AND NOT EXISTS (SELECT 1 FROM vault.secrets s JOIN beto_secret b ON b.vault_secret = s.id),
  'deleting an account removes its key and its Vault secret'
);

SELECT * FROM finish();
ROLLBACK;
