-- A cash holding's history: its opening balance, deposits, withdrawals,
-- income and charges of its own, and the cash leg of an operation settled in
-- it (a purchase paid, a sale or a dividend collected, in the currency of the
-- account side). The closes read it to count only deposits and withdrawals
-- as money put in or taken out. Written only through write_cash_movements,
-- which moves the holding's amount by what it writes; deleting an operation
-- deletes its cash legs and gives their cash back.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- ── Cash may stand at 0 ─────────────────────────────────────────────────────
-- A cash holding with history keeps it at 0, like an instrument sold out. The
-- check is relaxed, so the rows it held already pass it.
ALTER TABLE public.holdings
  ADD CONSTRAINT holdings_amount_at_least_zero
  CHECK (amount <> 'NaN' AND (amount > 0 OR (amount = 0 AND asset_class IN ('instrument', 'cash'))))
  NOT VALID;
ALTER TABLE public.holdings DROP CONSTRAINT holdings_amount_not_negative;

-- ── Cash movements ──────────────────────────────────────────────────────────
-- Extend-only: a new value is added with ALTER TYPE ... ADD VALUE.
CREATE TYPE public.cash_movement_kind AS ENUM (
  'opening_balance', 'deposit', 'withdrawal', 'settlement', 'income', 'charge');

-- amount is signed, in the holding's currency: what the movement added to it.
-- A settlement is an operation's cash in this holding; rates holds the
-- selling rate of each dollar on its date, as a movement's does.
CREATE TABLE public.cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  holding_id uuid NOT NULL,
  operation_id uuid,
  kind public.cash_movement_kind NOT NULL,
  date date NOT NULL CONSTRAINT cash_movements_date_in_range CHECK (date BETWEEN '1900-01-01' AND '9999-12-31'),
  amount numeric(20, 8) NOT NULL CONSTRAINT cash_movements_amount_not_nan CHECK (amount <> 'NaN'),
  reference text CHECK (reference IS NULL OR (char_length(reference) BETWEEN 1 AND 40 AND reference = btrim(reference))),
  note text CHECK (note IS NULL OR (char_length(note) BETWEEN 1 AND 200 AND note = btrim(note))),
  rates jsonb NOT NULL CONSTRAINT cash_movements_rates_object CHECK (jsonb_typeof(rates) = 'object'),
  -- When the RPC wrote it, after the user's lock, so it orders a day's
  -- movements.
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (user_id, id),
  FOREIGN KEY (user_id, holding_id) REFERENCES public.holdings (user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, operation_id) REFERENCES public.operations (user_id, id) ON DELETE CASCADE,
  CONSTRAINT cash_movements_kind_fields CHECK (
    (kind = 'opening_balance' AND amount >= 0 AND operation_id IS NULL)
    OR (kind IN ('deposit', 'income') AND amount > 0 AND operation_id IS NULL)
    OR (kind IN ('withdrawal', 'charge') AND amount < 0 AND operation_id IS NULL)
    OR (kind = 'settlement' AND amount <> 0 AND operation_id IS NOT NULL))
);

CREATE INDEX cash_movements_user_id_holding_id_order_idx
  ON public.cash_movements (user_id, holding_id, date, created_at, id);
CREATE INDEX cash_movements_user_id_operation_id_idx
  ON public.cash_movements (user_id, operation_id);
-- One opening per holding, one leg per operation and holding, and a broker's
-- number once per holding, so a file read twice writes nothing twice.
CREATE UNIQUE INDEX cash_movements_one_opening_idx
  ON public.cash_movements (user_id, holding_id) WHERE kind = 'opening_balance';
CREATE UNIQUE INDEX cash_movements_one_leg_idx
  ON public.cash_movements (user_id, holding_id, operation_id) WHERE kind = 'settlement';
