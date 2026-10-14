-- confirm_import: a user confirms only their own ready import, every
-- operation goes in with it or none does, and nobody moves an import any
-- other way.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(28);

-- The SQLSTATE a statement raises, or NULL if it succeeds.
CREATE FUNCTION pg_temp.error_of(statement text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE statement;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$f$;

-- One operation of Ana's import: an opening balance of `symbol` in her IOL
-- account, with the revisions of its holdings as she sees them.
CREATE FUNCTION pg_temp.opening(symbol text, quantity text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_object(
    'parts', jsonb_build_array(jsonb_build_object(
      'source_connection_id', 'a5000000-0000-4000-8000-0000000000a5',
      'portfolio_id', 'a1000000-0000-4000-8000-0000000000a1',
      'instrument_symbol', symbol, 'kind', 'opening_balance', 'date', '2026-09-30',
      'currency', 'ARS', 'quantity', quantity, 'price', '18000', 'rates', '{}'::jsonb)),
    'expected', (SELECT COALESCE(jsonb_object_agg(h.id, h.movements_revision), '{}'::jsonb)
                 FROM public.holdings h WHERE h.instrument_symbol = symbol))
$f$;

-- One cash balance of Ana's import in her IOL account, with her cash
-- holdings in that currency as she sees them.
CREATE FUNCTION pg_temp.cash(p_currency text, p_amount text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_object('cash', jsonb_build_object(
    'source_connection_id', 'a5000000-0000-4000-8000-0000000000a5',
    'currency', p_currency, 'amount', p_amount,
    'expected', (SELECT COALESCE(jsonb_object_agg(h.id, h.amount::text), '{}'::jsonb)
                 FROM public.holdings h
                 WHERE h.asset_class = 'cash' AND h.archived_at IS NULL
                   AND h.currency::text = p_currency)))
$f$;

GRANT EXECUTE ON FUNCTION pg_temp.error_of(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION pg_temp.opening(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.cash(text, text) TO authenticated;

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
INSERT INTO public.source_connections (id, user_id, institution, default_portfolio_id) VALUES
  ('a5000000-0000-4000-8000-0000000000a5', 'a0000000-0000-4000-8000-00000000000a', 'IOL',
   'a1000000-0000-4000-8000-0000000000a1'),
  ('b5000000-0000-4000-8000-0000000000b5', 'b0000000-0000-4000-8000-00000000000b', 'IOL',
   'b1000000-0000-4000-8000-0000000000b1');
-- Beto's account holds dollars, which Ana's import must never reach.
INSERT INTO public.holdings (user_id, source_connection_id, asset_class, currency, amount, label)
VALUES ('b0000000-0000-4000-8000-00000000000b', 'b5000000-0000-4000-8000-0000000000b5',
        'cash', 'USD', '700', 'Caja');

-- Ana has two imports ready to review and one still queued.
INSERT INTO public.uploaded_documents (id, user_id, source_connection_id, storage_path,
                                       file_name, mime_type, size_bytes, sha256)
SELECT id, 'a0000000-0000-4000-8000-00000000000a', 'a5000000-0000-4000-8000-0000000000a5',
       'a0000000-0000-4000-8000-00000000000a/imports/' || id || '/' || id,
       'resumen.pdf', 'application/pdf', 1024, repeat(digit, 64)
FROM (VALUES ('a8000000-0000-4000-8000-0000000000a1'::uuid, '1'),
             ('a8000000-0000-4000-8000-0000000000a2'::uuid, '2'),
             ('a8000000-0000-4000-8000-0000000000a3'::uuid, '3'),
             ('a8000000-0000-4000-8000-0000000000a4'::uuid, '4'),
             ('a8000000-0000-4000-8000-0000000000a5'::uuid, '5'),
             ('a8000000-0000-4000-8000-0000000000a6'::uuid, '6')) AS docs (id, digit);
-- And three statements of cash, ready to review.
INSERT INTO public.imports (id, user_id, document_id, status)
SELECT id, 'a0000000-0000-4000-8000-00000000000a', document_id, 'ready'
FROM (VALUES ('a9000000-0000-4000-8000-0000000000a4'::uuid, 'a8000000-0000-4000-8000-0000000000a4'::uuid),
             ('a9000000-0000-4000-8000-0000000000a5'::uuid, 'a8000000-0000-4000-8000-0000000000a5'::uuid),
             ('a9000000-0000-4000-8000-0000000000a6'::uuid, 'a8000000-0000-4000-8000-0000000000a6'::uuid))
  AS ready (id, document_id);
INSERT INTO public.imports (id, user_id, document_id, status) VALUES
  ('a9000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-00000000000a',
   'a8000000-0000-4000-8000-0000000000a1', 'ready'),
  ('a9000000-0000-4000-8000-0000000000a2', 'a0000000-0000-4000-8000-00000000000a',
   'a8000000-0000-4000-8000-0000000000a2', 'ready'),
  ('a9000000-0000-4000-8000-0000000000a3', 'a0000000-0000-4000-8000-00000000000a',
   'a8000000-0000-4000-8000-0000000000a3', 'queued');

-- ── What the API roles hold ─────────────────────────────────────────────────
SELECT ok(
  has_function_privilege('authenticated', 'public.confirm_import(uuid,jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.confirm_import(uuid,jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'public.confirm_import(uuid,jsonb)', 'EXECUTE'),
  'only authenticated confirms an import'
);

-- ── Signed in as Beto ───────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'b0000000-0000-4000-8000-00000000000b', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.error_of($$ SELECT public.confirm_import('a9000000-0000-4000-8000-0000000000a1', '[]') $$),
  'PT404',
  'a user never confirms another user''s import'
);

-- ── Signed in as Ana ────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);

SELECT is(
  (SELECT status::text FROM public.imports WHERE id = 'a9000000-0000-4000-8000-0000000000a1'),
  'ready',
  'another user''s attempt leaves the import ready'
);

SELECT is(
  public.confirm_import('a9000000-0000-4000-8000-0000000000a1',
    jsonb_build_array(pg_temp.opening('AAPL', '5'), pg_temp.opening('KO', '3'))),
  'a9000000-0000-4000-8000-0000000000a1'::uuid,
  'a user confirms their ready import'
);

SELECT results_eq(
  $$ SELECT (SELECT status::text FROM public.imports WHERE id = 'a9000000-0000-4000-8000-0000000000a1'),
            (SELECT string_agg(instrument_symbol || ':' || amount::text, ',' ORDER BY instrument_symbol)
             FROM public.holdings),
            (SELECT count(*)::int FROM public.operations) $$,
  $$ VALUES ('confirmed', 'AAPL:5.00000000,KO:3.00000000', 2) $$,
  'with every operation, one each, and the import marked confirmed'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.confirm_import('a9000000-0000-4000-8000-0000000000a1', '[]') $$),
  'PT404',
  'an import is confirmed once'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.confirm_import('a9000000-0000-4000-8000-0000000000a3', '[]') $$),
  'PT404',
  'an import still being read is not confirmed'
);

-- A stale read of AAPL in the second operation refuses the whole import.
SELECT is(
  pg_temp.error_of($$ SELECT public.confirm_import('a9000000-0000-4000-8000-0000000000a2',
                        jsonb_build_array(pg_temp.opening('GD30', '10'),
                                          jsonb_set(pg_temp.opening('AAPL', '1'), '{expected}', '{}'))) $$),
  'PT409',
  'an operation refused refuses the import'
);

SELECT results_eq(
  $$ SELECT (SELECT status::text FROM public.imports WHERE id = 'a9000000-0000-4000-8000-0000000000a2'),
            (SELECT count(*)::int FROM public.holdings WHERE instrument_symbol = 'GD30') $$,
  $$ VALUES ('ready', 0) $$,
  'and writes none of its operations'
);

-- Two operations that read one holding differently are refused.
SELECT is(
  pg_temp.error_of($$ SELECT public.confirm_import('a9000000-0000-4000-8000-0000000000a2',
                        jsonb_build_array(pg_temp.opening('AAPL', '1'),
                                          jsonb_set(pg_temp.opening('AAPL', '1'), '{expected}',
                                            (SELECT jsonb_object_agg(h.id, h.movements_revision + 7)
                                             FROM public.holdings h WHERE h.instrument_symbol = 'AAPL')))) $$),
  '22023',
  'operations that read one holding differently are refused'
);

-- A purchase that opens a holding and a sale of it, both read before the
-- first, go in one import.
SELECT is(
  public.confirm_import('a9000000-0000-4000-8000-0000000000a2',
    jsonb_build_array(
      pg_temp.opening('MSFT', '5'),
      jsonb_set(pg_temp.opening('MSFT', '2'), '{parts,0,kind}', '"sale"'))),
  'a9000000-0000-4000-8000-0000000000a2'::uuid,
  'an import may touch one instrument more than once'
);

SELECT results_eq(
  $$ SELECT (SELECT amount::text FROM public.holdings WHERE instrument_symbol = 'MSFT'),
            (SELECT count(*)::int FROM public.movements m
             JOIN public.holdings h ON h.id = m.holding_id WHERE h.instrument_symbol = 'MSFT') $$,
  $$ VALUES ('3.00000000', 2) $$,
  'with each of its operations written in turn'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.imports SET status = 'ready'
                      WHERE id = 'a9000000-0000-4000-8000-0000000000a1' $$),
  '42501',
  'a user never moves a confirmed import back'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.imports SET status = 'confirmed'
                      WHERE id = 'a9000000-0000-4000-8000-0000000000a3' $$),
  '42501',
  'nor confirms one still being read'
);

