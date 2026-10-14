-- Exchange connections by API (PLA-65): an account may hold one read-only API
-- key of an exchange, Binance first. Plant's server encrypts the key and its
-- secret before they are stored; authenticated never reads the ciphertext
-- back, only the import job does, as service_role. A sync is an import of the
-- account's balances instead of a file: it names its account and exchange,
-- has no document, counts against no quota, and goes through the same review.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- Extend-only, like every enum: the exchange refused the key, or the key can
-- trade, withdraw or transfer.
ALTER TYPE public.import_failure ADD VALUE IF NOT EXISTS 'connection_rejected' AFTER 'too_many_pages';
ALTER TYPE public.import_failure ADD VALUE IF NOT EXISTS 'connection_not_read_only' AFTER 'connection_rejected';

CREATE TABLE public.account_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  source_connection_id uuid NOT NULL,
  provider text NOT NULL
    CONSTRAINT account_api_keys_provider CHECK (provider IN ('binance')),
  key_hint text NOT NULL
    CONSTRAINT account_api_keys_key_hint CHECK (key_hint ~ '^[A-Za-z0-9]{4}$'),
  secret_ciphertext text NOT NULL
    CONSTRAINT account_api_keys_secret_ciphertext
    CHECK (char_length(secret_ciphertext) <= 2048
           AND secret_ciphertext ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  UNIQUE (user_id, source_connection_id),
  FOREIGN KEY (user_id, source_connection_id)
    REFERENCES public.source_connections (user_id, id) ON DELETE CASCADE
);

COMMENT ON COLUMN public.account_api_keys.key_hint IS
  'The API key''s last four characters, for the user to tell keys apart.';
COMMENT ON COLUMN public.account_api_keys.secret_ciphertext IS
  'The key and its secret, sealed with AES-256-GCM under CONNECTION_SECRETS_KEY and bound to the row''s user, account and provider. Never granted to authenticated for reading.';

ALTER TABLE public.account_api_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_api_keys FROM PUBLIC, anon, authenticated, service_role;
-- Every column but the ciphertext; a GET names its columns.
GRANT SELECT (id, user_id, source_connection_id, provider, key_hint, created_at), DELETE
  ON TABLE public.account_api_keys TO authenticated;
GRANT INSERT (source_connection_id, provider, key_hint, secret_ciphertext)
  ON TABLE public.account_api_keys TO authenticated;
-- The import job reads the sealed key of the account it syncs.
GRANT SELECT (user_id, source_connection_id, provider, secret_ciphertext)
  ON TABLE public.account_api_keys TO service_role;

CREATE POLICY account_api_keys_owner ON public.account_api_keys
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Requires two-factor authentication" ON public.account_api_keys
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb)
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb);

-- ── Syncs ───────────────────────────────────────────────────────────────────
-- An import reads either an uploaded document or an account's exchange. The
-- checks are not validated: every row before this one has a document. The app
-- reads document_id as nullable from this change on, and no other client
-- writes imports.
-- squawk-ignore ban-drop-not-null
ALTER TABLE public.imports ALTER COLUMN document_id DROP NOT NULL;
ALTER TABLE public.imports
  ADD COLUMN source_connection_id uuid,
  ADD COLUMN provider text CONSTRAINT imports_provider CHECK (provider IN ('binance'));
ALTER TABLE public.imports
  ADD CONSTRAINT imports_user_id_source_connection_id_fkey
  FOREIGN KEY (user_id, source_connection_id)
  REFERENCES public.source_connections (user_id, id) ON DELETE CASCADE
  NOT VALID;
ALTER TABLE public.imports
  ADD CONSTRAINT imports_origin CHECK (
    (document_id IS NOT NULL AND source_connection_id IS NULL AND provider IS NULL)
    OR (document_id IS NULL AND source_connection_id IS NOT NULL AND provider IS NOT NULL))
  NOT VALID;

COMMENT ON COLUMN public.imports.source_connection_id IS
  'The account a sync reads from its exchange; null for an uploaded document''s import.';
COMMENT ON COLUMN public.imports.provider IS
  'The exchange a sync reads; null for an uploaded document''s import.';

GRANT INSERT (source_connection_id, provider) ON TABLE public.imports TO authenticated;
GRANT SELECT (source_connection_id, provider) ON TABLE public.imports TO service_role;

-- A sync costs no reading by a model, so it counts against no quota.
CREATE OR REPLACE FUNCTION private.check_import_quota()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  AS $$
DECLARE
  v_month_start timestamptz := date_trunc('month', now() AT TIME ZONE 'America/Argentina/Buenos_Aires')
                                 AT TIME ZONE 'America/Argentina/Buenos_Aires';
BEGIN
  IF NEW.document_id IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('plant.imports:' || NEW.user_id::text, 0));
  IF (SELECT count(*) FROM private.import_requests r
      WHERE r.user_id = NEW.user_id AND r.created_at >= v_month_start) >= 20 THEN
    RAISE EXCEPTION 'the month''s imports are used up'
      USING ERRCODE = 'PT429', HINT = 'import_quota';
  END IF;
  INSERT INTO private.import_requests (user_id, created_at) VALUES (NEW.user_id, NEW.created_at);
  RETURN NEW;
END;
$$;

-- A sync starts only on an open account with a key of that exchange, and one
-- at a time per account. It runs as the caller, after the per-user import
-- lock, and raises a hint the app maps to its copy.
CREATE FUNCTION private.guard_sync_import()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('plant.imports:' || NEW.user_id::text, 0));
  IF NOT EXISTS (SELECT 1 FROM public.account_api_keys k
                 JOIN public.source_connections s
                   ON s.user_id = k.user_id AND s.id = k.source_connection_id
                 WHERE k.user_id = NEW.user_id
                   AND k.source_connection_id = NEW.source_connection_id
                   AND k.provider = NEW.provider
                   AND s.archived_at IS NULL) THEN
    RAISE EXCEPTION 'no key of that exchange on an open account'
      USING ERRCODE = 'PT404', HINT = 'not_connected';
  END IF;
  IF EXISTS (SELECT 1 FROM public.imports i
             WHERE i.user_id = NEW.user_id
               AND i.source_connection_id = NEW.source_connection_id
               AND i.status IN ('queued', 'reading')) THEN
    RAISE EXCEPTION 'the account is syncing already'
      USING ERRCODE = 'PT409', HINT = 'sync_in_progress';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_sync_import() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER imports_guard_sync
  BEFORE INSERT ON public.imports
  FOR EACH ROW WHEN (NEW.document_id IS NULL)
  EXECUTE FUNCTION private.guard_sync_import();
