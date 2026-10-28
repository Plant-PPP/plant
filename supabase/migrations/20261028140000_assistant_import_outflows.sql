-- The assistant's proposals of operations stage withdrawals, transfers to
-- another of the user's open accounts and payments on one of the user's
-- debts that is not a card: stage_assistant_import writes an operation's
-- direction, counterpart account, whether it pays a debt and the debt,
-- refusing an account or a debt that is not the caller's to name.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- p_draft is 'holdings' (rows of import_items) or 'operations' (rows of
-- import_operations); the tables' checks refuse a bad value. The new
-- import's id.
CREATE OR REPLACE FUNCTION public.stage_assistant_import(
  p_source_connection_id uuid,
  p_draft text,
  p_rows jsonb
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_import uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'signed in only' USING ERRCODE = '42501';
  END IF;
  IF p_draft IS DISTINCT FROM 'holdings' AND p_draft IS DISTINCT FROM 'operations' THEN
    RAISE EXCEPTION 'holdings or operations' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION '1 to 200 rows' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.source_connections s
                 WHERE s.user_id = v_uid AND s.id = p_source_connection_id
                   AND s.archived_at IS NULL) THEN
    RAISE EXCEPTION 'no open account of the caller' USING ERRCODE = 'PT404';
  END IF;
  IF p_draft = 'operations' AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_rows) r
       WHERE r ->> 'counterpart_connection_id' IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.source_connections s
                         WHERE s.user_id = v_uid
                           AND s.id = (r ->> 'counterpart_connection_id')::uuid
                           AND s.id <> p_source_connection_id
                           AND s.archived_at IS NULL)) THEN
    RAISE EXCEPTION 'no other open account of the caller'
      USING ERRCODE = 'PT404', HINT = 'counterpart_not_found';
  END IF;
  IF p_draft = 'operations' AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_rows) r
       WHERE r ->> 'pays_liability_id' IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.liabilities l
                         WHERE l.user_id = v_uid
                           AND l.id = (r ->> 'pays_liability_id')::uuid
                           AND l.kind <> 'credit_card')) THEN
    RAISE EXCEPTION 'no such debt of the caller to pay'
      USING ERRCODE = 'PT404', HINT = 'debt_not_found';
  END IF;

  INSERT INTO public.imports (user_id, source_connection_id, provider, sync_draft, status, document_date)
  VALUES (v_uid, p_source_connection_id, 'assistant', p_draft, 'ready',
          CASE WHEN p_draft = 'holdings'
               THEN (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date END)
  RETURNING id INTO v_import;

  IF p_draft = 'holdings' THEN
    INSERT INTO public.import_items
      (user_id, import_id, position, symbol, quantity, price, cost, currency, asset_class, confidence)
    SELECT v_uid, v_import, r.ordinality - 1, r.value->>'symbol', (r.value->>'quantity')::numeric,
           (r.value->>'price')::numeric, (r.value->>'cost')::numeric,
           (r.value->>'currency')::public.currency,
           coalesce(r.value->>'asset_class', 'instrument')::public.asset_class, 'medium'
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS r(value, ordinality);
  ELSE
    INSERT INTO public.import_operations
      (user_id, import_id, position, date, kind, direction, counterpart_connection_id,
       debt_payment, pays_liability_id, symbol, quantity, price, amount, charges, currency,
       confidence)
    SELECT v_uid, v_import, r.ordinality - 1, (r.value->>'date')::date,
           (r.value->>'kind')::public.movement_kind,
           (r.value->>'direction')::public.movement_direction,
           (r.value->>'counterpart_connection_id')::uuid,
           coalesce((r.value->>'debt_payment')::boolean, false),
           (r.value->>'pays_liability_id')::uuid, r.value->>'symbol',
           (r.value->>'quantity')::numeric, (r.value->>'price')::numeric,
           (r.value->>'amount')::numeric, (r.value->>'charges')::numeric,
           (r.value->>'currency')::public.currency, 'medium'
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS r(value, ordinality);
  END IF;
  RETURN v_import;
END;
$$;

