-- A draft's debt payments and confirm_import writing them: a payment pays one
-- of the caller's debts that is not a card, in the import's transaction, with
-- the rules every debt event obeys.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(14);

-- The SQLSTATE and hint a statement raises, or NULL if it succeeds.
CREATE FUNCTION pg_temp.error_of(statement text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE state text; hint text;
BEGIN
  EXECUTE statement;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS state = RETURNED_SQLSTATE, hint = PG_EXCEPTION_HINT;
  RETURN state || ' ' || coalesce(nullif(hint, ''), '-');
END
$f$;

-- A payment of `amount` on `debt` on `day`, with the cash it takes, if any.
CREATE FUNCTION pg_temp.payment(debt uuid, day text, amount text, cash jsonb)
RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_array(jsonb_build_object('debt_payment', jsonb_build_object(
    'liability_id', debt,
    'event', jsonb_build_object('kind', 'payment', 'date', day, 'amount', amount,
                                'annual_rate', NULL, 'settles', false),
    'cash', cash)))
$f$;

GRANT EXECUTE ON FUNCTION pg_temp.error_of(text) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.payment(uuid, text, text, jsonb) TO authenticated;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at)
VALUES
  ('a0000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ana@pgtap.invalid', '', now(), '{}', '{}', now(), now()),
  ('b0000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'beto@pgtap.invalid', '', now(), '{}', '{}', now(), now());

INSERT INTO public.source_connections (id, user_id, institution, default_portfolio_id)
SELECT 'a5000000-0000-4000-8000-0000000000a5', p.user_id, 'Exchange A', p.id
FROM public.portfolios p WHERE p.user_id = 'a0000000-0000-4000-8000-00000000000a';

-- Ana's dollars in the account.
INSERT INTO public.holdings (id, user_id, source_connection_id, asset_class, currency, amount) VALUES
  ('a7000000-0000-4000-8000-0000000000a7', 'a0000000-0000-4000-8000-00000000000a',
   'a5000000-0000-4000-8000-0000000000a5', 'cash', 'USD', '1000');

-- Ana: a dollar loan opened on 2026-01-01 and a card; Beto: a dollar loan.
INSERT INTO public.liabilities (id, user_id, kind, label, currency, uva, balance, annual_rate,
                                accrues, opened_on) VALUES
  ('a9000000-0000-4000-8000-0000000000a9', 'a0000000-0000-4000-8000-00000000000a',
   'usd_debt', 'Línea de crédito', 'USD', false, '5000', NULL, false, '2026-01-01'),
  ('a9200000-0000-4000-8000-0000000000a9', 'a0000000-0000-4000-8000-00000000000a',
   'credit_card', 'Visa', 'ARS', false, '1000', NULL, false, NULL),
  ('b9000000-0000-4000-8000-0000000000b9', 'b0000000-0000-4000-8000-00000000000b',
   'usd_debt', 'Préstamo', 'USD', false, '5000', NULL, false, '2026-01-01');

-- Ana's logs, ready to review.
INSERT INTO public.uploaded_documents (id, user_id, source_connection_id, storage_path,
                                       file_name, mime_type, size_bytes, sha256)
SELECT id, 'a0000000-0000-4000-8000-00000000000a', 'a5000000-0000-4000-8000-0000000000a5',
       'a0000000-0000-4000-8000-00000000000a/imports/' || id || '/' || id,
       'log.png', 'image/png', 1024, repeat(digit, 64)
FROM (VALUES ('a8000000-0000-4000-8000-0000000000a1'::uuid, '1'),
             ('a8000000-0000-4000-8000-0000000000a2'::uuid, '2'),
             ('a8000000-0000-4000-8000-0000000000a3'::uuid, '3')) AS docs (id, digit);
INSERT INTO public.imports (id, user_id, document_id, status)
SELECT ('a1000000-0000-4000-8000-0000000000a' || digit)::uuid,
       'a0000000-0000-4000-8000-00000000000a',
       ('a8000000-0000-4000-8000-0000000000a' || digit)::uuid, 'ready'
FROM (VALUES ('1'), ('2'), ('3')) AS ready (digit);

-- ── The draft ───────────────────────────────────────────────────────────────
-- A row of Ana's first import with a kind, a direction, whether it pays a debt
-- and the debt it pays.
CREATE FUNCTION pg_temp.row_of(at_position int, kind text, direction text, pays boolean, debt uuid)
RETURNS text LANGUAGE sql AS $f$
  SELECT format(
    $$ INSERT INTO public.import_operations
         (user_id, import_id, position, kind, direction, debt_payment, pays_liability_id,
          quantity, currency, confidence)
       VALUES ('a0000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-0000000000a1',
               %s, %L, %L, %L, %L, 100, 'USD', 'medium') $$,
    at_position, kind, direction, pays, debt)
$f$;

SELECT is(pg_temp.error_of(pg_temp.row_of(0, NULL, NULL, true, 'a9000000-0000-4000-8000-0000000000a9')),
  NULL, 'a draft row pays one of the user''s debts');

SELECT is(pg_temp.error_of(pg_temp.row_of(1, 'adjustment', 'out', true, NULL)), NULL,
  'a payment may take units out of the account');

SELECT is(pg_temp.error_of(pg_temp.row_of(2, 'purchase', NULL, true, NULL)), '23514 -',
  'a payment is no trade');

SELECT is(pg_temp.error_of(pg_temp.row_of(3, NULL, NULL, false, 'a9000000-0000-4000-8000-0000000000a9')),
  '23514 -', 'only a payment names a debt');

SELECT is(pg_temp.error_of(pg_temp.row_of(4, NULL, NULL, true, 'b9000000-0000-4000-8000-0000000000b9')),
  '23503 -', 'never another user''s debt');

SELECT ok(
  has_column_privilege('service_role', 'public.import_operations', 'debt_payment', 'INSERT')
    AND NOT has_column_privilege('service_role', 'public.import_operations', 'pays_liability_id', 'INSERT'),
  'the job reads a payment, never the debt it pays'
);

DELETE FROM public.import_operations;

-- ── Signed in as Ana ────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.error_of($$ SELECT public.confirm_import('a1000000-0000-4000-8000-0000000000a1',
       pg_temp.payment('b9000000-0000-4000-8000-0000000000b9', '2026-02-01', '100', NULL)) $$),
  'PT404 debt_not_found',
  'a user never pays another user''s debt'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.confirm_import('a1000000-0000-4000-8000-0000000000a1',
       pg_temp.payment('a9200000-0000-4000-8000-0000000000a9', '2026-02-01', '100', NULL)) $$),
  'PT404 debt_not_found',
  'nor a card, whose balance comes from its statements'
);

