-- The operation that brought a loan's money into an account: the units that
-- came in when it was disbursed, so the movements name it a loan rather than
-- a deposit. Deleting the operation clears it. 20261021140001 validates the
-- key.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TABLE public.liabilities ADD COLUMN disbursement_operation_id uuid;

ALTER TABLE public.liabilities
  ADD CONSTRAINT liabilities_disbursement_operation_fkey
  FOREIGN KEY (user_id, disbursement_operation_id)
  REFERENCES public.operations (user_id, id)
  ON DELETE SET NULL (disbursement_operation_id)
  NOT VALID;

COMMENT ON COLUMN public.liabilities.disbursement_operation_id IS
  'The operation the loan''s money came into an account with, or null.';

GRANT UPDATE (disbursement_operation_id) ON TABLE public.liabilities TO authenticated;
