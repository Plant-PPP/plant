-- A manual price is in its instrument's currency: one in the other would value
-- the user's holdings of it in the wrong one. The app refuses it too; this
-- holds for a write straight through the API. A symbol with no instrument is
-- left to the foreign key.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

CREATE FUNCTION private.guard_manual_price_currency()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.instruments i
             WHERE i.symbol = NEW.symbol AND i.currency <> NEW.currency) THEN
    RAISE EXCEPTION 'a manual price is in its instrument''s currency'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_manual_price_currency() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER manual_prices_in_instrument_currency
  BEFORE INSERT OR UPDATE OF symbol, currency ON public.manual_prices
  FOR EACH ROW EXECUTE FUNCTION private.guard_manual_price_currency();
