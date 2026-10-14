-- A user writes operations and movements only through write_operation
-- (PLA-147): the API's grants on them stay, as write_operation runs as the
-- caller, but a direct insert or delete would skip its checks (no holding
-- below zero units) and leave the holdings' amounts and revisions behind.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- write_operation marks its transaction; PostgREST cannot call set_config.
CREATE OR REPLACE FUNCTION public.write_operation(
  p_operation_id uuid, p_parts jsonb, p_expected jsonb, p_last boolean)
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
  -- What this transaction writes to operations and movements, it writes here.
  PERFORM pg_catalog.set_config('plant.write_operation', 'on', true);
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
    -- An edit the app admitted last on its day, as if entered again, takes the
    -- next place; otherwise it keeps its own.
    IF p_last AND jsonb_array_length(p_parts) > 0 THEN
      SELECT COALESCE(max(o.entry_order), 0) + 1 INTO v_entry_order
        FROM public.operations o WHERE o.user_id = v_user;
      UPDATE public.operations o SET entry_order = v_entry_order
        WHERE o.user_id = v_user AND o.id = v_operation;
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

-- It runs as the caller, so the API roles are told apart by current_user;
-- a cascade from deleting a holding or a user runs as the tables' owner.
CREATE FUNCTION private.ledger_written_by_write_operation()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $$
BEGIN
  IF current_user = 'authenticated'
     AND pg_catalog.current_setting('plant.write_operation', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'operations and movements are written through write_operation'
      USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION private.ledger_written_by_write_operation()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER movements_written_by_write_operation
  BEFORE INSERT OR DELETE ON public.movements
  FOR EACH ROW EXECUTE FUNCTION private.ledger_written_by_write_operation();

CREATE TRIGGER operations_written_by_write_operation
  BEFORE INSERT OR UPDATE OR DELETE ON public.operations
  FOR EACH ROW EXECUTE FUNCTION private.ledger_written_by_write_operation();
