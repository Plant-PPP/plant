-- Debt events and collateral: what a user may write, that each user reads and
-- writes only their own, that a row never points at another user's debt or
-- holding, and that events are written only through their RPCs.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(21);

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
SELECT 'b5000000-0000-4000-8000-0000000000b5', p.user_id, 'IOL', p.id
FROM public.portfolios p WHERE p.user_id = 'b0000000-0000-4000-8000-00000000000b';

INSERT INTO public.holdings (id, user_id, source_connection_id, asset_class, currency, amount) VALUES
  ('a7000000-0000-4000-8000-0000000000a7', 'a0000000-0000-4000-8000-00000000000a',
   'a5000000-0000-4000-8000-0000000000a5', 'cash', 'USD', '1000'),
  ('b7000000-0000-4000-8000-0000000000b7', 'b0000000-0000-4000-8000-00000000000b',
   'b5000000-0000-4000-8000-0000000000b5', 'cash', 'USD', '1000');

INSERT INTO public.liabilities (id, user_id, kind, label, currency, balance, opened_on) VALUES
  ('a9000000-0000-4000-8000-0000000000a9', 'a0000000-0000-4000-8000-00000000000a',
   'usd_debt', 'Préstamo', 'USD', '5000', '2026-01-01'),
  ('b9000000-0000-4000-8000-0000000000b9', 'b0000000-0000-4000-8000-00000000000b',
   'usd_debt', 'Préstamo', 'USD', '5000', '2026-01-01');

-- Beto's event and collateral, written as the owner.
INSERT INTO public.liability_events (id, user_id, liability_id, kind, date, amount) VALUES
  ('b8000000-0000-4000-8000-0000000000b8', 'b0000000-0000-4000-8000-00000000000b',
   'b9000000-0000-4000-8000-0000000000b9', 'payment', '2026-02-01', '100');
INSERT INTO public.liability_collateral (user_id, liability_id, holding_id) VALUES
  ('b0000000-0000-4000-8000-00000000000b', 'b9000000-0000-4000-8000-0000000000b9',
   'b7000000-0000-4000-8000-0000000000b7');

-- ── What the API roles hold ─────────────────────────────────────────────────
SELECT set_eq(
  $$ SELECT pg_temp.acl('public.liability_events') $$,
  ARRAY['(table):SELECT', '(table):DELETE',
        'liability_id:INSERT', 'kind:INSERT', 'date:INSERT', 'amount:INSERT',
        'annual_rate:INSERT', 'cash_holding_id:INSERT', 'takes_cash:INSERT', 'settles:INSERT',
        'date:UPDATE', 'amount:UPDATE', 'annual_rate:UPDATE', 'cash_holding_id:UPDATE',
        'takes_cash:UPDATE', 'settles:UPDATE'],
  'a user reads and writes an event''s own columns, never its owner, debt or kind once written'
);

SELECT set_eq(
  $$ SELECT pg_temp.acl('public.liability_collateral') $$,
  ARRAY['(table):SELECT', '(table):DELETE', 'liability_id:INSERT', 'holding_id:INSERT'],
  'a user reads, adds and removes collateral'
);

SELECT is_empty(
  $$ SELECT acl.grantee::regrole::text FROM pg_class c
     CROSS JOIN LATERAL aclexplode(c.relacl) acl
     WHERE c.oid IN ('public.liability_events'::regclass, 'public.liability_collateral'::regclass)
       AND acl.grantee IN ('anon'::regrole, 'service_role'::regrole, 0)
     UNION ALL
     SELECT acl.grantee::regrole::text FROM pg_attribute a
     CROSS JOIN LATERAL aclexplode(a.attacl) acl
     WHERE a.attrelid IN ('public.liability_events'::regclass, 'public.liability_collateral'::regclass)
       AND acl.grantee IN ('anon'::regrole, 'service_role'::regrole, 0) $$,
  'anon, the service role and PUBLIC hold nothing on events or collateral'
);

SELECT is(
  (SELECT confdelsetcols::text FROM pg_constraint
   WHERE conrelid = 'public.liability_events'::regclass
     AND confrelid = 'public.holdings'::regclass),
  (SELECT ARRAY[attnum]::smallint[]::text FROM pg_attribute
   WHERE attrelid = 'public.liability_events'::regclass AND attname = 'cash_holding_id'),
  'deleting a holding clears only the event''s cash holding, never its owner'
);

-- ── Signed in as Ana ────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.liability_events (liability_id, kind, date, amount)
                      VALUES ('a9000000-0000-4000-8000-0000000000a9', 'payment', '2026-02-01', '10') $$),
  '42501 -',
  'an event is written only through its RPC'
);

SELECT lives_ok(
  $$ SELECT public.record_liability_event('a9000000-0000-4000-8000-0000000000a9',
       '{"kind": "payment", "date": "2026-02-01", "amount": "10"}', NULL) $$,
  'a user records a payment through the RPC'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.liability_events SET amount = '20' $$),
  '42501 -',
  'nor is it changed outside its RPC'
);

