-- Validates the symbol checks the previous migration added NOT VALID.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TABLE public.price_alerts VALIDATE CONSTRAINT price_alerts_subject;
ALTER TABLE public.prices VALIDATE CONSTRAINT prices_symbol_pattern;
ALTER TABLE public.instruments VALIDATE CONSTRAINT instruments_symbol_pattern;