CREATE UNIQUE INDEX cash_movements_reference_idx
  ON public.cash_movements (user_id, holding_id, reference)
  WHERE reference IS NOT NULL AND kind <> 'settlement';

ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cash_movements FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, DELETE ON TABLE public.cash_movements TO authenticated;
GRANT INSERT (holding_id, operation_id, kind, date, amount, reference, note, rates)
  ON TABLE public.cash_movements TO authenticated;

CREATE POLICY cash_movements_owner ON public.cash_movements
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Requires two-factor authentication" ON public.cash_movements
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb)
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb);

CREATE TRIGGER cash_movements_written_through_rpc
  BEFORE INSERT OR DELETE ON public.cash_movements
  FOR EACH ROW EXECUTE FUNCTION private.written_through('plant.cash_movement');

-- ── A leg deleted with its operation ────────────────────────────────────────

-- Gives back to its holding what a cash leg added, when the leg goes with its
-- operation (write_operation deleting it); the RPC moves the amount itself.
-- An archived holding held nothing, and comes back with what is given.
CREATE FUNCTION private.cash_leg_deleted()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $$
DECLARE
  v_amount numeric;
BEGIN
  IF pg_catalog.current_setting('plant.cash_movement', true) IS NOT DISTINCT FROM 'on' THEN
    RETURN OLD;
  END IF;
  SELECT CASE WHEN h.archived_at IS NULL THEN h.amount ELSE 0 END - OLD.amount
    INTO v_amount
    FROM public.holdings h
    WHERE h.user_id = OLD.user_id AND h.id = OLD.holding_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN OLD;
  END IF;
  IF v_amount < 0 THEN
    RAISE EXCEPTION 'the cash holding would go below 0'
      USING ERRCODE = 'PT409', HINT = 'negative_cash';
  END IF;
  UPDATE public.holdings h SET amount = v_amount, archived_at = NULL
    WHERE h.user_id = OLD.user_id AND h.id = OLD.holding_id;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION private.cash_leg_deleted() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER cash_movements_leg_deleted
  AFTER DELETE ON public.cash_movements
  FOR EACH ROW WHEN (OLD.kind = 'settlement')
  EXECUTE FUNCTION private.cash_leg_deleted();

-- ── The RPC ─────────────────────────────────────────────────────────────────

