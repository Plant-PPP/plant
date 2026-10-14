-- A sold-out instrument holding stays active at 0 units with its history, and
-- the UI neither shows nor archives it, so it no longer keeps its account or
-- portfolio from being archived. Units coming back into it (a buy, or an edit
-- of its history) go through the same guard as restoring a holding, so they
-- cannot land in an archived account or portfolio.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- CREATE OR REPLACE keeps the owner and the grants but not the settings, so
-- SECURITY INVOKER and search_path are restated.
CREATE OR REPLACE FUNCTION private.guard_portfolio_write()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $$
BEGIN
  IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.portfolios p
                   WHERE p.user_id = NEW.user_id AND p.id <> NEW.id AND p.archived_at IS NULL) THEN
      RAISE EXCEPTION 'a user keeps at least one active portfolio'
        USING ERRCODE = 'PT409', HINT = 'last_active_portfolio';
    END IF;
    IF EXISTS (SELECT 1 FROM public.source_connections s
               WHERE s.user_id = NEW.user_id AND s.default_portfolio_id = NEW.id
                 AND s.archived_at IS NULL) THEN
      RAISE EXCEPTION 'an active account defaults to this portfolio'
        USING ERRCODE = 'PT409', HINT = 'portfolio_in_use';
    END IF;
    IF EXISTS (SELECT 1 FROM public.holdings h
               WHERE h.user_id = NEW.user_id AND h.portfolio_id = NEW.id
                 AND h.archived_at IS NULL
                 AND NOT (h.asset_class = 'instrument' AND h.amount = 0)) THEN
      RAISE EXCEPTION 'an active holding sits in this portfolio'
        USING ERRCODE = 'PT409', HINT = 'portfolio_has_holdings';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_source_connection_write()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.holdings h
               WHERE h.user_id = NEW.user_id AND h.source_connection_id = NEW.id
                 AND h.archived_at IS NULL
                 AND NOT (h.asset_class = 'instrument' AND h.amount = 0)) THEN
      RAISE EXCEPTION 'an active holding sits in this account'
        USING ERRCODE = 'PT409', HINT = 'source_connection_has_holdings';
    END IF;
  END IF;
  IF NEW.archived_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF (TG_OP = 'INSERT' OR OLD.archived_at IS NOT NULL
      OR NEW.default_portfolio_id IS DISTINCT FROM OLD.default_portfolio_id)
     AND EXISTS (SELECT 1 FROM public.portfolios p
                 WHERE p.user_id = NEW.user_id AND p.id = NEW.default_portfolio_id
                   AND p.archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'an active account cannot default to an archived portfolio'
      USING ERRCODE = 'PT409', HINT = 'portfolio_archived';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_holding_write()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $$
BEGIN
  IF NEW.archived_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF (TG_OP = 'INSERT' OR OLD.archived_at IS NOT NULL OR (OLD.amount = 0 AND NEW.amount > 0))
     AND EXISTS (SELECT 1 FROM public.source_connections s
                 WHERE s.user_id = NEW.user_id AND s.id = NEW.source_connection_id
                   AND s.archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'an active holding cannot sit in an archived account'
      USING ERRCODE = 'PT409', HINT = 'source_connection_archived';
  END IF;
  IF (TG_OP = 'INSERT' OR OLD.archived_at IS NOT NULL OR (OLD.amount = 0 AND NEW.amount > 0)
      OR NEW.portfolio_id IS DISTINCT FROM OLD.portfolio_id)
     AND EXISTS (SELECT 1 FROM public.portfolios p
                 WHERE p.user_id = NEW.user_id AND p.id = NEW.portfolio_id
                   AND p.archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'an active holding cannot sit in an archived portfolio'
      USING ERRCODE = 'PT409', HINT = 'portfolio_archived';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_portfolio_write() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.guard_source_connection_write() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.guard_holding_write() FROM PUBLIC, anon, authenticated;

-- A sold-out holding getting units back takes the user's lock and the guard,
-- so it cannot cross an archive of its account or portfolio.
CREATE TRIGGER portfolio_setup_1_lock_reopen
  BEFORE UPDATE OF amount ON public.holdings
  FOR EACH ROW WHEN (OLD.amount = 0 AND NEW.amount > 0)
  EXECUTE FUNCTION private.lock_portfolio_setup();
CREATE TRIGGER portfolio_setup_3_guard_reopen
  BEFORE UPDATE OF amount ON public.holdings
  FOR EACH ROW WHEN (OLD.amount = 0 AND NEW.amount > 0)
  EXECUTE FUNCTION private.guard_holding_write();
