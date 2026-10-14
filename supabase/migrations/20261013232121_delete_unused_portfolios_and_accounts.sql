-- A portfolio or an account not in use can be deleted (PLA-99); archiving
-- stays the rule for the rest. Not in use: no holding, archived or sold out
-- included, sits in it, and for a portfolio no account, archived
-- included, defaults to it. The last active portfolio stays. An account's
-- uploads, their imports and drafts go with it through their foreign keys;
-- private.import_requests keeps counting them against the month's quota.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- The owner policies are FOR ALL, so they already scope a delete to the
-- user's rows, and so does the MFA gate.
GRANT DELETE ON TABLE public.portfolios, public.source_connections TO authenticated;

-- Like the write guards, these run as the caller, key on the row's user_id,
-- take the user's portfolio setup lock before counting and raise PT409 with a
-- hint from PORTFOLIO_SETUP_GUARD. A delete run by a trigger is the cascade
-- from deleting the user, which takes every row, so they let it through.
CREATE FUNCTION private.guard_portfolio_delete()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
BEGIN
  IF pg_catalog.pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('plant.portfolio_setup:' || OLD.user_id::text, 0));
  IF OLD.archived_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.portfolios p
                     WHERE p.user_id = OLD.user_id AND p.id <> OLD.id AND p.archived_at IS NULL) THEN
    RAISE EXCEPTION 'a user keeps at least one active portfolio'
      USING ERRCODE = 'PT409', HINT = 'last_active_portfolio';
  END IF;
  IF EXISTS (SELECT 1 FROM public.source_connections s
             WHERE s.user_id = OLD.user_id AND s.default_portfolio_id = OLD.id) THEN
    RAISE EXCEPTION 'an account defaults to this portfolio'
      USING ERRCODE = 'PT409', HINT = 'portfolio_in_use';
  END IF;
  IF EXISTS (SELECT 1 FROM public.holdings h
             WHERE h.user_id = OLD.user_id AND h.portfolio_id = OLD.id) THEN
    RAISE EXCEPTION 'a holding sits in this portfolio'
      USING ERRCODE = 'PT409', HINT = 'portfolio_has_holdings';
  END IF;
  RETURN OLD;
END;
$$;

CREATE FUNCTION private.guard_source_connection_delete()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
BEGIN
  IF pg_catalog.pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('plant.portfolio_setup:' || OLD.user_id::text, 0));
  IF EXISTS (SELECT 1 FROM public.holdings h
             WHERE h.user_id = OLD.user_id AND h.source_connection_id = OLD.id) THEN
    RAISE EXCEPTION 'a holding sits in this account'
      USING ERRCODE = 'PT409', HINT = 'source_connection_has_holdings';
  END IF;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_portfolio_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.guard_source_connection_delete() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER portfolio_setup_3_guard_delete
  BEFORE DELETE ON public.portfolios
  FOR EACH ROW EXECUTE FUNCTION private.guard_portfolio_delete();
CREATE TRIGGER portfolio_setup_3_guard_delete
  BEFORE DELETE ON public.source_connections
  FOR EACH ROW EXECUTE FUNCTION private.guard_source_connection_delete();
