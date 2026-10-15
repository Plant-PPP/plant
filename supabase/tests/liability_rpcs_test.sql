-- The debt event RPCs and guards: recording, editing and deleting events,
-- taking and giving back cash, the rules every event obeys, and the rules a
-- debt with events keeps.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(61);

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

-- Ana: dollars and pesos in one account; Beto: dollars.
INSERT INTO public.holdings (id, user_id, source_connection_id, asset_class, currency, amount) VALUES
  ('a7000000-0000-4000-8000-0000000000a7', 'a0000000-0000-4000-8000-00000000000a',
   'a5000000-0000-4000-8000-0000000000a5', 'cash', 'USD', '1000'),
  ('a7100000-0000-4000-8000-0000000000a7', 'a0000000-0000-4000-8000-00000000000a',
   'a5000000-0000-4000-8000-0000000000a5', 'cash', 'ARS', '1000'),
  ('b7000000-0000-4000-8000-0000000000b7', 'b0000000-0000-4000-8000-00000000000b',
   'b5000000-0000-4000-8000-0000000000b5', 'cash', 'USD', '1000');

-- Ana: a dollar loan opened on 2026-01-01, a peso loan in UVA and a card.
INSERT INTO public.liabilities (id, user_id, kind, label, currency, uva, balance, annual_rate,
                                accrues, opened_on) VALUES
  ('a9000000-0000-4000-8000-0000000000a9', 'a0000000-0000-4000-8000-00000000000a',
   'usd_debt', 'Préstamo', 'USD', false, '5000', '0.12', true, '2026-01-01'),
  ('a9100000-0000-4000-8000-0000000000a9', 'a0000000-0000-4000-8000-00000000000a',
   'mortgage', 'Hipoteca', 'ARS', true, '45000', NULL, false, '2026-01-01'),
  ('a9200000-0000-4000-8000-0000000000a9', 'a0000000-0000-4000-8000-00000000000a',
   'credit_card', 'Visa', 'ARS', false, '1000', NULL, false, NULL),
  ('b9000000-0000-4000-8000-0000000000b9', 'b0000000-0000-4000-8000-00000000000b',
   'usd_debt', 'Préstamo', 'USD', false, '5000', NULL, false, '2026-01-01');
INSERT INTO public.liability_events (id, user_id, liability_id, kind, date, amount) VALUES
  ('b8000000-0000-4000-8000-0000000000b8', 'b0000000-0000-4000-8000-00000000000b',
   'b9000000-0000-4000-8000-0000000000b9', 'payment', '2026-02-01', '100');

SELECT is(
  (SELECT anchored_on::text FROM public.liabilities WHERE id = 'a9200000-0000-4000-8000-0000000000a9'),
  (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date::text,
  'a debt with no opening date is anchored on the Buenos Aires day it was created'
);

SELECT col_default_is('public', 'liability_events', 'created_at', 'clock_timestamp()',
  'an event is stamped when it is written, after the user''s lock');

SELECT ok(
  NOT has_column_privilege('authenticated', 'public.liabilities', 'anchored_on', 'INSERT')
  AND NOT has_column_privilege('authenticated', 'public.liabilities', 'anchored_on', 'UPDATE'),
  'a user never writes a debt''s anchor'
);

-- ── Signed in as Ana ────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

-- Recording.
SELECT lives_ok(
  $$ SELECT public.record_liability_event('a9000000-0000-4000-8000-0000000000a9',
       '{"kind": "rate_change", "date": "2026-02-01", "annual_rate": "0.1"}', NULL) $$,
  'a user records a rate change'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.liability_events (liability_id, kind, date, amount)
                      VALUES ('a9000000-0000-4000-8000-0000000000a9', 'payment', '2026-02-01', '10') $$),
  '42501 -',
  'the RPC leaves its write setting off'
);

SELECT public.record_liability_event('a9000000-0000-4000-8000-0000000000a9',
  '{"kind": "payment", "date": "2026-02-02", "amount": "100"}',
  '{"holding_id": "a7000000-0000-4000-8000-0000000000a7", "take": false}');
SELECT results_eq(
  $$ SELECT (SELECT amount::text FROM public.holdings WHERE id = 'a7000000-0000-4000-8000-0000000000a7'),
            (SELECT cash_holding_id::text || ' ' || takes_cash FROM public.liability_events
             WHERE amount = '100') $$,
  $$ VALUES ('1000.00000000', 'a7000000-0000-4000-8000-0000000000a7 false') $$,
  'a payment names the cash holding it came from without taking it'
);

