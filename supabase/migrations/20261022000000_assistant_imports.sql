-- The assistant proposes holdings or operations it read in an attachment;
-- confirming its card stages them as a ready import of the account, which the
-- user then reviews and confirms like any other. stage_assistant_import
-- writes the import and its rows as the caller, on an open account of
-- theirs; such an import has no file and no API key behind it.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

CREATE OR REPLACE FUNCTION private.guard_sync_import()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('plant.imports:' || NEW.user_id::text, 0));
  IF NEW.provider = 'assistant' THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.account_api_keys k
                 JOIN public.source_connections s
                   ON s.user_id = k.user_id AND s.id = k.source_connection_id
                 WHERE k.user_id = NEW.user_id
                   AND k.source_connection_id = NEW.source_connection_id
                   AND k.provider = NEW.provider
                   AND s.archived_at IS NULL) THEN
    RAISE EXCEPTION 'no key of that exchange on an open account'
      USING ERRCODE = 'PT404', HINT = 'not_connected';
  END IF;
  IF EXISTS (SELECT 1 FROM public.imports i
             WHERE i.user_id = NEW.user_id
               AND i.source_connection_id = NEW.source_connection_id
               AND i.status IN ('queued', 'reading')) THEN
    RAISE EXCEPTION 'the account is syncing already'
      USING ERRCODE = 'PT409', HINT = 'sync_in_progress';
  END IF;
  RETURN NEW;
END;
$$;

-- p_draft is 'holdings' (rows of import_items) or 'operations' (rows of
-- import_operations); the tables' checks refuse a bad value. The new
-- import's id.
CREATE FUNCTION public.stage_assistant_import(
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
      (user_id, import_id, position, date, kind, symbol, quantity, price, amount, charges, currency, confidence)
    SELECT v_uid, v_import, r.ordinality - 1, (r.value->>'date')::date,
           (r.value->>'kind')::public.movement_kind, r.value->>'symbol',
           (r.value->>'quantity')::numeric, (r.value->>'price')::numeric,
           (r.value->>'amount')::numeric, (r.value->>'charges')::numeric,
           (r.value->>'currency')::public.currency, 'medium'
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS r(value, ordinality);
  END IF;
  RETURN v_import;
END;
$$;

REVOKE ALL ON FUNCTION public.stage_assistant_import(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stage_assistant_import(uuid, text, jsonb) TO authenticated;
