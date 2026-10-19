-- Every movement carries the official, MEP and CCL rates of its day, so an
-- operation from before the quotes job ran (a sync of last year's trades)
-- could not be written. backfill_fx_rates inserts the days fx_rates lacks
-- from ArgentinaDatos' series, past days only and never over a row that is
-- there: what the hourly job saved stays as it is. Only the service role runs
-- it, and the guard lets a past day in only while it runs.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

CREATE OR REPLACE FUNCTION private.guard_fx_rate_insert()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
BEGIN
  IF NEW.rate_date <> (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
     AND NOT (
       NEW.rate_date < (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
       AND pg_catalog.current_setting('plant.backfill_fx_rates', true) IS NOT DISTINCT FROM 'on'
       AND current_user = 'postgres'
     ) THEN
    RAISE EXCEPTION 'a quote is dated today' USING ERRCODE = 'PT403';
  END IF;
  RETURN NEW;
END;
$$;

-- The rows are [{kind, rate_date, buy, sell}]: kind official, mep or ccl,
-- buy null or at most sell. How many it inserted.
CREATE FUNCTION public.backfill_fx_rates(p_rows jsonb)
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
  -- Past days are inserted while this runs; the flag is off again before it
  -- returns, and an error rolls it back with the rows.
  PERFORM pg_catalog.set_config('plant.backfill_fx_rates', 'on', true);
  INSERT INTO public.fx_rates (kind, rate_date, buy, sell, source, quoted_at, fetched_at)
  SELECT r.kind::public.fx_rate_kind, r.rate_date, r.buy, r.sell, 'argentinadatos',
         (r.rate_date::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires'), now()
  FROM jsonb_to_recordset(p_rows) AS r(kind text, rate_date date, buy numeric, sell numeric)
  WHERE r.kind IN ('official', 'mep', 'ccl')
    AND r.rate_date < (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
  ON CONFLICT (kind, rate_date) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  PERFORM pg_catalog.set_config('plant.backfill_fx_rates', 'off', true);
  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_fx_rates(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_fx_rates(jsonb) TO service_role;
