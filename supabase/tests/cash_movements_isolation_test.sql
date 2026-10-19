-- Cash movements: what a user may write, that each user reads and writes
-- only their own, that a movement never points at another user's holding or
-- operation, that they are written only through write_cash_movements, and how
-- the holding's amount follows them.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(17);

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

INSERT INTO public.source_connections (id, user_id, institution, default_portfolio_id)
SELECT 'a5000000-0000-4000-8000-0000000000a5', p.user_id, 'IOL', p.id
FROM public.portfolios p WHERE p.user_id = 'a0000000-0000-4000-8000-00000000000a';
INSERT INTO public.source_connections (id, user_id, institution, default_portfolio_id)
SELECT 'a6000000-0000-4000-8000-0000000000a6', p.user_id, 'Balanz', p.id
FROM public.portfolios p WHERE p.user_id = 'a0000000-0000-4000-8000-00000000000a';
INSERT INTO public.source_connections (id, user_id, institution, default_portfolio_id)
SELECT 'b5000000-0000-4000-8000-0000000000b5', p.user_id, 'IOL', p.id
FROM public.portfolios p WHERE p.user_id = 'b0000000-0000-4000-8000-00000000000b';

INSERT INTO public.holdings (id, user_id, source_connection_id, asset_class, currency, amount) VALUES
  ('a7000000-0000-4000-8000-0000000000a7', 'a0000000-0000-4000-8000-00000000000a',
   'a5000000-0000-4000-8000-0000000000a5', 'cash', 'USD', '1000'),
  ('b7000000-0000-4000-8000-0000000000b7', 'b0000000-0000-4000-8000-00000000000b',
   'b5000000-0000-4000-8000-0000000000b5', 'cash', 'USD', '1000');
INSERT INTO public.holdings (id, user_id, source_connection_id, asset_class, instrument_symbol, amount) VALUES
  ('a8000000-0000-4000-8000-0000000000a8', 'a0000000-0000-4000-8000-00000000000a',
   'a5000000-0000-4000-8000-0000000000a5', 'instrument', 'AAPL', '1'),
  ('a9000000-0000-4000-8000-0000000000a9', 'a0000000-0000-4000-8000-00000000000a',
   'a6000000-0000-4000-8000-0000000000a6', 'instrument', 'AAPL', '1'),
  ('b8000000-0000-4000-8000-0000000000b8', 'b0000000-0000-4000-8000-00000000000b',
   'b5000000-0000-4000-8000-0000000000b5', 'instrument', 'AAPL', '1');

-- A purchase each in Ana's two accounts and in Beto's, written as the owner.
INSERT INTO public.operations (id, user_id, entry_order) VALUES
  ('a1000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-00000000000a', 1),
  ('a2000000-0000-4000-8000-0000000000a2', 'a0000000-0000-4000-8000-00000000000a', 2),
  ('b1000000-0000-4000-8000-0000000000b1', 'b0000000-0000-4000-8000-00000000000b', 1);
INSERT INTO public.movements (user_id, holding_id, operation_id, entry_order, kind, date,
                              currency, quantity, price, rates)
VALUES
  ('a0000000-0000-4000-8000-00000000000a', 'a8000000-0000-4000-8000-0000000000a8',
   'a1000000-0000-4000-8000-0000000000a1', 1, 'purchase', '2026-02-01', 'USD', '1', '30', '{}'),
  ('a0000000-0000-4000-8000-00000000000a', 'a9000000-0000-4000-8000-0000000000a9',
   'a2000000-0000-4000-8000-0000000000a2', 2, 'purchase', '2026-02-01', 'USD', '1', '30', '{}'),
  ('b0000000-0000-4000-8000-00000000000b', 'b8000000-0000-4000-8000-0000000000b8',
   'b1000000-0000-4000-8000-0000000000b1', 1, 'purchase', '2026-02-01', 'USD', '1', '30', '{}');

-- Beto's history, written as the owner.
INSERT INTO public.cash_movements (id, user_id, holding_id, kind, date, amount, rates) VALUES
  ('bc000000-0000-4000-8000-0000000000bc', 'b0000000-0000-4000-8000-00000000000b',
   'b7000000-0000-4000-8000-0000000000b7', 'opening_balance', '2026-01-01', '1000', '{}');

-- ── What the API roles hold ─────────────────────────────────────────────────
SELECT set_eq(
  $$ SELECT pg_temp.acl('public.cash_movements') $$,
  ARRAY['(table):SELECT', '(table):DELETE',
        'holding_id:INSERT', 'operation_id:INSERT', 'kind:INSERT', 'date:INSERT',
        'amount:INSERT', 'reference:INSERT', 'note:INSERT', 'rates:INSERT'],
  'a user reads, inserts and deletes a cash movement''s own columns, never its owner'
);

