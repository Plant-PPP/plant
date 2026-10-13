-- Uploads: what a user may write on uploaded_documents and imports, that each
-- user reads and writes only their own, and that the imports bucket keeps
-- each user's files under their own folder.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(22);

-- The SQLSTATE a statement raises, or NULL if it succeeds.
CREATE FUNCTION pg_temp.error_of(statement text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE statement;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$f$;

-- The privileges authenticated holds on a table and its columns.
CREATE FUNCTION pg_temp.acl(rel regclass) RETURNS SETOF text LANGUAGE sql AS $f$
  SELECT '(table):' || acl.privilege_type
  FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl
  WHERE c.oid = rel AND acl.grantee = 'authenticated'::regrole
  UNION ALL
  SELECT a.attname || ':' || acl.privilege_type
  FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl
  WHERE a.attrelid = rel AND acl.grantee = 'authenticated'::regrole
$f$;

GRANT EXECUTE ON FUNCTION pg_temp.error_of(text) TO authenticated;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at)
VALUES
  ('a0000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ana@pgtap.invalid', '', now(), '{}', '{}', now(), now()),
  ('b0000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'beto@pgtap.invalid', '', now(), '{}', '{}', now(), now());

-- One account each, on the portfolio signup made.
ALTER TABLE public.source_connections DISABLE TRIGGER portfolio_setup_1_lock;
INSERT INTO public.source_connections (id, user_id, institution, default_portfolio_id)
SELECT CASE user_id WHEN 'a0000000-0000-4000-8000-00000000000a'
                    THEN 'a5000000-0000-4000-8000-0000000000a5'::uuid
                    ELSE 'b5000000-0000-4000-8000-0000000000b5'::uuid END,
       user_id, 'IOL', id
FROM public.portfolios
WHERE user_id IN ('a0000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-00000000000b');
ALTER TABLE public.source_connections ENABLE TRIGGER portfolio_setup_1_lock;

-- Beto's statement, read and waiting for review.
INSERT INTO public.uploaded_documents (id, user_id, source_connection_id, storage_path,
                                       file_name, mime_type, size_bytes, sha256)
VALUES ('b8000000-0000-4000-8000-0000000000b8', 'b0000000-0000-4000-8000-00000000000b',
        'b5000000-0000-4000-8000-0000000000b5',
        'b0000000-0000-4000-8000-00000000000b/imports/b9000000-0000-4000-8000-0000000000b9/b7000000-0000-4000-8000-0000000000b7',
        'resumen.pdf', 'application/pdf', 1024, repeat('b', 64));
INSERT INTO public.imports (id, user_id, document_id, status)
VALUES ('b9000000-0000-4000-8000-0000000000b9', 'b0000000-0000-4000-8000-00000000000b',
        'b8000000-0000-4000-8000-0000000000b8', 'ready');
INSERT INTO storage.objects (bucket_id, name)
VALUES ('imports',
        'b0000000-0000-4000-8000-00000000000b/imports/b9000000-0000-4000-8000-0000000000b9/b7000000-0000-4000-8000-0000000000b7');

-- ── What the API roles hold ─────────────────────────────────────────────────
SELECT set_eq(
  $$ SELECT pg_temp.acl('public.uploaded_documents') $$,
  ARRAY['(table):SELECT', '(table):DELETE', 'source_connection_id:INSERT', 'storage_path:INSERT',
        'file_name:INSERT', 'mime_type:INSERT', 'size_bytes:INSERT', 'sha256:INSERT'],
  'a user reads, deletes and adds their files, never a file''s owner, id or deletion date'
);

SELECT set_eq(
  $$ SELECT pg_temp.acl('public.imports') $$,
  ARRAY['(table):SELECT', 'document_id:INSERT'],
  'a user reads their imports and starts one, never its id or status'
);

SELECT is_empty(
  $$ SELECT acl.grantee::regrole::text FROM pg_class c
     CROSS JOIN LATERAL aclexplode(c.relacl) acl
     WHERE c.oid IN ('public.uploaded_documents'::regclass, 'public.imports'::regclass)
       AND acl.grantee IN ('anon'::regrole, 0)
     UNION ALL
     SELECT acl.grantee::regrole::text FROM pg_attribute a
     CROSS JOIN LATERAL aclexplode(a.attacl) acl
     WHERE a.attrelid IN ('public.uploaded_documents'::regclass, 'public.imports'::regclass)
       AND acl.grantee IN ('anon'::regrole, 0) $$,
  'anon and PUBLIC hold nothing on uploads; import_items_isolation_test.sql pins the service role''s'
);

SELECT results_eq(
  $$ SELECT public, file_size_limit FROM storage.buckets WHERE id = 'imports' $$,
  $$ VALUES (false, 20971520::bigint) $$,
  'the imports bucket is private and takes files up to 20 MiB'
);

-- ── Signed in as Ana ────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

INSERT INTO storage.objects (bucket_id, name)
VALUES ('imports',
        'a0000000-0000-4000-8000-00000000000a/imports/a9000000-0000-4000-8000-0000000000a9/a7000000-0000-4000-8000-0000000000a7');
INSERT INTO public.uploaded_documents (source_connection_id, storage_path, file_name,
                                       mime_type, size_bytes, sha256)
VALUES ('a5000000-0000-4000-8000-0000000000a5',
        'a0000000-0000-4000-8000-00000000000a/imports/a9000000-0000-4000-8000-0000000000a9/a7000000-0000-4000-8000-0000000000a7',
        'Resumen septiembre.pdf', 'application/pdf', 2048, repeat('a', 64));
INSERT INTO public.imports (document_id)
SELECT id FROM public.uploaded_documents WHERE sha256 = repeat('a', 64);

SELECT results_eq(
  $$ SELECT i.status::text, d.file_name, i.user_id::text, d.user_id::text,
            d.delete_after - d.created_at
     FROM public.imports i JOIN public.uploaded_documents d ON d.id = i.document_id $$,
  $$ VALUES ('queued', 'Resumen septiembre.pdf',
             'a0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000a',
             interval '30 days') $$,
  'a user starts an import, queued under their own id, and reads only theirs'
);

SELECT results_eq(
  $$ SELECT name FROM storage.objects WHERE bucket_id = 'imports' $$,
  $$ VALUES ('a0000000-0000-4000-8000-00000000000a/imports/a9000000-0000-4000-8000-0000000000a9/a7000000-0000-4000-8000-0000000000a7') $$,
  'a user reads only the files in their own folder'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO storage.objects (bucket_id, name)
                      VALUES ('imports', 'b0000000-0000-4000-8000-00000000000b/imports/x/y') $$),
  '42501',
  'a user never adds a file to another user''s folder'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO storage.objects (bucket_id, name)
                      VALUES ('imports', 'a0000000-0000-4000-8000-00000000000a/other/y') $$),
  '42501',
  'nor outside the imports folder'
);

