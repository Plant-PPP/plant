-- A holding with transfers is not deleted (PLA-148): the cascade would take
-- one side of each transfer and leave the other, and its operation, behind.
-- The app checks before deleting; this holds when it is called directly or a
-- transfer arrives in between.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- It runs as the caller, so the API roles are told apart by current_user; a
-- cascade from deleting a user runs as the tables' owner.
CREATE FUNCTION private.holding_without_transfers()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $$
BEGIN
  IF current_user = 'authenticated' AND EXISTS (
    SELECT 1 FROM public.movements m
    WHERE m.user_id = OLD.user_id AND m.holding_id = OLD.id AND m.kind = 'transfer'
  ) THEN
    RAISE EXCEPTION 'a holding with transfers is not deleted'
      USING ERRCODE = 'PT409', HINT = 'holding_has_transfers';
  END IF;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION private.holding_without_transfers() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER holdings_without_transfers
  BEFORE DELETE ON public.holdings
  FOR EACH ROW EXECUTE FUNCTION private.holding_without_transfers();
