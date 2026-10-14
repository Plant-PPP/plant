-- Price alerts: what a user may write, that each user reads and deletes only
-- their own, that only the quotes job marks one met, and that it marks each
-- once, by the latest quote.
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

-- The privileges a role holds on a table and its columns.
CREATE FUNCTION pg_temp.acl(rel regclass, role regrole) RETURNS SETOF text LANGUAGE sql AS $f$
  SELECT '(table):' || acl.privilege_type
  FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl
  WHERE c.oid = rel AND acl.grantee = role
  UNION ALL
  SELECT a.attname || ':' || acl.privilege_type
  FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl
  WHERE a.attrelid = rel AND acl.grantee = role
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

-- Beto waits for PGTAPX to drop below 50 dollars, and for BTC and the MEP to
-- cross the figures Ana's own price and rate cross: those are hers, not his.
INSERT INTO public.price_alerts (user_id, subject_kind, subject, direction, threshold, currency)
VALUES ('b0000000-0000-4000-8000-00000000000b', 'instrument', 'PGTAPX', 'below', 50, 'USD'),
       ('b0000000-0000-4000-8000-00000000000b', 'instrument', 'BTC', 'below', 1, 'USD'),
       ('b0000000-0000-4000-8000-00000000000b', 'dollar', 'mep', 'above', 99999999, 'ARS');

-- ── What the API roles hold ─────────────────────────────────────────────────
SELECT set_eq(
  $$ SELECT pg_temp.acl('public.price_alerts', 'authenticated') $$,
  ARRAY['(table):SELECT', '(table):DELETE', 'subject_kind:INSERT', 'subject:INSERT',
        'direction:INSERT', 'threshold:INSERT', 'currency:INSERT', 'gain_percent:INSERT',
        'cost_price:INSERT', 'seen_at:UPDATE', 'threshold:UPDATE', 'cost_price:UPDATE'],
  'a user reads, deletes, sets, refigures and marks seen an alert, never its owner or when it was met'
);

SELECT is_empty(
  $$ SELECT pg_temp.acl('public.price_alerts', 'anon')
     UNION ALL SELECT pg_temp.acl('public.price_alerts', 'service_role')
     UNION ALL SELECT acl.privilege_type FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl
     WHERE c.oid = 'public.price_alerts'::regclass AND acl.grantee = 0 $$,
  'anon, the service role and PUBLIC hold nothing on price alerts'
);

SELECT is(
  ARRAY[has_function_privilege('anon', 'public.meet_price_alerts()', 'EXECUTE'),
        has_function_privilege('authenticated', 'public.meet_price_alerts()', 'EXECUTE'),
        has_function_privilege('service_role', 'public.meet_price_alerts()', 'EXECUTE')],
  ARRAY[false, false, true],
  'only the service role marks alerts met'
);

-- ── Signed in as Ana ────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

INSERT INTO public.price_alerts (subject_kind, subject, direction, threshold, currency)
VALUES ('instrument', 'PGTAPX', 'above', 90, 'USD'), ('dollar', 'mep', 'above', 99999999, 'ARS'),
       ('instrument', 'BTC', 'below', 1, 'USD'), ('instrument', 'PGTAPY', 'above', 50, 'USD');
-- A gain alert whose cost the app has not worked out yet.
INSERT INTO public.price_alerts (subject_kind, subject, direction, currency, gain_percent)
VALUES ('instrument', 'BTC', 'above', 'USD', 20);

SELECT is(
  (SELECT count(*)::int FROM public.price_alerts),
  5,
  'a user sets alerts and reads only their own'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.price_alerts (subject_kind, subject, direction, threshold, currency, gain_percent)
                      VALUES ('instrument', 'BTC', 'above', 10, 'USD', 20) $$),
  '23514',
  'a gain alert''s figure comes with the cost it follows'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.price_alerts SET met_on = current_date, met_price = 1 $$),
  '42501',
  'a user never marks an alert met'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.price_alerts SET seen_at = now() $$),
  '23514',
  'an alert not met is not marked seen'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.price_alerts (subject_kind, subject, direction, threshold, currency)
                      VALUES ('dollar', 'uva', 'above', 1, 'ARS') $$),
  '23514',
  'a dollar alert is on a dollar kind, in pesos'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.meet_price_alerts() $$),
  '42501',
  'a user does not run the check'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.price_alerts (subject_kind, subject, direction, threshold, currency)
                      SELECT 'dollar', 'mep', 'above', n, 'ARS' FROM generate_series(1, 47) n $$),
  'P0001',
  'a user keeps at most 50 alerts'
);

