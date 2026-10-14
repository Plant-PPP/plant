-- The account a row belongs to as a document that lists several prints it
-- (PLA-151), for the review to route the row to one of the user's accounts.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TABLE public.import_items ADD COLUMN account text
  CHECK (char_length(account) BETWEEN 1 AND 60);

COMMENT ON COLUMN public.import_items.account IS
  'The account or wallet the document lists the row under, as printed; null when it lists one.';

GRANT INSERT (account) ON TABLE public.import_items TO service_role;
