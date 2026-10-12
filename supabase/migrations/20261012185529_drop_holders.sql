-- Holders leave the app (PLA-105): every account is the user's own. The
-- account guard keeps its holdings and portfolio checks; the holder ones go
-- with the table. Staging holds no real users yet, so the data goes too.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- CREATE OR REPLACE keeps the owner and the grants but not the settings, so
-- search_path is restated.
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
                 AND h.archived_at IS NULL) THEN
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

REVOKE ALL ON FUNCTION private.guard_source_connection_write() FROM PUBLIC, anon, authenticated;

-- Its foreign key, index and column grants go with it. Pre-beta, Tomas
-- accepted losing every account's holder (PLA-105).
-- squawk-ignore ban-drop-column
ALTER TABLE public.source_connections DROP COLUMN holder_id;

-- Takes ACCESS EXCLUSIVE on auth.users too (it drops holders' foreign key to
-- it) under lock_timeout; a user delete crossing in the other order deadlocks
-- and one side is aborted. Pre-beta, Tomas accepted losing the holders
-- (PLA-105).
-- squawk-ignore ban-drop-table
DROP TABLE public.holders;

DROP FUNCTION private.guard_holder_write();
