-- How many holdings a spreadsheet's reading left out, for the review to say
-- (PLA-146): rows with a symbol and a quantity that did not read, or past the
-- draft's row limit.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TABLE public.imports ADD COLUMN skipped_rows bigint NOT NULL DEFAULT 0
  CHECK (skipped_rows >= 0);
GRANT UPDATE (skipped_rows) ON TABLE public.imports TO service_role;
