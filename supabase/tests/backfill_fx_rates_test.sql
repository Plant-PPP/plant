-- backfill_fx_rates: only the service role runs it; it inserts past days
-- fx_rates lacks and never today's, a future one or over a saved row; and a
-- past day still never goes in any other way.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(8);

CREATE FUNCTION pg_temp.error_of(statement text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE statement;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$f$;

GRANT EXECUTE ON FUNCTION pg_temp.error_of(text) TO service_role, authenticated;

CREATE FUNCTION pg_temp.today() RETURNS date LANGUAGE sql AS $f$
  SELECT (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
$f$;

SELECT ok(
  has_function_privilege('service_role', 'public.backfill_fx_rates(jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.backfill_fx_rates(jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.backfill_fx_rates(jsonb)', 'EXECUTE')
    AND (SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""']
         FROM pg_proc p WHERE p.oid = 'public.backfill_fx_rates(jsonb)'::regprocedure),
  'backfill_fx_rates is a definer only the service role executes, with an empty search_path'
);

-- A saved MEP rate the backfill must leave as it is.
SET LOCAL session_replication_role = replica;
INSERT INTO public.fx_rates (kind, rate_date, sell, source, quoted_at, fetched_at)
VALUES ('mep', '2001-07-02', 1000, 'dolarapi', now(), now());
SET LOCAL session_replication_role = origin;

SET LOCAL ROLE service_role;

SELECT is(
  public.backfill_fx_rates(jsonb_build_array(
    jsonb_build_object('kind', 'mep', 'rate_date', '2001-07-01', 'buy', '1180.5', 'sell', '1190.25'),
    jsonb_build_object('kind', 'mep', 'rate_date', '2001-07-02', 'buy', null, 'sell', '1195'),
    jsonb_build_object('kind', 'ccl', 'rate_date', '2001-07-01', 'buy', null, 'sell', '1210'),
    jsonb_build_object('kind', 'blue', 'rate_date', '2001-07-01', 'buy', null, 'sell', '1300'),
    jsonb_build_object('kind', 'official', 'rate_date', pg_temp.today(), 'buy', null, 'sell', '1000'),
    jsonb_build_object('kind', 'official', 'rate_date', pg_temp.today() + 1, 'buy', null, 'sell', '1000')
  )),
  2,
  'it inserts the past days of the three dollars that are missing, and nothing else'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.backfill_fx_rates('{}') $$),
  '22023',
  'it refuses rows that are not a list'
);

-- The flag set by hand opens nothing outside the function.
SELECT is(
  pg_temp.error_of($$
    SELECT pg_catalog.set_config('plant.backfill_fx_rates', 'on', true);
    INSERT INTO public.fx_rates (kind, rate_date, sell, source, quoted_at, fetched_at)
    VALUES ('mep', '2001-07-05', 1200, 'argentinadatos', now(), now()) $$),
  'PT403',
  'the service role never inserts a past day directly, the flag set or not'
);

SELECT is(
  pg_catalog.current_setting('plant.backfill_fx_rates', true),
  'off',
  'the flag is off once the function returns'
);

RESET ROLE;

SELECT results_eq(
  $$ SELECT kind::text, rate_date::text, buy::text, sell::text, source::text
     FROM public.fx_rates WHERE rate_date < '2002-01-01' ORDER BY kind, rate_date $$,
  $$ VALUES ('ccl', '2001-07-01', NULL, '1210.00000000', 'argentinadatos'),
            ('mep', '2001-07-01', '1180.50000000', '1190.25000000', 'argentinadatos'),
            ('mep', '2001-07-02', NULL, '1000.00000000', 'dolarapi') $$,
  'the saved rate stays, and the new ones are the backfill''s'
);

SELECT is(
  (SELECT count(*)::int FROM public.fx_rates
   WHERE rate_date >= pg_temp.today() AND sell = 1000 AND source = 'argentinadatos'),
  0,
  'no rate for today or later came in'
);

SET LOCAL ROLE authenticated;
SELECT is(
  pg_temp.error_of($$ SELECT public.backfill_fx_rates('[]') $$),
  '42501',
  'a user never runs it'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
