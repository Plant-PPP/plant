-- Liabilities: what a user may write, that each user reads and writes only
-- their own, and the unit each kind of debt is owed in.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(16);

-- The SQLSTATE a statement raises, or NULL if it succeeds.
CREATE FUNCTION pg_temp.error_of(statement text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE statement;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$f$;

-- The privileges authenticated holds on a table and its columns.
CREATE FUNCTION pg_temp.acl(rel regclass) RETURNS SETOF text LANGUAGE sql AS $f$
  SELECT '(table):' || acl.privilege_type
  FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl
  WHERE c.oid = rel AND acl.grantee = 'authenticated'::regrole
  UNION ALL
  SELECT a.attname || ':' || acl.privilege_type
  FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl
  WHERE a.attrelid = rel AND acl.grantee = 'authenticated'::regrole
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

-- Beto owes a credit card.
INSERT INTO public.liabilities (id, user_id, kind, label, currency, balance) VALUES
  ('b9000000-0000-4000-8000-0000000000b9', 'b0000000-0000-4000-8000-00000000000b',
   'credit_card', 'Visa', 'ARS', '250000');

-- ── What the API roles hold ─────────────────────────────────────────────────
SELECT set_eq(
  $$ SELECT pg_temp.acl('public.liabilities') $$,
  ARRAY['(table):SELECT', '(table):DELETE',
        'kind:INSERT', 'label:INSERT', 'lender:INSERT', 'currency:INSERT', 'uva:INSERT',
        'instrument_symbol:INSERT', 'balance:INSERT', 'installment:INSERT',
        'annual_rate:INSERT', 'installments_left:INSERT', 'next_due_on:INSERT',
        'matures_on:INSERT', 'accrues:INSERT', 'opened_on:INSERT',
        'kind:UPDATE', 'label:UPDATE', 'lender:UPDATE', 'currency:UPDATE', 'uva:UPDATE',
        'instrument_symbol:UPDATE', 'balance:UPDATE', 'installment:UPDATE',
        'annual_rate:UPDATE', 'installments_left:UPDATE', 'next_due_on:UPDATE',
        'matures_on:UPDATE', 'accrues:UPDATE', 'opened_on:UPDATE'],
  'a user reads, deletes and writes a debt''s own columns, never its owner or id'
);

SELECT is_empty(
  $$ SELECT acl.grantee::regrole::text FROM pg_class c
     CROSS JOIN LATERAL aclexplode(c.relacl) acl
     WHERE c.oid = 'public.liabilities'::regclass
       AND acl.grantee IN ('anon'::regrole, 'service_role'::regrole, 0)
     UNION ALL
     SELECT acl.grantee::regrole::text FROM pg_attribute a
     CROSS JOIN LATERAL aclexplode(a.attacl) acl
     WHERE a.attrelid = 'public.liabilities'::regclass
       AND acl.grantee IN ('anon'::regrole, 'service_role'::regrole, 0) $$,
  'anon, the service role and PUBLIC hold nothing on liabilities'
);

-- ── Signed in as Ana ────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

INSERT INTO public.liabilities (kind, label, lender, currency, uva, balance, installment,
                                annual_rate, installments_left, next_due_on)
VALUES ('mortgage', 'Hipoteca', 'Banco Nación', 'ARS', true, '45000.5', '320.25', '0.035',
        240, '2026-11-10');
INSERT INTO public.liabilities (kind, label, instrument_symbol, balance)
VALUES ('crypto_loan', 'Préstamo BTC', 'BTC', '0.05');

SELECT results_eq(
  $$ SELECT kind::text, balance::text, user_id::text FROM public.liabilities ORDER BY kind $$,
  $$ VALUES ('crypto_loan', '0.05000000', 'a0000000-0000-4000-8000-00000000000a'),
            ('mortgage', '45000.50000000', 'a0000000-0000-4000-8000-00000000000a') $$,
  'a user writes their debts under their own id and reads only them'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.liabilities (kind, label, currency, balance)
                      VALUES ('usd_debt', 'Préstamo', 'ARS', '1') $$),
  '23514',
  'a debt in dollars is owed in dollars'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.liabilities (kind, label, currency, uva, balance)
                      VALUES ('personal_loan', 'Préstamo', 'USD', true, '1') $$),
  '23514',
  'only a peso debt is in UVA'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.liabilities (kind, label, currency, instrument_symbol, balance)
                      VALUES ('crypto_loan', 'Préstamo', 'USD', 'BTC', '1') $$),
  '23514',
  'a crypto loan is owed in its instrument and no currency'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.liabilities (kind, label, balance)
                      VALUES ('credit_card', 'Visa', '1') $$),
  '23514',
  'any other debt names its currency'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.liabilities (kind, label, currency, balance)
                      VALUES ('credit_card', 'Visa', 'ARS', '0') $$),
  '23514',
  'a debt owes more than nothing'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.liabilities (user_id, kind, label, currency, balance)
                      VALUES ('b0000000-0000-4000-8000-00000000000b', 'credit_card', 'Visa', 'ARS', '1') $$),
  '42501',
  'a user never writes the owner'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.liabilities SET user_id = 'b0000000-0000-4000-8000-00000000000b' $$),
  '42501',
  'a user never moves a debt to another owner'
);

UPDATE public.liabilities SET balance = '999' WHERE id = 'b9000000-0000-4000-8000-0000000000b9';
DELETE FROM public.liabilities WHERE id = 'b9000000-0000-4000-8000-0000000000b9';

UPDATE public.liabilities SET balance = '44000' WHERE kind = 'mortgage';
SELECT is(
  (SELECT balance::text FROM public.liabilities WHERE kind = 'mortgage'),
  '44000.00000000',
  'a user changes their own debt''s balance'
);

DELETE FROM public.liabilities WHERE kind = 'crypto_loan';
SELECT is(
  (SELECT count(*)::int FROM public.liabilities),
  1,
  'a user deletes their own debt'
);

-- ── Signed in as Beto ───────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'b0000000-0000-4000-8000-00000000000b', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);

SELECT results_eq(
  $$ SELECT id::text, balance::text FROM public.liabilities $$,
  $$ VALUES ('b9000000-0000-4000-8000-0000000000b9', '250000.00000000') $$,
  'another user''s update and delete leave a debt as it was'
);

-- ── Enrolled in MFA but signed in at aal1 ───────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'b0000000-0000-4000-8000-00000000000b', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', true)::text, true);

SELECT is_empty(
  $$ SELECT id FROM public.liabilities $$,
  'a user enrolled in MFA reads no debt before the second factor'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.liabilities (kind, label, currency, balance)
                      VALUES ('credit_card', 'Visa', 'ARS', '1') $$),
  '42501',
  'nor writes one'
);

-- ── Anonymous ───────────────────────────────────────────────────────────────
RESET ROLE;
SET LOCAL ROLE anon;

SELECT throws_ok(
  $$ SELECT id FROM public.liabilities $$,
  '42501',
  NULL,
  'anon reads no debt'
);

SELECT * FROM finish();
ROLLBACK;
