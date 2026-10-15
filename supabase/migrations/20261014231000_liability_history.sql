-- Debts with a history. A debt's row is its opening: the principal (balance)
-- and rate on its anchor day, which is opened_on or, when the user gave none,
-- the Buenos Aires day it was created. Rate changes, payments and adjustments
-- to the lender's figure come after it in liability_events, written only
-- through the RPCs below. A debt that accrues compounds daily from its anchor;
-- the balance on any day is computed in core, never stored. Card debts keep
-- their statements and take no events. Holdings pledged for a debt sit in
-- liability_collateral.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- ── Opening fields ──────────────────────────────────────────────────────────

ALTER TABLE public.liabilities
  ADD COLUMN accrues boolean NOT NULL DEFAULT false,
  ADD COLUMN opened_on date,
  ADD COLUMN anchored_on date NOT NULL DEFAULT '1900-01-01';

-- Validated by the next migration.
ALTER TABLE public.liabilities
  ADD CONSTRAINT liabilities_opened_on_in_range CHECK (opened_on BETWEEN '1900-01-01' AND '9999-12-31') NOT VALID;
ALTER TABLE public.liabilities
  ADD CONSTRAINT liabilities_accrues_opened CHECK (NOT accrues OR opened_on IS NOT NULL) NOT VALID;
ALTER TABLE public.liabilities
  ADD CONSTRAINT liabilities_accrues_fields CHECK (NOT accrues OR (installment IS NULL AND installments_left IS NULL
                           AND next_due_on IS NULL)) NOT VALID;
ALTER TABLE public.liabilities
  ADD CONSTRAINT liabilities_card_plain CHECK (kind <> 'credit_card' OR NOT accrues) NOT VALID;

GRANT INSERT (accrues, opened_on), UPDATE (accrues, opened_on)
  ON TABLE public.liabilities TO authenticated;

COMMENT ON COLUMN public.liabilities.balance IS
  'What was owed on anchored_on, in the debt''s unit: its currency, UVA units when uva, or units of instrument_symbol. Today''s balance is computed from it and the debt''s events.';
COMMENT ON COLUMN public.liabilities.annual_rate IS
  'The nominal annual rate on anchored_on as a fraction: 0.35 is 35% TNA. Later rates are rate_change events.';
COMMENT ON COLUMN public.liabilities.anchored_on IS
  'opened_on, or the Buenos Aires day the debt was created; kept by liabilities_guard.';

-- ── Events ──────────────────────────────────────────────────────────────────

-- Extend-only: a new value is added with ALTER TYPE ... ADD VALUE.
CREATE TYPE public.liability_event_kind AS ENUM ('rate_change', 'payment', 'adjustment');

-- A rate_change sets the rate from the day after its date; a payment lowers the
-- balance by its amount in the debt's unit, and settles closes the debt; an
-- adjustment sets the balance to the lender's figure. A payment may name the
-- cash holding it was paid from, and takes_cash records that the RPC took the
-- amount from it.
CREATE TABLE public.liability_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  liability_id uuid NOT NULL,
  kind public.liability_event_kind NOT NULL,
  date date NOT NULL
    CONSTRAINT liability_events_date_in_range CHECK (date BETWEEN '1900-01-01' AND '9999-12-31'),
  amount numeric(20, 8),
  annual_rate numeric(20, 8),
  cash_holding_id uuid,
  takes_cash boolean NOT NULL DEFAULT false,
  settles boolean NOT NULL DEFAULT false,
  -- When the RPC wrote it, after the user's lock, so it orders a day's events.
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (user_id, id),
  FOREIGN KEY (user_id, liability_id) REFERENCES public.liabilities (user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, cash_holding_id) REFERENCES public.holdings (user_id, id)
    ON DELETE SET NULL (cash_holding_id),
  CONSTRAINT liability_events_fields CHECK (
    (kind = 'rate_change' AND amount IS NULL AND annual_rate IS NOT NULL
      AND annual_rate >= 0 AND annual_rate <= 10 AND annual_rate <> 'NaN'
      AND cash_holding_id IS NULL AND NOT takes_cash AND NOT settles)
    OR (kind = 'payment' AND amount IS NOT NULL AND amount > 0 AND amount <> 'NaN'
      AND annual_rate IS NULL)
    OR (kind = 'adjustment' AND amount IS NOT NULL AND amount >= 0 AND amount <> 'NaN'
      AND annual_rate IS NULL
      AND cash_holding_id IS NULL AND NOT takes_cash AND NOT settles))
);

