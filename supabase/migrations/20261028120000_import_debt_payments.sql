-- A document of operations may show a loan repaid: from the account's units
-- or cash, or on the debt's own log. The draft marks such a row as a debt
-- payment, and the review names the debt it pays. confirm_import also writes
-- payments, in the same transaction as the units: an item
-- { "debt_payment": { "liability_id", "event", "cash" } } is recorded through
-- record_liability_event, after every debt it names is checked to be one of
-- the caller's that is not a card. 20261028120001 validates the checks.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TABLE public.import_operations
  ADD COLUMN debt_payment boolean NOT NULL DEFAULT false,
  ADD COLUMN pays_liability_id uuid;

ALTER TABLE public.import_operations
  ADD CONSTRAINT import_operations_pays_liability_fkey
  FOREIGN KEY (user_id, pays_liability_id)
  REFERENCES public.liabilities (user_id, id)
  ON DELETE SET NULL (pays_liability_id) NOT VALID;

-- A payment is only that, or units out of the account; only a payment names
-- the debt it pays.
ALTER TABLE public.import_operations
  ADD CONSTRAINT import_operations_debt_payment
  CHECK ((NOT debt_payment OR kind IS NULL OR (kind = 'adjustment' AND direction = 'out'))
         AND (pays_liability_id IS NULL OR debt_payment)) NOT VALID;

COMMENT ON COLUMN public.import_operations.debt_payment IS
  'Whether the row repays a loan.';
COMMENT ON COLUMN public.import_operations.pays_liability_id IS
  'The user''s debt the payment pays.';

-- The import job reads a document's repayments; it never names the debt.
GRANT INSERT (debt_payment) ON TABLE public.import_operations TO service_role;

