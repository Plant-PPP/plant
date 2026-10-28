-- The orphan files finder: only objects of the imports bucket over a day old
-- that no document points at, chat files once 30 days old, after the cursor,
-- and only service_role may ask.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(11);

-- The SQLSTATE a statement raises, or NULL if it succeeds.
CREATE FUNCTION pg_temp.error_of(statement text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE statement;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$f$;

GRANT EXECUTE ON FUNCTION pg_temp.error_of(text) TO anon, authenticated, service_role;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at)
VALUES
  ('a0000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ana@pgtap.invalid', '', now(), '{}', '{}', now(), now()),
  ('b0000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'beto@pgtap.invalid', '', now(), '{}', '{}', now(), now());

INSERT INTO public.source_connections (id, user_id, institution, default_portfolio_id)
SELECT 'a5000000-0000-4000-8000-0000000000a5', user_id, 'IOL', id
FROM public.portfolios WHERE user_id = 'a0000000-0000-4000-8000-00000000000a';

-- Ana's documents: one whose file is still there, one whose file the
-- deletion job already removed and whose object a stale copy brought back.
INSERT INTO public.uploaded_documents (user_id, source_connection_id, storage_path, file_name,
                                       mime_type, size_bytes, sha256, file_deleted_at)
VALUES
  ('a0000000-0000-4000-8000-00000000000a', 'a5000000-0000-4000-8000-0000000000a5',
   'a0000000-0000-4000-8000-00000000000a/imports/a1000000-0000-4000-8000-000000000001/a2000000-0000-4000-8000-000000000001',
   'resumen.pdf', 'application/pdf', 1024, repeat('a', 64), NULL),
  ('a0000000-0000-4000-8000-00000000000a', 'a5000000-0000-4000-8000-0000000000a5',
   'a0000000-0000-4000-8000-00000000000a/imports/a1000000-0000-4000-8000-000000000002/a2000000-0000-4000-8000-000000000002',
   'resumen.pdf', 'application/pdf', 1024, repeat('b', 64), now());

INSERT INTO storage.buckets (id, name, public) VALUES ('pgtap-other', 'pgtap-other', false);

INSERT INTO storage.objects (id, bucket_id, name, created_at)
VALUES
  -- Has a document.
  ('00000000-0000-4000-8000-000000000001', 'imports',
   'a0000000-0000-4000-8000-00000000000a/imports/a1000000-0000-4000-8000-000000000001/a2000000-0000-4000-8000-000000000001',
   now() - interval '40 days'),
  -- Has a document whose file was marked deleted.
  ('00000000-0000-4000-8000-000000000002', 'imports',
   'a0000000-0000-4000-8000-00000000000a/imports/a1000000-0000-4000-8000-000000000002/a2000000-0000-4000-8000-000000000002',
   now() - interval '40 days'),
  -- Ana's finish never ran.
  ('00000000-0000-4000-8000-000000000003', 'imports',
   'a0000000-0000-4000-8000-00000000000a/imports/a1000000-0000-4000-8000-000000000003/a2000000-0000-4000-8000-000000000003',
   now() - interval '25 hours'),
  -- Beto wrote a name of his own.
  ('00000000-0000-4000-8000-000000000004', 'imports',
   'b0000000-0000-4000-8000-00000000000b/imports/mi-resumen.pdf',
   now() - interval '3 days'),
  -- An upload whose finish may still run.
  ('00000000-0000-4000-8000-000000000005', 'imports',
   'a0000000-0000-4000-8000-00000000000a/imports/a1000000-0000-4000-8000-000000000005/a2000000-0000-4000-8000-000000000005',
   now() - interval '23 hours'),
  -- Another bucket.
  ('00000000-0000-4000-8000-000000000006', 'pgtap-other',
   'a0000000-0000-4000-8000-00000000000a/imports/old.pdf',
   now() - interval '40 days'),
  -- A chat file its conversation still reads.
  ('00000000-0000-4000-8000-000000000007', 'imports',
   'a0000000-0000-4000-8000-00000000000a/assistant/a3000000-0000-4000-8000-000000000007/msg-0',
   now() - interval '29 days'),
  -- One past its 30 days.
  ('00000000-0000-4000-8000-000000000008', 'imports',
   'a0000000-0000-4000-8000-00000000000a/assistant/a3000000-0000-4000-8000-000000000008/msg-0',
   now() - interval '31 days');

SET LOCAL ROLE service_role;

SELECT results_eq(
  $$ SELECT id::text, name FROM public.orphan_import_files(100) $$,
  $$ VALUES ('00000000-0000-4000-8000-000000000003',
             'a0000000-0000-4000-8000-00000000000a/imports/a1000000-0000-4000-8000-000000000003/a2000000-0000-4000-8000-000000000003'),
            ('00000000-0000-4000-8000-000000000004',
             'b0000000-0000-4000-8000-00000000000b/imports/mi-resumen.pdf'),
            ('00000000-0000-4000-8000-000000000008',
             'a0000000-0000-4000-8000-00000000000a/assistant/a3000000-0000-4000-8000-000000000008/msg-0') $$,
  'only the imports objects over a day old with no document, of every user, by id'
);

SELECT is_empty(
  $$ SELECT 1 FROM public.orphan_import_files(100)
     WHERE id = '00000000-0000-4000-8000-000000000007' $$,
  'never a chat file under 30 days old'
);

SELECT is_empty(
  $$ SELECT 1 FROM public.orphan_import_files(100) f
     JOIN public.uploaded_documents d ON d.storage_path = f.name $$,
  'never an object a document points at, its file marked deleted or not'
);

SELECT is_empty(
  $$ SELECT 1 FROM public.orphan_import_files(100)
     WHERE id = '00000000-0000-4000-8000-000000000005' $$,
  'never an upload under a day old'
);

SELECT is_empty(
  $$ SELECT 1 FROM public.orphan_import_files(100)
     WHERE id = '00000000-0000-4000-8000-000000000006' $$,
  'never an object of another bucket'
);

SELECT results_eq(
  $$ SELECT id::text FROM public.orphan_import_files(1) $$,
  ARRAY['00000000-0000-4000-8000-000000000003'],
  'a batch stops at its limit'
);

SELECT results_eq(
  $$ SELECT id::text FROM public.orphan_import_files(100, '00000000-0000-4000-8000-000000000003') $$,
  ARRAY['00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000008'],
  'the next batch starts after the cursor'
);

SELECT is_empty(
  $$ SELECT 1 FROM public.orphan_import_files(-1) $$,
  'a negative limit finds nothing'
);

RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated","aal":"aal2"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.error_of($$ SELECT * FROM public.orphan_import_files(100) $$),
  '42501',
  'authenticated cannot ask'
);

RESET ROLE;
SET LOCAL ROLE anon;

SELECT is(
  pg_temp.error_of($$ SELECT * FROM public.orphan_import_files(100) $$),
  '42501',
  'anon cannot ask'
);

RESET ROLE;
-- A page after the cursor probes the documents by path, not by scanning them.
SELECT has_index('public', 'uploaded_documents', 'uploaded_documents_storage_path_idx',
                 ARRAY['storage_path'], 'a document is found by its path alone');

SELECT * FROM finish();
ROLLBACK;
