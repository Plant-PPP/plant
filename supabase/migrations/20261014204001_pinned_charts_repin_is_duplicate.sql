-- Re-pinning a chart already pinned answers 23505 from the unique key, which
-- the app reads as "already pinned", even when the user has 12: the limit
-- lets it through to the key.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- CREATE OR REPLACE drops the settings, so search_path is restated.
CREATE OR REPLACE FUNCTION private.pinned_charts_limit()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('pinned_charts:' || NEW.user_id::text, 0));
  IF EXISTS (SELECT 1 FROM public.pinned_charts
             WHERE user_id = NEW.user_id AND topic = NEW.topic
               AND portfolio_id IS NOT DISTINCT FROM NEW.portfolio_id) THEN
    RETURN NEW;
  END IF;
  IF (SELECT count(*) FROM public.pinned_charts WHERE user_id = NEW.user_id) >= 12 THEN
    RAISE EXCEPTION 'pinned charts limit reached' USING ERRCODE = 'P0001', HINT = 'pinned_charts_full';
  END IF;
  RETURN NEW;
END
$$;
