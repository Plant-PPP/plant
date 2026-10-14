-- Operations, movements, manual prices and rates, and the tax report's
-- exclusions: what a user may write on each, that each user reads and writes
-- only their own, and what write_operation does with an operation's movements
-- and the holdings they move.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(55);

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

-- The revisions write_operation expects: every holding of the symbol the
-- caller sees.
CREATE FUNCTION pg_temp.revisions(symbol text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT COALESCE(jsonb_object_agg(h.id, h.movements_revision), '{}'::jsonb)
  FROM public.holdings h WHERE h.instrument_symbol = symbol
$f$;

-- A purchase, sale or other trade of AAPL in Ana's IOL account.
CREATE FUNCTION pg_temp.trade(kind text, quantity text, date text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_object(
    'source_connection_id', 'a5000000-0000-4000-8000-0000000000a5',
    'portfolio_id', 'a1000000-0000-4000-8000-0000000000a1',
    'instrument_symbol', 'AAPL', 'kind', kind, 'date', date, 'currency', 'ARS',
    'quantity', quantity, 'price', '18000', 'rates', '{}'::jsonb)
$f$;

-- Operation ids by name, kept across statements.
CREATE TEMP TABLE ops (name text PRIMARY KEY, id uuid);

GRANT EXECUTE ON FUNCTION pg_temp.error_of(text) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.revisions(text) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.trade(text, text, text) TO authenticated;
GRANT ALL ON TABLE ops TO authenticated;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at)
VALUES
  ('a0000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ana@pgtap.invalid', '', now(), '{}', '{}', now(), now()),
  ('b0000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'beto@pgtap.invalid', '', now(), '{}', '{}', now(), now());

-- Each user has "Principal" from signup and an account defaulting to it; Beto
-- has an operation with one movement and a manual price.
UPDATE public.portfolios SET id = 'a1000000-0000-4000-8000-0000000000a1'
WHERE user_id = 'a0000000-0000-4000-8000-00000000000a';
UPDATE public.portfolios SET id = 'b1000000-0000-4000-8000-0000000000b1'
WHERE user_id = 'b0000000-0000-4000-8000-00000000000b';
INSERT INTO public.source_connections (id, user_id, institution, default_portfolio_id) VALUES
  ('a5000000-0000-4000-8000-0000000000a5', 'a0000000-0000-4000-8000-00000000000a', 'IOL',
   'a1000000-0000-4000-8000-0000000000a1'),
  ('b5000000-0000-4000-8000-0000000000b5', 'b0000000-0000-4000-8000-00000000000b', 'IOL',
   'b1000000-0000-4000-8000-0000000000b1');
INSERT INTO public.holdings (id, user_id, source_connection_id, portfolio_id, asset_class,
                             instrument_symbol, amount) VALUES
  ('b7000000-0000-4000-8000-0000000000b7', 'b0000000-0000-4000-8000-00000000000b',
   'b5000000-0000-4000-8000-0000000000b5', 'b1000000-0000-4000-8000-0000000000b1',
   'instrument', 'AAPL', '1');
INSERT INTO public.operations (id, user_id, entry_order) VALUES
  ('b8000000-0000-4000-8000-0000000000b8', 'b0000000-0000-4000-8000-00000000000b', 1);
INSERT INTO public.movements (user_id, holding_id, operation_id, entry_order, kind, date, currency,
                              quantity, price, rates) VALUES
  ('b0000000-0000-4000-8000-00000000000b', 'b7000000-0000-4000-8000-0000000000b7',
   'b8000000-0000-4000-8000-0000000000b8', 1, 'purchase', '2026-01-02', 'ARS', '1', '18000', '{}');
INSERT INTO public.manual_prices (user_id, symbol, price_date, price, currency) VALUES
  ('b0000000-0000-4000-8000-00000000000b', 'AAPL', '2026-01-02', '18000', 'ARS');

-- ── What the API roles hold ─────────────────────────────────────────────────
SELECT set_eq(
  $$ SELECT pg_temp.acl('public.operations') $$,
  ARRAY['(table):SELECT', '(table):DELETE', 'entry_order:INSERT', 'entry_order:UPDATE'],
  'a user reads and deletes operations and writes only their entry order'
);

SELECT set_eq(
  $$ SELECT pg_temp.acl('public.movements') $$,
  ARRAY['(table):SELECT', '(table):DELETE',
        'holding_id:INSERT', 'operation_id:INSERT', 'entry_order:INSERT', 'kind:INSERT',
        'date:INSERT', 'currency:INSERT', 'direction:INSERT', 'quantity:INSERT', 'price:INSERT',
        'amount:INSERT', 'charges:INSERT', 'reference:INSERT', 'note:INSERT', 'rates:INSERT'],
  'a user reads, inserts and deletes movements and never updates one'
);

SELECT set_eq(
  $$ SELECT pg_temp.acl('public.manual_prices') $$,
  ARRAY['(table):SELECT', '(table):DELETE',
        'symbol:INSERT', 'price_date:INSERT', 'price:INSERT', 'currency:INSERT',
        'price:UPDATE', 'currency:UPDATE'],
  'a user writes a manual price and changes only its value'
);

SELECT set_eq(
  $$ SELECT pg_temp.acl('public.manual_rates') $$,
  ARRAY['(table):SELECT', '(table):DELETE', 'kind:INSERT', 'rate_date:INSERT', 'sell:INSERT',
        'sell:UPDATE'],
  'a user writes a manual rate and changes only its value'
);

SELECT set_eq(
  $$ SELECT pg_temp.acl('public.tax_report_exclusions') $$,
  ARRAY['(table):SELECT', '(table):DELETE', 'instrument_symbol:INSERT', 'holding_id:INSERT'],
  'a user adds and removes exclusions and never updates one'
);

SELECT is_empty(
  $$ SELECT c.relname || ' ' || acl.grantee::regrole::text FROM pg_class c
     CROSS JOIN LATERAL aclexplode(c.relacl) acl
     WHERE c.oid IN ('public.operations'::regclass, 'public.movements'::regclass,
                     'public.manual_prices'::regclass, 'public.manual_rates'::regclass,
                     'public.tax_report_exclusions'::regclass)
       AND acl.grantee IN ('anon'::regrole, 'service_role'::regrole, 0)
     UNION ALL
     SELECT c.relname || ' ' || acl.grantee::regrole::text FROM pg_attribute a
     JOIN pg_class c ON c.oid = a.attrelid
     CROSS JOIN LATERAL aclexplode(a.attacl) acl
     WHERE c.oid IN ('public.operations'::regclass, 'public.movements'::regclass,
                     'public.manual_prices'::regclass, 'public.manual_rates'::regclass,
                     'public.tax_report_exclusions'::regclass)
       AND acl.grantee IN ('anon'::regrole, 'service_role'::regrole, 0) $$,
  'anon, the service role and PUBLIC hold nothing on the new tables'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.write_operation(uuid,jsonb,jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'public.write_operation(uuid,jsonb,jsonb)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.write_operation(uuid,jsonb,jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.write_operation(uuid,jsonb,jsonb,boolean)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'public.write_operation(uuid,jsonb,jsonb,boolean)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.write_operation(uuid,jsonb,jsonb,boolean)', 'EXECUTE'),
  'only authenticated may call write_operation'
);

-- ── Signed in as Ana ────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

-- A purchase opens a holding at its units, entered first.
INSERT INTO ops VALUES ('purchase', public.write_operation(
  NULL, jsonb_build_array(pg_temp.trade('purchase', '10', '2026-02-02')), pg_temp.revisions('AAPL')));

SELECT results_eq(
  $$ SELECT h.amount::text, h.movements_revision, m.entry_order, m.rank, m.kind::text
     FROM public.holdings h JOIN public.movements m ON m.holding_id = h.id
     WHERE m.operation_id = (SELECT id FROM ops WHERE name = 'purchase') $$,
  $$ VALUES ('10.00000000', 1::bigint, 1::bigint, 1::bigint, 'purchase') $$,
  'a purchase opens a holding at its units, with the first entry order'
);

-- An opening balance the same day ranks before it.
INSERT INTO ops VALUES ('opening', public.write_operation(
  NULL, jsonb_build_array(pg_temp.trade('opening_balance', '2', '2026-02-02')), pg_temp.revisions('AAPL')));

SELECT results_eq(
  $$ SELECT m.kind::text, m.entry_order, m.rank FROM public.movements m
     ORDER BY m.date, m.rank, m.id $$,
  $$ VALUES ('opening_balance', 2::bigint, -1::bigint), ('purchase', 1::bigint, 1::bigint) $$,
  'an opening balance ranks first in its day, whatever its entry order'
);

SELECT is(
  (SELECT amount::text FROM public.holdings WHERE instrument_symbol = 'AAPL'),
  '12.00000000',
  'the holding holds what its movements leave'
);

INSERT INTO ops VALUES ('sale', public.write_operation(
  NULL, jsonb_build_array(pg_temp.trade('sale', '5', '2026-03-02')), pg_temp.revisions('AAPL')));

SELECT is(
  (SELECT amount::text FROM public.holdings WHERE instrument_symbol = 'AAPL'),
  '7.00000000',
  'a sale takes its units out'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.write_operation(
    NULL, jsonb_build_array(pg_temp.trade('sale', '1', '2026-03-03')),
    jsonb_build_object((SELECT id FROM public.holdings WHERE instrument_symbol = 'AAPL'), 0)) $$),
  'PT409 stale',
  'a write from an older read of the holdings is refused'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.write_operation(
    NULL, '[]'::jsonb || pg_temp.trade('purchase', '1', '2026-03-03'), '{}'::jsonb) $$),
  'PT409 stale',
  'a write that missed a holding of the instrument is refused'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.write_operation(
    NULL, jsonb_build_array(pg_temp.trade('sale', '8', '2026-03-03')), pg_temp.revisions('AAPL')) $$),
  'PT409 negative_units',
  'a sale of more than is held is refused'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.write_operation(
    NULL, jsonb_build_array(pg_temp.trade('sale', '1', '2026-01-01')), pg_temp.revisions('AAPL')) $$),
  'PT409 negative_units',
  'a sale before anything was held is refused'
);

