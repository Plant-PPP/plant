-- Validates the debt constraints the previous migration added NOT VALID.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TABLE public.liabilities VALIDATE CONSTRAINT liabilities_opened_on_in_range;
ALTER TABLE public.liabilities VALIDATE CONSTRAINT liabilities_accrues_opened;
ALTER TABLE public.liabilities VALIDATE CONSTRAINT liabilities_accrues_fields;
ALTER TABLE public.liabilities VALIDATE CONSTRAINT liabilities_card_plain;
