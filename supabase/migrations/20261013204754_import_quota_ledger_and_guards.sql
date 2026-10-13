-- The import quota counts every import started, a confirmed import stays
-- confirmed, and an instrument holding entered with its units keeps them once
-- it gets movements.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- ── The quota ───────────────────────────────────────────────────────────────
-- One row per import started, kept when the import or its file is deleted, so
-- deleting a file gives no import back. Only the quota trigger reads or
-- writes it.
CREATE TABLE private.import_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL
);

CREATE INDEX import_requests_user_id_created_at_idx
  ON private.import_requests (user_id, created_at);

ALTER TABLE private.import_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.import_requests FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO private.import_requests (user_id, created_at)
SELECT i.user_id, i.created_at FROM public.imports i;

-- SECURITY DEFINER because a user starts an import as authenticated, which
-- holds nothing on private.import_requests. The import's user_id and
-- created_at are their defaults: authenticated inserts only document_id.
CREATE OR REPLACE FUNCTION private.check_import_quota()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  AS $$
DECLARE
  v_month_start timestamptz := date_trunc('month', now() AT TIME ZONE 'America/Argentina/Buenos_Aires')
                                 AT TIME ZONE 'America/Argentina/Buenos_Aires';
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('plant.imports:' || NEW.user_id::text, 0));
  IF (SELECT count(*) FROM private.import_requests r
      WHERE r.user_id = NEW.user_id AND r.created_at >= v_month_start) >= 20 THEN
    RAISE EXCEPTION 'the month''s imports are used up'
      USING ERRCODE = 'PT429', HINT = 'import_quota';
  END IF;
  INSERT INTO private.import_requests (user_id, created_at) VALUES (NEW.user_id, NEW.created_at);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.check_import_quota() FROM PUBLIC, anon, authenticated;

-- ── Import status ───────────────────────────────────────────────────────────
-- Nobody moves a confirmed import, the job included: a read retried after the
-- user confirmed would make it ready to confirm again. A user moves an import
-- only from ready to confirmed, which confirm_import does.
CREATE OR REPLACE FUNCTION private.guard_import_status()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
BEGIN
  IF OLD.status = 'confirmed' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'a confirmed import stays confirmed' USING ERRCODE = '42501';
  END IF;
  IF current_user = 'authenticated'
     AND NOT (OLD.status = 'ready' AND NEW.status = 'confirmed') THEN
    RAISE EXCEPTION 'a user only confirms a ready import' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_import_status() FROM PUBLIC, anon, authenticated;

-- ── Writing an operation ────────────────────────────────────────────────────
-- As in 20261013130100_movements.sql, plus: an active instrument holding a
-- part writes to that has units and no movement (entered with its amount)
-- first gets those units as an opening balance of their own operation, on
-- the part's day, in its currency, at its price and dollar rates, so the sum
-- of its movements keeps them. A part with no price (income, or units going
-- out with their own cost) into such a holding is refused with hint
-- 'no_history'.
CREATE OR REPLACE FUNCTION public.write_operation(p_operation_id uuid, p_parts jsonb, p_expected jsonb)
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
  v_units numeric;
  v_opening uuid;
  v_opening_order bigint;
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

  -- Before an edit takes its operation's movements out, so a holding they
  -- leave empty is not taken for one entered with its amount.
  FOR v_part IN SELECT value FROM jsonb_array_elements(p_parts) LOOP
    SELECT h.id, h.amount INTO v_holding, v_units FROM public.holdings h
      WHERE h.user_id = v_user AND h.archived_at IS NULL AND h.asset_class = 'instrument'
        AND h.source_connection_id = (v_part ->> 'source_connection_id')::uuid
        AND h.portfolio_id = (v_part ->> 'portfolio_id')::uuid
        AND h.instrument_symbol = v_part ->> 'instrument_symbol'
        AND h.amount > 0
        AND NOT EXISTS (SELECT 1 FROM public.movements m
                        WHERE m.user_id = v_user AND m.holding_id = h.id);
    CONTINUE WHEN NOT FOUND;
    IF v_part ->> 'price' IS NULL THEN
      RAISE EXCEPTION 'a holding with no movements takes a priced one first'
        USING ERRCODE = 'PT409', HINT = 'no_history';
    END IF;
    SELECT COALESCE(max(o.entry_order), 0) + 1 INTO v_opening_order
      FROM public.operations o WHERE o.user_id = v_user;
    INSERT INTO public.operations (entry_order) VALUES (v_opening_order) RETURNING id INTO v_opening;
    INSERT INTO public.movements (holding_id, operation_id, entry_order, kind, date, currency,
                                  quantity, price, rates)
      VALUES (v_holding, v_opening, v_opening_order, 'opening_balance',
              (v_part ->> 'date')::date,
              (v_part ->> 'currency')::public.currency,
              v_units,
              (v_part ->> 'price')::numeric,
              v_part -> 'rates');
  END LOOP;

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