-- Editing the purchase keeps its entry order and settles the holding.
SELECT is(
  public.write_operation(
    (SELECT id FROM ops WHERE name = 'purchase'),
    jsonb_build_array(pg_temp.trade('purchase', '4', '2026-02-02')), pg_temp.revisions('AAPL')),
  (SELECT id FROM ops WHERE name = 'purchase'),
  'an edit answers the operation it rewrote'
);

SELECT results_eq(
  $$ SELECT m.quantity::text, m.entry_order FROM public.movements m
     WHERE m.operation_id = (SELECT id FROM ops WHERE name = 'purchase') $$,
  $$ VALUES ('4.00000000', 1::bigint) $$,
  'an edit replaces the operation''s movements and keeps its entry order'
);

SELECT results_eq(
  $$ SELECT amount::text, movements_revision FROM public.holdings WHERE instrument_symbol = 'AAPL' $$,
  $$ VALUES ('1.00000000', 4::bigint) $$,
  'every write leaves the holding at its units and bumps its revision'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.write_operation(
    (SELECT id FROM ops WHERE name = 'opening'), '[]'::jsonb, pg_temp.revisions('AAPL')) $$),
  'PT409 negative_units',
  'deleting what a later sale took from is refused'
);

SELECT is(
  public.write_operation((SELECT id FROM ops WHERE name = 'sale'), '[]'::jsonb, pg_temp.revisions('AAPL')),
  NULL::uuid,
  'a delete answers null'
);

