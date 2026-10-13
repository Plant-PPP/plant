-- Movements, manual prices and dollar rates, and the assets left out of the
-- tax report (PLA-103, PLA-104, PLA-122). An operation groups its movements,
-- one per holding it touches: a purchase split across portfolios, or a
-- transfer's two sides. An instrument holding's amount is the units its
-- movements leave, kept by write_operation, which writes an operation's
-- movements in one transaction.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- ── Instruments ─────────────────────────────────────────────────────────────
-- Priced by the user until a feed quotes them.
INSERT INTO public.instruments (symbol, name, type, currency) VALUES
  ('AAPL', 'Apple', 'cedear', 'ARS'),
  ('KO', 'Coca-Cola', 'cedear', 'ARS'),
  ('MELI', 'MercadoLibre', 'cedear', 'ARS'),
  ('MSFT', 'Microsoft', 'cedear', 'ARS'),
  ('NVDA', 'NVIDIA', 'cedear', 'ARS'),
  ('SPY', 'SPDR S&P 500', 'cedear', 'ARS'),
  ('TSLA', 'Tesla', 'cedear', 'ARS'),
  ('AL30', 'Bonar 2030', 'bond', 'ARS'),
  ('GD30', 'Global 2030', 'bond', 'USD'),
  ('TX26', 'Boncer 2026', 'bond', 'ARS');

-- ── Holdings ────────────────────────────────────────────────────────────────
-- An instrument holding sold out stays at 0 units with its history; every
-- other class keeps a positive amount. The check is relaxed, so the rows it
-- held already pass it; validating would scan the table under its lock.
ALTER TABLE public.holdings
  ADD CONSTRAINT holdings_amount_not_negative
  CHECK (amount <> 'NaN' AND (amount > 0 OR (amount = 0 AND asset_class = 'instrument')))
  NOT VALID;
ALTER TABLE public.holdings DROP CONSTRAINT holdings_amount_check;

-- Bumped by every write of the holding's movements, so a write computed from
-- what a page read is refused once another changed them.
ALTER TABLE public.holdings
  ADD COLUMN movements_revision bigint NOT NULL DEFAULT 0;

GRANT UPDATE (movements_revision) ON TABLE public.holdings TO authenticated;
-- An instrument holding whose last movement goes is deleted with it.
GRANT DELETE ON TABLE public.holdings TO authenticated;

-- ── Operations ──────────────────────────────────────────────────────────────
-- entry_order orders a day's operations as the user entered them: one more
-- than the user's highest when created, kept when edited.
CREATE TABLE public.operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  entry_order bigint NOT NULL CONSTRAINT operations_entry_order_not_negative CHECK (entry_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id)
);

CREATE INDEX operations_user_id_entry_order_idx ON public.operations (user_id, entry_order DESC);

ALTER TABLE public.operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.operations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, DELETE ON TABLE public.operations TO authenticated;
GRANT INSERT (entry_order) ON TABLE public.operations TO authenticated;

CREATE POLICY operations_owner ON public.operations
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Requires two-factor authentication" ON public.operations
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb)
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb);

-- ── Movements ───────────────────────────────────────────────────────────────
-- Extend-only: a new value is added with ALTER TYPE ... ADD VALUE.
CREATE TYPE public.movement_kind AS ENUM (
  'opening_balance', 'purchase', 'sale', 'dividend', 'coupon', 'adjustment', 'transfer', 'yield');
CREATE TYPE public.movement_direction AS ENUM ('in', 'out');

