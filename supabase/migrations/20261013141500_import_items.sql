-- What the import job reads from a file: a draft of the holdings it lists,
-- each with how sure the reading is and the page it came from, for the user
-- to review. The job writes as service_role, past RLS, with only the columns
-- it needs; the user only reads the draft until the review arrives.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- Extend-only: a new value is added with ALTER TYPE ... ADD VALUE.
CREATE TYPE public.import_failure AS ENUM (
  'unsupported', 'unreadable', 'nothing_found', 'extraction_failed');
CREATE TYPE public.import_confidence AS ENUM ('high', 'medium', 'low');

-- Why a failed import stopped, and the date the document's holdings are at.
ALTER TABLE public.imports ADD COLUMN failure public.import_failure;
ALTER TABLE public.imports ADD COLUMN document_date date;

CREATE TABLE public.import_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  import_id uuid NOT NULL,
  position bigint NOT NULL CHECK (position BETWEEN 0 AND 999),
  symbol text NOT NULL CHECK (char_length(symbol) BETWEEN 1 AND 30),
  quantity numeric(20, 8) NOT NULL CHECK (quantity > 0 AND quantity <> 'NaN'),
  price numeric(20, 8) CHECK (price > 0 AND price <> 'NaN'),
  currency public.currency NOT NULL,
  confidence public.import_confidence NOT NULL,
  source_page bigint CHECK (source_page BETWEEN 1 AND 10000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  UNIQUE (user_id, import_id, position),
  FOREIGN KEY (user_id, import_id)
    REFERENCES public.imports (user_id, id) ON DELETE CASCADE
);

COMMENT ON COLUMN public.import_items.symbol IS
  'The instrument as the document names it, before it is matched to one Plant knows.';
COMMENT ON COLUMN public.import_items.price IS
  'The price per unit the document prints, in currency; null when it prints none.';

ALTER TABLE public.import_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.import_items FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.import_items TO authenticated;
-- A retried read replaces the draft it may have half written.
GRANT SELECT (id, import_id), DELETE ON TABLE public.import_items TO service_role;
GRANT INSERT (user_id, import_id, position, symbol, quantity, price, currency, confidence,
              source_page)
  ON TABLE public.import_items TO service_role;

CREATE POLICY import_items_owner ON public.import_items
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Requires two-factor authentication" ON public.import_items
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb)
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb);

-- The job reads an import and its file, and moves the import along.
GRANT SELECT (id, user_id, document_id, status) ON TABLE public.imports TO service_role;
GRANT UPDATE (status, failure, document_date) ON TABLE public.imports TO service_role;
GRANT SELECT (id, user_id, storage_path, mime_type)
  ON TABLE public.uploaded_documents TO service_role;