SELECT is_empty(
  $$ SELECT 1 FROM public.operations WHERE id = (SELECT id FROM ops WHERE name = 'sale')
     UNION ALL
     SELECT 1 FROM public.movements WHERE operation_id = (SELECT id FROM ops WHERE name = 'sale') $$,
  'a delete takes the operation and its movements'
);

SELECT lives_ok(
  $$ SELECT public.write_operation((SELECT id FROM ops WHERE name = 'opening'), '[]'::jsonb, pg_temp.revisions('AAPL')) $$,
  'a user deletes an operation nothing later took from'
);

SELECT lives_ok(
  $$ SELECT public.write_operation((SELECT id FROM ops WHERE name = 'purchase'), '[]'::jsonb, pg_temp.revisions('AAPL')) $$,
  'a user deletes their last operation of a holding'
);

SELECT is_empty(
  $$ SELECT 1 FROM public.holdings WHERE instrument_symbol = 'AAPL' $$,
  'a holding with no movement left is deleted'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.write_operation(
    'b8000000-0000-4000-8000-0000000000b8', '[]'::jsonb, '{}'::jsonb) $$),
  'PT404 not_found',
  'a user cannot delete another user''s operation'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.write_operation(
    'b8000000-0000-4000-8000-0000000000b8', jsonb_build_array(pg_temp.trade('purchase', '1', '2026-02-02')),
    '{}'::jsonb) $$),
  'PT404 not_found',
  'a user cannot rewrite another user''s operation'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.write_operation(
    NULL, jsonb_build_array(pg_temp.trade('purchase', '1', '2026-02-02')
                            || '{"source_connection_id": "b5000000-0000-4000-8000-0000000000b5"}'),
    '{}'::jsonb) $$),
  '23503 -',
  'a user cannot write into another user''s account'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.write_operation(NULL, '[]'::jsonb, '{}'::jsonb) $$),
  '22023 -',
  'a new operation has a part'
);

