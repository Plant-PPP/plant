-- A document of operations may list units that came into the account from
-- outside it (a crypto deposit from a wallet, a loan's disbursement): the
-- draft keeps them as an adjustment in, which the review confirms at a cost
-- per unit. 20261021130001 validates the check.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TABLE public.import_operations DROP CONSTRAINT import_operations_kind_check;

ALTER TABLE public.import_operations
  ADD CONSTRAINT import_operations_kind_check
  CHECK (kind IN ('purchase', 'sale', 'dividend', 'coupon', 'adjustment')) NOT VALID;
