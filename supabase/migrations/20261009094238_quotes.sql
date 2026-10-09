-- Quotes: dollar rates, UVA and crypto prices, one row per day, read by every
-- signed-in user and inserted only by the server's daily job.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

CREATE TYPE public.fx_rate_kind AS ENUM ('official', 'mep', 'ccl', 'blue', 'uva');
-- Extend-only: a new provider adds its value with ALTER TYPE ... ADD VALUE.
CREATE TYPE public.quote_source AS ENUM ('dolarapi', 'argentinadatos', 'kraken');
CREATE TYPE public.currency AS ENUM ('ARS', 'USD');

-- One row per kind and Buenos Aires day, written once, in pesos per dollar
-- (per UVA for uva). buy is the house's buying price; UVA has a single value,
-- kept in sell. quoted_at is the instant the source stamps (the fetch instant
-- when it stamps none).
CREATE TABLE public.fx_rates (
  kind public.fx_rate_kind NOT NULL,
  rate_date date NOT NULL,
  buy numeric(20, 8) CHECK (buy > 0),
  sell numeric(20, 8) NOT NULL CHECK (sell > 0),
  source public.quote_source NOT NULL,
  quoted_at timestamptz NOT NULL,
  fetched_at timestamptz NOT NULL,
  PRIMARY KEY (kind, rate_date),
  CHECK (buy IS NULL OR buy <= sell),
  CHECK (kind <> 'uva' OR buy IS NULL)
);

CREATE TABLE public.prices (
  symbol text NOT NULL CHECK (symbol ~ '^[A-Z0-9]{1,15}$'),
  price_date date NOT NULL,
  price numeric(20, 8) NOT NULL CHECK (price > 0),
  currency public.currency NOT NULL,
  source public.quote_source NOT NULL,
  quoted_at timestamptz NOT NULL,
  fetched_at timestamptz NOT NULL,
  PRIMARY KEY (symbol, price_date)
);

-- A quote is written once and read by every user, so only today's may be
-- inserted: a past or future row would never be replaced. The table owner
-- corrects a row with UPDATE, and a backfill disables the trigger inside its
-- own migration. PT403 makes PostgREST answer 403 and keeps the refusal apart
-- from a missing grant (42501).
CREATE FUNCTION private.guard_fx_rate_insert()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
BEGIN
  IF NEW.rate_date <> (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date THEN
    RAISE EXCEPTION 'a quote is dated today' USING ERRCODE = 'PT403';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION private.guard_price_insert()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
BEGIN
  IF NEW.price_date <> (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date THEN
    RAISE EXCEPTION 'a quote is dated today' USING ERRCODE = 'PT403';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_fx_rate_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.guard_price_insert() FROM PUBLIC, anon, authenticated;

-- A BEFORE INSERT trigger fires before ON CONFLICT looks for the row, so a
-- past-dated duplicate is refused too.
CREATE TRIGGER fx_rates_guard BEFORE INSERT ON public.fx_rates
  FOR EACH ROW EXECUTE FUNCTION private.guard_fx_rate_insert();
CREATE TRIGGER prices_guard BEFORE INSERT ON public.prices
  FOR EACH ROW EXECUTE FUNCTION private.guard_price_insert();

ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prices ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.fx_rates FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.prices FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.fx_rates TO authenticated;
GRANT SELECT ON TABLE public.prices TO authenticated;
-- service_role bypasses RLS, so its grants are the whole boundary: insert
-- rows, and read the key columns, which ON CONFLICT DO NOTHING and the
-- writer's RETURNING need.
GRANT SELECT (kind, rate_date),
      INSERT (kind, rate_date, buy, sell, source, quoted_at, fetched_at)
  ON TABLE public.fx_rates TO service_role;
GRANT SELECT (symbol, price_date),
      INSERT (symbol, price_date, price, currency, source, quoted_at, fetched_at)
  ON TABLE public.prices TO service_role;

-- Market data, the same for every user.
CREATE POLICY fx_rates_select_all ON public.fx_rates
  FOR SELECT TO authenticated
  USING (true);
CREATE POLICY prices_select_all ON public.prices
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Requires two-factor authentication" ON public.fx_rates
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb)
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb);

CREATE POLICY "Requires two-factor authentication" ON public.prices
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb)
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb);
