-- The principal of what a debt owed on its anchor day, when the lender
-- separates it from the interest: the rest of the balance is interest.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TABLE public.liabilities
  ADD COLUMN principal numeric(20, 8)
    CONSTRAINT liabilities_principal CHECK (principal > 0 AND principal <> 'NaN' AND principal <= balance);

COMMENT ON COLUMN public.liabilities.principal IS
  'The principal within the anchor day''s balance, in the debt''s unit, or null.';

GRANT INSERT (principal), UPDATE (principal) ON TABLE public.liabilities TO authenticated;
