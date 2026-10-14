-- A transfer's fee (PLA-140): the side its units leave may carry charges,
-- an expense apart from the units' cost; the side they arrive in carries
-- none. The check is relaxed, so the rows it held already pass it;
-- validating would scan the table under its lock.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TABLE public.movements DROP CONSTRAINT movements_kind_fields;
ALTER TABLE public.movements
  ADD CONSTRAINT movements_kind_fields CHECK (
    (kind IN ('opening_balance', 'purchase', 'sale') AND quantity IS NOT NULL AND price IS NOT NULL
      AND amount IS NULL AND direction IS NULL)
    OR (kind IN ('dividend', 'coupon') AND amount IS NOT NULL AND quantity IS NULL
      AND price IS NULL AND direction IS NULL)
    OR (kind = 'adjustment' AND direction IS NOT NULL AND quantity IS NOT NULL
      AND price IS NOT NULL AND amount IS NULL)
    -- Units leaving carry their own cost and the fee; units arriving may be
    -- given a cost.
    OR (kind = 'transfer' AND direction IS NOT NULL AND quantity IS NOT NULL AND amount IS NULL
      AND (direction = 'in' OR price IS NULL) AND (direction = 'out' OR charges = '[]'))
    OR (kind = 'yield' AND direction IS NOT NULL AND quantity IS NOT NULL
      AND price IS NOT NULL AND amount IS NULL AND charges = '[]'))
  NOT VALID;