UPDATE storage.objects SET name = name || '-2' WHERE bucket_id = 'imports';
SELECT is(
  (SELECT count(*)::int FROM storage.objects WHERE name LIKE '%-2'),
  0,
  'a user never changes a file once uploaded'
);

DELETE FROM public.uploaded_documents WHERE user_id = 'b0000000-0000-4000-8000-00000000000b';

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.uploaded_documents (source_connection_id, storage_path,
                        file_name, mime_type, size_bytes, sha256)
                      VALUES ('a5000000-0000-4000-8000-0000000000a5',
                        'b0000000-0000-4000-8000-00000000000b/imports/a9000000-0000-4000-8000-0000000000a1/a7000000-0000-4000-8000-0000000000a1',
                        'x.pdf', 'application/pdf', 1, repeat('c', 64)) $$),
  '23514',
  'a file''s path is under its owner''s folder'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.uploaded_documents (source_connection_id, storage_path,
                        file_name, mime_type, size_bytes, sha256)
                      VALUES ('a5000000-0000-4000-8000-0000000000a5',
                        'a0000000-0000-4000-8000-00000000000a/imports/a9000000-0000-4000-8000-0000000000a1/a7000000-0000-4000-8000-0000000000a1',
                        'x.exe', 'application/x-msdownload', 1, repeat('c', 64)) $$),
  '23514',
  'a file is one of the types Plant reads'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.uploaded_documents (source_connection_id, storage_path,
                        file_name, mime_type, size_bytes, sha256)
                      VALUES ('a5000000-0000-4000-8000-0000000000a5',
                        'a0000000-0000-4000-8000-00000000000a/imports/a9000000-0000-4000-8000-0000000000a1/a7000000-0000-4000-8000-0000000000a1',
                        'x.pdf', 'application/pdf', 20971521, repeat('c', 64)) $$),
  '23514',
  'a file is at most 20 MiB'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.uploaded_documents (source_connection_id, storage_path,
                        file_name, mime_type, size_bytes, sha256)
                      VALUES ('a5000000-0000-4000-8000-0000000000a5',
                        'a0000000-0000-4000-8000-00000000000a/imports/a9000000-0000-4000-8000-0000000000a1/a7000000-0000-4000-8000-0000000000a1',
                        'otra copia.pdf', 'application/pdf', 2048, repeat('a', 64)) $$),
  '23505',
  'the same file twice in one account is refused'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.uploaded_documents (source_connection_id, storage_path,
                        file_name, mime_type, size_bytes, sha256)
                      VALUES ('b5000000-0000-4000-8000-0000000000b5',
                        'a0000000-0000-4000-8000-00000000000a/imports/a9000000-0000-4000-8000-0000000000a1/a7000000-0000-4000-8000-0000000000a1',
                        'x.pdf', 'application/pdf', 1, repeat('c', 64)) $$),
  '23503',
  'a user never uploads into another user''s account'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.imports (document_id)
                      VALUES ('b8000000-0000-4000-8000-0000000000b8') $$),
  '23503',
  'nor imports another user''s file'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.imports (document_id, status)
                      SELECT id, 'ready' FROM public.uploaded_documents $$),
  '42501',
  'a user never sets an import''s status'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.imports SET status = 'ready' $$),
  '42501',
  'nor moves it along'
);