-- Writes a cash holding's movements in one go: deletes p_deletes (ids of its
-- movements) and inserts p_inserts, a list of { "kind", "date", "amount",
-- "operation_id", "reference", "note", "rates" }. The holding's amount moves
-- by what was added less what was deleted, from 0 when the write starts its
-- history with an opening balance, and from 0 when it was archived; it never
-- goes below 0. A history starts with one opening balance and nothing comes
-- before it; a leg names an operation of the holding's account. Returns the
-- ids inserted, in order.
CREATE FUNCTION public.write_cash_movements(
  p_holding_id uuid, p_inserts jsonb, p_deletes uuid[])
  RETURNS uuid[]
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $$
DECLARE
  v_user uuid := (SELECT auth.uid());
  v_cash public.holdings%ROWTYPE;
  v_had boolean;
  v_base numeric;
  v_deleted numeric := 0;
  v_added numeric := 0;
  v_count integer;
  v_opening date;
  v_ids uuid[];
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'no user' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_inserts) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_inserts) > 2000
     OR COALESCE(pg_catalog.cardinality(p_deletes), 0) > 2000 THEN
    RAISE EXCEPTION 'at most 2000 cash movements a write' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_inserts) e
             WHERE jsonb_typeof(e) <> 'object'
                OR EXISTS (SELECT 1 FROM jsonb_object_keys(e) k
                           WHERE k NOT IN ('kind', 'date', 'amount', 'operation_id',
                                           'reference', 'note', 'rates'))) THEN
    RAISE EXCEPTION 'a cash movement has kind, date, amount, operation_id, reference, note and rates'
      USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('plant.portfolio_setup:' || v_user::text, 0));

  SELECT * INTO v_cash FROM public.holdings h
    WHERE h.user_id = v_user AND h.id = p_holding_id AND h.asset_class = 'cash'
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such cash holding' USING ERRCODE = 'PT404', HINT = 'not_found';
  END IF;
  v_had := EXISTS (SELECT 1 FROM public.cash_movements m
                   WHERE m.user_id = v_user AND m.holding_id = p_holding_id);

  PERFORM pg_catalog.set_config('plant.cash_movement', 'on', true);
  IF COALESCE(pg_catalog.cardinality(p_deletes), 0) > 0 THEN
    WITH gone AS (
      DELETE FROM public.cash_movements m
      WHERE m.user_id = v_user AND m.holding_id = p_holding_id AND m.id = ANY (p_deletes)
      RETURNING m.amount)
    SELECT count(*), COALESCE(sum(amount), 0) INTO v_count, v_deleted FROM gone;
    IF v_count <> (SELECT count(DISTINCT d) FROM unnest(p_deletes) d) THEN
      RAISE EXCEPTION 'a cash movement to delete is not there'
        USING ERRCODE = 'PT409', HINT = 'stale';
    END IF;
  END IF;
  WITH added AS (
    INSERT INTO public.cash_movements
      (holding_id, operation_id, kind, date, amount, reference, note, rates)
    SELECT p_holding_id, (e ->> 'operation_id')::uuid,
           (e ->> 'kind')::public.cash_movement_kind, (e ->> 'date')::date,
           round((e ->> 'amount')::numeric, 8), e ->> 'reference', e ->> 'note',
           COALESCE(e -> 'rates', '{}'::jsonb)
    FROM jsonb_array_elements(p_inserts) WITH ORDINALITY AS t(e, n)
    ORDER BY n
    RETURNING id, amount)
  SELECT COALESCE(array_agg(id), '{}'), COALESCE(sum(amount), 0) INTO v_ids, v_added FROM added;
  PERFORM pg_catalog.set_config('plant.cash_movement', 'off', true);

  SELECT m.date INTO v_opening FROM public.cash_movements m
    WHERE m.user_id = v_user AND m.holding_id = p_holding_id AND m.kind = 'opening_balance';
  IF EXISTS (SELECT 1 FROM public.cash_movements m
             WHERE m.user_id = v_user AND m.holding_id = p_holding_id
               AND (v_opening IS NULL OR m.date < v_opening)) THEN
    RAISE EXCEPTION 'a cash history starts with its opening balance'
      USING ERRCODE = 'PT409', HINT = 'before_opening';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cash_movements m
             WHERE m.user_id = v_user AND m.holding_id = p_holding_id
               AND m.operation_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM public.movements o
                               JOIN public.holdings oh
                                 ON oh.user_id = o.user_id AND oh.id = o.holding_id
                               WHERE o.user_id = v_user AND o.operation_id = m.operation_id
                                 AND oh.source_connection_id = v_cash.source_connection_id)) THEN
    RAISE EXCEPTION 'a cash leg is of an operation of the same account'
      USING ERRCODE = 'PT409', HINT = 'other_account';
  END IF;

  v_base := CASE WHEN NOT v_had OR v_cash.archived_at IS NOT NULL THEN 0 ELSE v_cash.amount END;
  IF v_base + v_added - v_deleted < 0 THEN
    RAISE EXCEPTION 'the cash holding would go below 0'
      USING ERRCODE = 'PT409', HINT = 'negative_cash';
  END IF;
  UPDATE public.holdings h
    SET amount = v_base + v_added - v_deleted, archived_at = NULL
    WHERE h.user_id = v_user AND h.id = p_holding_id;
  RETURN v_ids;
END;
$$;

REVOKE ALL ON FUNCTION public.write_cash_movements(uuid, jsonb, uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.write_cash_movements(uuid, jsonb, uuid[]) TO authenticated;
