-- numeric accepts 'NaN', which passes > 0 and <= in Postgres (it sorts NaN
-- above every number). A NaN buy already fails buy <= sell against any sell
-- but NaN, so sell and price are the columns to check.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- fx_rates holds one row per kind and day, so the check validates at once.
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE public.fx_rates ADD CONSTRAINT fx_rates_not_nan CHECK (sell <> 'NaN');

-- prices holds one row per symbol and day, so the check validates at once.
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE public.prices ADD CONSTRAINT prices_not_nan CHECK (price <> 'NaN');
