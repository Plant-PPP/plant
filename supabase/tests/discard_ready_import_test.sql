-- Discarding or cancelling an import: a user fails their own ready import or
-- one still being read, never another user's, and never a confirmed one.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(5);

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
SELECT CASE user_id WHEN 'a0000000-0000-4000-8000-00000000000a'
                    THEN 'a5000000-0000-4000-8000-0000000000a5'::uuid
                    ELSE 'b5000000-0000-4000-8000-0000000000b5'::uuid END,
       user_id, 'Binance', id
FROM public.portfolios
WHERE user_id IN ('a0000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-00000000000b');

-- Made-up credentials, so each account may sync.
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'b0000000-0000-4000-8000-00000000000b', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;
INSERT INTO public.account_api_keys (source_connection_id, provider, key_hint, credentials)
VALUES ('b5000000-0000-4000-8000-0000000000b5', 'binance', 'BETO',
        '{"apiKey": "BetoKey000000001", "apiSecret": "BetoSecret000001"}');
RESET ROLE;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;
INSERT INTO public.account_api_keys (source_connection_id, provider, key_hint, credentials)
VALUES ('a5000000-0000-4000-8000-0000000000a5', 'binance', 'ANA1',
        '{"apiKey": "AnaKey0000000001", "apiSecret": "AnaSecret0000001"}');
RESET ROLE;

-- Ana has a ready, a confirmed and a reading sync (last: an account syncs
-- one at a time); Beto a ready one.
INSERT INTO public.imports (id, user_id, source_connection_id, provider, sync_draft, status)
VALUES ('a9000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-00000000000a',
        'a5000000-0000-4000-8000-0000000000a5', 'binance', 'holdings', 'ready'),
       ('a9000000-0000-4000-8000-0000000000a3', 'a0000000-0000-4000-8000-00000000000a',
        'a5000000-0000-4000-8000-0000000000a5', 'binance', 'holdings', 'confirmed'),
       ('b9000000-0000-4000-8000-0000000000b1', 'b0000000-0000-4000-8000-00000000000b',
        'b5000000-0000-4000-8000-0000000000b5', 'binance', 'holdings', 'ready'),
       ('a9000000-0000-4000-8000-0000000000a2', 'a0000000-0000-4000-8000-00000000000a',
        'a5000000-0000-4000-8000-0000000000a5', 'binance', 'holdings', 'reading');

SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.error_of($$ UPDATE public.imports SET status = 'failed'
                      WHERE id = 'a9000000-0000-4000-8000-0000000000a1' $$),
  NULL,
  'a user discards their own ready import'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.imports SET status = 'failed'
                      WHERE id = 'a9000000-0000-4000-8000-0000000000a2' $$),
  NULL,
  'and cancels one still being read'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.imports SET status = 'failed'
                      WHERE id = 'a9000000-0000-4000-8000-0000000000a3' $$),
  '42501',
  'nor a confirmed one'
);

UPDATE public.imports SET status = 'failed'
WHERE id = 'b9000000-0000-4000-8000-0000000000b1';

RESET ROLE;

SELECT results_eq(
  $$ SELECT status::text, failure::text FROM public.imports
     WHERE id = 'a9000000-0000-4000-8000-0000000000a1' $$,
  $$ VALUES ('failed', NULL::text) $$,
  'the discarded import is failed with no failure'
);

SELECT is(
  (SELECT status::text FROM public.imports WHERE id = 'b9000000-0000-4000-8000-0000000000b1'),
  'ready',
  'another user''s ready import stays as it was'
);

SELECT * FROM finish();
ROLLBACK;