-- ── The tables' own rules ───────────────────────────────────────────────────
INSERT INTO ops VALUES ('own', public.write_operation(
  NULL, jsonb_build_array(pg_temp.trade('purchase', '3', '2026-02-02')), '{}'::jsonb));

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.movements (holding_id, operation_id, entry_order, kind, date,
                                                    currency, quantity, amount, rates)
     SELECT m.holding_id, m.operation_id, 9, 'dividend', '2026-02-03', 'ARS', '1', '5', '{}'
     FROM public.movements m LIMIT 1 $$),
  '23514 -',
  'income is an amount, with no quantity'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.movements (holding_id, operation_id, entry_order, kind, date,
                                                    currency, direction, quantity, price, rates)
     SELECT m.holding_id, m.operation_id, 9, 'transfer', '2026-02-03', 'ARS', 'out', '1', '5', '{}'
     FROM public.movements m LIMIT 1 $$),
  '23514 -',
  'units transferred out carry their own cost'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.movements (holding_id, operation_id, entry_order, kind, date,
                                                    currency, direction, quantity, charges, rates)
     SELECT m.holding_id, m.operation_id, 9, 'transfer', '2026-02-03', 'ARS', 'in', '1',
            '[{"kind": "commission", "label": null, "amount": "5"}]', '{}'
     FROM public.movements m LIMIT 1 $$),
  '23514 -',
  'units transferred in carry no fee'
);

-- The insert is rolled back by the exception its block raises after it.
SELECT is(
  pg_temp.error_of($$ DO $d$ BEGIN
       INSERT INTO public.movements (holding_id, operation_id, entry_order, kind, date, currency,
                                     direction, quantity, charges, rates)
       SELECT m.holding_id, m.operation_id, 9, 'transfer', '2026-02-03', 'ARS', 'out', '1',
              '[{"kind": "commission", "label": null, "amount": "5"}]', '{}'
       FROM public.movements m LIMIT 1;
       RAISE EXCEPTION 'inserted' USING HINT = 'inserted';
     END $d$ $$),
  'P0001 inserted',
  'units transferred out carry the transfer''s fee'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.movements (holding_id, operation_id, entry_order, kind, date,
                                                    currency, quantity, price, rates)
     SELECT m.holding_id, m.operation_id, 9, 'purchase', '2026-02-03', 'ARS', '1', '5', '[]'
     FROM public.movements m LIMIT 1 $$),
  '23514 -',
  'a movement''s rates are an object'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.movements (holding_id, operation_id, entry_order, kind, date,
                                                    currency, quantity, price, rates)
     SELECT 'b7000000-0000-4000-8000-0000000000b7', m.operation_id, 9, 'purchase', '2026-02-03', 'ARS',
            '1', '5', '{}'
     FROM public.movements m LIMIT 1 $$),
  '23503 -',
  'a movement cannot go into another user''s holding'
);