SAVEPOINT before_delete;
DELETE FROM public.uploaded_documents WHERE sha256 = repeat('a', 64);
SELECT is(
  (SELECT count(*)::int FROM public.imports),
  0,
  'deleting a file deletes its import'
);
ROLLBACK TO SAVEPOINT before_delete;

-- ── Signed in as Beto ───────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'b0000000-0000-4000-8000-00000000000b', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);

SELECT results_eq(
  $$ SELECT (SELECT count(*)::int FROM public.imports),
            (SELECT count(*)::int FROM public.uploaded_documents),
            (SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'imports') $$,
  $$ VALUES (1, 1, 1) $$,
  'another user''s delete leaves a file row as it was, and each user sees only theirs'
);

-- ── Enrolled in MFA but signed in at aal1 ───────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'b0000000-0000-4000-8000-00000000000b', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', true)::text, true);

SELECT results_eq(
  $$ SELECT (SELECT count(*)::int FROM public.imports),
            (SELECT count(*)::int FROM public.uploaded_documents),
            (SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'imports') $$,
  $$ VALUES (0, 0, 0) $$,
  'a user enrolled in MFA reads no import, file row or file before the second factor'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO storage.objects (bucket_id, name)
                      VALUES ('imports', 'b0000000-0000-4000-8000-00000000000b/imports/x/y') $$),
  '42501',
  'nor uploads a file'
);

-- ── Anonymous ───────────────────────────────────────────────────────────────
RESET ROLE;
SET LOCAL ROLE anon;

SELECT throws_ok(
  $$ SELECT id FROM public.imports $$,
  '42501',
  NULL,
  'anon reads no import'
);

SELECT * FROM finish();
ROLLBACK;
