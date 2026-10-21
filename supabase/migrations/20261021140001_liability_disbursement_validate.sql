-- Validates the key the previous migration added NOT VALID.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TABLE public.liabilities VALIDATE CONSTRAINT liabilities_disbursement_operation_fkey;
