-- Uploads with no account: a user files one, the same file twice with none is
-- refused, and its account is set once, to an account of the user's.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(9);

-- The SQLSTATE a statement raises, or NULL if it succeeds.
CREATE FUNCTION pg_temp.error_of(statement text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE statement;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
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

-- Ana has two accounts, Beto one.
ALTER TABLE public.source_connections DISABLE TRIGGER portfolio_setup_1_lock;
INSERT INTO public.source_connections (id, user_id, institution, default_portfolio_id)
SELECT v.id, p.user_id, v.institution, p.id
FROM public.portfolios p
JOIN (VALUES ('a5000000-0000-4000-8000-0000000000a5'::uuid, 'a0000000-0000-4000-8000-00000000000a'::uuid, 'IOL'),
             ('a6000000-0000-4000-8000-0000000000a6'::uuid, 'a0000000-0000-4000-8000-00000000000a'::uuid, 'Balanz'),
             ('b5000000-0000-4000-8000-0000000000b5'::uuid, 'b0000000-0000-4000-8000-00000000000b'::uuid, 'IOL'))
  AS v (id, user_id, institution) ON v.user_id = p.user_id;
ALTER TABLE public.source_connections ENABLE TRIGGER portfolio_setup_1_lock;

-- ── Signed in as Ana ────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.uploaded_documents (storage_path, file_name,
                        mime_type, size_bytes, sha256)
                      VALUES ('a0000000-0000-4000-8000-00000000000a/imports/a9000000-0000-4000-8000-0000000000a1/a7000000-0000-4000-8000-0000000000a1',
                        'Resumen tarjeta.pdf', 'application/pdf', 2048, repeat('a', 64)) $$),
  NULL,
  'a user files a document with no account'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.imports (document_id)
                      SELECT id FROM public.uploaded_documents WHERE sha256 = repeat('a', 64) $$),
  NULL,
  'and starts its import'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.uploaded_documents (storage_path, file_name,
                        mime_type, size_bytes, sha256)
                      VALUES ('a0000000-0000-4000-8000-00000000000a/imports/a9000000-0000-4000-8000-0000000000a2/a7000000-0000-4000-8000-0000000000a2',
                        'Otra copia.pdf', 'application/pdf', 2048, repeat('a', 64)) $$),
  '23505',
  'the same file twice with no account is refused'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.uploaded_documents (source_connection_id, storage_path,
                        file_name, mime_type, size_bytes, sha256)
                      VALUES ('a5000000-0000-4000-8000-0000000000a5',
                        'a0000000-0000-4000-8000-00000000000a/imports/a9000000-0000-4000-8000-0000000000a3/a7000000-0000-4000-8000-0000000000a3',
                        'Resumen IOL.pdf', 'application/pdf', 2048, repeat('a', 64)) $$),
  NULL,
  'while the same file in an account is another upload'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.uploaded_documents
                      SET source_connection_id = 'b5000000-0000-4000-8000-0000000000b5'
                      WHERE file_name = 'Resumen tarjeta.pdf' $$),
  '23503',
  'a document''s account is never another user''s'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.uploaded_documents
                      SET source_connection_id = 'a5000000-0000-4000-8000-0000000000a5'
                      WHERE file_name = 'Resumen tarjeta.pdf' $$),
  '23505',
  'nor one that holds the same file already'
);

UPDATE public.uploaded_documents
SET source_connection_id = 'a6000000-0000-4000-8000-0000000000a6'
WHERE file_name = 'Resumen tarjeta.pdf';

SELECT is(
  (SELECT source_connection_id FROM public.uploaded_documents WHERE file_name = 'Resumen tarjeta.pdf'),
  'a6000000-0000-4000-8000-0000000000a6'::uuid,
  'a user sets the account of a document with none'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.uploaded_documents
                      SET source_connection_id = 'a5000000-0000-4000-8000-0000000000a5'
                      WHERE file_name = 'Resumen tarjeta.pdf' $$),
  '42501',
  'and never changes it once set'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.uploaded_documents SET source_connection_id = NULL
                      WHERE file_name = 'Resumen IOL.pdf' $$),
  '42501',
  'nor takes it away'
);

SELECT * FROM finish();
ROLLBACK;
