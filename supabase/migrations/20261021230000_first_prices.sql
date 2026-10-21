-- A symbol bought today had no price until the quotes job ran after the
-- close, so its holding showed no value all day. save_first_prices inserts a
-- symbol's last close the feeds read before today, only for a symbol prices
-- has no row of: once one is there, only the hourly job adds the next. Only
-- the service role runs it, and the guard lets a past day in only while it
-- runs.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

CREATE OR REPLACE FUNCTION private.guard_price_insert()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
BEGIN
  IF NEW.price_date <> (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
     AND NOT (
       NEW.price_date < (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
       AND pg_catalog.current_setting('plant.first_prices', true) IS NOT DISTINCT FROM 'on'
       AND current_user = 'postgres'
     ) THEN
    RAISE EXCEPTION 'a quote is dated today' USING ERRCODE = 'PT403';
  END IF;
  RETURN NEW;
END;
$$;

-- The rows are [{symbol, price_date, price, currency, source, quoted_at,
-- fetched_at}], as the feeds read them. A symbol's latest row before today
-- is kept. How many it inserted.
CREATE FUNCTION public.save_first_prices(p_rows jsonb)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  AS $$
DECLARE
  v_inserted integer;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) > 5000 THEN
    RAISE EXCEPTION 'up to 5000 rows at a time' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.set_config('plant.first_prices', 'on', true);
  INSERT INTO public.prices (symbol, price_date, price, currency, source, quoted_at, fetched_at)
  SELECT DISTINCT ON (r.symbol)
         r.symbol, r.price_date, r.price, r.currency, r.source, r.quoted_at, r.fetched_at
  FROM jsonb_populate_recordset(NULL::public.prices, p_rows) AS r
  WHERE r.price_date < (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
    AND NOT EXISTS (SELECT 1 FROM public.prices p WHERE p.symbol = r.symbol)
  ORDER BY r.symbol, r.price_date DESC
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  PERFORM pg_catalog.set_config('plant.first_prices', 'off', true);
  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.save_first_prices(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_first_prices(jsonb) TO service_role;
