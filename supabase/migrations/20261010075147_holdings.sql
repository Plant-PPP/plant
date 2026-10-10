-- Holdings: what a user holds in each account, and the catalog of instruments
-- a holding can name. Instruments are market data every user reads and no API
-- role writes; a new symbol arrives in a migration with the quote feed that
-- prices it. Holdings are archived, never deleted, and take the portfolio
-- setup lock, stamp and guard like the accounts they belong to.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- Extend-only: a new value is added with ALTER TYPE ... ADD VALUE.
CREATE TYPE public.asset_class AS ENUM ('instrument', 'cash', 'fixed_term', 'real_estate', 'other');
CREATE TYPE public.instrument_type AS ENUM ('crypto');

-- The symbol pattern is the one prices.symbol uses.
CREATE TABLE public.instruments (
  symbol text PRIMARY KEY CONSTRAINT instruments_symbol_pattern CHECK (symbol ~ '^[A-Z0-9]{1,15}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80 AND name = btrim(name)),
  type public.instrument_type NOT NULL,
  currency public.currency NOT NULL
);

INSERT INTO public.instruments (symbol, name, type, currency) VALUES
  ('BTC', 'Bitcoin', 'crypto', 'USD'),
  ('ETH', 'Ethereum', 'crypto', 'USD'),
  ('SOL', 'Solana', 'crypto', 'USD'),
  ('USDT', 'Tether', 'crypto', 'USD'),
  ('USDC', 'USD Coin', 'crypto', 'USD');

ALTER TABLE public.instruments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.instruments FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.instruments TO authenticated;

CREATE POLICY instruments_select_all ON public.instruments
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Requires two-factor authentication" ON public.instruments
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb)
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb);

-- One position. Its holder is its account's, read through the account; its
-- portfolio defaults to the account's default portfolio.
CREATE TABLE public.holdings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  source_connection_id uuid NOT NULL,
  portfolio_id uuid NOT NULL,
  asset_class public.asset_class NOT NULL,
  instrument_symbol text REFERENCES public.instruments (symbol),
  amount numeric(20, 8) NOT NULL CHECK (amount > 0 AND amount <> 'NaN'),
  currency public.currency,
  annual_rate numeric(20, 8)
    CONSTRAINT holdings_annual_rate CHECK (annual_rate >= 0 AND annual_rate <= 10 AND annual_rate <> 'NaN'),
  started_on date,
  matures_on date,
  valued_on date,
  label text CHECK (label IS NULL OR (char_length(label) BETWEEN 1 AND 80 AND label = btrim(label))),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  FOREIGN KEY (user_id, source_connection_id) REFERENCES public.source_connections (user_id, id),
  FOREIGN KEY (user_id, portfolio_id) REFERENCES public.portfolios (user_id, id),
  -- A finite date in the years the app reads.
  CONSTRAINT holdings_dates_in_range CHECK (
    started_on BETWEEN '1900-01-01' AND '9999-12-31'
    AND matures_on BETWEEN '1900-01-01' AND '9999-12-31'
    AND valued_on BETWEEN '1900-01-01' AND '9999-12-31'),
  -- One branch per class; each names the class-dependent columns it
  -- constrains. A label is optional for cash and fixed terms.
  CONSTRAINT holdings_class_fields CHECK (
    (asset_class = 'instrument' AND instrument_symbol IS NOT NULL AND currency IS NULL
      AND annual_rate IS NULL AND started_on IS NULL AND matures_on IS NULL
      AND valued_on IS NULL AND label IS NULL)
    OR (asset_class = 'cash' AND currency IS NOT NULL AND instrument_symbol IS NULL
      AND annual_rate IS NULL AND started_on IS NULL AND matures_on IS NULL
      AND valued_on IS NULL)
    OR (asset_class = 'fixed_term' AND currency IS NOT NULL AND annual_rate IS NOT NULL
      AND started_on IS NOT NULL AND matures_on IS NOT NULL AND matures_on > started_on
      AND instrument_symbol IS NULL AND valued_on IS NULL)
    OR (asset_class = 'real_estate' AND currency IS NOT NULL AND valued_on IS NOT NULL
      AND label IS NOT NULL AND instrument_symbol IS NULL AND annual_rate IS NULL
      AND started_on IS NULL AND matures_on IS NULL)
    OR (asset_class = 'other' AND currency IS NOT NULL AND valued_on IS NOT NULL
      AND label IS NOT NULL AND instrument_symbol IS NULL AND annual_rate IS NULL
      AND started_on IS NULL AND matures_on IS NULL))
);

COMMENT ON COLUMN public.holdings.amount IS
  'Units for an instrument, the balance for cash, the principal for a fixed term, the value for real estate or other.';
COMMENT ON COLUMN public.holdings.annual_rate IS
  'A fixed term''s nominal annual rate as a fraction: 0.35 is 35% TNA.';

