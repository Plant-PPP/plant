-- The files a user attaches to a question are kept for the conversation, so
-- its later turns read them again: in the imports bucket under
-- {user}/assistant/{conversation}/, the question naming their paths in its
-- metadata. A user adds, reads and removes only their own, and none is
-- overwritten, as with their imports. The orphan files job removes a chat
-- file 30 days after it was added; no document ever points at one.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

CREATE POLICY assistant_objects_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'imports'
              AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
              AND (storage.foldername(name))[2] = 'assistant');

CREATE POLICY assistant_objects_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'imports'
         AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
         AND (storage.foldername(name))[2] = 'assistant');

CREATE POLICY assistant_objects_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'imports'
         AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
         AND (storage.foldername(name))[2] = 'assistant');

-- The files in the imports bucket that no document points at, over a day
-- old, but a chat file under 30 days old, which its conversation reads.
CREATE OR REPLACE FUNCTION public.orphan_import_files(p_limit integer, p_after uuid DEFAULT NULL)
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
    AND NOT ((storage.foldername(o.name))[2] = 'assistant'
             AND o.created_at > now() - interval '30 days')
  ORDER BY o.id
  LIMIT least(greatest(p_limit, 0), 1000);
$$;
