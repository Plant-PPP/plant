-- The orphan files job asks, for each object, whether a document points at
-- its path; the unique key leads with user_id, which the object's name only
-- spells. Alone in its file, like every concurrent build.
-- squawk-ignore require-lock-timeout, require-statement-timeout, prefer-robust-stmts
CREATE INDEX CONCURRENTLY uploaded_documents_storage_path_idx
  ON public.uploaded_documents (storage_path);
