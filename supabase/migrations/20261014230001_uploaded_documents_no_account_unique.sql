-- The same file twice with no account is refused, as it is in one account.
-- Alone in its file, like every concurrent build.
-- squawk-ignore require-lock-timeout, require-statement-timeout, prefer-robust-stmts
CREATE UNIQUE INDEX CONCURRENTLY uploaded_documents_user_id_sha256_no_account_key
  ON public.uploaded_documents (user_id, sha256) WHERE source_connection_id IS NULL;
