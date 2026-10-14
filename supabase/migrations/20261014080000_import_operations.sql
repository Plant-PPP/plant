-- What the import job reads from a document of operations (PLA-149): a draft
-- of each purchase, sale, dividend or coupon it shows, with a null for
-- whatever the document does not say or the readings disagreed on, for the
-- review to ask. The job writes as service_role, past RLS, with only the
-- columns it needs; the user only reads the draft.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

CREATE TABLE public.import_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  import_id uuid NOT NULL,
  position bigint NOT NULL CHECK (position BETWEEN 0 AND 999),
  date date,
  kind public.movement_kind CHECK (kind IN ('purchase', 'sale', 'dividend', 'coupon')),
  symbol text CHECK (char_length(symbol) BETWEEN 1 AND 30),
  quantity numeric(20, 8) CHECK (quantity > 0 AND quantity <> 'NaN'),
  price numeric(20, 8) CHECK (price > 0 AND price <> 'NaN'),
  amount numeric(20, 8) CHECK (amount > 0 AND amount <> 'NaN'),
  charges numeric(20, 8) CHECK (charges >= 0 AND charges <> 'NaN'),
  reference text CHECK (char_length(reference) BETWEEN 1 AND 40),
  currency public.currency NOT NULL,
  confidence public.import_confidence NOT NULL,
  source_page bigint CHECK (source_page BETWEEN 1 AND 10000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  UNIQUE (user_id, import_id, position),
  FOREIGN KEY (user_id, import_id)
    REFERENCES public.imports (user_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.import_operations IS
  'A null field is one the document does not print or the two readings disagreed on; the review asks for it.';
COMMENT ON COLUMN public.import_operations.symbol IS
  'The instrument as the document names it, before it is matched to one Plant knows.';
COMMENT ON COLUMN public.import_operations.price IS
  'The price the document prints, in currency, a bond''s per 100 nominal.';
COMMENT ON COLUMN public.import_operations.amount IS
  'A dividend''s or coupon''s amount, or the total the document prints for a trade.';
COMMENT ON COLUMN public.import_operations.charges IS
  'The commissions, market fees, VAT and taxes the document prints, added up.';

ALTER TABLE public.import_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.import_operations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.import_operations TO authenticated;
-- A retried read replaces the draft it may have half written, its user's only.
GRANT SELECT (id, user_id, import_id), DELETE ON TABLE public.import_operations TO service_role;
GRANT INSERT (user_id, import_id, position, date, kind, symbol, quantity, price, amount,
              charges, reference, currency, confidence, source_page)
  ON TABLE public.import_operations TO service_role;

CREATE POLICY import_operations_owner ON public.import_operations
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Requires two-factor authentication" ON public.import_operations
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb)
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb);

-- Writes each operation through write_operation, after marking the import
-- confirmed: a ready import of the caller's, or nothing is written. Each
-- operation is { "parts": [...], "expected": {...} } as write_operation takes
-- them, every expected read before the first operation. Operations of one
-- import may touch the same instrument, so the revisions read are checked
-- once, under the user's lock, against what the holdings are now; each
-- operation then passes write_operation the revisions as they stand.
CREATE OR REPLACE FUNCTION public.confirm_import(p_import_id uuid, p_operations jsonb)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $$
DECLARE
  v_user uuid := (SELECT auth.uid());
  v_operation jsonb;
  v_expected jsonb := '{}'::jsonb;
  v_symbols text[] := '{}';
  v_key text;
  v_value jsonb;
  v_current jsonb;
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
