-- What a property cost the user, financing included, next to the value they
-- state for it.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TABLE public.holdings
  ADD COLUMN cost numeric(20, 8)
    CONSTRAINT holdings_cost CHECK (
      cost > 0 AND cost <> 'NaN' AND (cost IS NULL OR asset_class = 'real_estate')
    );

COMMENT ON COLUMN public.holdings.cost IS
  'What a property cost the user, financing included, in the holding''s currency, or null.';

GRANT INSERT (cost), UPDATE (cost) ON TABLE public.holdings TO authenticated;
