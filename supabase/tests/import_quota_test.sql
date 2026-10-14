-- The monthly import quota, and the audit row a file's deletion leaves.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(13);

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
SELECT CASE user_id WHEN 'a0000000-0000-4000-8000-00000000000a'
                    THEN 'a5000000-0000-4000-8000-0000000000a5'::uuid
                    ELSE 'b5000000-0000-4000-8000-0000000000b5'::uuid END,
       user_id, 'IOL', id
FROM public.portfolios
WHERE user_id IN ('a0000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-00000000000b');

-- 23 files each, one per import.
INSERT INTO public.uploaded_documents (user_id, source_connection_id, storage_path, file_name,
                                       mime_type, size_bytes, sha256)
SELECT u.id, u.account, u.id || '/imports/' || gen_random_uuid() || '/' || gen_random_uuid(),
       'resumen.pdf', 'application/pdf', 1024, md5(u.id::text || n) || md5(n::text || u.id)
FROM (VALUES ('a0000000-0000-4000-8000-00000000000a'::uuid, 'a5000000-0000-4000-8000-0000000000a5'::uuid),
             ('b0000000-0000-4000-8000-00000000000b'::uuid, 'b5000000-0000-4000-8000-0000000000b5'::uuid))
       AS u (id, account),
     generate_series(1, 23) AS n;

-- Ana started 18 imports this month and one last month.
INSERT INTO public.imports (user_id, document_id, created_at)
SELECT user_id, id, CASE WHEN n = 1 THEN now() - interval '40 days' ELSE now() END
FROM (SELECT d.*, row_number() OVER (ORDER BY d.id) AS n FROM public.uploaded_documents d
      WHERE d.user_id = 'a0000000-0000-4000-8000-00000000000a') docs
WHERE n <= 19;

-- One import at a time, as an upload starts it.
CREATE FUNCTION pg_temp.start_one() RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.error_of($$ INSERT INTO public.imports (document_id)
                             SELECT d.id FROM public.uploaded_documents d
                             WHERE NOT EXISTS (SELECT 1 FROM public.imports i WHERE i.document_id = d.id)
                             ORDER BY d.id LIMIT 1 $$)
$f$;

GRANT EXECUTE ON FUNCTION pg_temp.start_one() TO authenticated;

-- ── Signed in as Ana ────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(pg_temp.start_one(), NULL, 'a user starts their 19th import of the month, last month''s not counted');
SELECT is(pg_temp.start_one(), NULL, 'and their 20th');

SELECT is(pg_temp.start_one(), 'PT429', 'and not a 21st');

-- ── Signed in as Beto ───────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'b0000000-0000-4000-8000-00000000000b', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.imports (document_id)
                      SELECT d.id FROM public.uploaded_documents d ORDER BY d.id LIMIT 1 $$),
  NULL,
  'another user''s imports count against nobody else'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.uploaded_documents SET file_deleted_at = now() $$),
  '42501',
  'a user never marks a file deleted'
);

-- ── As the deletion job ─────────────────────────────────────────────────────
RESET ROLE;
SET LOCAL ROLE service_role;

UPDATE public.uploaded_documents SET file_deleted_at = now()
WHERE id = (SELECT id FROM public.uploaded_documents
            WHERE user_id = 'b0000000-0000-4000-8000-00000000000b' ORDER BY id LIMIT 1);
-- Marking it again leaves no second row.
UPDATE public.uploaded_documents SET file_deleted_at = now()
WHERE file_deleted_at IS NOT NULL;

SELECT is(
  pg_temp.error_of($$ UPDATE public.uploaded_documents SET delete_after = now() $$),
  '42501',
  'the job never moves a file''s deletion date'
);

RESET ROLE;

SELECT results_eq(
  $$ SELECT user_id::text, action::text, outcome::text,
            metadata ->> 'document_id' = (SELECT id::text FROM public.uploaded_documents
                                          WHERE file_deleted_at IS NOT NULL)
     FROM private.audit_log WHERE action = 'imports.file.deleted' $$,
  $$ VALUES ('b0000000-0000-4000-8000-00000000000b', 'imports.file.deleted', 'success', true) $$,
  'deleting a file leaves one audit row, with its owner and its document'
);

SELECT is(
  (SELECT count(*)::int FROM public.imports i JOIN public.uploaded_documents d ON d.id = i.document_id
   WHERE d.file_deleted_at IS NOT NULL),
  1,
  'and keeps its row and its import'
);

-- ── Deleting files gives no import back ─────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

DELETE FROM public.uploaded_documents d
WHERE EXISTS (SELECT 1 FROM public.imports i WHERE i.document_id = d.id);

SELECT is((SELECT count(*)::int FROM public.imports), 0,
          'a user deletes every file they imported, and its import with it');
SELECT is(pg_temp.start_one(), 'PT429', 'and still starts no import past the month''s 20');
SELECT is(public.imports_used_this_month(), 20::bigint,
          'and reads the month''s 20 used, as the quota counts them');

SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'b0000000-0000-4000-8000-00000000000b', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);

SELECT is(public.imports_used_this_month(), 1::bigint, 'another user reads only their own');

RESET ROLE;
SET LOCAL ROLE anon;

SELECT is(pg_temp.error_of($$ SELECT public.imports_used_this_month() $$), '42501',
          'anon cannot read the count');

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
