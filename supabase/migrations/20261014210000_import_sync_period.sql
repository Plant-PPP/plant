-- The period a sync of operations reads: the user picks it before the sync
-- starts, and the import job passes it to the provider. Null on either end
-- leaves that end open; a sync of holdings and a file carry none.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TABLE public.imports
  ADD COLUMN sync_from date,
  ADD COLUMN sync_to date;

ALTER TABLE public.imports
  ADD CONSTRAINT imports_sync_period
  CHECK (
    (sync_from IS NULL AND sync_to IS NULL)
    OR (sync_draft = 'operations'
        AND sync_from >= '2000-01-01'
        AND (sync_from IS NULL OR sync_to IS NULL OR sync_from <= sync_to))
  ) NOT VALID;

COMMENT ON COLUMN public.imports.sync_from IS
  'A sync of operations: the first day it reads; null reads from the provider''s start.';
COMMENT ON COLUMN public.imports.sync_to IS
  'A sync of operations: the last day it reads; null reads up to today.';

GRANT INSERT (sync_from, sync_to) ON TABLE public.imports TO authenticated;
GRANT SELECT (sync_from, sync_to) ON TABLE public.imports TO service_role;
