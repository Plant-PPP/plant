-- numeric accepts 'NaN', which passes >= 0 in Postgres (it sorts NaN above
-- every number), and one NaN row turns every sum of a user's costs into NaN.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- ai_costs gets one row per model call and the AI pipeline has not shipped,
-- so the check validates at once.
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE public.ai_costs ADD CONSTRAINT ai_costs_not_nan CHECK (amount_usd <> 'NaN');