-- One holding's part of an operation. Its fields follow core's movement
-- schema: a trade moves a quantity at a price per unit, income is an amount,
-- and an adjustment, transfer or yield moves units in or out. rates holds the
-- selling rate of each dollar on its date, and charges what the broker
-- charged, item by item; the app validates both before writing.
CREATE TABLE public.movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  holding_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  entry_order bigint NOT NULL CONSTRAINT movements_entry_order_not_negative CHECK (entry_order >= 0),
  -- Within a day, an opening balance comes before every operation.
  rank bigint NOT NULL GENERATED ALWAYS AS (
    CASE WHEN kind = 'opening_balance' THEN -1 ELSE entry_order END) STORED,
  kind public.movement_kind NOT NULL,
  date date NOT NULL CONSTRAINT movements_date_in_range CHECK (date BETWEEN '1900-01-01' AND '9999-12-31'),
  currency public.currency NOT NULL,
  direction public.movement_direction,
  quantity numeric(20, 8) CONSTRAINT movements_quantity_positive CHECK (quantity > 0 AND quantity <> 'NaN'),
  price numeric(20, 8) CONSTRAINT movements_price_not_negative CHECK (price >= 0 AND price <> 'NaN'),
  amount numeric(20, 8) CONSTRAINT movements_amount_positive CHECK (amount > 0 AND amount <> 'NaN'),
  charges jsonb NOT NULL DEFAULT '[]'
    CONSTRAINT movements_charges_list CHECK (jsonb_typeof(charges) = 'array' AND jsonb_array_length(charges) <= 10),
  reference text CHECK (reference IS NULL OR (char_length(reference) BETWEEN 1 AND 40 AND reference = btrim(reference))),
  note text CHECK (note IS NULL OR (char_length(note) BETWEEN 1 AND 200 AND note = btrim(note))),
  rates jsonb NOT NULL CONSTRAINT movements_rates_object CHECK (jsonb_typeof(rates) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  FOREIGN KEY (user_id, holding_id) REFERENCES public.holdings (user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, operation_id) REFERENCES public.operations (user_id, id) ON DELETE CASCADE,
  -- One branch per kind; each names the kind-dependent columns it constrains.
  CONSTRAINT movements_kind_fields CHECK (
    (kind IN ('opening_balance', 'purchase', 'sale') AND quantity IS NOT NULL AND price IS NOT NULL
      AND amount IS NULL AND direction IS NULL)
    OR (kind IN ('dividend', 'coupon') AND amount IS NOT NULL AND quantity IS NULL
      AND price IS NULL AND direction IS NULL)
    OR (kind = 'adjustment' AND direction IS NOT NULL AND quantity IS NOT NULL
      AND price IS NOT NULL AND amount IS NULL)
    -- Units leaving carry their own cost; units arriving may be given one.
    OR (kind = 'transfer' AND direction IS NOT NULL AND quantity IS NOT NULL AND amount IS NULL
      AND (direction = 'in' OR price IS NULL) AND charges = '[]')
    OR (kind = 'yield' AND direction IS NOT NULL AND quantity IS NOT NULL
      AND price IS NOT NULL AND amount IS NULL AND charges = '[]'))
);

COMMENT ON COLUMN public.movements.price IS
  'The price of one unit, in currency: per unit for every instrument type, a bond''s included.';

-- A holding's history in the order core replays it, and a list's pages.
CREATE INDEX movements_user_id_holding_id_order_idx
  ON public.movements (user_id, holding_id, date, rank, id);
CREATE INDEX movements_user_id_order_idx
  ON public.movements (user_id, date DESC, rank DESC, id DESC);
CREATE INDEX movements_user_id_operation_id_idx
  ON public.movements (user_id, operation_id);

ALTER TABLE public.movements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.movements FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, DELETE ON TABLE public.movements TO authenticated;
GRANT INSERT (holding_id, operation_id, entry_order, kind, date, currency, direction, quantity,
              price, amount, charges, reference, note, rates)
  ON TABLE public.movements TO authenticated;

CREATE POLICY movements_owner ON public.movements
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Requires two-factor authentication" ON public.movements
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb)
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb);

-- ── Manual prices and dollar rates ──────────────────────────────────────────
-- A price the user states for an instrument on a day; the newest on or before
-- a date wins over the feeds' of the same day or older.
CREATE TABLE public.manual_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  symbol text NOT NULL REFERENCES public.instruments (symbol),
  price_date date NOT NULL
    CONSTRAINT manual_prices_date_in_range CHECK (price_date BETWEEN '1900-01-01' AND '9999-12-31'),
  price numeric(20, 8) NOT NULL CONSTRAINT manual_prices_price_positive CHECK (price > 0 AND price <> 'NaN'),
  currency public.currency NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  UNIQUE (user_id, symbol, price_date)
);

CREATE TYPE public.manual_rate_kind AS ENUM ('mep', 'ccl', 'official');

-- A dollar's selling rate the user states on a day, taken as manual prices
-- are.
CREATE TABLE public.manual_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  kind public.manual_rate_kind NOT NULL,
  rate_date date NOT NULL
    CONSTRAINT manual_rates_date_in_range CHECK (rate_date BETWEEN '1900-01-01' AND '9999-12-31'),
  sell numeric(20, 8) NOT NULL CONSTRAINT manual_rates_sell_positive CHECK (sell > 0 AND sell <> 'NaN'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  UNIQUE (user_id, kind, rate_date)
);

ALTER TABLE public.manual_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_rates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.manual_prices FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.manual_rates FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, DELETE ON TABLE public.manual_prices TO authenticated;
GRANT INSERT (symbol, price_date, price, currency), UPDATE (price, currency)
  ON TABLE public.manual_prices TO authenticated;