SELECT results_eq(
  $$ SELECT DISTINCT user_id FROM public.movements
     UNION SELECT DISTINCT user_id FROM public.operations
     UNION SELECT DISTINCT user_id FROM public.manual_prices $$,
  $$ VALUES ('a0000000-0000-4000-8000-00000000000a'::uuid) $$,
  'a user reads only their own operations, movements and prices'
);

SELECT is_empty(
  $$ DELETE FROM public.movements WHERE operation_id = 'b8000000-0000-4000-8000-0000000000b8' RETURNING id $$,
  'a user cannot delete another user''s movements'
);

SELECT lives_ok(
  $$ INSERT INTO public.manual_prices (symbol, price_date, price, currency)
     VALUES ('AAPL', '2026-01-02', '18100', 'ARS') $$,
  'a user states a price another user stated on the same day'
);

SELECT throws_ok(
  $$ INSERT INTO public.manual_prices (symbol, price_date, price, currency)
     VALUES ('AAPL', '2026-01-02', '18200', 'ARS') $$,
  '23505', NULL,
  'a user states one price an instrument a day'
);

SELECT throws_ok(
  $$ INSERT INTO public.manual_prices (symbol, price_date, price, currency)
     VALUES ('AAPL', '2026-01-03', '0', 'ARS') $$,
  '23514', NULL,
  'a price is positive'
);

SELECT throws_ok(
  $$ INSERT INTO public.manual_rates (kind, rate_date, sell) VALUES ('blue', '2026-01-02', '1300') $$,
  '22P02', NULL,
  'a manual rate is MEP, CCL or official'
);

SELECT throws_ok(
  $$ INSERT INTO public.tax_report_exclusions (instrument_symbol, holding_id)
     VALUES ('AAPL', (SELECT holding_id FROM public.movements LIMIT 1)) $$,
  '23514', NULL,
  'an exclusion names an instrument or a holding, not both'
);

SELECT throws_ok(
  $$ INSERT INTO public.tax_report_exclusions (instrument_symbol, holding_id) VALUES (NULL, NULL) $$,
  '23514', NULL,
  'an exclusion names something'
);

-- An edit that moves a sale to a later day goes last there when the app
-- admitted it so; keeping its place would sell before that day's purchase.
SAVEPOINT edit_last;
INSERT INTO ops VALUES ('ko_buy', public.write_operation(
  NULL, jsonb_build_array(pg_temp.trade('purchase', '5', '2026-04-01') || '{"instrument_symbol": "KO"}'),
  pg_temp.revisions('KO')));
INSERT INTO ops VALUES ('ko_sale', public.write_operation(
  NULL, jsonb_build_array(pg_temp.trade('sale', '5', '2026-04-01') || '{"instrument_symbol": "KO"}'),
  pg_temp.revisions('KO')));
INSERT INTO ops VALUES ('ko_later', public.write_operation(
  NULL, jsonb_build_array(pg_temp.trade('purchase', '5', '2026-04-03') || '{"instrument_symbol": "KO"}'),
  pg_temp.revisions('KO')));

SELECT is(
  pg_temp.error_of($$ SELECT public.write_operation(
    (SELECT id FROM ops WHERE name = 'ko_sale'),
    jsonb_build_array(pg_temp.trade('sale', '10', '2026-04-03') || '{"instrument_symbol": "KO"}'),
    pg_temp.revisions('KO'), false) $$),
  'PT409 negative_units',
  'an edit that keeps its place on its new day sells before that day''s purchase'
);

SELECT lives_ok(
  $$ SELECT public.write_operation(
    (SELECT id FROM ops WHERE name = 'ko_sale'),
    jsonb_build_array(pg_temp.trade('sale', '10', '2026-04-03') || '{"instrument_symbol": "KO"}'),
    pg_temp.revisions('KO'), true) $$,
  'an edit that goes last on its new day sells after that day''s purchase'
);

