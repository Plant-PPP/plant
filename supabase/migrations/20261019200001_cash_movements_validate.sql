-- Validates the holdings check the previous migration added NOT VALID.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TABLE public.holdings VALIDATE CONSTRAINT holdings_amount_at_least_zero;