-- Writes each operation through write_operation, each debt payment through
-- record_liability_event and each cash balance into the account's cash
-- holding in its currency, after marking the import confirmed: a ready import
-- of the caller's, or nothing is written. An operation is { "parts": [...],
-- "expected": {...} } as write_operation takes them, every expected read
-- before the first operation. Operations of one import may touch the same
-- instrument, so the revisions read are checked once, under the user's lock,
-- against what the holdings are now; each operation then passes
-- write_operation the revisions as they stand. A debt payment is
-- { "debt_payment": { "liability_id", "event", "cash" } } as
-- record_liability_event takes them. A cash balance is { "cash": {
-- "source_connection_id", "currency", "amount", "expected" } }, expected
-- being the account's active cash holdings in that currency as read, by id,
-- with their amounts as text: with none the balance opens one in the
-- account's default portfolio, with one it becomes its amount, and several are
-- refused, for the user to set by hand. A balance at zero opens nothing and
-- archives the one holding.
CREATE OR REPLACE FUNCTION public.confirm_import(p_import_id uuid, p_operations jsonb)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $$
DECLARE
  v_user uuid := (SELECT auth.uid());
  v_operation jsonb;
  v_cash jsonb;
  v_expected jsonb := '{}'::jsonb;
  v_symbols text[] := '{}';
  v_key text;
  v_value jsonb;
  v_current jsonb;
  v_amount numeric;
  v_payment jsonb;
  v_debts uuid[] := '{}';
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'no user' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_operations) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_operations) > 500 THEN
    RAISE EXCEPTION 'an import has at most 500 operations' USING ERRCODE = '22023';
  END IF;

  -- The user's lock first, as deleting an account takes it before the rows
  -- it cascades to.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('plant.portfolio_setup:' || v_user::text, 0));

  UPDATE public.imports i SET status = 'confirmed'
    WHERE i.user_id = v_user AND i.id = p_import_id AND i.status = 'ready';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such import ready to confirm' USING ERRCODE = 'PT404', HINT = 'not_found';
  END IF;

  FOR v_operation IN SELECT value FROM jsonb_array_elements(p_operations) LOOP
    IF v_operation ? 'debt_payment' THEN
      v_payment := v_operation -> 'debt_payment';
      IF jsonb_typeof(v_payment) IS DISTINCT FROM 'object'
         OR jsonb_typeof(v_payment -> 'event') IS DISTINCT FROM 'object'
         OR v_payment -> 'event' ->> 'kind' IS DISTINCT FROM 'payment'
         OR jsonb_typeof(v_payment -> 'liability_id') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'a debt payment names its debt and is a payment'
          USING ERRCODE = '22023';
      END IF;
      v_debts := v_debts || (v_payment ->> 'liability_id')::uuid;
      CONTINUE;
    END IF;
    IF v_operation ? 'cash' THEN
      v_cash := v_operation -> 'cash';
      IF jsonb_typeof(v_cash) IS DISTINCT FROM 'object'
         OR jsonb_typeof(v_cash -> 'expected') IS DISTINCT FROM 'object'
         OR jsonb_typeof(v_cash -> 'amount') IS DISTINCT FROM 'string'
         OR v_cash ->> 'source_connection_id' IS NULL
         OR v_cash ->> 'currency' IS NULL THEN
        RAISE EXCEPTION 'a cash balance has its account, currency, amount and the holdings read'
          USING ERRCODE = '22023';
      END IF;
      CONTINUE;
    END IF;
    IF jsonb_typeof(v_operation -> 'parts') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_operation -> 'parts') > 20
       OR jsonb_typeof(v_operation -> 'expected') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'an operation has its parts and the holdings read' USING ERRCODE = '22023';
    END IF;
    FOR v_key, v_value IN SELECT key, value FROM jsonb_each(v_operation -> 'expected') LOOP
      IF v_expected ? v_key AND v_expected -> v_key IS DISTINCT FROM v_value THEN
        RAISE EXCEPTION 'the operations read one holding differently' USING ERRCODE = '22023';
      END IF;
      v_expected := v_expected || jsonb_build_object(v_key, v_value);
    END LOOP;
    SELECT v_symbols || COALESCE(array_agg(part ->> 'instrument_symbol'), '{}') INTO v_symbols
      FROM jsonb_array_elements(v_operation -> 'parts') part;
  END LOOP;

  SELECT COALESCE(jsonb_object_agg(h.id, h.movements_revision), '{}'::jsonb) INTO v_current
    FROM public.holdings h
    WHERE h.user_id = v_user AND h.asset_class = 'instrument'
      AND h.instrument_symbol = ANY (v_symbols);
  IF v_current IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'the holdings changed since they were read'
      USING ERRCODE = 'PT409', HINT = 'stale';
  END IF;

  -- Every debt paid is one of the caller's, and not a card, whose balance
  -- comes from its statements.
  IF EXISTS (SELECT 1 FROM unnest(v_debts) AS paid (id)
             WHERE NOT EXISTS (SELECT 1 FROM public.liabilities l
                               WHERE l.user_id = v_user AND l.id = paid.id
                                 AND l.kind <> 'credit_card')) THEN
    RAISE EXCEPTION 'no such debt to pay' USING ERRCODE = 'PT404', HINT = 'debt_not_found';
  END IF;

  FOR v_operation IN SELECT value FROM jsonb_array_elements(p_operations) LOOP
    IF v_operation ? 'debt_payment' THEN
      v_payment := v_operation -> 'debt_payment';
      PERFORM public.record_liability_event(
        (v_payment ->> 'liability_id')::uuid, v_payment -> 'event', v_payment -> 'cash');
      CONTINUE;
    END IF;
    IF v_operation ? 'cash' THEN
      v_cash := v_operation -> 'cash';
      v_amount := (v_cash ->> 'amount')::numeric;
      IF NOT (v_amount >= 0) OR v_amount = 'NaN' THEN
        RAISE EXCEPTION 'a cash balance is zero or above' USING ERRCODE = '22023';
      END IF;
      -- Editing a cash holding's amount takes no user lock, so the ones
      -- read are locked here before they are compared.
      SELECT COALESCE(jsonb_object_agg(c.id, c.amount::text), '{}'::jsonb) INTO v_current
        FROM (SELECT h.id, h.amount FROM public.holdings h
              WHERE h.user_id = v_user AND h.asset_class = 'cash' AND h.archived_at IS NULL
                AND h.source_connection_id = (v_cash ->> 'source_connection_id')::uuid
                AND h.currency = (v_cash ->> 'currency')::public.currency
              FOR UPDATE) c;
      IF v_current IS DISTINCT FROM v_cash -> 'expected' THEN
        RAISE EXCEPTION 'the holdings changed since they were read'
          USING ERRCODE = 'PT409', HINT = 'stale';
      END IF;
      IF v_current = '{}'::jsonb THEN
        IF v_amount > 0 THEN
          INSERT INTO public.holdings (source_connection_id, asset_class, currency, amount)
          VALUES ((v_cash ->> 'source_connection_id')::uuid, 'cash',
                  (v_cash ->> 'currency')::public.currency, v_amount);
        END IF;
      ELSIF (SELECT count(*) FROM jsonb_object_keys(v_current)) = 1 AND v_amount = 0 THEN
        UPDATE public.holdings h SET archived_at = now()
          WHERE h.user_id = v_user
            AND h.id = (SELECT key::uuid FROM jsonb_object_keys(v_current) key);
      ELSIF (SELECT count(*) FROM jsonb_object_keys(v_current)) = 1 THEN
        UPDATE public.holdings h SET amount = v_amount
          WHERE h.user_id = v_user
            AND h.id = (SELECT key::uuid FROM jsonb_object_keys(v_current) key)
            AND h.amount <> v_amount;
      ELSE
        RAISE EXCEPTION 'the account holds several cash balances in that currency'
          USING ERRCODE = '22023', HINT = 'several_cash';
      END IF;
      CONTINUE;
    END IF;
    SELECT COALESCE(jsonb_object_agg(h.id, h.movements_revision), '{}'::jsonb) INTO v_current
      FROM public.holdings h
      WHERE h.user_id = v_user AND h.asset_class = 'instrument'
        AND h.instrument_symbol IN (
          SELECT part ->> 'instrument_symbol' FROM jsonb_array_elements(v_operation -> 'parts') part);
    PERFORM public.write_operation(NULL, v_operation -> 'parts', v_current);
  END LOOP;

  RETURN p_import_id;
END;
$$;
