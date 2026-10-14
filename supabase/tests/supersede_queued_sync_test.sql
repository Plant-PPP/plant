-- supersede_queued_sync: fails the caller's own queued sync of an account and
-- starts another in its place, both or neither; never another user's sync, nor
-- one being read.
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

CREATE FUNCTION pg_temp.sign_in(sub text) RETURNS void LANGUAGE sql AS $f$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', sub, 'role', 'authenticated', 'aal', 'aal1',
                      'mfa_enrolled', false)::text, true);
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
SELECT CASE user_id WHEN 'a0000000-0000-4000-8000-00000000000a'
                    THEN 'a5000000-0000-4000-8000-0000000000a5'::uuid
                    ELSE 'b5000000-0000-4000-8000-0000000000b5'::uuid END,
       user_id, 'Binance', id
FROM public.portfolios
WHERE user_id IN ('a0000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-00000000000b');

-- Made-up credentials; each user has a queued sync of holdings.
SELECT pg_temp.sign_in('b0000000-0000-4000-8000-00000000000b');
SET LOCAL ROLE authenticated;
INSERT INTO public.account_api_keys (source_connection_id, provider, key_hint, credentials)
VALUES ('b5000000-0000-4000-8000-0000000000b5', 'binance', 'BETO',
        '{"apiKey": "BetoKey000000001", "apiSecret": "BetoSecret000001"}');
RESET ROLE;
SELECT pg_temp.sign_in('a0000000-0000-4000-8000-00000000000a');
SET LOCAL ROLE authenticated;
INSERT INTO public.account_api_keys (source_connection_id, provider, key_hint, credentials)
VALUES ('a5000000-0000-4000-8000-0000000000a5', 'binance', 'ANA1',
        '{"apiKey": "AnaKey0000000001", "apiSecret": "AnaSecret0000001"}');
RESET ROLE;
INSERT INTO public.imports (id, user_id, source_connection_id, provider, sync_draft)
VALUES ('a9000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-00000000000a',
        'a5000000-0000-4000-8000-0000000000a5', 'binance', 'holdings'),
       ('b9000000-0000-4000-8000-0000000000b1', 'b0000000-0000-4000-8000-00000000000b',
        'b5000000-0000-4000-8000-0000000000b5', 'binance', 'holdings');

SELECT ok(
  has_function_privilege('authenticated',
      'public.supersede_queued_sync(uuid,uuid,text,text,date,date)', 'EXECUTE')
    AND NOT has_function_privilege('anon',
      'public.supersede_queued_sync(uuid,uuid,text,text,date,date)', 'EXECUTE')
    AND (SELECT NOT p.prosecdef AND p.proconfig = ARRAY['search_path=""']
         FROM pg_proc p
         WHERE p.oid = 'public.supersede_queued_sync(uuid,uuid,text,text,date,date)'::regprocedure),
  'supersede_queued_sync is an invoker only authenticated executes, with an empty search_path'
);

-- Ana names Beto's queued sync on her account and on his.
SELECT pg_temp.sign_in('a0000000-0000-4000-8000-00000000000a');
SET LOCAL ROLE authenticated;

SELECT is(
  public.supersede_queued_sync('b9000000-0000-4000-8000-0000000000b1',
    'b5000000-0000-4000-8000-0000000000b5', 'binance', 'operations', NULL, NULL),
  NULL,
  'another user''s queued sync is not superseded'
);

SELECT is(
  public.supersede_queued_sync('b9000000-0000-4000-8000-0000000000b1',
    'a5000000-0000-4000-8000-0000000000a5', 'binance', 'operations', NULL, NULL),
  NULL,
  'nor through the caller''s own account'
);

RESET ROLE;
SELECT results_eq(
  $$ SELECT id::text, status::text FROM public.imports
     WHERE user_id = 'b0000000-0000-4000-8000-00000000000b' $$,
  $$ VALUES ('b9000000-0000-4000-8000-0000000000b1', 'queued') $$,
  'Beto''s sync stays queued and alone'
);

-- Ana's key goes: the new sync is refused, and her queued one stays.
DELETE FROM public.account_api_keys WHERE source_connection_id = 'a5000000-0000-4000-8000-0000000000a5';
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.error_of($$ SELECT public.supersede_queued_sync('a9000000-0000-4000-8000-0000000000a1',
    'a5000000-0000-4000-8000-0000000000a5', 'binance', 'operations', NULL, NULL) $$),
  'PT404',
  'a new sync with no key is refused'
);

SELECT results_eq(
  $$ SELECT status::text FROM public.imports
     WHERE source_connection_id = 'a5000000-0000-4000-8000-0000000000a5' $$,
  $$ VALUES ('queued') $$,
  'and the queued sync is not failed for it'
);

RESET ROLE;
SELECT pg_temp.sign_in('a0000000-0000-4000-8000-00000000000a');
SET LOCAL ROLE authenticated;
INSERT INTO public.account_api_keys (source_connection_id, provider, key_hint, credentials)
VALUES ('a5000000-0000-4000-8000-0000000000a5', 'binance', 'ANA2',
        '{"apiKey": "AnaKey0000000002", "apiSecret": "AnaSecret0000002"}');

SELECT isnt(
  public.supersede_queued_sync('a9000000-0000-4000-8000-0000000000a1',
    'a5000000-0000-4000-8000-0000000000a5', 'binance', 'operations', '2026-01-01', NULL),
  NULL,
  'a user supersedes their own queued sync'
);

SELECT results_eq(
  $$ SELECT status::text, coalesce(sync_draft, ''), coalesce(sync_from::text, '')
     FROM public.imports
     WHERE source_connection_id = 'a5000000-0000-4000-8000-0000000000a5'
     ORDER BY status $$,
  $$ VALUES ('failed', 'holdings', ''), ('queued', 'operations', '2026-01-01') $$,
  'the queued sync failed and the one asked for queued'
);

-- The job starts reading the new one.
RESET ROLE;
UPDATE public.imports SET status = 'reading'
WHERE source_connection_id = 'a5000000-0000-4000-8000-0000000000a5' AND status = 'queued';
SET LOCAL ROLE authenticated;

SELECT is(
  public.supersede_queued_sync(
    (SELECT id FROM public.imports
     WHERE source_connection_id = 'a5000000-0000-4000-8000-0000000000a5' AND status = 'reading'),
    'a5000000-0000-4000-8000-0000000000a5', 'binance', 'holdings', NULL, NULL),
  NULL,
  'a sync being read is never superseded'
);

SELECT * FROM finish();
ROLLBACK;
