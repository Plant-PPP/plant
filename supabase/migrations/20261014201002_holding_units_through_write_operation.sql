-- An instrument holding's units are what its movements leave, so a user adds
-- one or changes its amount only through write_operation, like its movements.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

CREATE OR REPLACE FUNCTION private.ledger_written_by_write_operation()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $$
BEGIN
  IF current_user = 'authenticated'
     AND pg_catalog.current_setting('plant.write_operation', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION '% are written through write_operation', TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER holdings_units_written_by_write_operation
  BEFORE INSERT OR UPDATE OF amount ON public.holdings
  FOR EACH ROW WHEN (NEW.asset_class = 'instrument')
  EXECUTE FUNCTION private.ledger_written_by_write_operation();
