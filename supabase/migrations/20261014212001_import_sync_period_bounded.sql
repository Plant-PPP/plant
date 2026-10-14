-- A sync period's days fall between 2000 and year 9999, so the import job
-- never gets a day it cannot read ('infinity' or year 10000), and only a sync
-- of operations carries one: a NULL sync_draft (a file import) passed the old
-- check. 20261014212002 validates it.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TABLE public.imports DROP CONSTRAINT imports_sync_period;

ALTER TABLE public.imports
  ADD CONSTRAINT imports_sync_period
  CHECK (
    (sync_from IS NULL AND sync_to IS NULL)
    OR (sync_draft IS NOT DISTINCT FROM 'operations'
        AND (sync_from IS NULL OR sync_from BETWEEN '2000-01-01' AND '9999-12-31')
        AND (sync_to IS NULL OR sync_to BETWEEN '2000-01-01' AND '9999-12-31')
        AND (sync_from IS NULL OR sync_to IS NULL OR sync_from <= sync_to))
  ) NOT VALID;
