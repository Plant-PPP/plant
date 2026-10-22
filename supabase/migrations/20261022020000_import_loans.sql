-- What the import job reads from a loan or credit line statement, next to a
-- card's: the debt's kind, rate, whether it accrues and the day of its
-- balance, and for a crypto loan the instrument it is owed in; its currency
-- is a placeholder the review ignores. A null kind is a card.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TABLE public.import_debts
  ADD COLUMN kind public.liability_kind,
  ADD COLUMN annual_rate numeric(10, 8)
    CONSTRAINT import_debts_annual_rate CHECK (annual_rate BETWEEN 0 AND 10 AND annual_rate <> 'NaN'),
  ADD COLUMN accrues boolean,
  ADD COLUMN opened_on date
    CONSTRAINT import_debts_opened_on_in_range CHECK (opened_on BETWEEN '1900-01-01' AND '9999-12-31'),
  ADD COLUMN instrument_symbol text
    CONSTRAINT import_debts_instrument_symbol CHECK (instrument_symbol ~ '^[A-Z0-9]{1,15}$');

COMMENT ON COLUMN public.import_debts.kind IS 'The debt''s kind, or null for a card.';
COMMENT ON COLUMN public.import_debts.annual_rate IS 'The yearly rate as a fraction, or null.';

GRANT INSERT (kind, annual_rate, accrues, opened_on, instrument_symbol)
  ON TABLE public.import_debts TO service_role;

-- Marks a ready import of the caller's confirmed and writes each debt the
-- review kept: a new credit card debt, or the balance of one of the caller's
-- card debts in the same currency, with the minimum payment and due date the
-- statement gives, keeping the debt's own where it gives none; or a new debt
-- of another kind. Each debt is { "liability_id", "kind", "label", "lender",
-- "currency", "instrument_symbol", "balance", "installment", "annual_rate",
-- "accrues", "opened_on", "next_due_on" }, a missing kind a card; all or
-- nothing, as the caller, under RLS.
CREATE OR REPLACE FUNCTION public.confirm_import_debts(p_import_id uuid, p_debts jsonb)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $$
DECLARE
  v_user uuid := (SELECT auth.uid());
  v_debt jsonb;
  v_kind public.liability_kind;
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
    v_kind := COALESCE((v_debt ->> 'kind')::public.liability_kind, 'credit_card');
    IF v_kind <> 'credit_card' THEN
      IF v_debt ->> 'liability_id' IS NOT NULL THEN
        RAISE EXCEPTION 'only a card debt is updated' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.liabilities (kind, label, lender, currency, instrument_symbol, balance,
                                      installment, annual_rate, accrues, opened_on, next_due_on)
      VALUES (v_kind, v_debt ->> 'label', v_debt ->> 'lender',
              (v_debt ->> 'currency')::public.currency, v_debt ->> 'instrument_symbol',
              (v_debt ->> 'balance')::numeric, (v_debt ->> 'installment')::numeric,
              (v_debt ->> 'annual_rate')::numeric, COALESCE((v_debt ->> 'accrues')::boolean, false),
              (v_debt ->> 'opened_on')::date, (v_debt ->> 'next_due_on')::date);
    ELSIF v_debt ->> 'liability_id' IS NOT NULL THEN
      UPDATE public.liabilities l
        SET balance = (v_debt ->> 'balance')::numeric,
            installment = COALESCE((v_debt ->> 'installment')::numeric, l.installment),
            next_due_on = COALESCE((v_debt ->> 'next_due_on')::date, l.next_due_on)
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
