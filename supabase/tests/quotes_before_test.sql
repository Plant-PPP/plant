-- quotes_before: each named key's latest quote before a day, at any age, read
-- as the caller.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(6);

DELETE FROM public.fx_rates;
DELETE FROM public.prices;

-- Past rows, as a backfill writes them.
ALTER TABLE public.fx_rates DISABLE TRIGGER fx_rates_guard;
ALTER TABLE public.prices DISABLE TRIGGER prices_guard;
INSERT INTO public.fx_rates (kind, rate_date, buy, sell, source, quoted_at, fetched_at) VALUES
  ('mep', '2026-03-01', NULL, 1000, 'dolarapi', now(), now()),
  ('mep', '2026-09-01', NULL, 1300.5, 'dolarapi', now(), now()),
  ('mep', '2026-09-09', NULL, 1350, 'dolarapi', now(), now()),
  ('ccl', '2026-09-20', NULL, 1400, 'dolarapi', now(), now());
INSERT INTO public.prices (symbol, price_date, price, currency, source, quoted_at, fetched_at) VALUES
  ('KO', '2025-01-02', 8000, 'ARS', 'kraken', now(), now()),
  ('KO', '2026-09-01', 9000.25, 'ARS', 'kraken', now(), now()),
  ('BTC', '2026-09-10', 65000, 'USD', 'kraken', now(), now());
ALTER TABLE public.fx_rates ENABLE TRIGGER fx_rates_guard;
ALTER TABLE public.prices ENABLE TRIGGER prices_guard;

SELECT ok(
  (SELECT NOT p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=""']
   FROM pg_proc p
   WHERE p.oid = 'public.quotes_before(date,public.fx_rate_kind[],text[])'::regprocedure),
  'quotes_before is a stable function that runs as the caller with an empty search_path'
);

SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

SELECT results_eq(
  $$ SELECT kind::text, symbol, quote_date, amount, currency::text
     FROM public.quotes_before('2026-09-09', ARRAY['mep', 'ccl', 'mep']::public.fx_rate_kind[],
                               ARRAY['KO', 'BTC', 'ETH', 'KO'])
     ORDER BY kind NULLS LAST, symbol $$,
  $$ VALUES ('mep'::text, NULL::text, '2026-09-01'::date, '1300.50000000'::text, NULL::text),
            (NULL, 'KO', '2026-09-01', '9000.25000000', 'ARS') $$,
  'each named key''s latest quote before the day, at any age, once per key; none for a key with nothing before it'
);

SELECT results_eq(
  $$ SELECT quote_date FROM public.quotes_before('2026-09-02', ARRAY['mep']::public.fx_rate_kind[], ARRAY['KO']) ORDER BY quote_date $$,
  $$ VALUES ('2026-09-01'::date), ('2026-09-01'::date) $$,
  'a quote the day before counts'
);

SELECT is_empty(
  $$ SELECT 1 FROM public.quotes_before('2026-09-09', '{}'::public.fx_rate_kind[], '{}'::text[]) $$,
  'no key, no row'
);

RESET ROLE;

SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', true)::text, true);
SET LOCAL ROLE authenticated;

SELECT is_empty(
  $$ SELECT 1 FROM public.quotes_before('2026-12-31', ARRAY['mep']::public.fx_rate_kind[], ARRAY['KO']) $$,
  'the MFA gate hides the quotes below aal2'
);

RESET ROLE;

SELECT set_config('request.jwt.claims', '{"role": "anon"}', true);
SET LOCAL ROLE anon;

SELECT throws_ok(
  $$ SELECT 1 FROM public.quotes_before('2026-12-31', ARRAY['mep']::public.fx_rate_kind[], ARRAY['KO']) $$,
  '42501', NULL,
  'anon cannot call it'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
