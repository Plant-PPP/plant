-- Connector credentials in Supabase Vault (PLA-155): an account's credentials
-- for its provider (a key and secret, a single key, a token and query id, a
-- username and password) are a JSON object stored as a Vault secret, so no
-- key of the app's seals them. account_api_keys keeps the provider, a hint
-- and which Vault secret holds them, never the credentials.
--
-- A user writes credentials in a transient `credentials` column that a
-- trigger moves into Vault before the row is stored: it runs as the owner,
-- authorizes from the session (auth.uid() and the account's ownership,
-- never from the row) and leaves the column null, which a check holds. Only
-- the import job reads them back, as service_role, through
-- public.account_credentials, filtered by user, account and provider.
--
-- Keys sealed under CONNECTION_SECRETS_KEY (PLA-65) do not open any more:
-- they are deleted and the user connects again. secret_ciphertext stays,
-- unused and granted to nobody, until a later migration drops it.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

DELETE FROM public.account_api_keys;

-- A provider is any registry id: adding one needs no migration.
ALTER TABLE public.account_api_keys DROP CONSTRAINT account_api_keys_provider;
ALTER TABLE public.account_api_keys
  ADD CONSTRAINT account_api_keys_provider CHECK (provider ~ '^[a-z][a-z0-9_]{1,29}$') NOT VALID;
ALTER TABLE public.imports DROP CONSTRAINT imports_provider;
ALTER TABLE public.imports
  ADD CONSTRAINT imports_provider CHECK (provider ~ '^[a-z][a-z0-9_]{1,29}$') NOT VALID;

-- A hint is up to the last four letters or digits of the field the provider
-- shows (a username may have fewer).
ALTER TABLE public.account_api_keys DROP CONSTRAINT account_api_keys_key_hint;
ALTER TABLE public.account_api_keys
  ADD CONSTRAINT account_api_keys_key_hint CHECK (key_hint ~ '^[A-Za-z0-9]{1,4}$') NOT VALID;

-- squawk-ignore ban-drop-not-null
ALTER TABLE public.account_api_keys ALTER COLUMN secret_ciphertext DROP NOT NULL;
REVOKE INSERT (secret_ciphertext), UPDATE (secret_ciphertext)
  ON TABLE public.account_api_keys FROM authenticated;
REVOKE SELECT (secret_ciphertext) ON TABLE public.account_api_keys FROM service_role;
COMMENT ON COLUMN public.account_api_keys.secret_ciphertext IS
  'Unused since credentials moved to Vault; dropped by a later migration.';

ALTER TABLE public.account_api_keys
  ADD COLUMN vault_secret uuid,
  ADD COLUMN credentials jsonb
    CONSTRAINT account_api_keys_credentials_transient CHECK (credentials IS NULL);
ALTER TABLE public.account_api_keys
  ADD CONSTRAINT account_api_keys_vault_secret CHECK (vault_secret IS NOT NULL) NOT VALID;

COMMENT ON COLUMN public.account_api_keys.vault_secret IS
  'The id of the vault.secrets row holding the credentials JSON.';
COMMENT ON COLUMN public.account_api_keys.credentials IS
  'Write-only: the credentials a user sends, moved into Vault by private.store_account_credentials before the row is stored. Always null at rest.';

GRANT INSERT (credentials), UPDATE (credentials)
  ON TABLE public.account_api_keys TO authenticated;

-- ── Into Vault ──────────────────────────────────────────────────────────────
-- SECURITY DEFINER because authenticated holds nothing in vault. It
-- authorizes from the session, not from the row: the caller must be the
-- row's user and own the open account it names.
CREATE FUNCTION private.store_account_credentials()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  AS $$
DECLARE
  v_user uuid := (SELECT auth.uid());
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.vault_secret := OLD.vault_secret;
  END IF;
  IF NEW.credentials IS NULL THEN
    IF TG_OP = 'INSERT' OR NEW.provider IS DISTINCT FROM OLD.provider THEN
      RAISE EXCEPTION 'a key needs its credentials' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  IF v_user IS NULL OR NEW.user_id IS DISTINCT FROM v_user
     OR NOT EXISTS (SELECT 1 FROM public.source_connections s
                    WHERE s.user_id = v_user AND s.id = NEW.source_connection_id
                      AND s.archived_at IS NULL) THEN
    RAISE EXCEPTION 'credentials only for an open account of the caller''s'
      USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(NEW.credentials) IS DISTINCT FROM 'object'
     OR octet_length(NEW.credentials::text) > 4096 THEN
    RAISE EXCEPTION 'credentials are one object of at most 4 KiB' USING ERRCODE = '22023';
  END IF;
  IF NEW.vault_secret IS NULL THEN
    NEW.vault_secret := vault.create_secret(NEW.credentials::text, NULL, 'plant account_api_keys');
  ELSE
    PERFORM vault.update_secret(NEW.vault_secret, NEW.credentials::text);
  END IF;
  NEW.credentials := NULL;
  RETURN NEW;
END;
$$;

-- A key's Vault secret goes with it, the account's deletion included.
CREATE FUNCTION private.delete_account_credentials()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  AS $$
BEGIN
  DELETE FROM vault.secrets s WHERE s.id = OLD.vault_secret;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION private.store_account_credentials() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.delete_account_credentials() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER account_api_keys_store_credentials
  BEFORE INSERT OR UPDATE ON public.account_api_keys
  FOR EACH ROW EXECUTE FUNCTION private.store_account_credentials();
CREATE TRIGGER account_api_keys_delete_credentials
  AFTER DELETE ON public.account_api_keys
  FOR EACH ROW EXECUTE FUNCTION private.delete_account_credentials();

-- ── Out of Vault, for the import job only ───────────────────────────────────
CREATE FUNCTION public.account_credentials(
  p_user_id uuid, p_source_connection_id uuid, p_provider text)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = ''
  AS $$
  SELECT d.decrypted_secret::jsonb
  FROM public.account_api_keys k
  JOIN vault.decrypted_secrets d ON d.id = k.vault_secret
  WHERE k.user_id = p_user_id
    AND k.source_connection_id = p_source_connection_id
    AND k.provider = p_provider
$$;

REVOKE ALL ON FUNCTION public.account_credentials(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_credentials(uuid, uuid, text) TO service_role;

-- ── Syncs of holdings or of operations ──────────────────────────────────────
ALTER TABLE public.imports
  ADD COLUMN sync_draft text
    CONSTRAINT imports_sync_draft CHECK (sync_draft IN ('holdings', 'operations'));
ALTER TABLE public.imports
  ADD CONSTRAINT imports_sync_draft_only_syncs
  CHECK (sync_draft IS NULL OR source_connection_id IS NOT NULL) NOT VALID;

COMMENT ON COLUMN public.imports.sync_draft IS
  'What a sync reads: holdings or operations; null for a file, and a sync before PLA-155 read holdings.';

GRANT INSERT (sync_draft) ON TABLE public.imports TO authenticated;
GRANT SELECT (sync_draft) ON TABLE public.imports TO service_role;
