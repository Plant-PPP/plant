-- What an import's review compares and how spreadsheets are read: the value
-- each row prints and the totals the document prints, aliases that name an
-- instrument, and the column mapping a spreadsheet format gets once per
-- account institution. The job writes as service_role with only the columns
-- it needs, filtering by the import's user.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- Mapping a spreadsheet's columns is costed apart from reading a statement.
ALTER TYPE public.ai_cost_type ADD VALUE 'import_column_mapping' AFTER 'import_extraction';

-- The row's value as the document prints it, in its currency; null when it
-- prints none.
ALTER TABLE public.import_items ADD COLUMN value numeric(20, 8)
  CHECK (value > 0 AND value <> 'NaN');
GRANT INSERT (value) ON TABLE public.import_items TO service_role;
-- A retried read deletes only its own user's draft.
GRANT SELECT (user_id) ON TABLE public.import_items TO service_role;

-- The holdings totals the document prints, per currency.
ALTER TABLE public.imports ADD COLUMN printed_total_ars numeric(20, 2)
  CHECK (printed_total_ars >= 0 AND printed_total_ars <> 'NaN');
ALTER TABLE public.imports ADD COLUMN printed_total_usd numeric(20, 2)
  CHECK (printed_total_usd >= 0 AND printed_total_usd <> 'NaN');
GRANT UPDATE (printed_total_ars, printed_total_usd) ON TABLE public.imports TO service_role;

-- The job reads the institution of the account a file was uploaded to. The
-- foreign key between them is (user_id, id), so the embed needs user_id.
GRANT SELECT (source_connection_id) ON TABLE public.uploaded_documents TO service_role;
GRANT SELECT (id, user_id, institution) ON TABLE public.source_connections TO service_role;

-- Other names a document gives an instrument, matched after normalizing case,
-- accents and punctuation. Migrations seed them; nobody else writes them.
ALTER TABLE public.instruments ADD COLUMN aliases text[] NOT NULL DEFAULT '{}';
UPDATE public.instruments SET aliases = v.aliases
FROM (VALUES
  ('BTC', ARRAY['BITCOIN']),
  ('ETH', ARRAY['ETHEREUM', 'ETHER']),
  ('SOL', ARRAY['SOLANA']),
  ('USDT', ARRAY['TETHER']),
  ('USDC', ARRAY['USD COIN']),
  ('AAPL', ARRAY['APPLE']),
  ('KO', ARRAY['COCA COLA']),
  ('MELI', ARRAY['MERCADO LIBRE', 'MERCADOLIBRE']),
  ('MSFT', ARRAY['MICROSOFT']),
  ('NVDA', ARRAY['NVIDIA']),
  ('SPY', ARRAY['SPDR S&P 500']),
  ('TSLA', ARRAY['TESLA'])
) AS v (symbol, aliases)
WHERE instruments.symbol = v.symbol;

-- How one spreadsheet format reads, per user, account institution and set of
-- headers, so the model maps it only once. Only the job writes a mapping.
CREATE TABLE public.column_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  institution text NOT NULL
    CHECK (char_length(institution) BETWEEN 1 AND 60 AND institution = btrim(institution)),
  header_signature text NOT NULL CHECK (header_signature ~ '^[0-9a-f]{64}$'),
  mapping jsonb NOT NULL CHECK (jsonb_typeof(mapping) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, institution, header_signature)
);

ALTER TABLE public.column_mappings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.column_mappings FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.column_mappings TO authenticated;
GRANT SELECT (user_id, institution, header_signature, mapping),
      INSERT (user_id, institution, header_signature, mapping)
  ON TABLE public.column_mappings TO service_role;

CREATE POLICY column_mappings_owner ON public.column_mappings
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Requires two-factor authentication" ON public.column_mappings
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb)
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb);