CREATE INDEX liability_events_user_id_created_idx
  ON public.liability_events (user_id, created_at DESC, id DESC);
CREATE INDEX liability_events_liability_idx
  ON public.liability_events (user_id, liability_id, created_at DESC, id DESC);
CREATE INDEX liability_events_cash_holding_idx
  ON public.liability_events (user_id, cash_holding_id);

ALTER TABLE public.liability_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.liability_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, DELETE ON TABLE public.liability_events TO authenticated;
GRANT INSERT (liability_id, kind, date, amount, annual_rate, cash_holding_id, takes_cash, settles),
      UPDATE (date, amount, annual_rate, cash_holding_id, takes_cash, settles)
  ON TABLE public.liability_events TO authenticated;

CREATE POLICY liability_events_owner ON public.liability_events
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Requires two-factor authentication" ON public.liability_events
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb)
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb);

-- ── Collateral ──────────────────────────────────────────────────────────────

CREATE TABLE public.liability_collateral (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  liability_id uuid NOT NULL,
  holding_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  UNIQUE (user_id, liability_id, holding_id),
  FOREIGN KEY (user_id, liability_id) REFERENCES public.liabilities (user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, holding_id) REFERENCES public.holdings (user_id, id) ON DELETE CASCADE
);

CREATE INDEX liability_collateral_holding_idx
  ON public.liability_collateral (user_id, holding_id);

ALTER TABLE public.liability_collateral ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.liability_collateral FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, DELETE ON TABLE public.liability_collateral TO authenticated;
GRANT INSERT (liability_id, holding_id) ON TABLE public.liability_collateral TO authenticated;

CREATE POLICY liability_collateral_owner ON public.liability_collateral
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Requires two-factor authentication" ON public.liability_collateral
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb)
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb);

-- ── Written only through an RPC ─────────────────────────────────────────────