SELECT public.record_liability_event('a9000000-0000-4000-8000-0000000000a9',
  '{"kind": "payment", "date": "2026-02-03", "amount": "200"}',
  '{"holding_id": "a7000000-0000-4000-8000-0000000000a7", "take": true, "expected": "1000"}');
SELECT is(
  (SELECT amount::text FROM public.holdings WHERE id = 'a7000000-0000-4000-8000-0000000000a7'),
  '800.00000000',
  'a payment that takes cash lowers the cash holding'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.record_liability_event('a9000000-0000-4000-8000-0000000000a9',
       '{"kind": "payment", "date": "2026-02-03", "amount": "1"}',
       '{"holding_id": "a7000000-0000-4000-8000-0000000000a7", "take": true, "expected": "1000"}') $$),
  'PT409 stale',
  'a cash holding that changed since it was read is refused'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.record_liability_event('a9000000-0000-4000-8000-0000000000a9',
       '{"kind": "payment", "date": "2026-02-03", "amount": "900"}',
       '{"holding_id": "a7000000-0000-4000-8000-0000000000a7", "take": true, "expected": "800"}') $$),
  'PT409 insufficient_cash',
  'a payment takes no more cash than the holding has'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.record_liability_event('a9000000-0000-4000-8000-0000000000a9',
       '{"kind": "payment", "date": "2026-02-03", "amount": "1"}',
       '{"holding_id": "a7100000-0000-4000-8000-0000000000a7", "take": false}') $$),
  'PT409 currency',
  'a dollar debt is paid from dollars'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.record_liability_event('a9000000-0000-4000-8000-0000000000a9',
       '{"kind": "payment", "date": "2026-02-03", "amount": "1"}',
       '{"holding_id": "b7000000-0000-4000-8000-0000000000b7", "take": false}') $$),
  'PT404 not_found',
  'a payment never names another user''s cash holding'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.record_liability_event('a9100000-0000-4000-8000-0000000000a9',
       '{"kind": "payment", "date": "2026-02-03", "amount": "1"}',
       '{"holding_id": "a7100000-0000-4000-8000-0000000000a7", "take": false}') $$),
  'PT409 no_cash_link',
  'a debt in UVA takes no cash holding'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.record_liability_event('a9000000-0000-4000-8000-0000000000a9',
       '{"kind": "payment", "date": "2026-02-03", "amount": "1",
         "cash_holding_id": "a7000000-0000-4000-8000-0000000000a7"}', NULL) $$),
  '22023 -',
  'an event names its cash holding only in the cash argument'
);
SELECT is(
  pg_temp.error_of($$ SELECT public.record_liability_event('a9000000-0000-4000-8000-0000000000a9',
       '{"kind": "payment", "date": "2026-02-03", "amount": "1"}', '{"take": false}') $$),
  '22023 -',
  'a cash argument names its holding'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.record_liability_event('a9200000-0000-4000-8000-0000000000a9',
       '{"kind": "payment", "date": "2026-02-03", "amount": "1"}', NULL) $$),
  'PT409 no_history',
  'a card debt follows its statements'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.record_liability_event('a9000000-0000-4000-8000-0000000000a9',
       jsonb_build_object('kind', 'payment', 'amount', '1',
         'date', ((now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + 1)::text), NULL) $$),
  'PT409 future_date',
  'an event is dated today or earlier'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.record_liability_event('a9000000-0000-4000-8000-0000000000a9',
       '{"kind": "payment", "date": "2025-12-31", "amount": "1"}', NULL) $$),
  'PT409 before_opening',
  'an event is dated on or after the debt opens'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.record_liability_event('b9000000-0000-4000-8000-0000000000b9',
       '{"kind": "payment", "date": "2026-02-03", "amount": "1"}', NULL) $$),
  'PT404 not_found',
  'a user never records an event on another user''s debt'
);

-- Emptying a cash holding archives it; deleting the payment gives it back.
SELECT public.record_liability_event('a9000000-0000-4000-8000-0000000000a9',
  '{"kind": "payment", "date": "2026-02-04", "amount": "800"}',
  '{"holding_id": "a7000000-0000-4000-8000-0000000000a7", "take": true, "expected": "800"}');
