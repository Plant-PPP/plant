-- A user pins at most 12 charts, the most Resumen shows (MAX_PINS in
-- apps/web/src/lib/assistant/pins.ts), counted under a lock on the user so
-- two pins at once cannot both pass. It runs as the user: their own rows are
-- the ones it counts.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

CREATE FUNCTION private.pinned_charts_limit()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('pinned_charts:' || NEW.user_id::text, 0));
  IF (SELECT count(*) FROM public.pinned_charts WHERE user_id = NEW.user_id) >= 12 THEN
    RAISE EXCEPTION 'pinned charts limit reached' USING ERRCODE = 'P0001', HINT = 'pinned_charts_full';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION private.pinned_charts_limit() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER pinned_charts_limit BEFORE INSERT ON public.pinned_charts
  FOR EACH ROW EXECUTE FUNCTION private.pinned_charts_limit();