-- ── Cash ────────────────────────────────────────────────────────────────────
SELECT is(
  public.confirm_import('a9000000-0000-4000-8000-0000000000a4',
    jsonb_build_array(pg_temp.cash('ARS', '125000.5'))),
  'a9000000-0000-4000-8000-0000000000a4'::uuid,
  'a cash balance goes in with its import'
);

SELECT results_eq(
  $$ SELECT asset_class::text, currency::text, amount::text, portfolio_id, label
     FROM public.holdings WHERE asset_class = 'cash' $$,
  $$ VALUES ('cash', 'ARS', '125000.50000000', 'a1000000-0000-4000-8000-0000000000a1'::uuid,
             NULL::text) $$,
  'opening the account''s cash in that currency, in its default portfolio'
);

UPDATE public.holdings SET label = 'Caja' WHERE asset_class = 'cash';

-- A stale read of that cash refuses the whole import.
SELECT is(
  pg_temp.error_of($$ SELECT public.confirm_import('a9000000-0000-4000-8000-0000000000a5',
                        jsonb_build_array(jsonb_set(pg_temp.cash('ARS', '1'), '{cash,expected}', '{}'))) $$),
  'PT409',
  'a cash balance read before the cash changed is refused'
);

SELECT is(
  public.confirm_import('a9000000-0000-4000-8000-0000000000a5',
    jsonb_build_array(pg_temp.cash('ARS', '90000'), pg_temp.opening('GD30', '4'))),
  'a9000000-0000-4000-8000-0000000000a5'::uuid,
  'a cash balance goes in beside operations'
);