GRANT SELECT, DELETE ON TABLE public.manual_rates TO authenticated;
GRANT INSERT (kind, rate_date, sell), UPDATE (sell) ON TABLE public.manual_rates TO authenticated;

CREATE POLICY manual_prices_owner ON public.manual_prices
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Requires two-factor authentication" ON public.manual_prices
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb)
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb);

CREATE POLICY manual_rates_owner ON public.manual_rates
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Requires two-factor authentication" ON public.manual_rates
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb)
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb);

CREATE TRIGGER manual_prices_set_updated_at
  BEFORE UPDATE ON public.manual_prices
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER manual_rates_set_updated_at
  BEFORE UPDATE ON public.manual_rates
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

-- ── The tax report ──────────────────────────────────────────────────────────
-- An asset the user left out of the report: an instrument across every
-- holding of it, or any other holding on its own.
CREATE TABLE public.tax_report_exclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  instrument_symbol text REFERENCES public.instruments (symbol),
  holding_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  UNIQUE (user_id, instrument_symbol),
  UNIQUE (user_id, holding_id),
  FOREIGN KEY (user_id, holding_id) REFERENCES public.holdings (user_id, id) ON DELETE CASCADE,
  CONSTRAINT tax_report_exclusions_one_asset CHECK (num_nonnulls(instrument_symbol, holding_id) = 1)
);

ALTER TABLE public.tax_report_exclusions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tax_report_exclusions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, DELETE ON TABLE public.tax_report_exclusions TO authenticated;
GRANT INSERT (instrument_symbol, holding_id) ON TABLE public.tax_report_exclusions TO authenticated;

CREATE POLICY tax_report_exclusions_owner ON public.tax_report_exclusions
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Requires two-factor authentication" ON public.tax_report_exclusions
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb)
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb);

