-- save_first_prices: only the service role runs it; it inserts a symbol's
-- latest past price only when the symbol has none, never today's or a
-- future one; and a past day still never goes in any other way.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(5);

CREATE FUNCTION pg_temp.error_of(statement text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE statement;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$f$;

GRANT EXECUTE ON FUNCTION pg_temp.error_of(text) TO service_role;

CREATE FUNCTION pg_temp.today() RETURNS date LANGUAGE sql AS $f$
  SELECT (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
$f$;

SELECT ok(
  has_function_privilege('service_role', 'public.save_first_prices(jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.save_first_prices(jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.save_first_prices(jsonb)', 'EXECUTE')
    AND (SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""']
         FROM pg_proc p WHERE p.oid = 'public.save_first_prices(jsonb)'::regprocedure),
  'save_first_prices is a definer only the service role executes, with an empty search_path'
);

-- A symbol already priced, which keeps only what the hourly job saved.
SET LOCAL session_replication_role = replica;
INSERT INTO public.prices (symbol, price_date, price, currency, source, quoted_at, fetched_at)
VALUES ('ZZOLD', '2001-07-02', 10, 'USD', 'kraken', now(), now());
SET LOCAL session_replication_role = origin;

SET LOCAL ROLE service_role;

CREATE FUNCTION pg_temp.row_of(symbol text, day date, price text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_object('symbol', symbol, 'price_date', day, 'price', price,
    'currency', 'USD', 'source', 'kraken', 'quoted_at', now(), 'fetched_at', now());
$f$;
GRANT EXECUTE ON FUNCTION pg_temp.row_of(text, date, text) TO service_role;

SELECT is(
  public.save_first_prices(jsonb_build_array(
    pg_temp.row_of('ZZNEW', '2001-07-01', '5'),
    pg_temp.row_of('ZZNEW', '2001-07-03', '6'),
    pg_temp.row_of('ZZOLD', '2001-07-03', '11'),
    pg_temp.row_of('ZZTODAY', pg_temp.today(), '1'),
    pg_temp.row_of('ZZNEXT', pg_temp.today() + 1, '1')
  )),
  1,
  'it inserts only the unpriced symbol, at its latest past day'
);

RESET ROLE;

SELECT is(
  (SELECT price::text FROM public.prices WHERE symbol = 'ZZNEW'),
  '6.00000000',
  'the latest past price is the one kept'
);

SET LOCAL ROLE service_role;

SELECT is(
  pg_temp.error_of($$ SELECT public.save_first_prices('{}') $$),
  '22023',
  'it refuses rows that are not a list'
);

SELECT is(
  pg_temp.error_of($$
    SELECT pg_catalog.set_config('plant.first_prices', 'on', true);
    INSERT INTO public.prices (symbol, price_date, price, currency, source, quoted_at, fetched_at)
    VALUES ('ZZPAST', '2001-07-05', 1, 'USD', 'kraken', now(), now()) $$),
  'PT403',
  'the service role never inserts a past day directly, the flag set or not'
);

SELECT * FROM finish();
ROLLBACK;
