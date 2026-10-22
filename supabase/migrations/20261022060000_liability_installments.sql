-- A debt's installment plan: what is due on each date, in the debt's unit.
-- Whether an installment is paid is derived in core from the debt's payments,
-- never stored. The plan is replaced whole through replace_liability_installments.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

CREATE TABLE public.liability_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  liability_id uuid NOT NULL,
  due_on date NOT NULL CONSTRAINT liability_installments_due_on_in_range
    CHECK (due_on BETWEEN '1900-01-01' AND '9999-12-31'),
  amount numeric(20, 8) NOT NULL CONSTRAINT liability_installments_amount_positive CHECK (amount > 0),
  position bigint NOT NULL CONSTRAINT liability_installments_position_range
    CHECK (position BETWEEN 0 AND 599),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  UNIQUE (user_id, liability_id, position),
  FOREIGN KEY (user_id, liability_id) REFERENCES public.liabilities (user_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.liability_installments IS
  'A debt''s installment plan, at most 600 rows: position orders it and caps its size.';

ALTER TABLE public.liability_installments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.liability_installments FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, DELETE ON TABLE public.liability_installments TO authenticated;
GRANT INSERT (liability_id, due_on, amount, position)
  ON TABLE public.liability_installments TO authenticated;

CREATE POLICY liability_installments_owner ON public.liability_installments
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Requires two-factor authentication" ON public.liability_installments
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb)
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb);

-- Replaces one of the caller's debts' plan with p_installments, an array of
-- {due_on, amount} kept in its order. Returns how many rows it wrote.
CREATE FUNCTION public.replace_liability_installments(p_liability_id uuid, p_installments jsonb)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $$
DECLARE
  v_user uuid := (SELECT auth.uid());
  v_debt uuid;
  v_count integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'no user' USING ERRCODE = '42501';
  END IF;
  IF pg_catalog.jsonb_typeof(p_installments) IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_array_length(p_installments) > 600 THEN
    RAISE EXCEPTION 'invalid installments' USING ERRCODE = '22023';
  END IF;

  SELECT l.id INTO v_debt FROM public.liabilities l
    WHERE l.user_id = v_user AND l.id = p_liability_id
    FOR UPDATE;
  IF v_debt IS NULL THEN
    RAISE EXCEPTION 'no such debt' USING ERRCODE = 'PT404', HINT = 'not_found';
  END IF;

  DELETE FROM public.liability_installments i
    WHERE i.user_id = v_user AND i.liability_id = v_debt;
  INSERT INTO public.liability_installments (liability_id, due_on, amount, position)
  SELECT v_debt, (item.value ->> 'due_on')::date, (item.value ->> 'amount')::numeric,
         item.ordinality - 1
  FROM pg_catalog.jsonb_array_elements(p_installments) WITH ORDINALITY AS item(value, ordinality);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_liability_installments(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_liability_installments(uuid, jsonb) TO authenticated;