SELECT ok(
  (SELECT archived_at IS NOT NULL FROM public.holdings WHERE id = 'a7000000-0000-4000-8000-0000000000a7'),
  'a payment that empties a cash holding archives it'
);

SELECT is(
  public.delete_liability_event((SELECT id FROM public.liability_events WHERE amount = '800')),
  true,
  'deleting a payment that took cash gives it back'
);
SELECT results_eq(
  $$ SELECT archived_at IS NULL, amount::text FROM public.holdings
     WHERE id = 'a7000000-0000-4000-8000-0000000000a7' $$,
  $$ VALUES (true, '800.00000000') $$,
  'an emptied cash holding comes back with what the payment took'
);

-- Editing keeps the event's place and moves the cash by the difference.
SELECT is(
  public.update_liability_event((SELECT id FROM public.liability_events WHERE amount = '200'),
    '{"date": "2026-02-03", "amount": "300"}',
    '{"holding_id": "a7000000-0000-4000-8000-0000000000a7", "take": true, "expected": "800"}'),
  true,
  'a user edits a payment that took cash'
);
SELECT results_eq(
  $$ SELECT (SELECT amount::text FROM public.holdings WHERE id = 'a7000000-0000-4000-8000-0000000000a7'),
            (SELECT count(*)::text FROM public.liability_events WHERE amount = '300') $$,
  $$ VALUES ('700.00000000', '1') $$,
  'editing takes only the difference from the same cash holding'
);

-- A payment that emptied its cash holding, then a new cash holding on the
-- same account: an edit that keeps the link moves it to where the cash went.
SELECT public.record_liability_event('a9000000-0000-4000-8000-0000000000a9',
  '{"kind": "payment", "date": "2026-02-05", "amount": "700"}',
  '{"holding_id": "a7000000-0000-4000-8000-0000000000a7", "take": true, "expected": "700"}');
RESET ROLE;
INSERT INTO public.holdings (id, user_id, source_connection_id, asset_class, currency, amount) VALUES
  ('a7200000-0000-4000-8000-0000000000a7', 'a0000000-0000-4000-8000-00000000000a',
   'a5000000-0000-4000-8000-0000000000a5', 'cash', 'USD', '1000');
SET LOCAL ROLE authenticated;
SELECT is(
  public.update_liability_event((SELECT id FROM public.liability_events WHERE amount = '700'),
    '{"date": "2026-02-06", "amount": "700"}',
    '{"holding_id": "a7000000-0000-4000-8000-0000000000a7", "take": true, "expected": "0"}'),
  true,
  'a user edits a payment whose emptied cash holding was replaced'
);
SELECT results_eq(
  $$ SELECT (SELECT amount::text FROM public.holdings WHERE id = 'a7200000-0000-4000-8000-0000000000a7'),
            (SELECT cash_holding_id::text FROM public.liability_events WHERE amount = '700') $$,
  $$ VALUES ('1000.00000000', 'a7200000-0000-4000-8000-0000000000a7') $$,
  'the kept link follows the cash to the holding it went back to'
);

-- A payment whose cash holding was deleted gives nothing back.
RESET ROLE;
UPDATE public.liability_events SET cash_holding_id = NULL WHERE amount = '700';
SET LOCAL ROLE authenticated;
SELECT is(
  public.delete_liability_event((SELECT id FROM public.liability_events WHERE amount = '700')),
  false,
  'deleting a payment whose cash holding is gone says nothing went back'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.update_liability_event(
       (SELECT id FROM public.liability_events WHERE kind = 'rate_change'),
       '{"kind": "payment", "date": "2026-02-01", "amount": "1"}', NULL) $$),
  '22023 -',
  'an event keeps its kind'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.record_liability_event('a9000000-0000-4000-8000-0000000000a9',
       '{"kind": "rate_change", "date": "2026-02-01"}', NULL) $$),
  '23514 -',
  'a rate change names its rate'
);

SELECT public.record_liability_event('a9100000-0000-4000-8000-0000000000a9',
  '{"kind": "adjustment", "date": "2026-02-01", "amount": "0"}', NULL);