SELECT results_eq(
  $$ SELECT amount::text, label, (SELECT count(*)::int FROM public.holdings WHERE asset_class = 'cash')
     FROM public.holdings WHERE asset_class = 'cash' $$,
  $$ VALUES ('90000.00000000', 'Caja', 1) $$,
  'as the amount of the one cash holding the account has in that currency'
);

INSERT INTO public.holdings (source_connection_id, asset_class, currency, amount, label)
VALUES ('a5000000-0000-4000-8000-0000000000a5', 'cash', 'ARS', '10', 'Otra caja');

SELECT is(
  pg_temp.error_of($$ SELECT public.confirm_import('a9000000-0000-4000-8000-0000000000a6',
                        jsonb_build_array(pg_temp.cash('ARS', '5'))) $$),
  '22023',
  'a cash balance is refused where the account holds several in that currency'
);

-- Beto's account is not visible under RLS, so the default portfolio trigger
-- resolves none for it: the not-null on portfolio_id refuses first.
SELECT is(
  pg_temp.error_of($$ SELECT public.confirm_import('a9000000-0000-4000-8000-0000000000a6',
                        jsonb_build_array(jsonb_set(pg_temp.cash('USD', '5'), '{cash,source_connection_id}',
                                                    '"b5000000-0000-4000-8000-0000000000b5"'))) $$),
  '23502',
  'and never goes into an account that is not the user''s'
);