-- One guard for every table an RPC alone writes; the RPC turns on the setting
-- named by the trigger's argument for its own write and off again. It runs as
-- the caller, so the API roles are told apart by current_user; a cascade from
-- deleting a parent or a user runs as the tables' owner and passes.
CREATE FUNCTION private.written_through()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $$
BEGIN
  IF current_user = 'authenticated'
     AND pg_catalog.current_setting(TG_ARGV[0], true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'written only through its RPC' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION private.written_through() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE TRIGGER movements_written_by_write_operation
  BEFORE INSERT OR DELETE ON public.movements
  FOR EACH ROW EXECUTE FUNCTION private.written_through('plant.write_operation');

CREATE OR REPLACE TRIGGER operations_written_by_write_operation
  BEFORE INSERT OR UPDATE OR DELETE ON public.operations
  FOR EACH ROW EXECUTE FUNCTION private.written_through('plant.write_operation');

CREATE OR REPLACE TRIGGER holdings_units_written_by_write_operation
  BEFORE INSERT OR UPDATE OF amount ON public.holdings
  FOR EACH ROW WHEN (NEW.asset_class = 'instrument')
  EXECUTE FUNCTION private.written_through('plant.write_operation');

DROP FUNCTION private.ledger_written_by_write_operation();

CREATE TRIGGER liability_events_written_through_rpc
  BEFORE INSERT OR UPDATE OR DELETE ON public.liability_events
  FOR EACH ROW EXECUTE FUNCTION private.written_through('plant.liability_event');

-- ── Debt guard ──────────────────────────────────────────────────────────────

-- Keeps anchored_on, and refuses an opened_on after today, a change of unit
-- under events (their amounts are in that unit) and an anchor after the
-- earliest event. Principal, rate, opened_on and accrues stay editable: every
-- figure is computed from them.
CREATE FUNCTION private.liability_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $$
DECLARE
  v_earliest date;
BEGIN
  NEW.anchored_on := COALESCE(NEW.opened_on,
    (NEW.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date);
  IF NEW.opened_on > (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date THEN
    RAISE EXCEPTION 'a debt opens today or earlier'
      USING ERRCODE = 'PT409', HINT = 'future_date';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT min(e.date) INTO v_earliest FROM public.liability_events e
      WHERE e.user_id = NEW.user_id AND e.liability_id = NEW.id;
    IF v_earliest IS NOT NULL
       AND (NEW.kind, NEW.currency, NEW.uva, NEW.instrument_symbol)
           IS DISTINCT FROM (OLD.kind, OLD.currency, OLD.uva, OLD.instrument_symbol) THEN
      RAISE EXCEPTION 'a debt with events keeps its unit'
        USING ERRCODE = 'PT409', HINT = 'has_history';
    END IF;
    IF NEW.anchored_on > v_earliest THEN
      RAISE EXCEPTION 'a debt opens on or before its first event'
        USING ERRCODE = 'PT409', HINT = 'before_opening';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.liability_guard() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER liabilities_guard
  BEFORE INSERT OR UPDATE ON public.liabilities
  FOR EACH ROW EXECUTE FUNCTION private.liability_guard();

-- Sets anchored_on on the existing rows through the guard.
UPDATE public.liabilities SET opened_on = opened_on;

-- ── Event guard ─────────────────────────────────────────────────────────────

-- The rules an event obeys whichever RPC writes it: card debts take none; an
-- event is dated today or earlier and on or after the debt's anchor; and a cash
-- holding is named only for a debt with a currency and not in UVA.
CREATE FUNCTION private.liability_event_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $$
DECLARE
  v_debt public.liabilities%ROWTYPE;
BEGIN
  SELECT * INTO v_debt FROM public.liabilities l
    WHERE l.user_id = NEW.user_id AND l.id = NEW.liability_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF v_debt.kind = 'credit_card' THEN
    RAISE EXCEPTION 'card debts follow their statements'
      USING ERRCODE = 'PT409', HINT = 'no_history';
  END IF;
  IF NEW.date > (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date THEN
    RAISE EXCEPTION 'an event is dated today or earlier'
      USING ERRCODE = 'PT409', HINT = 'future_date';
  END IF;
  IF NEW.date < v_debt.anchored_on THEN
    RAISE EXCEPTION 'an event is dated on or after the debt opens'
      USING ERRCODE = 'PT409', HINT = 'before_opening';
  END IF;
  IF NEW.cash_holding_id IS NOT NULL AND (v_debt.currency IS NULL OR v_debt.uva) THEN
    RAISE EXCEPTION 'this debt takes no cash holding'
      USING ERRCODE = 'PT409', HINT = 'no_cash_link';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.liability_event_guard() FROM PUBLIC, anon, authenticated, service_role;

-- Not on cash_holding_id alone: a deleted cash holding clears it, which must
-- never depend on the debt's rules.
CREATE TRIGGER liability_events_guard
  BEFORE INSERT OR UPDATE OF date, amount, annual_rate, takes_cash, settles
  ON public.liability_events
  FOR EACH ROW EXECUTE FUNCTION private.liability_event_guard();

-- A debt closes with a settling payment or an adjustment to 0, and only an
-- adjustment above 0 reopens it: after any write of its user's, no payment or
-- rate change may apply after a close (nor a second settle share its day)
-- without a reopening applied in between, in the order a debt's events apply
-- (by date, a settle last, then as entered). Checked after the write, so a
-- deleted or re-dated reopening counts too. A debt's delete cascades its whole history before
-- the check runs, so it always passes.
CREATE FUNCTION private.liability_history_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $$
DECLARE
  v_user uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
  v_debt uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.liability_id ELSE NEW.liability_id END;
BEGIN
  IF EXISTS (
       SELECT 1 FROM public.liability_events c
       JOIN public.liability_events o
         ON o.user_id = c.user_id AND o.liability_id = c.liability_id
       WHERE c.user_id = v_user AND c.liability_id = v_debt
         AND (c.settles OR (c.kind = 'adjustment' AND c.amount = 0))
         AND o.kind <> 'adjustment' AND o.id <> c.id
         AND ((o.date, o.settles, o.created_at, o.id) > (c.date, c.settles, c.created_at, c.id)
              OR (o.settles AND c.settles AND o.date = c.date))
         AND NOT EXISTS (
           SELECT 1 FROM public.liability_events a
           WHERE a.user_id = c.user_id AND a.liability_id = c.liability_id
             AND a.kind = 'adjustment' AND a.amount > 0
             AND (a.date, a.settles, a.created_at, a.id) > (c.date, c.settles, c.created_at, c.id)
             AND (a.date, a.settles, a.created_at, a.id) < (o.date, o.settles, o.created_at, o.id))) THEN
    RAISE EXCEPTION 'the debt was closed before this date'
      USING ERRCODE = 'PT409', HINT = 'settled';
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.liability_history_guard() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER liability_events_history_guard
  AFTER INSERT OR UPDATE OR DELETE ON public.liability_events
  FOR EACH ROW EXECUTE FUNCTION private.liability_history_guard();

-- ── Cash ────────────────────────────────────────────────────────────────────

-- Moves one of the caller's active cash holdings by p_delta, refusing another
-- currency, an amount that changed since it was read (unless p_delta is 0,
-- when it only checks the holding) and a balance below 0. A cash holding is
-- archived at 0 keeping its amount, as confirm_import does.
CREATE FUNCTION public.move_cash(
  p_holding_id uuid, p_currency public.currency, p_expected numeric, p_delta numeric)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $$
DECLARE
  v_user uuid := (SELECT auth.uid());
  v_cash public.holdings%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'no user' USING ERRCODE = '42501';
  END IF;
  IF p_delta IS NULL OR p_delta = 'NaN' THEN
    RAISE EXCEPTION 'a cash move is a number' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('plant.portfolio_setup:' || v_user::text, 0));

  SELECT * INTO v_cash FROM public.holdings h
    WHERE h.user_id = v_user AND h.id = p_holding_id
      AND h.asset_class = 'cash' AND h.archived_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such cash holding' USING ERRCODE = 'PT404', HINT = 'not_found';
  END IF;
  IF v_cash.currency IS DISTINCT FROM p_currency THEN
    RAISE EXCEPTION 'the cash holding is in another currency'
      USING ERRCODE = 'PT409', HINT = 'currency';
  END IF;
  IF p_delta = 0 THEN
    RETURN;
  END IF;
  IF v_cash.amount IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'the cash holding changed since it was read'
      USING ERRCODE = 'PT409', HINT = 'stale';
  END IF;
  IF v_cash.amount + p_delta < 0 THEN
    RAISE EXCEPTION 'the cash holding has less than that'
      USING ERRCODE = 'PT409', HINT = 'insufficient_cash';
  END IF;
  IF v_cash.amount + p_delta = 0 THEN
    UPDATE public.holdings h SET archived_at = now()
      WHERE h.user_id = v_user AND h.id = p_holding_id;
  ELSE
    UPDATE public.holdings h SET amount = h.amount + p_delta
      WHERE h.user_id = v_user AND h.id = p_holding_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.move_cash(uuid, public.currency, numeric, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_cash(uuid, public.currency, numeric, numeric) TO authenticated;

-- Gives p_amount back to a cash holding a payment took it from, and never
-- refuses: to the holding while it is active; when it was archived, to the
-- active cash holding of its account, portfolio and currency if there is one,
-- or by reactivating it while its account and portfolio are active. Returns
-- the holding the amount went to, or NULL when it could not go back.
CREATE FUNCTION public.restore_cash(
  p_holding_id uuid, p_currency public.currency, p_amount numeric)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $$
DECLARE
  v_user uuid := (SELECT auth.uid());
  v_cash public.holdings%ROWTYPE;
  v_active uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'no user' USING ERRCODE = '42501';
  END IF;
  IF NOT (p_amount > 0) OR p_amount = 'NaN' THEN
    RAISE EXCEPTION 'an amount restored is above 0' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('plant.portfolio_setup:' || v_user::text, 0));

  SELECT * INTO v_cash FROM public.holdings h
    WHERE h.user_id = v_user AND h.id = p_holding_id
      AND h.asset_class = 'cash' AND h.currency = p_currency
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_cash.archived_at IS NULL THEN
    UPDATE public.holdings h SET amount = h.amount + p_amount
      WHERE h.user_id = v_user AND h.id = p_holding_id;
    RETURN p_holding_id;
  END IF;
  SELECT h.id INTO v_active FROM public.holdings h
    WHERE h.user_id = v_user AND h.asset_class = 'cash' AND h.archived_at IS NULL
      AND h.source_connection_id = v_cash.source_connection_id
      AND h.portfolio_id = v_cash.portfolio_id AND h.currency = p_currency
    ORDER BY h.created_at, h.id
    LIMIT 1
    FOR UPDATE;
  IF FOUND THEN
    UPDATE public.holdings h SET amount = h.amount + p_amount
      WHERE h.user_id = v_user AND h.id = v_active;
    RETURN v_active;
  END IF;
  IF EXISTS (SELECT 1 FROM public.source_connections s
             WHERE s.user_id = v_user AND s.id = v_cash.source_connection_id
               AND s.archived_at IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.portfolios p
                WHERE p.user_id = v_user AND p.id = v_cash.portfolio_id
                  AND p.archived_at IS NOT NULL) THEN
    RETURN NULL;
  END IF;
  UPDATE public.holdings h SET amount = p_amount, archived_at = NULL
    WHERE h.user_id = v_user AND h.id = p_holding_id;
  RETURN p_holding_id;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_cash(uuid, public.currency, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_cash(uuid, public.currency, numeric) TO authenticated;

-- ── Event RPCs ──────────────────────────────────────────────────────────────

-- Records an event of the caller's debt. p_event is { "kind", "date",
-- "amount", "annual_rate", "settles" }; p_cash, for a payment only, is
-- { "holding_id", "take", "expected" }: the cash holding it was paid from,
-- whether to take the amount from it now, and its amount as read. The
-- liability_events_guard and liability_events_history_guard triggers hold
-- the rules every event obeys.
CREATE FUNCTION public.record_liability_event(
  p_liability_id uuid, p_event jsonb, p_cash jsonb)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $$
DECLARE
  v_user uuid := (SELECT auth.uid());
  v_debt public.liabilities%ROWTYPE;
  v_kind public.liability_event_kind;
  v_amount numeric;
  v_holding uuid;
  v_take boolean := false;
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'no user' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_event) IS DISTINCT FROM 'object'
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_event) k
                WHERE k NOT IN ('kind', 'date', 'amount', 'annual_rate', 'settles')) THEN
    RAISE EXCEPTION 'an event has kind, date, amount, annual_rate and settles' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('plant.portfolio_setup:' || v_user::text, 0));

  SELECT * INTO v_debt FROM public.liabilities l
    WHERE l.user_id = v_user AND l.id = p_liability_id
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such debt' USING ERRCODE = 'PT404', HINT = 'not_found';
  END IF;

  v_kind := (p_event ->> 'kind')::public.liability_event_kind;
  -- At the scale it is stored with, so cash moves by what the event keeps.
  v_amount := round((p_event ->> 'amount')::numeric, 8);
  IF p_cash IS NOT NULL AND jsonb_typeof(p_cash) <> 'null' THEN
    IF v_kind IS DISTINCT FROM 'payment' OR jsonb_typeof(p_cash) <> 'object' THEN
      RAISE EXCEPTION 'only a payment names a cash holding' USING ERRCODE = '22023';
    END IF;
    IF v_debt.currency IS NULL OR v_debt.uva THEN
      RAISE EXCEPTION 'this debt takes no cash holding'
        USING ERRCODE = 'PT409', HINT = 'no_cash_link';
    END IF;
    v_holding := (p_cash ->> 'holding_id')::uuid;
    v_take := COALESCE((p_cash ->> 'take')::boolean, false);
    IF v_holding IS NULL THEN
      RAISE EXCEPTION 'a cash link names its holding' USING ERRCODE = '22023';
    END IF;
    PERFORM public.move_cash(v_holding, v_debt.currency,
      (p_cash ->> 'expected')::numeric, CASE WHEN v_take THEN -v_amount ELSE 0 END);
  END IF;

  PERFORM pg_catalog.set_config('plant.liability_event', 'on', true);
  INSERT INTO public.liability_events
    (liability_id, kind, date, amount, annual_rate, cash_holding_id, takes_cash, settles)
  VALUES (p_liability_id, v_kind, (p_event ->> 'date')::date, v_amount,
          (p_event ->> 'annual_rate')::numeric, v_holding, v_take,
          COALESCE((p_event ->> 'settles')::boolean, false))
  RETURNING id INTO v_id;
  PERFORM pg_catalog.set_config('plant.liability_event', 'off', true);
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_liability_event(uuid, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_liability_event(uuid, jsonb, jsonb) TO authenticated;

-- Edits one of the caller's events in place, keeping its id and when it was
-- entered (the order of a day's events). p_event and p_cash are as for
-- record_liability_event; a payment that took cash gives it back and takes it
-- again, by the difference when it stays on the same holding, and a kept link
-- follows the cash to where it went back. Returns false when cash taken
-- before could not go back; a link kept then must take nothing.
CREATE FUNCTION public.update_liability_event(
  p_event_id uuid, p_event jsonb, p_cash jsonb)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $$
DECLARE
  v_user uuid := (SELECT auth.uid());
  v_liability uuid;
  v_debt public.liabilities%ROWTYPE;
  v_old public.liability_events%ROWTYPE;
  v_amount numeric;
  v_holding uuid;
  v_expected numeric;
  v_take boolean := false;
  v_restored_to uuid;
  v_restored boolean := true;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'no user' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_event) IS DISTINCT FROM 'object'
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_event) k
                WHERE k NOT IN ('kind', 'date', 'amount', 'annual_rate', 'settles')) THEN
    RAISE EXCEPTION 'an event has kind, date, amount, annual_rate and settles' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('plant.portfolio_setup:' || v_user::text, 0));

  -- The debt before the event, as a debt's DELETE cascades in that order.
  SELECT e.liability_id INTO v_liability FROM public.liability_events e
    WHERE e.user_id = v_user AND e.id = p_event_id;
  SELECT * INTO v_debt FROM public.liabilities l
    WHERE l.user_id = v_user AND l.id = v_liability
    FOR SHARE;
  SELECT * INTO v_old FROM public.liability_events e
    WHERE e.user_id = v_user AND e.id = p_event_id AND e.liability_id = v_liability
    FOR UPDATE;
  IF v_debt.id IS NULL OR v_old.id IS NULL THEN
    RAISE EXCEPTION 'no such event' USING ERRCODE = 'PT404', HINT = 'not_found';
  END IF;

  IF p_event ? 'kind' AND p_event ->> 'kind' IS DISTINCT FROM v_old.kind::text THEN
    RAISE EXCEPTION 'an event keeps its kind' USING ERRCODE = '22023';
  END IF;
  -- At the scale it is stored with, so cash moves by what the event keeps.
  v_amount := round((p_event ->> 'amount')::numeric, 8);
  IF p_cash IS NOT NULL AND jsonb_typeof(p_cash) <> 'null' THEN
    IF v_old.kind <> 'payment' OR jsonb_typeof(p_cash) <> 'object' THEN
      RAISE EXCEPTION 'only a payment names a cash holding' USING ERRCODE = '22023';
    END IF;
    IF v_debt.currency IS NULL OR v_debt.uva THEN
      RAISE EXCEPTION 'this debt takes no cash holding'
        USING ERRCODE = 'PT409', HINT = 'no_cash_link';
    END IF;
    v_holding := (p_cash ->> 'holding_id')::uuid;
    v_take := COALESCE((p_cash ->> 'take')::boolean, false);
    IF v_holding IS NULL THEN
      RAISE EXCEPTION 'a cash link names its holding' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_expected := (p_cash ->> 'expected')::numeric;
  IF v_old.takes_cash AND v_take AND v_old.cash_holding_id = v_holding
     AND EXISTS (SELECT 1 FROM public.holdings h
                 WHERE h.user_id = v_user AND h.id = v_holding AND h.archived_at IS NULL) THEN
    PERFORM public.move_cash(v_holding, v_debt.currency, v_expected, v_old.amount - v_amount);
  ELSE
    IF v_old.takes_cash AND v_old.cash_holding_id IS NOT NULL THEN
      v_restored_to := public.restore_cash(v_old.cash_holding_id, v_debt.currency, v_old.amount);
      v_restored := v_restored_to IS NOT NULL;
      -- A kept link follows the cash to where it went back, which the caller
      -- could not have read; another holding it went back to holds it too.
      IF v_restored_to IS NOT NULL AND v_holding = v_old.cash_holding_id THEN
        v_holding := v_restored_to;
        SELECT h.amount INTO v_expected FROM public.holdings h
          WHERE h.user_id = v_user AND h.id = v_restored_to;
      ELSIF v_restored_to = v_holding THEN
        v_expected := COALESCE(v_expected, 0) + v_old.amount;
      END IF;
    ELSIF v_old.takes_cash THEN
      v_restored := false;
    END IF;
    -- A kept link that takes nothing is only a reference, so its holding may
    -- have been archived since, but not moved to another currency.
    IF v_holding IS NOT NULL AND NOT v_take AND v_holding = v_old.cash_holding_id THEN
      IF NOT EXISTS (SELECT 1 FROM public.holdings h
                     WHERE h.user_id = v_user AND h.id = v_holding
                       AND h.asset_class = 'cash' AND h.currency = v_debt.currency) THEN
        RAISE EXCEPTION 'the cash holding is in another currency'
          USING ERRCODE = 'PT409', HINT = 'currency';
      END IF;
    ELSIF v_holding IS NOT NULL THEN
      PERFORM public.move_cash(v_holding, v_debt.currency, v_expected,
        CASE WHEN v_take THEN -v_amount ELSE 0 END);
    END IF;
  END IF;

  PERFORM pg_catalog.set_config('plant.liability_event', 'on', true);
  UPDATE public.liability_events e
    SET date = (p_event ->> 'date')::date,
        amount = v_amount,
        annual_rate = (p_event ->> 'annual_rate')::numeric,
        cash_holding_id = v_holding,
        takes_cash = v_take,
        settles = COALESCE((p_event ->> 'settles')::boolean, false)
    WHERE e.user_id = v_user AND e.id = p_event_id;
  PERFORM pg_catalog.set_config('plant.liability_event', 'off', true);
  RETURN v_restored;