-- ── Writing an operation ────────────────────────────────────────────────────
-- Writes an operation's movements in one transaction with the holdings they
-- move. It runs as the caller, so RLS and the grants above bound it: the
-- caller could write the same rows one statement at a time.
--
-- p_operation_id null writes a new operation; otherwise the user's operation
-- with that id has its movements replaced, keeping its entry order, or is
-- deleted when p_parts is empty. Each part names the account, portfolio and
-- instrument of its holding (the active one there, or a new one) and its
-- movement's fields.
--
-- p_expected maps the id of every holding of the instruments the operation
-- touches, before and after, archived ones included, to the
-- movements_revision the caller read; the write is refused with hint 'stale'
-- unless those are exactly the user's holdings of them now, at those
-- revisions. A user's writes run one at a time, behind the portfolio setup
-- lock, so the check holds until the transaction ends.
--
-- Then each holding it touched is left at the units its movements leave (a
-- history going below zero is refused with hint 'negative_units'), its
-- revision bumped, and deleted if no movement is left. Returns the
-- operation's id, or null once deleted.
CREATE FUNCTION public.write_operation(p_operation_id uuid, p_parts jsonb, p_expected jsonb)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $$
DECLARE
  v_user uuid := (SELECT auth.uid());
  v_operation uuid := p_operation_id;
  v_entry_order bigint;
  v_part jsonb;
  v_holding uuid;
  v_touched uuid[] := '{}';
  v_symbols text[] := '{}';
  v_current jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'no user' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_parts) IS DISTINCT FROM 'array' OR jsonb_array_length(p_parts) > 20
     OR (jsonb_array_length(p_parts) = 0 AND v_operation IS NULL) THEN
    RAISE EXCEPTION 'an operation has 1 to 20 parts' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_expected) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'the holdings read are an object' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('plant.portfolio_setup:' || v_user::text, 0));

  IF v_operation IS NOT NULL THEN
    SELECT o.entry_order INTO v_entry_order FROM public.operations o
      WHERE o.user_id = v_user AND o.id = v_operation;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'no such operation' USING ERRCODE = 'PT404', HINT = 'not_found';
    END IF;
    SELECT COALESCE(array_agg(DISTINCT m.holding_id), '{}'),
           COALESCE(array_agg(DISTINCT h.instrument_symbol), '{}')
      INTO v_touched, v_symbols
      FROM public.movements m
      JOIN public.holdings h ON h.user_id = m.user_id AND h.id = m.holding_id
      WHERE m.user_id = v_user AND m.operation_id = v_operation;
  END IF;
  SELECT v_symbols || COALESCE(array_agg(part ->> 'instrument_symbol'), '{}') INTO v_symbols
    FROM jsonb_array_elements(p_parts) part;

  SELECT COALESCE(jsonb_object_agg(h.id, h.movements_revision), '{}'::jsonb) INTO v_current
    FROM public.holdings h
    WHERE h.user_id = v_user AND h.asset_class = 'instrument'
      AND h.instrument_symbol = ANY (v_symbols);
  IF v_current IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'the holdings changed since they were read'
      USING ERRCODE = 'PT409', HINT = 'stale';
  END IF;

  IF v_operation IS NULL THEN
    SELECT COALESCE(max(o.entry_order), 0) + 1 INTO v_entry_order
      FROM public.operations o WHERE o.user_id = v_user;
    INSERT INTO public.operations (entry_order) VALUES (v_entry_order) RETURNING id INTO v_operation;
  ELSIF jsonb_array_length(p_parts) = 0 THEN
    DELETE FROM public.operations o WHERE o.user_id = v_user AND o.id = v_operation;
  ELSE
    DELETE FROM public.movements m WHERE m.user_id = v_user AND m.operation_id = v_operation;
  END IF;

  FOR v_part IN SELECT value FROM jsonb_array_elements(p_parts) LOOP
    v_holding := NULL;
    SELECT h.id INTO v_holding FROM public.holdings h
      WHERE h.user_id = v_user AND h.archived_at IS NULL AND h.asset_class = 'instrument'
        AND h.source_connection_id = (v_part ->> 'source_connection_id')::uuid
        AND h.portfolio_id = (v_part ->> 'portfolio_id')::uuid
        AND h.instrument_symbol = v_part ->> 'instrument_symbol';
    IF v_holding IS NULL THEN
      INSERT INTO public.holdings (source_connection_id, portfolio_id, asset_class, instrument_symbol, amount)
        VALUES ((v_part ->> 'source_connection_id')::uuid, (v_part ->> 'portfolio_id')::uuid,
                'instrument', v_part ->> 'instrument_symbol', 0)
        RETURNING id INTO v_holding;
    END IF;
    INSERT INTO public.movements (holding_id, operation_id, entry_order, kind, date, currency, direction,
                                  quantity, price, amount, charges, reference, note, rates)
      VALUES (v_holding, v_operation, v_entry_order,
              (v_part ->> 'kind')::public.movement_kind,
              (v_part ->> 'date')::date,
              (v_part ->> 'currency')::public.currency,
              (v_part ->> 'direction')::public.movement_direction,
              (v_part ->> 'quantity')::numeric,
              (v_part ->> 'price')::numeric,
              (v_part ->> 'amount')::numeric,
              COALESCE(v_part -> 'charges', '[]'::jsonb),
              v_part ->> 'reference',
              v_part ->> 'note',
              v_part -> 'rates');
    v_touched := array_append(v_touched, v_holding);
  END LOOP;

  -- The units each movement brings in (positive) or takes out (negative),
  -- running in the order core replays a holding's history.
  IF EXISTS (
    SELECT 1 FROM (
      SELECT sum(CASE WHEN m.kind IN ('dividend', 'coupon') THEN 0
                      WHEN m.kind = 'sale' OR m.direction = 'out' THEN -m.quantity
                      ELSE m.quantity END)
               OVER (PARTITION BY m.holding_id ORDER BY m.date, m.rank, m.id) AS held
        FROM public.movements m
        WHERE m.user_id = v_user AND m.holding_id = ANY (v_touched)) running
    WHERE running.held < 0) THEN
    RAISE EXCEPTION 'a holding cannot hold fewer than zero units'
      USING ERRCODE = 'PT409', HINT = 'negative_units';
  END IF;

  UPDATE public.holdings h
    SET amount = COALESCE((SELECT sum(CASE WHEN m.kind IN ('dividend', 'coupon') THEN 0
                                           WHEN m.kind = 'sale' OR m.direction = 'out' THEN -m.quantity
                                           ELSE m.quantity END)
                           FROM public.movements m
                           WHERE m.user_id = v_user AND m.holding_id = h.id), 0),
        movements_revision = h.movements_revision + 1
    WHERE h.user_id = v_user AND h.id = ANY (v_touched);

  DELETE FROM public.holdings h
    WHERE h.user_id = v_user AND h.id = ANY (v_touched)
      AND NOT EXISTS (SELECT 1 FROM public.movements m
                      WHERE m.user_id = v_user AND m.holding_id = h.id);

  RETURN CASE WHEN jsonb_array_length(p_parts) = 0 THEN NULL ELSE v_operation END;
END;
$$;

REVOKE ALL ON FUNCTION public.write_operation(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.write_operation(uuid, jsonb, jsonb) TO authenticated;
