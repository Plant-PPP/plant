-- A file may be uploaded to no account: a card statement or a loan's belongs
-- to none. Its review asks for the account when the reading turns out to be
-- holdings or operations, and the account is then set once, by the user.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- Code already deployed always files a document with its account, and only
-- this change's code reads one without.
-- squawk-ignore ban-drop-not-null
ALTER TABLE public.uploaded_documents ALTER COLUMN source_connection_id DROP NOT NULL;

COMMENT ON COLUMN public.uploaded_documents.source_connection_id IS
  'The account the file was uploaded to; null for none, set once at its review.';

-- The composite foreign key still holds an account, when there is one, to
-- the document's user.
GRANT UPDATE (source_connection_id) ON TABLE public.uploaded_documents TO authenticated;

-- An account, once set, stays; only a document with none gets one.
CREATE FUNCTION private.uploaded_documents_account_set_once()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.source_connection_id IS NOT NULL OR NEW.source_connection_id IS NULL THEN
    RAISE EXCEPTION 'a document''s account is set once'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION private.uploaded_documents_account_set_once()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER uploaded_documents_account_set_once
  BEFORE UPDATE OF source_connection_id ON public.uploaded_documents
  FOR EACH ROW
  WHEN (OLD.source_connection_id IS DISTINCT FROM NEW.source_connection_id)
  EXECUTE FUNCTION private.uploaded_documents_account_set_once();