SELECT is(
  pg_temp.error_of($$ SELECT public.record_liability_event('a9100000-0000-4000-8000-0000000000a9',
       '{"kind": "payment", "date": "2026-02-02", "amount": "1"}', NULL) $$),
  'PT409 settled',
  'an adjustment to 0 closes a debt'
);

-- The lender's real figure entered after a mistaken 0 on its day reopens it.
SELECT public.record_liability_event('a9100000-0000-4000-8000-0000000000a9',
  '{"kind": "adjustment", "date": "2026-02-01", "amount": "500"}', NULL);
SELECT lives_ok(
  $$ SELECT public.record_liability_event('a9100000-0000-4000-8000-0000000000a9',
       '{"kind": "payment", "date": "2026-02-02", "amount": "1"}', NULL) $$,
  'an adjustment above 0 entered after one to 0 on its day reopens the debt'
);
SELECT is(
  pg_temp.error_of($$ SELECT public.record_liability_event('a9100000-0000-4000-8000-0000000000a9',
       '{"kind": "adjustment", "date": "2026-02-03", "amount": "0"}', NULL);
     SELECT public.record_liability_event('a9100000-0000-4000-8000-0000000000a9',
       '{"kind": "payment", "date": "2026-02-03", "amount": "1"}', NULL) $$),
  'PT409 settled',
  'a payment entered after an adjustment to 0 on its day is refused'
);
SELECT is(
  pg_temp.error_of($$ SELECT public.record_liability_event('a9100000-0000-4000-8000-0000000000a9',
       '{"kind": "adjustment", "date": "2026-02-04", "amount": "500"}', NULL);
     SELECT public.record_liability_event('a9100000-0000-4000-8000-0000000000a9',
       '{"kind": "adjustment", "date": "2026-02-04", "amount": "0"}', NULL);
     SELECT public.record_liability_event('a9100000-0000-4000-8000-0000000000a9',
       '{"kind": "payment", "date": "2026-02-05", "amount": "1"}', NULL) $$),
  'PT409 settled',
  'an adjustment above 0 entered before one to 0 on its day does not reopen it'
);

-- A link that took nothing is kept on an edit after its holding was archived.
SELECT public.record_liability_event('a9000000-0000-4000-8000-0000000000a9',
  '{"kind": "payment", "date": "2026-02-07", "amount": "5"}',
  '{"holding_id": "a7200000-0000-4000-8000-0000000000a7", "take": false}');
RESET ROLE;
UPDATE public.holdings SET archived_at = now() WHERE id = 'a7200000-0000-4000-8000-0000000000a7';
SET LOCAL ROLE authenticated;
SELECT is(
  public.update_liability_event((SELECT id FROM public.liability_events WHERE amount = '5'),
    '{"date": "2026-02-08", "amount": "5"}',
    '{"holding_id": "a7200000-0000-4000-8000-0000000000a7", "take": false}'),
  true,
  'an edit keeps a link that took nothing to an archived cash holding'
);
SELECT is(
  pg_temp.error_of($$ SELECT public.update_liability_event(
       (SELECT id FROM public.liability_events WHERE amount = '5'),
       '{"date": "2025-12-31", "amount": "5"}', NULL) $$),
  'PT409 before_opening',
  'an edit keeps an event on or after the debt opens'
);
RESET ROLE;
UPDATE public.holdings SET currency = 'ARS' WHERE id = 'a7200000-0000-4000-8000-0000000000a7';
SET LOCAL ROLE authenticated;
SELECT is(
  pg_temp.error_of($$ SELECT public.update_liability_event(
       (SELECT id FROM public.liability_events WHERE amount = '5'),
       '{"date": "2026-02-08", "amount": "5"}',
       '{"holding_id": "a7200000-0000-4000-8000-0000000000a7", "take": false}') $$),
  'PT409 currency',
  'nor once that holding is in another currency'
);
SELECT is(
  pg_temp.error_of($$ SELECT public.update_liability_event(
       (SELECT id FROM public.liability_events WHERE amount = '5'),
       '{"date": "2026-02-08", "amount": "5"}', '{"take": true}') $$),
  '22023 -',
  'a cash link names its holding'
);

