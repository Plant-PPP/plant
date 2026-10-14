-- The average cost per unit a holdings table prints (PLA-151), which the
-- review proposes as the price the units came in at.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TABLE public.import_items ADD COLUMN cost numeric(20, 8)
  CHECK (cost > 0 AND cost <> 'NaN');

COMMENT ON COLUMN public.import_items.cost IS
  'The average cost per unit the document prints, in currency, a bond''s per 100 nominal; null when it prints none.';

GRANT INSERT (cost) ON TABLE public.import_items TO service_role;
