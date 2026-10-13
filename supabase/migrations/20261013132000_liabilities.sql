-- Liabilities: what a user owes. A personal loan or a mortgage may be in UVA,
-- owed in pesos at the UVA of the day; a crypto loan is owed in units of an
-- instrument; anything else in a currency. A debt is deleted, never archived:
-- nothing else points at it yet.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- Extend-only: a new value is added with ALTER TYPE ... ADD VALUE.
CREATE TYPE public.liability_kind AS ENUM (
  'personal_loan', 'mortgage', 'credit_card', 'usd_debt', 'crypto_loan');

-- The column names are core's liabilityFields; its unitsAgree is the
-- liabilities_unit CHECK.
CREATE TABLE public.liabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  kind public.liability_kind NOT NULL,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60 AND label = btrim(label)),
  lender text CHECK (lender IS NULL OR (char_length(lender) BETWEEN 1 AND 60 AND lender = btrim(lender))),
  currency public.currency,
  uva boolean NOT NULL DEFAULT false,
  instrument_symbol text REFERENCES public.instruments (symbol),
  balance numeric(20, 8) NOT NULL CHECK (balance > 0 AND balance <> 'NaN'),
  installment numeric(20, 8) CHECK (installment > 0 AND installment <> 'NaN'),
  annual_rate numeric(20, 8)
    CONSTRAINT liabilities_annual_rate CHECK (annual_rate >= 0 AND annual_rate <= 10 AND annual_rate <> 'NaN'),
  installments_left bigint CHECK (installments_left BETWEEN 1 AND 600),
  next_due_on date,
  matures_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  -- A finite date in the years the app reads.
  CONSTRAINT liabilities_dates_in_range CHECK (
    next_due_on BETWEEN '1900-01-01' AND '9999-12-31'
    AND matures_on BETWEEN '1900-01-01' AND '9999-12-31'),
  CONSTRAINT liabilities_unit CHECK (
    (kind = 'crypto_loan' AND instrument_symbol IS NOT NULL AND currency IS NULL AND NOT uva)
    OR (kind <> 'crypto_loan' AND instrument_symbol IS NULL AND currency IS NOT NULL
      AND (NOT uva OR currency = 'ARS')
      AND (kind <> 'usd_debt' OR currency = 'USD')))
);

COMMENT ON COLUMN public.liabilities.balance IS
  'What is owed, in the debt''s unit: its currency, UVA units when uva, or units of instrument_symbol.';
COMMENT ON COLUMN public.liabilities.annual_rate IS
  'The nominal annual rate as a fraction: 0.35 is 35% TNA.';

CREATE INDEX liabilities_user_id_created_idx
  ON public.liabilities (user_id, created_at DESC, id DESC);

ALTER TABLE public.liabilities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.liabilities FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, DELETE ON TABLE public.liabilities TO authenticated;
GRANT INSERT (kind, label, lender, currency, uva, instrument_symbol, balance, installment,
              annual_rate, installments_left, next_due_on, matures_on),
      UPDATE (kind, label, lender, currency, uva, instrument_symbol, balance, installment,
              annual_rate, installments_left, next_due_on, matures_on)
  ON TABLE public.liabilities TO authenticated;

CREATE POLICY liabilities_owner ON public.liabilities
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Requires two-factor authentication" ON public.liabilities
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb)
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb);

CREATE TRIGGER liabilities_set_updated_at
  BEFORE UPDATE ON public.liabilities
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