CREATE INDEX holdings_user_id_source_connection_id_idx
  ON public.holdings (user_id, source_connection_id);
CREATE INDEX holdings_user_id_portfolio_id_idx
  ON public.holdings (user_id, portfolio_id);
-- One active position per instrument in an account's portfolio.
CREATE UNIQUE INDEX holdings_active_instrument_key
  ON public.holdings (user_id, source_connection_id, portfolio_id, instrument_symbol)
  WHERE archived_at IS NULL AND asset_class = 'instrument';
CREATE INDEX holdings_user_id_active_idx
  ON public.holdings (user_id, created_at DESC, id DESC) WHERE archived_at IS NULL;
CREATE INDEX holdings_user_id_archived_idx
  ON public.holdings (user_id, archived_at DESC, id DESC) WHERE archived_at IS NOT NULL;

ALTER TABLE public.holdings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.holdings FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.holdings TO authenticated;
GRANT INSERT (source_connection_id, portfolio_id, asset_class, instrument_symbol, amount,
              currency, annual_rate, started_on, matures_on, valued_on, label),
      UPDATE (portfolio_id, amount, currency, annual_rate, started_on, matures_on, valued_on,
              label, archived_at)
  ON TABLE public.holdings TO authenticated;

CREATE POLICY holdings_owner ON public.holdings
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Requires two-factor authentication" ON public.holdings
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb)
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb);

CREATE TRIGGER holdings_set_updated_at
  BEFORE UPDATE ON public.holdings
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

-- ── Holdings triggers ───────────────────────────────────────────────────────
-- In name order: lock, default, stamp, guard. Default fires only on INSERT and
-- stamp only on UPDATE. The lock and the guard fire on INSERT and on changes
-- of portfolio_id or archived_at, so editing an amount takes no user lock.

-- A holding inserted with no portfolio goes to its account's default one. A
-- row the caller cannot see is left to NOT NULL or the foreign key.
CREATE FUNCTION private.default_holding_portfolio()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $$
BEGIN
  IF NEW.portfolio_id IS NULL THEN
    SELECT s.default_portfolio_id INTO NEW.portfolio_id
      FROM public.source_connections s
      WHERE s.user_id = NEW.user_id AND s.id = NEW.source_connection_id;
  END IF;
  RETURN NEW;
END;
$$;

-- An active holding sits in an active account and an active portfolio:
-- checked when it is created, restored or moved. The rule for the portfolio
-- is the one guard_source_connection_write applies to an account's default
-- portfolio; each guard keeps its own copy, since a trigger cannot call a
-- shared helper in private (the API roles have no USAGE on it). A third table
-- with the rule (debts, PLA-77) moves it into one shared trigger function.
CREATE FUNCTION private.guard_holding_write()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $$
BEGIN
  IF NEW.archived_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF (TG_OP = 'INSERT' OR OLD.archived_at IS NOT NULL)
     AND EXISTS (SELECT 1 FROM public.source_connections s
                 WHERE s.user_id = NEW.user_id AND s.id = NEW.source_connection_id
                   AND s.archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'an active holding cannot sit in an archived account'
      USING ERRCODE = 'PT409', HINT = 'source_connection_archived';
  END IF;
  IF (TG_OP = 'INSERT' OR OLD.archived_at IS NOT NULL
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

REVOKE ALL ON FUNCTION private.default_holding_portfolio() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.guard_holding_write() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER portfolio_setup_1_lock
  BEFORE INSERT OR UPDATE OF portfolio_id, archived_at ON public.holdings
  FOR EACH ROW EXECUTE FUNCTION private.lock_portfolio_setup();
CREATE TRIGGER portfolio_setup_2_default
  BEFORE INSERT ON public.holdings
  FOR EACH ROW EXECUTE FUNCTION private.default_holding_portfolio();
CREATE TRIGGER portfolio_setup_2_stamp
  BEFORE UPDATE ON public.holdings
  FOR EACH ROW EXECUTE FUNCTION private.stamp_archived_at();
CREATE TRIGGER portfolio_setup_3_guard
  BEFORE INSERT OR UPDATE OF portfolio_id, archived_at ON public.holdings
  FOR EACH ROW EXECUTE FUNCTION private.guard_holding_write();

-- ── Portfolio and account guards ────────────────────────────────────────────
-- A portfolio or account that still holds active holdings stays active.
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
                 AND h.archived_at IS NULL) THEN
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
  IF (TG_OP = 'INSERT' OR OLD.archived_at IS NOT NULL
      OR NEW.holder_id IS DISTINCT FROM OLD.holder_id)
     AND EXISTS (SELECT 1 FROM public.holders h
                 WHERE h.user_id = NEW.user_id AND h.id = NEW.holder_id
                   AND h.archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'an active account cannot belong to an archived holder'
      USING ERRCODE = 'PT409', HINT = 'holder_archived';
  END IF;
  RETURN NEW;
END;
$$;