SELECT results_eq(
  $$ SELECT o.name, m.entry_order > (SELECT max(m2.entry_order) FROM public.movements m2
                                      JOIN ops o2 ON o2.id = m2.operation_id
                                      WHERE o2.name = 'ko_later'),
            (SELECT h.amount::text FROM public.holdings h WHERE h.id = m.holding_id),
            (SELECT op.entry_order = m.entry_order FROM public.operations op WHERE op.id = m.operation_id)
     FROM public.movements m JOIN ops o ON o.id = m.operation_id WHERE o.name = 'ko_sale' $$,
  $$ VALUES ('ko_sale', true, '0.00000000', true) $$,
  'the edited sale takes the next entry order, with its operation, and the holding sells out'
);
ROLLBACK TO SAVEPOINT edit_last;

-- An account whose holding is sold out is archived, and a buy cannot reopen
-- the holding there.
SAVEPOINT sold_out;
SELECT public.write_operation(
  NULL, jsonb_build_array(pg_temp.trade('sale', '3', '2026-03-02')), pg_temp.revisions('AAPL'));

SELECT lives_ok(
  $$ UPDATE public.source_connections SET archived_at = now()
     WHERE id = 'a5000000-0000-4000-8000-0000000000a5' $$,
  'an account whose only holding is sold out can be archived'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.write_operation(
    NULL, jsonb_build_array(pg_temp.trade('purchase', '1', '2026-04-02')), pg_temp.revisions('AAPL')) $$),
  'PT409 source_connection_archived',
  'a buy cannot reopen a sold-out holding in an archived account'
);
ROLLBACK TO SAVEPOINT sold_out;

-- Outside write_operation a user writes no operation or movement. Every
-- earlier write_operation call marked this transaction, so the mark is
-- cleared first, as a new request starts without it.
SAVEPOINT direct;
SELECT set_config('plant.write_operation', '', true);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.movements (holding_id, operation_id, entry_order, kind, date,
                                                    currency, quantity, price, rates)
     SELECT m.holding_id, m.operation_id, 9, 'purchase', '2026-02-03', 'ARS', '1', '5', '{}'
     FROM public.movements m LIMIT 1 $$),
  '42501 -',
  'a movement cannot be inserted outside write_operation'
);

SELECT is(
  pg_temp.error_of($$ DELETE FROM public.movements $$),
  '42501 -',
  'a movement cannot be deleted outside write_operation'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.operations (entry_order) VALUES (1000) $$),
  '42501 -',
  'an operation cannot be inserted outside write_operation'
);

SELECT is(
  pg_temp.error_of($$ DELETE FROM public.operations $$),
  '42501 -',
  'an operation cannot be deleted outside write_operation'
);

SELECT lives_ok(
  $$ DELETE FROM public.holdings WHERE instrument_symbol = 'AAPL' $$,
  'deleting a holding still takes its movements with it'
);

SELECT lives_ok(
  $$ SELECT public.write_operation(
       NULL, jsonb_build_array(pg_temp.trade('purchase', '1', '2026-04-02')), pg_temp.revisions('AAPL')) $$,
  'write_operation still writes them'
);
ROLLBACK TO SAVEPOINT direct;

RESET ROLE;

SELECT results_eq(
  $$ SELECT amount::text FROM public.holdings WHERE id = 'b7000000-0000-4000-8000-0000000000b7'
     UNION ALL
     SELECT count(*)::text FROM public.movements WHERE user_id = 'b0000000-0000-4000-8000-00000000000b' $$,
  $$ VALUES ('1.00000000'), ('1') $$,
  'the other user''s holding and movements are unchanged'
);

DELETE FROM auth.users WHERE id = 'a0000000-0000-4000-8000-00000000000a';
SELECT is_empty(
  $$ SELECT 1 FROM public.operations WHERE user_id = 'a0000000-0000-4000-8000-00000000000a'
     UNION ALL SELECT 1 FROM public.movements WHERE user_id = 'a0000000-0000-4000-8000-00000000000a'
     UNION ALL SELECT 1 FROM public.manual_prices WHERE user_id = 'a0000000-0000-4000-8000-00000000000a' $$,
  'deleting a user deletes their operations, movements and prices'
);

SELECT * FROM finish();
ROLLBACK;
