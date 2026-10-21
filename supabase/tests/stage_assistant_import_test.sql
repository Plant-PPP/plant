-- stage_assistant_import: a signed-in user stages a ready import of an open
-- account of theirs with the rows the assistant proposed; never in another
-- user's account, an archived one, or with a bad draft or row count. An
-- exchange sync still needs its key.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(9);

CREATE FUNCTION pg_temp.error_of(statement text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE statement;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$f$;

GRANT EXECUTE ON FUNCTION pg_temp.error_of(text) TO authenticated;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at)
VALUES
  ('a0000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ana@pgtap.invalid', '', now(), '{}', '{}', now(), now()),
  ('b0000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'beto@pgtap.invalid', '', now(), '{}', '{}', now(), now());

INSERT INTO public.source_connections (id, user_id, institution, default_portfolio_id)
SELECT 'a5000000-0000-4000-8000-0000000000a5', p.user_id, 'Nexo', p.id
FROM public.portfolios p WHERE p.user_id = 'a0000000-0000-4000-8000-00000000000a';
INSERT INTO public.source_connections (id, user_id, institution, default_portfolio_id, archived_at)
SELECT 'a5100000-0000-4000-8000-0000000000a5', p.user_id, 'Roxom', p.id, now()
FROM public.portfolios p WHERE p.user_id = 'a0000000-0000-4000-8000-00000000000a';
INSERT INTO public.source_connections (id, user_id, institution, default_portfolio_id)
SELECT 'b5000000-0000-4000-8000-0000000000b5', p.user_id, 'Nexo', p.id
FROM public.portfolios p WHERE p.user_id = 'b0000000-0000-4000-8000-00000000000b';

SELECT ok(
  has_function_privilege('authenticated', 'public.stage_assistant_import(uuid,text,jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.stage_assistant_import(uuid,text,jsonb)', 'EXECUTE')
    AND (SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""']
         FROM pg_proc p WHERE p.oid = 'public.stage_assistant_import(uuid,text,jsonb)'::regprocedure),
  'stage_assistant_import is a definer a signed-in user executes, with an empty search_path'
);

-- ── Signed in as Ana ────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

CREATE TEMP TABLE staged ON COMMIT DROP AS
SELECT public.stage_assistant_import('a5000000-0000-4000-8000-0000000000a5', 'holdings',
  '[{"symbol":"BTC","quantity":"0.05","currency":"USD","asset_class":"instrument","price":null,"cost":null,"user_id":"b0000000-0000-4000-8000-00000000000b"},
    {"symbol":"USD","quantity":"500","currency":"USD","asset_class":"cash","price":null,"cost":null}]') AS id;

SELECT results_eq(
  $$ SELECT status::text, provider, sync_draft, user_id::text FROM public.imports WHERE id = (SELECT id FROM staged) $$,
  $$ VALUES ('ready', 'assistant', 'holdings', 'a0000000-0000-4000-8000-00000000000a') $$,
  'it stages a ready holdings import of the caller'
);

SELECT results_eq(
  $$ SELECT position::int, symbol, asset_class::text, user_id::text FROM public.import_items
     WHERE import_id = (SELECT id FROM staged) ORDER BY position $$,
  $$ VALUES (0, 'BTC', 'instrument', 'a0000000-0000-4000-8000-00000000000a'),
            (1, 'USD', 'cash', 'a0000000-0000-4000-8000-00000000000a') $$,
  'its rows are the caller''s, in order, whatever user a row names'
);

CREATE TEMP TABLE staged_operations ON COMMIT DROP AS
SELECT public.stage_assistant_import('a5000000-0000-4000-8000-0000000000a5', 'operations',
  '[{"date":"2026-10-21","kind":"purchase","symbol":"BTC","quantity":"0.1","price":"84000","amount":null,"charges":null,"currency":"USD"}]') AS id;

SELECT results_eq(
  $$ SELECT kind::text, symbol FROM public.import_operations
     WHERE import_id = (SELECT id FROM staged_operations) $$,
  $$ VALUES ('purchase', 'BTC') $$,
  'it stages operations too'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.stage_assistant_import('b5000000-0000-4000-8000-0000000000b5', 'holdings',
    '[{"symbol":"BTC","quantity":"1","currency":"USD"}]') $$),
  'PT404',
  'never in another user''s account'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.stage_assistant_import('a5100000-0000-4000-8000-0000000000a5', 'holdings',
    '[{"symbol":"BTC","quantity":"1","currency":"USD"}]') $$),
  'PT404',
  'never in an archived account'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.stage_assistant_import('a5000000-0000-4000-8000-0000000000a5', 'debts',
    '[{"symbol":"BTC","quantity":"1","currency":"USD"}]') $$),
  '22023',
  'only holdings or operations'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.stage_assistant_import('a5000000-0000-4000-8000-0000000000a5', 'holdings', '[]') $$),
  '22023',
  'at least one row'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.imports (source_connection_id, provider, sync_draft)
    VALUES ('a5000000-0000-4000-8000-0000000000a5', 'binance', 'holdings') $$),
  'PT404',
  'an exchange sync still needs its key'
);

SELECT * FROM finish();
ROLLBACK;
