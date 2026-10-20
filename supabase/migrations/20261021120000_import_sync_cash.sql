-- What a sync of operations read of the account's money (its movements and
-- the balance each currency opened with), written by the import job and read
-- by the confirmation, which adds it to the account's cash. A JSON object
-- the app checks against cashDraftSchema; 20261021120001 validates the
-- check.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TABLE public.imports ADD COLUMN sync_cash jsonb;

ALTER TABLE public.imports
  ADD CONSTRAINT imports_sync_cash CHECK (
    sync_cash IS NULL
    OR (sync_draft = 'operations'
        AND jsonb_typeof(sync_cash) = 'object'
        AND octet_length(sync_cash::text) <= 2000000)
  ) NOT VALID;

COMMENT ON COLUMN public.imports.sync_cash IS
  'A sync of operations: the movements of the account''s cash it read and each currency''s opening balance; null when the provider gives none.';

GRANT SELECT (sync_cash) ON TABLE public.imports TO authenticated;
GRANT UPDATE (sync_cash) ON TABLE public.imports TO service_role;