SELECT is(
  pg_temp.error_of($$ DELETE FROM public.liability_events $$),
  '42501 -',
  'nor deleted'
);

SELECT results_eq(
  $$ SELECT liability_id::text, user_id::text FROM public.liability_events $$,
  $$ VALUES ('a9000000-0000-4000-8000-0000000000a9', 'a0000000-0000-4000-8000-00000000000a') $$,
  'a user reads only their own events'
);

SELECT is_empty(
  $$ SELECT id FROM public.liability_collateral $$,
  'nor reads another user''s collateral'
);

-- With the RPC's setting on, the foreign keys are what stops a pointer at
-- another user's rows.
SELECT set_config('plant.liability_event', 'on', true);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.liability_events (liability_id, kind, date, amount)
                      VALUES ('b9000000-0000-4000-8000-0000000000b9', 'payment', '2026-02-01', '10') $$),
  '23503 -',
  'an event never hangs off another user''s debt'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.liability_events (liability_id, kind, date, amount, cash_holding_id)
                      VALUES ('a9000000-0000-4000-8000-0000000000a9', 'payment', '2026-02-01', '10',
                              'b7000000-0000-4000-8000-0000000000b7') $$),
  '23503 -',
  'nor names another user''s cash holding'
);

UPDATE public.liability_events SET amount = '999' WHERE id = 'b8000000-0000-4000-8000-0000000000b8';
DELETE FROM public.liability_events WHERE id = 'b8000000-0000-4000-8000-0000000000b8';
SELECT set_config('plant.liability_event', 'off', true);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.liability_collateral (liability_id, holding_id)
                      VALUES ('a9000000-0000-4000-8000-0000000000a9', 'b7000000-0000-4000-8000-0000000000b7') $$),
  '23503 -',
  'collateral never names another user''s holding'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.liability_collateral (liability_id, holding_id)
                      VALUES ('b9000000-0000-4000-8000-0000000000b9', 'a7000000-0000-4000-8000-0000000000a7') $$),
  '23503 -',
  'nor pledges for another user''s debt'
);

INSERT INTO public.liability_collateral (liability_id, holding_id)
VALUES ('a9000000-0000-4000-8000-0000000000a9', 'a7000000-0000-4000-8000-0000000000a7');
SELECT is(
  (SELECT count(*)::int FROM public.liability_collateral),
  1,
  'a user pledges their own holding for their own debt'
);

-- A payment that took cash keeps its record when the holding goes.
SELECT public.record_liability_event('a9000000-0000-4000-8000-0000000000a9',
  '{"kind": "payment", "date": "2026-02-02", "amount": "50"}',
  '{"holding_id": "a7000000-0000-4000-8000-0000000000a7", "take": true, "expected": "1000"}');
DELETE FROM public.holdings WHERE id = 'a7000000-0000-4000-8000-0000000000a7';
SELECT results_eq(
  $$ SELECT cash_holding_id IS NULL, takes_cash FROM public.liability_events WHERE amount = '50' $$,
  $$ VALUES (true, true) $$,
  'deleting a cash holding a payment took from keeps the payment'
);

-- A settled and reopened history goes with its debt.
SELECT public.record_liability_event('a9000000-0000-4000-8000-0000000000a9',
  '{"kind": "payment", "date": "2026-03-01", "amount": "1", "settles": true}', NULL);
SELECT public.record_liability_event('a9000000-0000-4000-8000-0000000000a9',
  '{"kind": "adjustment", "date": "2026-03-02", "amount": "10"}', NULL);
SELECT public.record_liability_event('a9000000-0000-4000-8000-0000000000a9',
  '{"kind": "payment", "date": "2026-03-03", "amount": "1"}', NULL);
DELETE FROM public.liabilities WHERE id = 'a9000000-0000-4000-8000-0000000000a9';
SELECT is(
  (SELECT count(*)::int FROM public.liability_events),
  0,
  'deleting a debt deletes its events'
);

-- ── Signed in as Beto ───────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'b0000000-0000-4000-8000-00000000000b', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);

SELECT results_eq(
  $$ SELECT id::text, amount::text FROM public.liability_events $$,
  $$ VALUES ('b8000000-0000-4000-8000-0000000000b8', '100.00000000') $$,
  'another user''s update and delete leave an event as it was'
);

-- ── Enrolled in MFA but signed in at aal1 ───────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'b0000000-0000-4000-8000-00000000000b', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', true)::text, true);

SELECT is_empty(
  $$ SELECT id FROM public.liability_events UNION ALL SELECT id FROM public.liability_collateral $$,
  'a user enrolled in MFA reads no event or collateral before the second factor'
);

-- ── Anonymous ───────────────────────────────────────────────────────────────
RESET ROLE;
SET LOCAL ROLE anon;

SELECT throws_ok(
  $$ SELECT id FROM public.liability_events $$,
  '42501',
  NULL,
  'anon reads no event'
);

SELECT throws_ok(
  $$ SELECT id FROM public.liability_collateral $$,
  '42501',
  NULL,
  'anon reads no collateral'
);

SELECT * FROM finish();
ROLLBACK;