-- Cash a payment emptied does not come back into an archived account.
RESET ROLE;
INSERT INTO public.source_connections (id, user_id, institution, default_portfolio_id)
SELECT 'a6000000-0000-4000-8000-0000000000a6', p.user_id, 'Balanz', p.id
FROM public.portfolios p WHERE p.user_id = 'a0000000-0000-4000-8000-00000000000a';
INSERT INTO public.holdings (id, user_id, source_connection_id, asset_class, currency, amount) VALUES
  ('a7600000-0000-4000-8000-0000000000a7', 'a0000000-0000-4000-8000-00000000000a',
   'a6000000-0000-4000-8000-0000000000a6', 'cash', 'USD', '100');
SET LOCAL ROLE authenticated;
SELECT public.record_liability_event('a9000000-0000-4000-8000-0000000000a9',
  '{"kind": "payment", "date": "2026-02-09", "amount": "100"}',
  '{"holding_id": "a7600000-0000-4000-8000-0000000000a7", "take": true, "expected": "100"}');
RESET ROLE;
UPDATE public.source_connections SET archived_at = now()
  WHERE id = 'a6000000-0000-4000-8000-0000000000a6';
SET LOCAL ROLE authenticated;
SELECT is(
  public.delete_liability_event((SELECT id FROM public.liability_events WHERE date = '2026-02-09')),
  false,
  'deleting a payment whose emptied cash sits in an archived account gives nothing back'
);
SELECT results_eq(
  $$ SELECT archived_at IS NOT NULL, amount::text FROM public.holdings
     WHERE id = 'a7600000-0000-4000-8000-0000000000a7' $$,
  $$ VALUES (true, '100.00000000') $$,
  'and leaves that cash holding archived'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.update_liability_event('b8000000-0000-4000-8000-0000000000b8',
       '{"date": "2026-02-01", "amount": "1"}', NULL) $$),
  'PT404 not_found',
  'a user never edits another user''s event'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.delete_liability_event('b8000000-0000-4000-8000-0000000000b8') $$),
  'PT404 not_found',
  'nor deletes it'
);

SELECT is(
  pg_temp.error_of($$ DELETE FROM public.liability_events $$),
  '42501 -',
  'editing and deleting leave the write setting off'
);

-- Settling.
SELECT public.record_liability_event('a9000000-0000-4000-8000-0000000000a9',
  '{"kind": "payment", "date": "2026-03-01", "amount": "4000", "settles": true}', NULL);
SELECT is(
  pg_temp.error_of($$ SELECT public.record_liability_event('a9000000-0000-4000-8000-0000000000a9',
       '{"kind": "payment", "date": "2026-03-02", "amount": "1"}', NULL) $$),
  'PT409 settled',
  'a settled debt takes no later payment'
);
SELECT is(
  pg_temp.error_of($$ SELECT public.record_liability_event('a9000000-0000-4000-8000-0000000000a9',
       '{"kind": "payment", "date": "2026-02-15", "amount": "1", "settles": true}', NULL) $$),
  'PT409 settled',
  'nor is settled before a payment that comes after'
);
SELECT is(
  pg_temp.error_of($$ SELECT public.record_liability_event('a9000000-0000-4000-8000-0000000000a9',
       '{"kind": "payment", "date": "2026-03-01", "amount": "1", "settles": true}', NULL) $$),
  'PT409 settled',
  'nor settled twice on one day'
);
SELECT is(
  pg_temp.error_of($$ SELECT public.record_liability_event('a9000000-0000-4000-8000-0000000000a9',
       '{"kind": "rate_change", "date": "2026-03-02", "annual_rate": "0.1"}', NULL) $$),
  'PT409 settled',
  'nor takes a rate change'
);
SELECT is(
  pg_temp.error_of($$ SELECT public.record_liability_event('a9000000-0000-4000-8000-0000000000a9',
       '{"kind": "adjustment", "date": "2026-03-01", "amount": "0"}', NULL) $$),
  'PT409 settled',
  'nor the lender''s 0 on the day of its settle'
);
RESET ROLE;
SELECT is(
  pg_temp.error_of($$ INSERT INTO public.liability_events (user_id, liability_id, kind, date, amount)
       VALUES ('a0000000-0000-4000-8000-00000000000a', 'a9000000-0000-4000-8000-0000000000a9',
               'payment', '2026-03-02', '1') $$),
  'PT409 settled',
  'the history rule holds for every role'
);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$ SELECT public.record_liability_event('a9000000-0000-4000-8000-0000000000a9',
       '{"kind": "adjustment", "date": "2026-03-05", "amount": "50"}', NULL) $$,
  'an adjustment reopens a settled debt'
);
SELECT lives_ok(
  $$ SELECT public.record_liability_event('a9000000-0000-4000-8000-0000000000a9',
       '{"kind": "payment", "date": "2026-03-06", "amount": "50"}', NULL) $$,
  'and payments follow it'
);
SELECT is(
  pg_temp.error_of($$ SELECT public.delete_liability_event(
       (SELECT id FROM public.liability_events WHERE kind = 'adjustment' AND date = '2026-03-05')) $$),
  'PT409 settled',
  'the adjustment that reopened a settled debt is not deleted under a later payment'
);
SELECT is(
  pg_temp.error_of($$ SELECT public.update_liability_event(
       (SELECT id FROM public.liability_events WHERE kind = 'adjustment' AND date = '2026-03-05'),
       '{"date": "2026-03-10", "amount": "50"}', NULL) $$),
  'PT409 settled',
  'nor moved past it'
);

