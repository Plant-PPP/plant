-- imports.read_run_id: the run that claimed an import for reading is the
-- import job's alone. A user reads every other column of their imports, never
-- this one, and never writes it.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(5);

CREATE FUNCTION pg_temp.error_of(statement text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE statement;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$f$;

GRANT EXECUTE ON FUNCTION pg_temp.error_of(text) TO authenticated, service_role;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at)
VALUES ('a0000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'ana@pgtap.invalid', '', now(), '{}', '{}', now(), now());

INSERT INTO public.source_connections (id, user_id, institution, default_portfolio_id)
SELECT 'a5000000-0000-4000-8000-0000000000a5', user_id, 'IOL', id
FROM public.portfolios WHERE user_id = 'a0000000-0000-4000-8000-00000000000a';
INSERT INTO public.uploaded_documents (id, user_id, source_connection_id, storage_path,
                                       file_name, mime_type, size_bytes, sha256)
VALUES ('a8000000-0000-4000-8000-0000000000a8', 'a0000000-0000-4000-8000-00000000000a',
        'a5000000-0000-4000-8000-0000000000a5',
        'a0000000-0000-4000-8000-00000000000a/imports/a8000000-0000-4000-8000-0000000000a8/a8000000-0000-4000-8000-0000000000a8',
        'resumen.pdf', 'application/pdf', 1024, repeat('a', 64));
INSERT INTO public.imports (id, user_id, document_id)
VALUES ('a9000000-0000-4000-8000-0000000000a9', 'a0000000-0000-4000-8000-00000000000a',
        'a8000000-0000-4000-8000-0000000000a8');

SET LOCAL ROLE service_role;
SELECT is(
  pg_temp.error_of($$ UPDATE public.imports SET status = 'reading', read_run_id = '01M8Z3K4567890QWERTYXABCDE'
                      WHERE id = 'a9000000-0000-4000-8000-0000000000a9' AND status = 'queued' $$),
  NULL,
  'the import job claims an import for its run'
);
SELECT results_eq(
  $$ SELECT read_run_id FROM public.imports WHERE id = 'a9000000-0000-4000-8000-0000000000a9' $$,
  $$ VALUES ('01M8Z3K4567890QWERTYXABCDE') $$,
  'and reads which run claimed it'
);
RESET ROLE;

SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

SELECT results_eq(
  $$ SELECT id::text, status::text FROM public.imports $$,
  $$ VALUES ('a9000000-0000-4000-8000-0000000000a9', 'reading') $$,
  'a user reads their import'
);
SELECT is(
  pg_temp.error_of($$ SELECT read_run_id FROM public.imports $$),
  '42501',
  'but not which run claimed it'
);
SELECT is(
  pg_temp.error_of($$ UPDATE public.imports SET read_run_id = 'mine'
                      WHERE id = 'a9000000-0000-4000-8000-0000000000a9' $$),
  '42501',
  'nor writes it'
);

SELECT * FROM finish();
ROLLBACK;