SELECT is(
  (SELECT status::text FROM public.imports WHERE id = 'a1000000-0000-4000-8000-0000000000a1'),
  'ready',
  'a refused payment leaves the import ready'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.confirm_import('a1000000-0000-4000-8000-0000000000a1',
       '[{"debt_payment": {"liability_id": "a9000000-0000-4000-8000-0000000000a9",
          "event": {"kind": "rate_change", "date": "2026-02-01", "annual_rate": "0.1"}}}]') $$),
  '22023 -',
  'an import records only payments'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.confirm_import('a1000000-0000-4000-8000-0000000000a1',
       pg_temp.payment('a9000000-0000-4000-8000-0000000000a9', '2025-12-01', '100', NULL)) $$),
  'PT409 before_opening',
  'a payment obeys the rules every debt event does'
);

SELECT public.confirm_import('a1000000-0000-4000-8000-0000000000a1',
  pg_temp.payment('a9000000-0000-4000-8000-0000000000a9', '2026-02-01', '100', NULL));
SELECT results_eq(
  $$ SELECT kind::text, date::text, amount::text FROM public.liability_events $$,
  $$ VALUES ('payment', '2026-02-01', '100.00000000') $$,
  'a confirmed import pays the debt'
);

SELECT public.confirm_import('a1000000-0000-4000-8000-0000000000a2',
  pg_temp.payment('a9000000-0000-4000-8000-0000000000a9', '2026-02-02', '200',
    '{"holding_id": "a7000000-0000-4000-8000-0000000000a7", "take": true, "expected": "1000"}'));
SELECT is(
  (SELECT amount::text FROM public.holdings WHERE id = 'a7000000-0000-4000-8000-0000000000a7'),
  '800.00000000',
  'a payment from the account''s cash takes it'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.confirm_import('a1000000-0000-4000-8000-0000000000a3',
       pg_temp.payment('a9000000-0000-4000-8000-0000000000a9', '2026-02-03', '1',
         '{"holding_id": "a7000000-0000-4000-8000-0000000000a7", "take": true, "expected": "1000"}')) $$),
  'PT409 stale',
  'against the cash as the review read it'
);

SELECT * FROM finish();
ROLLBACK;