-- The debt's own rules once it has events.
SELECT lives_ok(
  $$ UPDATE public.liabilities SET kind = 'usd_debt', label = 'Préstamo Nexo', currency = 'USD',
       uva = false, instrument_symbol = NULL, balance = '6000', annual_rate = '0.13'
     WHERE id = 'a9000000-0000-4000-8000-0000000000a9' $$,
  'a debt with events changes its name, principal and rate with its unit as it was'
);
SELECT is(
  pg_temp.error_of($$ UPDATE public.liabilities SET kind = 'personal_loan', currency = 'ARS'
                      WHERE id = 'a9000000-0000-4000-8000-0000000000a9' $$),
  'PT409 has_history',
  'a debt with events keeps its unit'
);
SELECT is(
  pg_temp.error_of($$ UPDATE public.liabilities SET kind = 'credit_card'
                      WHERE id = 'a9000000-0000-4000-8000-0000000000a9' $$),
  'PT409 has_history',
  'and its kind'
);
SELECT is(
  pg_temp.error_of($$ UPDATE public.liabilities SET opened_on = '2026-02-10'
                      WHERE id = 'a9000000-0000-4000-8000-0000000000a9' $$),
  'PT409 before_opening',
  'a debt opens on or before its first event'
);
SELECT is(
  pg_temp.error_of($$ UPDATE public.liabilities SET opened_on = NULL, accrues = false
                      WHERE id = 'a9000000-0000-4000-8000-0000000000a9' $$),
  'PT409 before_opening',
  'clearing the opening date moves the anchor to the day it was created'
);
SELECT is(
  pg_temp.error_of($$ INSERT INTO public.liabilities (kind, label, currency, balance, opened_on)
                      VALUES ('usd_debt', 'Préstamo', 'USD', '1',
                              (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + 1) $$),
  'PT409 future_date',
  'a debt opens today or earlier'
);
SELECT is(
  pg_temp.error_of($$ INSERT INTO public.liabilities (kind, label, currency, balance, accrues)
                      VALUES ('usd_debt', 'Préstamo', 'USD', '1', true) $$),
  '23514 -',
  'a debt that accrues names the day of its balance'
);
SELECT is(
  pg_temp.error_of($$ INSERT INTO public.liabilities (kind, label, currency, balance, accrues,
                                                     opened_on, installment)
                      VALUES ('usd_debt', 'Préstamo', 'USD', '1', true, '2026-01-01', '10') $$),
  '23514 -',
  'a debt that accrues has no installment'
);
SELECT is(
  pg_temp.error_of($$ INSERT INTO public.liabilities (kind, label, currency, balance, accrues, opened_on)
                      VALUES ('credit_card', 'Visa', 'ARS', '1', true, '2026-01-01') $$),
  '23514 -',
  'a card never accrues'
);

-- ── Signed in as Beto ───────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'b0000000-0000-4000-8000-00000000000b', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);

SELECT results_eq(
  $$ SELECT (SELECT amount::text FROM public.holdings),
            (SELECT string_agg(id::text || ' ' || amount::text, ',') FROM public.liability_events) $$,
  $$ VALUES ('1000.00000000', 'b8000000-0000-4000-8000-0000000000b8 100.00000000') $$,
  'another user''s calls leave a user''s cash and events as they were'
);

SELECT * FROM finish();
ROLLBACK;
