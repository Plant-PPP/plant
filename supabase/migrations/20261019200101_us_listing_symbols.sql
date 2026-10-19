-- A symbol is a BYMA or crypto ticker, or a US listing's ticker with .US (a
-- class share with a dash: BRK-B.US), so a ticker can be a CEDEAR and a US
-- share at once. The three checks repeat INSTRUMENT_SYMBOL_PATTERN in
-- @plant/shared; 20261019200102 validates them. instruments goes last: every
-- page reads it.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TABLE public.price_alerts DROP CONSTRAINT price_alerts_subject;

ALTER TABLE public.price_alerts
  ADD CONSTRAINT price_alerts_subject CHECK (
    (subject_kind = 'instrument' AND subject ~ '^([A-Z0-9]{1,15}|[A-Z0-9]{1,10}(-[A-Z0-9]{1,2})?\.US)$')
    OR (subject_kind = 'dollar' AND subject IN ('official', 'mep', 'ccl', 'blue') AND currency = 'ARS')
  ) NOT VALID;

ALTER TABLE public.prices DROP CONSTRAINT prices_symbol_check;

ALTER TABLE public.prices
  ADD CONSTRAINT prices_symbol_pattern CHECK (symbol ~ '^([A-Z0-9]{1,15}|[A-Z0-9]{1,10}(-[A-Z0-9]{1,2})?\.US)$') NOT VALID;

ALTER TABLE public.instruments DROP CONSTRAINT instruments_symbol_pattern;

ALTER TABLE public.instruments
  ADD CONSTRAINT instruments_symbol_pattern CHECK (symbol ~ '^([A-Z0-9]{1,15}|[A-Z0-9]{1,10}(-[A-Z0-9]{1,2})?\.US)$') NOT VALID;
