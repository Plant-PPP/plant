-- Uploads: the files a user sends to be read into an account, and the import
-- each one starts. The file lives in the private `imports` bucket, at
-- {user_id}/imports/{upload_id}/{object_id}; its original name is only a
-- column. A file is kept 30 days.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- Extend-only: a new value is added with ALTER TYPE ... ADD VALUE.
CREATE TYPE public.import_status AS ENUM ('queued', 'reading', 'ready', 'failed', 'confirmed');

-- One uploaded file. Its type, size and hash are read back from Storage by the
-- server after the upload; the same file twice in one account is refused.
-- Deleting it deletes its import.
CREATE TABLE public.uploaded_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  source_connection_id uuid NOT NULL,
  storage_path text NOT NULL,
  file_name text NOT NULL
    CHECK (char_length(file_name) BETWEEN 1 AND 255 AND file_name !~ '[[:cntrl:]/\\]'),
  mime_type text NOT NULL CHECK (mime_type IN (
    'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 20971520),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  delete_after timestamptz NOT NULL DEFAULT now() + interval '30 days',
  UNIQUE (user_id, id),
  UNIQUE (user_id, storage_path),
  UNIQUE (user_id, source_connection_id, sha256),
  FOREIGN KEY (user_id, source_connection_id)
    REFERENCES public.source_connections (user_id, id) ON DELETE CASCADE,
  -- The object sits under its owner's folder, one level per id.
  CONSTRAINT uploaded_documents_path CHECK (
    storage_path ~ '^[0-9a-f-]{36}/imports/[0-9a-f-]{36}/[0-9a-f-]{36}$'
    AND split_part(storage_path, '/', 1) = user_id::text)
);

COMMENT ON COLUMN public.uploaded_documents.delete_after IS
  'When the file and this row are deleted.';

ALTER TABLE public.uploaded_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.uploaded_documents FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, DELETE ON TABLE public.uploaded_documents TO authenticated;
GRANT INSERT (source_connection_id, storage_path, file_name, mime_type, size_bytes, sha256)
  ON TABLE public.uploaded_documents TO authenticated;

CREATE POLICY uploaded_documents_owner ON public.uploaded_documents
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Requires two-factor authentication" ON public.uploaded_documents
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb)
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb);

-- Reading one file into its account. The user starts it, queued; the job
-- moves it along.
CREATE TABLE public.imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  document_id uuid NOT NULL,
  status public.import_status NOT NULL DEFAULT 'queued',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  UNIQUE (user_id, document_id),
  FOREIGN KEY (user_id, document_id)
    REFERENCES public.uploaded_documents (user_id, id) ON DELETE CASCADE
);

CREATE INDEX imports_user_id_created_idx ON public.imports (user_id, created_at DESC, id DESC);

ALTER TABLE public.imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.imports FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.imports TO authenticated;
GRANT INSERT (document_id) ON TABLE public.imports TO authenticated;

CREATE POLICY imports_owner ON public.imports
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Requires two-factor authentication" ON public.imports
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb)
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb);

CREATE TRIGGER imports_set_updated_at
  BEFORE UPDATE ON public.imports
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

-- ── The imports bucket ──────────────────────────────────────────────────────
-- Private, with Storage's own size and type checks; the server checks the
-- file's first bytes again after the upload.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('imports', 'imports', false, 20971520, ARRAY[
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);

-- A user adds, reads and removes files only under their own folder. No
-- policy lets a file be overwritten once uploaded.
CREATE POLICY imports_objects_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'imports'
              AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
              AND (storage.foldername(name))[2] = 'imports');

CREATE POLICY imports_objects_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'imports'
         AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
         AND (storage.foldername(name))[2] = 'imports');

CREATE POLICY imports_objects_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'imports'
         AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
         AND (storage.foldername(name))[2] = 'imports');

CREATE POLICY "Requires two-factor authentication" ON storage.objects
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb)
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb);