-- Were a portfolio of her own given to it, the account foreign key, which
-- pairs the account with the user, would still refuse it.
SAVEPOINT own_portfolio;
RESET ROLE;
CREATE OR REPLACE FUNCTION private.default_holding_portfolio()
  RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $f$
BEGIN
  NEW.portfolio_id := 'a1000000-0000-4000-8000-0000000000a1';
  RETURN NEW;
END;
$f$;
SET LOCAL ROLE authenticated;
SELECT is(
  pg_temp.error_of($$ SELECT public.confirm_import('a9000000-0000-4000-8000-0000000000a6',
                        jsonb_build_array(jsonb_set(pg_temp.cash('USD', '5'), '{cash,source_connection_id}',
                                                    '"b5000000-0000-4000-8000-0000000000b5"'))) $$),
  '23503',
  'the account foreign key pairs it with the user'
);
ROLLBACK TO SAVEPOINT own_portfolio;

RESET ROLE;
SELECT results_eq(
  $$ SELECT user_id, source_connection_id, currency::text, amount::text FROM public.holdings
     WHERE source_connection_id = 'b5000000-0000-4000-8000-0000000000b5'
        OR user_id = 'b0000000-0000-4000-8000-00000000000b' $$,
  $$ VALUES ('b0000000-0000-4000-8000-00000000000b'::uuid, 'b5000000-0000-4000-8000-0000000000b5'::uuid,
             'USD', '700.00000000') $$,
  'Beto''s account keeps only his own cash'
);
SET LOCAL ROLE authenticated;

SELECT results_eq(
  $$ SELECT (SELECT status::text FROM public.imports WHERE id = 'a9000000-0000-4000-8000-0000000000a6'),
            (SELECT string_agg(amount::text, ',' ORDER BY amount) FROM public.holdings
             WHERE asset_class = 'cash') $$,
  $$ VALUES ('ready', '10.00000000,90000.00000000') $$,
  'leaving the import ready and the cash as it was'
);

-- ── Enrolled in MFA but signed in at aal1 ───────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', true)::text, true);

SELECT is(
  pg_temp.error_of($$ SELECT public.confirm_import('a9000000-0000-4000-8000-0000000000a2', '[]') $$),
  'PT404',
  'a user enrolled in MFA confirms nothing before the second factor'
);

-- ── As the import job ───────────────────────────────────────────────────────
RESET ROLE;
SET LOCAL ROLE service_role;

SELECT is(
  pg_temp.error_of($$ UPDATE public.imports SET status = 'ready'
                      WHERE id = 'a9000000-0000-4000-8000-0000000000a1' $$),
  '42501',
  'the job never moves a confirmed import back to ready'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.imports SET status = 'failed'
                      WHERE id = 'a9000000-0000-4000-8000-0000000000a1' $$),
  '42501',
  'nor to failed'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.imports SET status = 'reading'
                      WHERE id = 'a9000000-0000-4000-8000-0000000000a3' $$),
  NULL,
  'and moves a queued import along'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
