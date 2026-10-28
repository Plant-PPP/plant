-- Validates the check and the foreign key the previous migration added NOT
-- VALID.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TABLE public.import_operations VALIDATE CONSTRAINT import_operations_debt_payment;
ALTER TABLE public.import_operations VALIDATE CONSTRAINT import_operations_pays_liability_fkey;