-- ── The quotes job ──────────────────────────────────────────────────────────
RESET ROLE;
INSERT INTO public.prices (symbol, price_date, price, currency, source, quoted_at, fetched_at)
VALUES ('PGTAPX', (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date, 100, 'USD',
        'kraken', now(), now());
-- Ana's own BTC price and MEP rate, today: they win over any feed quote of
-- an earlier day. A price dated tomorrow is not hers yet.
INSERT INTO public.manual_prices (user_id, symbol, price_date, price, currency)
VALUES ('a0000000-0000-4000-8000-00000000000a', 'BTC',
        (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date, 0.5, 'USD'),
       ('a0000000-0000-4000-8000-00000000000a', 'BTC',
        (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + 1, 999999, 'USD');
INSERT INTO public.manual_rates (user_id, kind, rate_date, sell)
VALUES ('a0000000-0000-4000-8000-00000000000a', 'mep',
        (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date, 100000000);
-- Ana's own PGTAPY price today is in pesos: it says nothing of her dollar
-- alert, which the feed's dollar price of the same day meets.
INSERT INTO public.instruments (symbol, name, type, currency)
VALUES ('PGTAPY', 'PGTAP Y', 'crypto', 'USD');
INSERT INTO public.prices (symbol, price_date, price, currency, source, quoted_at, fetched_at)
VALUES ('PGTAPY', (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date, 120, 'USD',
        'kraken', now(), now());
INSERT INTO public.manual_prices (user_id, symbol, price_date, price, currency)
VALUES ('a0000000-0000-4000-8000-00000000000a', 'PGTAPY',
        (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date, 10, 'ARS');
SET LOCAL ROLE service_role;

SELECT is(public.meet_price_alerts(), 4,
  'the check marks met the alerts the latest quote meets, the user''s own price and rate up to today included, in the alert''s currency, and not a gain alert with no figure');
SELECT is(public.meet_price_alerts(), 0, 'an alert is met once');

RESET ROLE;
SELECT results_eq(
  $$ SELECT user_id::text, met_price, met_on = (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
     FROM public.price_alerts WHERE met_on IS NOT NULL ORDER BY met_price $$,
  $$ VALUES ('a0000000-0000-4000-8000-00000000000a', 0.5::numeric, true),
            ('a0000000-0000-4000-8000-00000000000a', 100::numeric, true),
            ('a0000000-0000-4000-8000-00000000000a', 120::numeric, true),
            ('a0000000-0000-4000-8000-00000000000a', 100000000::numeric, true) $$,
  'each met alert keeps the quote and the day it was met at'
);

SELECT is_empty(
  $$ SELECT subject FROM public.price_alerts
     WHERE user_id = 'b0000000-0000-4000-8000-00000000000b' AND met_on IS NOT NULL $$,
  'one user''s own price or rate never meets another user''s alert'
);

-- ── Ana again ───────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
UPDATE public.price_alerts SET seen_at = now() WHERE met_on IS NOT NULL;
DELETE FROM public.price_alerts;
RESET ROLE;

SELECT results_eq(
  $$ SELECT user_id::text, subject FROM public.price_alerts ORDER BY subject COLLATE "C" $$,
  $$ VALUES ('b0000000-0000-4000-8000-00000000000b', 'BTC'),
            ('b0000000-0000-4000-8000-00000000000b', 'PGTAPX'),
            ('b0000000-0000-4000-8000-00000000000b', 'mep') $$,
  'deleting removes only the user''s own'
);

-- ── Enrolled in MFA but signed in at aal1 ───────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'b0000000-0000-4000-8000-00000000000b', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', true)::text, true);
SET LOCAL ROLE authenticated;

SELECT is_empty(
  $$ SELECT id FROM public.price_alerts $$,
  'a user enrolled in MFA reads no alert before the second factor'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