END;
$$;

REVOKE ALL ON FUNCTION public.update_liability_event(uuid, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_liability_event(uuid, jsonb, jsonb) TO authenticated;

-- Deletes one of the caller's events, giving back the cash it took. Returns
-- false when that cash could not go back.
CREATE FUNCTION public.delete_liability_event(p_event_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $$
DECLARE
  v_user uuid := (SELECT auth.uid());
  v_liability uuid;
  v_debt public.liabilities%ROWTYPE;
  v_old public.liability_events%ROWTYPE;
  v_restored boolean := true;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'no user' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('plant.portfolio_setup:' || v_user::text, 0));

  SELECT e.liability_id INTO v_liability FROM public.liability_events e
    WHERE e.user_id = v_user AND e.id = p_event_id;
  SELECT * INTO v_debt FROM public.liabilities l
    WHERE l.user_id = v_user AND l.id = v_liability
    FOR SHARE;
  SELECT * INTO v_old FROM public.liability_events e
    WHERE e.user_id = v_user AND e.id = p_event_id AND e.liability_id = v_liability
    FOR UPDATE;
  IF v_debt.id IS NULL OR v_old.id IS NULL THEN
    RAISE EXCEPTION 'no such event' USING ERRCODE = 'PT404', HINT = 'not_found';
  END IF;

  IF v_old.takes_cash THEN
    v_restored := v_old.cash_holding_id IS NOT NULL
      AND public.restore_cash(v_old.cash_holding_id, v_debt.currency, v_old.amount) IS NOT NULL;
  END IF;

  PERFORM pg_catalog.set_config('plant.liability_event', 'on', true);
  DELETE FROM public.liability_events e WHERE e.user_id = v_user AND e.id = p_event_id;
  PERFORM pg_catalog.set_config('plant.liability_event', 'off', true);
  RETURN v_restored;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_liability_event(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_liability_event(uuid) TO authenticated;
