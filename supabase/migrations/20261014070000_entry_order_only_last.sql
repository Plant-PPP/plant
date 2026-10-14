-- A user writes an operation's entry order only to put it last, as
-- write_operation does (PLA-144): any other value, through the API's grants on
-- the column, could push the next place past bigint and block every later
-- write.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- It runs as the caller, so the API roles are told apart by current_user, and
-- the caller's own operations are the whole sequence it reads.
CREATE FUNCTION private.entry_order_goes_last()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $$
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.entry_order IS NOT DISTINCT FROM OLD.entry_order THEN
    RETURN NEW;
  END IF;
  IF NEW.entry_order IS DISTINCT FROM (
    SELECT COALESCE(max(o.entry_order), 0) + 1 FROM public.operations o
    WHERE o.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'an operation only goes last' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.entry_order_goes_last() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER operations_entry_order_goes_last
  BEFORE INSERT OR UPDATE OF entry_order ON public.operations
  FOR EACH ROW EXECUTE FUNCTION private.entry_order_goes_last();
