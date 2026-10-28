-- A document of operations may show units leaving the account (a withdrawal,
-- a fee charged in the asset itself), and the review may name one as a
-- transfer to another of the user's accounts. The draft keeps an
-- adjustment's direction, and a transfer's counterpart account once the user
-- or the assistant names it. A row written before this column has no
-- direction and is an adjustment in. 20261028110001 validates the checks.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TABLE public.import_operations
  ADD COLUMN direction public.movement_direction,
  ADD COLUMN counterpart_connection_id uuid;

ALTER TABLE public.import_operations
  ADD CONSTRAINT import_operations_counterpart_fkey
  FOREIGN KEY (user_id, counterpart_connection_id)
  REFERENCES public.source_connections (user_id, id)
  ON DELETE SET NULL (counterpart_connection_id) NOT VALID;

ALTER TABLE public.import_operations DROP CONSTRAINT import_operations_kind_check;

ALTER TABLE public.import_operations
  ADD CONSTRAINT import_operations_kind_check
  CHECK (kind IN ('purchase', 'sale', 'dividend', 'coupon', 'adjustment', 'transfer')) NOT VALID;

-- Only an adjustment or a transfer has a direction, a transfer's is out, and
-- only a transfer names the account its units go to.
ALTER TABLE public.import_operations
  ADD CONSTRAINT import_operations_direction
  CHECK ((direction IS NULL OR kind IN ('adjustment', 'transfer'))
         AND (kind IS DISTINCT FROM 'transfer' OR direction = 'out')
         AND (counterpart_connection_id IS NULL OR kind = 'transfer')) NOT VALID;

COMMENT ON COLUMN public.import_operations.direction IS
  'Whether an adjustment''s units came in or left; null on an adjustment written before it, which came in.';
COMMENT ON COLUMN public.import_operations.counterpart_connection_id IS
  'The user''s account a transfer''s units go to.';

-- The import job reads a document's withdrawals; it never names a transfer.
GRANT INSERT (direction) ON TABLE public.import_operations TO service_role;
