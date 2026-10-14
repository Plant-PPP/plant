-- The file deletion job reads the documents whose file is still there by
-- delete_after, oldest first. Alone in its file, like every concurrent build.
-- squawk-ignore require-lock-timeout, require-statement-timeout, prefer-robust-stmts
CREATE INDEX CONCURRENTLY uploaded_documents_due_idx
  ON public.uploaded_documents (delete_after) WHERE file_deleted_at IS NULL;
