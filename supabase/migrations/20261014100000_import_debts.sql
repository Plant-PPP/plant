-- What the import job reads from a card statement (PLA-78): a draft of what it
-- says is owed in each currency, with a null for whatever the statement does
-- not print or the readings disagreed on, for the review to ask. The job
-- writes as service_role, past RLS, with only the columns it needs; the user
-- only reads the draft.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

CREATE TABLE public.import_debts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  import_id uuid NOT NULL,
  position bigint NOT NULL CHECK (position BETWEEN 0 AND 9),
  label text CHECK (char_length(label) BETWEEN 1 AND 60),
  lender text CHECK (char_length(lender) BETWEEN 1 AND 60),
  currency public.currency NOT NULL,
  balance numeric(20, 8) CHECK (balance > 0 AND balance <> 'NaN'),
  minimum_payment numeric(20, 8) CHECK (minimum_payment > 0 AND minimum_payment <> 'NaN'),
  due_date date CHECK (due_date BETWEEN '1900-01-01' AND '9999-12-31'),
  confidence public.import_confidence NOT NULL,
  source_page bigint CHECK (source_page BETWEEN 1 AND 10000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  UNIQUE (user_id, import_id, position),
  FOREIGN KEY (user_id, import_id)
    REFERENCES public.imports (user_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.import_debts IS
  'A null field is one the statement does not print or the two readings disagreed on; the review asks for it.';
COMMENT ON COLUMN public.import_debts.label IS
  'The card as the statement names it (Visa, Mastercard Black).';
COMMENT ON COLUMN public.import_debts.balance IS
  'The statement''s balance in currency: what is owed at its close.';

ALTER TABLE public.import_debts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.import_debts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.import_debts TO authenticated;
-- A retried read replaces the draft it may have half written, its user's only.
GRANT SELECT (id, user_id, import_id), DELETE ON TABLE public.import_debts TO service_role;
GRANT INSERT (user_id, import_id, position, label, lender, currency, balance, minimum_payment,
              due_date, confidence, source_page)
  ON TABLE public.import_debts TO service_role;

CREATE POLICY import_debts_owner ON public.import_debts
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Requires two-factor authentication" ON public.import_debts
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb)
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb);

-- Marks a ready import of the caller's confirmed and writes each debt the
-- review kept: a new credit card debt, or the balance, minimum payment and
-- due date of one of the caller's card debts in the same currency. Each debt
-- is { "liability_id", "label", "lender", "currency", "balance",
-- "installment", "next_due_on" }; all or nothing, as the caller, under RLS.
CREATE FUNCTION public.confirm_import_debts(p_import_id uuid, p_debts jsonb)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $$
DECLARE
  v_user uuid := (SELECT auth.uid());
  v_debt jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'no user' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_debts) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_debts) > 10 THEN
    RAISE EXCEPTION 'an import has at most 10 debts' USING ERRCODE = '22023';
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

  FOR v_debt IN SELECT value FROM jsonb_array_elements(p_debts) LOOP
    IF jsonb_typeof(v_debt) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'a debt is an object' USING ERRCODE = '22023';
    END IF;
    IF v_debt ->> 'liability_id' IS NOT NULL THEN
      UPDATE public.liabilities l
        SET balance = (v_debt ->> 'balance')::numeric,
            installment = (v_debt ->> 'installment')::numeric,
            next_due_on = (v_debt ->> 'next_due_on')::date
        WHERE l.user_id = v_user
          AND l.id = (v_debt ->> 'liability_id')::uuid
          AND l.kind = 'credit_card'
          AND l.currency = (v_debt ->> 'currency')::public.currency;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'no such card debt' USING ERRCODE = 'PT404', HINT = 'not_found';
      END IF;
    ELSE
      INSERT INTO public.liabilities (kind, label, lender, currency, balance, installment, next_due_on)
      VALUES ('credit_card', v_debt ->> 'label', v_debt ->> 'lender',
              (v_debt ->> 'currency')::public.currency, (v_debt ->> 'balance')::numeric,
              (v_debt ->> 'installment')::numeric, (v_debt ->> 'next_due_on')::date);
    END IF;
  END LOOP;

  RETURN p_import_id;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_import_debts(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_import_debts(uuid, jsonb) TO authenticated;
