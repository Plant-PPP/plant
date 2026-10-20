-- Validates the check the previous migration added NOT VALID.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TABLE public.imports VALIDATE CONSTRAINT imports_sync_cash;
