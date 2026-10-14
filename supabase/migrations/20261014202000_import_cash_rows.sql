-- Cash in an import's draft: a row of a provider's or a document's cash
-- balance, which confirm_import writes as the account's cash holding in
-- that currency, as the user would type it.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TABLE public.import_items ADD COLUMN asset_class public.asset_class NOT NULL DEFAULT 'instrument'
  CHECK (asset_class IN ('instrument', 'cash'));

COMMENT ON COLUMN public.import_items.asset_class IS
  'cash for a balance in currency, quantity its amount and symbol the currency''s code; instrument otherwise.';

GRANT INSERT (asset_class) ON TABLE public.import_items TO service_role;

-- Writes each operation through write_operation and each cash balance into
-- the account's cash holding in its currency, after marking the import
-- confirmed: a ready import of the caller's, or nothing is written. An
-- operation is { "parts": [...], "expected": {...} } as write_operation takes
-- them, every expected read before the first operation. Operations of one
-- import may touch the same instrument, so the revisions read are checked
-- once, under the user's lock, against what the holdings are now; each
-- operation then passes write_operation the revisions as they stand.
-- A cash balance is { "cash": { "source_connection_id", "currency",
-- "amount", "expected" } }, expected being the account's active cash
-- holdings in that currency as read, by id, with their amounts as text: with
-- none the balance opens one in the account's default portfolio, with one it
-- becomes its amount, and several are refused, for the user to set by hand.
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

  FOR v_operation IN SELECT value FROM jsonb_array_elements(p_operations) LOOP
    IF v_operation ? 'cash' THEN
      v_cash := v_operation -> 'cash';
      v_amount := (v_cash ->> 'amount')::numeric;
      IF NOT (v_amount > 0) THEN
        RAISE EXCEPTION 'a cash balance is above zero' USING ERRCODE = '22023';
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
        INSERT INTO public.holdings (source_connection_id, asset_class, currency, amount)
        VALUES ((v_cash ->> 'source_connection_id')::uuid, 'cash',
                (v_cash ->> 'currency')::public.currency, v_amount);
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
