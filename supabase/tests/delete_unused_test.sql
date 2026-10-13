-- Deleting a portfolio or an account that was never used: no account defaults
-- to the portfolio and no holding, archived or closed included, ever sat in
-- either. The last active portfolio stays. An account's uploads go with it,
-- and the month's quota keeps counting them.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(25);

-- The hint a statement raises, or NULL if it succeeds.
CREATE FUNCTION pg_temp.hint_of(statement text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE hint text;
BEGIN
  EXECUTE statement;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS hint = PG_EXCEPTION_HINT;
  RETURN hint;
END
$f$;

GRANT EXECUTE ON FUNCTION pg_temp.hint_of(text) TO authenticated;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at)
VALUES
  ('a0000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ana@pgtap.invalid', '', now(), '{}', '{}', now(), now()),
  ('b0000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'beto@pgtap.invalid', '', now(), '{}', '{}', now(), now());

UPDATE public.portfolios SET id = 'a1000000-0000-4000-8000-0000000000a1'
WHERE user_id = 'a0000000-0000-4000-8000-00000000000a';
UPDATE public.portfolios SET id = 'b1000000-0000-4000-8000-0000000000b1'
WHERE user_id = 'b0000000-0000-4000-8000-00000000000b';

-- Ana: an unused portfolio, an unused archived one, one an archived account
-- defaults to and one an archived holding sits in.
INSERT INTO public.portfolios (id, user_id, name, archived_at) VALUES
  ('a2000000-0000-4000-8000-0000000000a2', 'a0000000-0000-4000-8000-00000000000a', 'Libre', NULL),
  ('a3000000-0000-4000-8000-0000000000a3', 'a0000000-0000-4000-8000-00000000000a', 'Vieja', now()),
  ('a4000000-0000-4000-8000-0000000000a4', 'a0000000-0000-4000-8000-00000000000a', 'Usada', NULL),
  ('a7000000-0000-4000-8000-0000000000a7', 'a0000000-0000-4000-8000-00000000000a', 'Con tenencias', NULL);

-- Ana: an account with an archived holding, an archived one with an upload,
-- and an unused active one.
INSERT INTO public.source_connections (id, user_id, institution, default_portfolio_id, archived_at) VALUES
  ('a5000000-0000-4000-8000-0000000000a5', 'a0000000-0000-4000-8000-00000000000a', 'IOL',
   'a1000000-0000-4000-8000-0000000000a1', NULL),
  ('a6000000-0000-4000-8000-0000000000a6', 'a0000000-0000-4000-8000-00000000000a', 'Balanz',
   'a4000000-0000-4000-8000-0000000000a4', now()),
  ('a8000000-0000-4000-8000-0000000000a8', 'a0000000-0000-4000-8000-00000000000a', 'Cocos',
   'a1000000-0000-4000-8000-0000000000a1', NULL);

INSERT INTO public.holdings (user_id, source_connection_id, portfolio_id, asset_class, amount,
                             currency, archived_at)
VALUES ('a0000000-0000-4000-8000-00000000000a', 'a5000000-0000-4000-8000-0000000000a5',
        'a7000000-0000-4000-8000-0000000000a7', 'cash', 1, 'ARS', now());

INSERT INTO public.uploaded_documents (id, user_id, source_connection_id, storage_path,
                                       file_name, mime_type, size_bytes, sha256)
VALUES ('a9000000-0000-4000-8000-0000000000a9', 'a0000000-0000-4000-8000-00000000000a',
        'a6000000-0000-4000-8000-0000000000a6',
        'a0000000-0000-4000-8000-00000000000a/imports/a9000000-0000-4000-8000-0000000000a9/a9000000-0000-4000-8000-0000000000a9',
        'resumen.pdf', 'application/pdf', 1024, repeat('1', 64));
INSERT INTO public.imports (id, user_id, document_id, status) VALUES
  ('aa000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-00000000000a',
   'a9000000-0000-4000-8000-0000000000a9', 'ready');
INSERT INTO public.import_items (user_id, import_id, position, symbol, quantity, currency, confidence)
VALUES ('a0000000-0000-4000-8000-00000000000a', 'aa000000-0000-4000-8000-0000000000aa', 0,
        'AAPL', 1, 'USD', 'high');

-- Beto: only Principal active, an unused archived portfolio and an unused
-- archived account.
INSERT INTO public.portfolios (id, user_id, name, archived_at) VALUES
  ('b2000000-0000-4000-8000-0000000000b2', 'b0000000-0000-4000-8000-00000000000b', 'Vieja', now());
INSERT INTO public.source_connections (id, user_id, institution, default_portfolio_id, archived_at) VALUES
  ('b5000000-0000-4000-8000-0000000000b5', 'b0000000-0000-4000-8000-00000000000b', 'IOL',
   'b2000000-0000-4000-8000-0000000000b2', now());

-- ── What the API roles hold ─────────────────────────────────────────────────
SELECT ok(
  has_table_privilege('authenticated', 'public.portfolios', 'DELETE')
    AND has_table_privilege('authenticated', 'public.source_connections', 'DELETE'),
  'a user may delete portfolios and accounts, as the guards allow'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.portfolios', 'DELETE')
    AND NOT has_table_privilege('anon', 'public.source_connections', 'DELETE')
    AND NOT has_table_privilege('service_role', 'public.portfolios', 'DELETE')
    AND NOT has_table_privilege('service_role', 'public.source_connections', 'DELETE'),
  'anon and the service role delete neither'
);

SELECT ok(
  (SELECT bool_and(NOT p.prosecdef AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=""'])
   FROM pg_proc p
   WHERE p.oid IN ('private.guard_portfolio_delete()'::regprocedure,
                   'private.guard_source_connection_delete()'::regprocedure)),
  'the delete guards run as the caller with an empty search_path'
);

SELECT ok(
  NOT has_function_privilege('authenticated', 'private.guard_portfolio_delete()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'private.guard_source_connection_delete()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'private.guard_portfolio_delete()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'private.guard_source_connection_delete()', 'EXECUTE'),
  'no API role executes the delete guards'
);

-- ── anon ────────────────────────────────────────────────────────────────────
SET LOCAL ROLE anon;

SELECT throws_ok(
  $$ DELETE FROM public.portfolios $$,
  '42501', 'permission denied for table portfolios',
  'anon cannot delete portfolios'
);

SELECT throws_ok(
  $$ DELETE FROM public.source_connections $$,
  '42501', 'permission denied for table source_connections',
  'anon cannot delete accounts'
);

RESET ROLE;

-- ── Signed in as Beto ───────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'b0000000-0000-4000-8000-00000000000b', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

SELECT is_empty(
  $$ DELETE FROM public.portfolios WHERE id = 'a2000000-0000-4000-8000-0000000000a2' RETURNING id $$,
  'a user cannot delete another user''s unused portfolio'
);

SELECT is_empty(
  $$ DELETE FROM public.source_connections WHERE id = 'a8000000-0000-4000-8000-0000000000a8' RETURNING id $$,
  'a user cannot delete another user''s unused account'
);

SELECT is(
  pg_temp.hint_of($$ DELETE FROM public.portfolios WHERE id = 'b1000000-0000-4000-8000-0000000000b1' $$),
  'last_active_portfolio',
  'a user cannot delete their last active portfolio'
);

SELECT is(
  pg_temp.hint_of($$ DELETE FROM public.portfolios WHERE id = 'b2000000-0000-4000-8000-0000000000b2' $$),
  'portfolio_in_use',
  'a portfolio an archived account defaults to is refused'
);

SELECT results_eq(
  $$ DELETE FROM public.source_connections WHERE id = 'b5000000-0000-4000-8000-0000000000b5' RETURNING id $$,
  $$ VALUES ('b5000000-0000-4000-8000-0000000000b5'::uuid) $$,
  'a user deletes their unused archived account'
);

SELECT results_eq(
  $$ DELETE FROM public.portfolios WHERE id = 'b2000000-0000-4000-8000-0000000000b2' RETURNING id $$,
  $$ VALUES ('b2000000-0000-4000-8000-0000000000b2'::uuid) $$,
  'a user deletes their unused archived portfolio once no account defaults to it'
);

RESET ROLE;

-- ── Signed in as Ana ────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.hint_of($$ DELETE FROM public.portfolios WHERE id = 'a4000000-0000-4000-8000-0000000000a4' $$),
  'portfolio_in_use',
  'an active portfolio an archived account defaults to is refused'
);

SELECT is(
  pg_temp.hint_of($$ DELETE FROM public.portfolios WHERE id = 'a7000000-0000-4000-8000-0000000000a7' $$),
  'portfolio_has_holdings',
  'a portfolio an archived holding sits in is refused'
);

SELECT is(
  pg_temp.hint_of($$ DELETE FROM public.source_connections WHERE id = 'a5000000-0000-4000-8000-0000000000a5' $$),
  'source_connection_has_holdings',
  'an account an archived holding sits in is refused'
);

SELECT results_eq(
  $$ DELETE FROM public.portfolios
     WHERE id IN ('a2000000-0000-4000-8000-0000000000a2', 'a3000000-0000-4000-8000-0000000000a3')
     RETURNING id $$,
  $$ VALUES ('a2000000-0000-4000-8000-0000000000a2'::uuid), ('a3000000-0000-4000-8000-0000000000a3'::uuid) $$,
  'a user deletes their unused portfolios, active or archived'
);

SELECT results_eq(
  $$ DELETE FROM public.source_connections WHERE id = 'a8000000-0000-4000-8000-0000000000a8' RETURNING id $$,
  $$ VALUES ('a8000000-0000-4000-8000-0000000000a8'::uuid) $$,
  'a user deletes their unused active account'
);

SELECT results_eq(
  $$ DELETE FROM public.source_connections WHERE id = 'a6000000-0000-4000-8000-0000000000a6' RETURNING id $$,
  $$ VALUES ('a6000000-0000-4000-8000-0000000000a6'::uuid) $$,
  'a user deletes an unused account with uploads'
);

SELECT results_eq(
  $$ DELETE FROM public.portfolios WHERE id = 'a4000000-0000-4000-8000-0000000000a4' RETURNING id $$,
  $$ VALUES ('a4000000-0000-4000-8000-0000000000a4'::uuid) $$,
  'the portfolio that account defaulted to is then deleted'
);

RESET ROLE;

SELECT is_empty(
  $$ SELECT 1 FROM public.uploaded_documents WHERE id = 'a9000000-0000-4000-8000-0000000000a9'
     UNION ALL
     SELECT 1 FROM public.imports WHERE id = 'aa000000-0000-4000-8000-0000000000aa'
     UNION ALL
     SELECT 1 FROM public.import_items WHERE import_id = 'aa000000-0000-4000-8000-0000000000aa' $$,
  'deleting an account deletes its uploads, their imports and drafts'
);

SELECT is(
  (SELECT count(*)::int FROM private.import_requests
   WHERE user_id = 'a0000000-0000-4000-8000-00000000000a'),
  1,
  'the deleted import still counts against the month''s quota'
);

SELECT results_eq(
  $$ SELECT id FROM public.portfolios WHERE user_id = 'a0000000-0000-4000-8000-00000000000a' ORDER BY id $$,
  $$ VALUES ('a1000000-0000-4000-8000-0000000000a1'::uuid), ('a7000000-0000-4000-8000-0000000000a7'::uuid) $$,
  'the refused portfolios stay'
);

SELECT results_eq(
  $$ SELECT id FROM public.source_connections WHERE user_id = 'a0000000-0000-4000-8000-00000000000a' $$,
  $$ VALUES ('a5000000-0000-4000-8000-0000000000a5'::uuid) $$,
  'the refused account stays'
);

-- ── Deleting the user ───────────────────────────────────────────────────────
-- The cascade from auth.users takes every row, used or not.
SELECT lives_ok(
  $$ DELETE FROM auth.users WHERE id = 'a0000000-0000-4000-8000-00000000000a' $$,
  'deleting a user with holdings, accounts and portfolios goes through'
);

SELECT is_empty(
  $$ SELECT 1 FROM public.portfolios WHERE user_id = 'a0000000-0000-4000-8000-00000000000a'
     UNION ALL
     SELECT 1 FROM public.source_connections WHERE user_id = 'a0000000-0000-4000-8000-00000000000a'
     UNION ALL
     SELECT 1 FROM public.holdings WHERE user_id = 'a0000000-0000-4000-8000-00000000000a' $$,
  'and leaves none of their rows'
);

SELECT * FROM finish();
ROLLBACK;
