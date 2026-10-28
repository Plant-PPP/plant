-- stage_assistant_import: a signed-in user stages a ready import of an open
-- account of theirs with the rows the assistant proposed; never in another
-- user's account, an archived one, or with a bad draft or row count; a
-- transfer only to another open account of theirs and a payment only on a
-- debt of theirs that is not a card. An exchange sync still needs its key.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(15);

CREATE FUNCTION pg_temp.error_of(statement text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE statement;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$f$;

-- The SQLSTATE and hint a statement raises, or NULL if it succeeds.
CREATE FUNCTION pg_temp.refusal_of(statement text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE state text; hint text;
BEGIN
  EXECUTE statement;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS state = RETURNED_SQLSTATE, hint = PG_EXCEPTION_HINT;
  RETURN state || ' ' || coalesce(nullif(hint, ''), '-');
END
$f$;

-- Stages in Ana's open account one operation row with these fields.
CREATE FUNCTION pg_temp.stage_row(fields text) RETURNS text LANGUAGE sql AS $f$
  SELECT format(
    $$ SELECT public.stage_assistant_import('a5000000-0000-4000-8000-0000000000a5', 'operations',
         jsonb_build_array('{"date":"2026-10-21","symbol":"USDT","quantity":"100","currency":"USD"}'::jsonb
                           || %L::jsonb)) $$,
    fields)
$f$;

GRANT EXECUTE ON FUNCTION pg_temp.error_of(text) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.refusal_of(text) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.stage_row(text) TO authenticated;

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
SELECT 'a5200000-0000-4000-8000-0000000000a5', p.user_id, 'Exchange B', p.id
FROM public.portfolios p WHERE p.user_id = 'a0000000-0000-4000-8000-00000000000a';
INSERT INTO public.source_connections (id, user_id, institution, default_portfolio_id)
SELECT 'b5000000-0000-4000-8000-0000000000b5', p.user_id, 'Nexo', p.id
FROM public.portfolios p WHERE p.user_id = 'b0000000-0000-4000-8000-00000000000b';

-- Ana: a dollar credit line and a card; Beto: a loan.
INSERT INTO public.liabilities (id, user_id, kind, label, currency, uva, balance, accrues, opened_on)
VALUES
  ('a9000000-0000-4000-8000-0000000000a9', 'a0000000-0000-4000-8000-00000000000a',
   'usd_debt', 'Línea', 'USD', false, '5000', false, '2026-01-01'),
  ('a9200000-0000-4000-8000-0000000000a9', 'a0000000-0000-4000-8000-00000000000a',
   'credit_card', 'Visa', 'ARS', false, '1000', false, NULL),
  ('b9000000-0000-4000-8000-0000000000b9', 'b0000000-0000-4000-8000-00000000000b',
   'usd_debt', 'Préstamo', 'USD', false, '5000', false, '2026-01-01');

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

CREATE TEMP TABLE staged_outflows ON COMMIT DROP AS
SELECT public.stage_assistant_import('a5000000-0000-4000-8000-0000000000a5', 'operations',
  '[{"date":"2026-10-21","kind":"adjustment","direction":"out","symbol":"BTC","quantity":"0.1","currency":"USD"},
    {"date":"2026-10-21","kind":"transfer","direction":"out","symbol":"BTC","quantity":"0.09","currency":"USD",
     "counterpart_connection_id":"a5200000-0000-4000-8000-0000000000a5"},
    {"date":"2026-10-21","kind":null,"symbol":null,"quantity":"500","currency":"USD",
     "debt_payment":true,"pays_liability_id":"a9000000-0000-4000-8000-0000000000a9"}]') AS id;

SELECT results_eq(
  $$ SELECT kind::text, direction::text, counterpart_connection_id::text, debt_payment,
            pays_liability_id::text
     FROM public.import_operations WHERE import_id = (SELECT id FROM staged_outflows)
     ORDER BY position $$,
  $$ VALUES ('adjustment', 'out', NULL, false, NULL),
            ('transfer', 'out', 'a5200000-0000-4000-8000-0000000000a5', false, NULL),
            (NULL, NULL, NULL, true, 'a9000000-0000-4000-8000-0000000000a9') $$,
  'it stages withdrawals, transfers to another account of the caller and payments on a debt'
);

SELECT is(
  pg_temp.refusal_of(pg_temp.stage_row(
    '{"kind":"transfer","direction":"out","counterpart_connection_id":"b5000000-0000-4000-8000-0000000000b5"}')),
  'PT404 counterpart_not_found',
  'never a transfer to another user''s account'
);

SELECT is(
  pg_temp.refusal_of(pg_temp.stage_row(
    '{"kind":"transfer","direction":"out","counterpart_connection_id":"a5000000-0000-4000-8000-0000000000a5"}')),
  'PT404 counterpart_not_found',
  'nor to the import''s own account'
);

SELECT is(
  pg_temp.refusal_of(pg_temp.stage_row(
    '{"kind":"transfer","direction":"out","counterpart_connection_id":"a5100000-0000-4000-8000-0000000000a5"}')),
  'PT404 counterpart_not_found',
  'nor to an archived one'
);

SELECT is(
  pg_temp.refusal_of(pg_temp.stage_row(
    '{"kind":null,"debt_payment":true,"pays_liability_id":"b9000000-0000-4000-8000-0000000000b9"}')),
  'PT404 debt_not_found',
  'never a payment on another user''s debt'
);

SELECT is(
  pg_temp.refusal_of(pg_temp.stage_row(
    '{"kind":null,"debt_payment":true,"pays_liability_id":"a9200000-0000-4000-8000-0000000000a9"}')),
  'PT404 debt_not_found',
  'nor on a card'
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