SELECT is_empty(
  $$ SELECT acl.grantee::regrole::text FROM pg_class c
     CROSS JOIN LATERAL aclexplode(c.relacl) acl
     WHERE c.oid = 'public.cash_movements'::regclass
       AND acl.grantee IN ('anon'::regrole, 'service_role'::regrole, 0)
     UNION ALL
     SELECT acl.grantee::regrole::text FROM pg_attribute a
     CROSS JOIN LATERAL aclexplode(a.attacl) acl
     WHERE a.attrelid = 'public.cash_movements'::regclass
       AND acl.grantee IN ('anon'::regrole, 'service_role'::regrole, 0) $$,
  'anon, the service role and PUBLIC hold nothing on cash movements'
);

-- ── Signed in as Ana ────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.cash_movements (holding_id, kind, date, amount, rates)
                      VALUES ('a7000000-0000-4000-8000-0000000000a7', 'deposit', '2026-02-01', '10', '{}') $$),
  '42501 -',
  'a cash movement is written only through its RPC'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.write_cash_movements('a7000000-0000-4000-8000-0000000000a7',
                        '[{"kind": "deposit", "date": "2026-02-01", "amount": "10", "rates": {}}]', '{}') $$),
  'PT409 before_opening',
  'a history starts with its opening balance'
);

SELECT lives_ok(
  $$ SELECT public.write_cash_movements('a7000000-0000-4000-8000-0000000000a7',
       '[{"kind": "opening_balance", "date": "2026-01-01", "amount": "100", "rates": {}},
         {"kind": "deposit", "date": "2026-01-15", "amount": "50", "rates": {}, "reference": "77"}]', '{}') $$,
  'Ana writes her opening balance and a deposit'
);

SELECT is(
  (SELECT amount FROM public.holdings WHERE id = 'a7000000-0000-4000-8000-0000000000a7'),
  150.00000000::numeric,
  'a history starts the amount from its opening, and each movement moves it'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.write_cash_movements('a7000000-0000-4000-8000-0000000000a7',
                        '[{"kind": "withdrawal", "date": "2026-02-01", "amount": "-200", "rates": {}}]', '{}') $$),
  'PT409 negative_cash',
  'a withdrawal never takes the cash below 0'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.write_cash_movements('a7000000-0000-4000-8000-0000000000a7',
                        '[{"kind": "deposit", "date": "2025-12-01", "amount": "1", "rates": {}}]', '{}') $$),
  'PT409 before_opening',
  'nothing comes before the opening balance'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.write_cash_movements('a7000000-0000-4000-8000-0000000000a7',
                        '[{"kind": "deposit", "date": "2026-03-01", "amount": "5", "rates": {}, "reference": "77"}]', '{}') $$),
  '23505 -',
  'a broker''s number is written once per holding'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.write_cash_movements('b7000000-0000-4000-8000-0000000000b7',
                        '[{"kind": "deposit", "date": "2026-02-01", "amount": "10", "rates": {}}]', '{}') $$),
  'PT404 not_found',
  'Ana cannot write Beto''s cash'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.write_cash_movements('a7000000-0000-4000-8000-0000000000a7',
                        '[{"kind": "settlement", "date": "2026-02-01", "amount": "-30", "rates": {},
                           "operation_id": "b1000000-0000-4000-8000-0000000000b1"}]', '{}') $$),
  '23503 -',
  'a leg never names another user''s operation'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.write_cash_movements('a7000000-0000-4000-8000-0000000000a7',
                        '[{"kind": "settlement", "date": "2026-02-01", "amount": "-30", "rates": {},
                           "operation_id": "a2000000-0000-4000-8000-0000000000a2"}]', '{}') $$),
  'PT409 other_account',
  'a leg names an operation of its holding''s account'
);

SELECT lives_ok(
  $$ SELECT public.write_cash_movements('a7000000-0000-4000-8000-0000000000a7',
       '[{"kind": "settlement", "date": "2026-02-01", "amount": "-30", "rates": {},
          "operation_id": "a1000000-0000-4000-8000-0000000000a1"}]', '{}') $$,
  'Ana settles her purchase in that account''s cash'
);

SELECT is(
  (SELECT count(*)::int FROM public.cash_movements),
  3,
  'Ana reads only her own cash movements'
);

SELECT is(
  pg_temp.error_of($$ DELETE FROM public.cash_movements WHERE id = 'bc000000-0000-4000-8000-0000000000bc' $$),
  NULL,
  'a delete of Beto''s movement reaches no row'
);

-- write_operation deleting the purchase takes its leg and gives its cash back.
SELECT set_config('plant.write_operation', 'on', true);
DELETE FROM public.operations WHERE id = 'a1000000-0000-4000-8000-0000000000a1';
SELECT set_config('plant.write_operation', 'off', true);

SELECT is(
  (SELECT amount FROM public.holdings WHERE id = 'a7000000-0000-4000-8000-0000000000a7'),
  150.00000000::numeric,
  'deleting an operation gives its cash leg back'
);

RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.cash_movements WHERE user_id = 'b0000000-0000-4000-8000-00000000000b'),
  1,
  'Beto''s movement is still there'
);

SELECT * FROM finish();
ROLLBACK;
