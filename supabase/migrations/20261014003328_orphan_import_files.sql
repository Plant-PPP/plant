-- The files in the imports bucket that no document points at: a signed upload
-- whose finish never ran, or an object a user wrote straight into their
-- folder. The orphan files job removes them through Storage.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- Runs as the caller: service_role reads storage.objects and
-- uploaded_documents.storage_path already. Only objects over a day old, so an
-- upload whose finish has not run yet is never one. Keyset by the object's
-- id, which is no path, so the job's cursor carries none.
CREATE FUNCTION public.orphan_import_files(p_limit integer, p_after uuid DEFAULT NULL)
  RETURNS TABLE (id uuid, name text)
  LANGUAGE sql
  STABLE
  SET search_path = ''
  AS $$
  SELECT o.id, o.name FROM storage.objects o
  WHERE o.bucket_id = 'imports'
    AND o.created_at < now() - interval '1 day'
    AND (p_after IS NULL OR o.id > p_after)
    AND NOT EXISTS (SELECT 1 FROM public.uploaded_documents d WHERE d.storage_path = o.name)
  ORDER BY o.id
  LIMIT least(greatest(p_limit, 0), 1000);
$$;

REVOKE ALL ON FUNCTION public.orphan_import_files(integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.orphan_import_files(integer, uuid) TO service_role;
