-- The Inngest run that claimed an import for reading, so a retried prepare of
-- that run goes on while any other run skips it. Only the import job reads or
-- writes it: authenticated keeps reading every other column, now through a
-- column grant, as a table grant would cover this one too.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TABLE public.imports ADD COLUMN read_run_id text;

REVOKE SELECT ON TABLE public.imports FROM authenticated;
GRANT SELECT (id, user_id, document_id, status, created_at, updated_at, failure,
              document_date, printed_total_ars, printed_total_usd, skipped_rows,
              source_connection_id, provider, sync_draft, sync_from, sync_to)
  ON TABLE public.imports TO authenticated;

GRANT SELECT (read_run_id), UPDATE (read_run_id) ON TABLE public.imports TO service_role;
