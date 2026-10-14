-- The import job's draft: what the job may read and write as service_role,
-- that each user reads only their own draft and writes none of it.
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

-- The privileges a role holds on a table and its columns.
CREATE FUNCTION pg_temp.acl(rel regclass, role regrole) RETURNS SETOF text LANGUAGE sql AS $f$
  SELECT '(table):' || acl.privilege_type
  FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl
  WHERE c.oid = rel AND acl.grantee = role
  UNION ALL
  SELECT a.attname || ':' || acl.privilege_type
  FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl
  WHERE a.attrelid = rel AND acl.grantee = role
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

ALTER TABLE public.source_connections DISABLE TRIGGER portfolio_setup_1_lock;
INSERT INTO public.source_connections (id, user_id, institution, default_portfolio_id)
SELECT CASE user_id WHEN 'a0000000-0000-4000-8000-00000000000a'
                    THEN 'a5000000-0000-4000-8000-0000000000a5'::uuid
                    ELSE 'b5000000-0000-4000-8000-0000000000b5'::uuid END,
       user_id, 'IOL', id
FROM public.portfolios
WHERE user_id IN ('a0000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-00000000000b');
ALTER TABLE public.source_connections ENABLE TRIGGER portfolio_setup_1_lock;

-- A queued import each.
INSERT INTO public.uploaded_documents (id, user_id, source_connection_id, storage_path,
                                       file_name, mime_type, size_bytes, sha256)
VALUES
  ('a8000000-0000-4000-8000-0000000000a8', 'a0000000-0000-4000-8000-00000000000a',
   'a5000000-0000-4000-8000-0000000000a5',
   'a0000000-0000-4000-8000-00000000000a/imports/a9000000-0000-4000-8000-0000000000a9/a7000000-0000-4000-8000-0000000000a7',
   'resumen.pdf', 'application/pdf', 1024, repeat('a', 64)),
  ('b8000000-0000-4000-8000-0000000000b8', 'b0000000-0000-4000-8000-00000000000b',
   'b5000000-0000-4000-8000-0000000000b5',
   'b0000000-0000-4000-8000-00000000000b/imports/b9000000-0000-4000-8000-0000000000b9/b7000000-0000-4000-8000-0000000000b7',
   'resumen.pdf', 'application/pdf', 1024, repeat('b', 64));
INSERT INTO public.imports (id, user_id, document_id) VALUES
  ('a1000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-00000000000a',
   'a8000000-0000-4000-8000-0000000000a8'),
  ('b1000000-0000-4000-8000-0000000000b1', 'b0000000-0000-4000-8000-00000000000b',
   'b8000000-0000-4000-8000-0000000000b8');

-- ── What the API roles hold ─────────────────────────────────────────────────
SELECT set_eq(
  $$ SELECT pg_temp.acl('public.import_items', 'authenticated') $$,
  ARRAY['(table):SELECT'],
  'a user only reads a draft'
);

SELECT set_eq(
  $$ SELECT 'import_items.' || pg_temp.acl('public.import_items', 'service_role')
     UNION ALL SELECT 'imports.' || pg_temp.acl('public.imports', 'service_role')
     UNION ALL SELECT 'uploaded_documents.' || pg_temp.acl('public.uploaded_documents', 'service_role')
     UNION ALL SELECT 'source_connections.' || pg_temp.acl('public.source_connections', 'service_role') $$,
  ARRAY['import_items.(table):DELETE', 'import_items.id:SELECT', 'import_items.import_id:SELECT',
        'import_items.user_id:SELECT', 'import_items.value:INSERT',
        'import_items.user_id:INSERT', 'import_items.import_id:INSERT', 'import_items.position:INSERT',
        'import_items.symbol:INSERT', 'import_items.quantity:INSERT', 'import_items.price:INSERT',
        'import_items.currency:INSERT', 'import_items.confidence:INSERT',
        'import_items.source_page:INSERT',
        'imports.id:SELECT', 'imports.user_id:SELECT', 'imports.document_id:SELECT',
        'imports.status:SELECT', 'imports.status:UPDATE', 'imports.failure:UPDATE',
        'imports.document_date:UPDATE', 'imports.printed_total_ars:UPDATE',
        'imports.printed_total_usd:UPDATE', 'imports.skipped_rows:UPDATE',
        'uploaded_documents.id:SELECT', 'uploaded_documents.user_id:SELECT',
        'uploaded_documents.storage_path:SELECT', 'uploaded_documents.mime_type:SELECT',
        'uploaded_documents.delete_after:SELECT', 'uploaded_documents.file_deleted_at:SELECT',
        'uploaded_documents.file_deleted_at:UPDATE',
        'uploaded_documents.source_connection_id:SELECT',
        'source_connections.id:SELECT', 'source_connections.user_id:SELECT',
        'source_connections.institution:SELECT'],
  'the jobs read an import, its file and its account''s institution, move the import along, write its draft and mark a file deleted, nothing more'
);

SELECT is_empty(
  $$ SELECT pg_temp.acl('public.import_items', 'anon')
     UNION ALL SELECT acl.privilege_type FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl
     WHERE c.oid = 'public.import_items'::regclass AND acl.grantee = 0 $$,
  'anon and PUBLIC hold nothing on a draft'
);

-- ── As the job ──────────────────────────────────────────────────────────────
SET LOCAL ROLE service_role;

UPDATE public.imports SET status = 'ready', document_date = '2026-09-30'
WHERE id = 'a1000000-0000-4000-8000-0000000000a1';
INSERT INTO public.import_items (user_id, import_id, position, symbol, quantity, price,
                                 currency, confidence, source_page)
VALUES ('a0000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-0000000000a1', 0,
        'AAPL', '5', '18000', 'ARS', 'high', 1),
       ('a0000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-0000000000a1', 1,
        'GD30', '100', NULL, 'USD', 'low', 2);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.import_items (user_id, import_id, position, symbol,
                        quantity, currency, confidence)
                      VALUES ('a0000000-0000-4000-8000-00000000000a',
                              'b1000000-0000-4000-8000-0000000000b1', 0, 'AAPL', '1', 'ARS', 'high') $$),
  '23503',
  'the job never files a row under another user''s import'
);

SELECT results_eq(
  $$ SELECT s.institution FROM public.uploaded_documents d
     JOIN public.source_connections s ON (s.user_id, s.id) = (d.user_id, d.source_connection_id)
     WHERE d.id = 'a8000000-0000-4000-8000-0000000000a8' AND d.user_id = 'a0000000-0000-4000-8000-00000000000a' $$,
  $$ VALUES ('IOL') $$,
  'the job reads the institution of the account a file was uploaded to'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.imports SET document_id = 'b8000000-0000-4000-8000-0000000000b8' $$),
  '42501',
  'the job never moves an import to another file'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.import_items (user_id, import_id, position, symbol,
                        quantity, currency, confidence)
                      VALUES ('a0000000-0000-4000-8000-00000000000a',
                              'a1000000-0000-4000-8000-0000000000a1', 2, 'AAPL', '0', 'ARS', 'high') $$),
  '23514',
  'a row holds more than nothing'
);

RESET ROLE;

-- ── Signed in as Ana ────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

SELECT results_eq(
  $$ SELECT i.status::text, i.document_date::text, d.symbol, d.quantity::text, d.confidence::text
     FROM public.imports i JOIN public.import_items d ON d.import_id = i.id
     ORDER BY d.position $$,
  $$ VALUES ('ready', '2026-09-30', 'AAPL', '5.00000000', 'high'),
            ('ready', '2026-09-30', 'GD30', '100.00000000', 'low') $$,
  'a user reads their own import''s draft'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.import_items SET quantity = '1' $$),
  '42501',
  'and changes none of it'
);

-- ── Signed in as Beto ───────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'b0000000-0000-4000-8000-00000000000b', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);

SELECT is_empty(
  $$ SELECT id FROM public.import_items $$,
  'another user reads no row of it'
);

-- ── Enrolled in MFA but signed in at aal1 ───────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', true)::text, true);

SELECT is_empty(
  $$ SELECT id FROM public.import_items $$,
  'a user enrolled in MFA reads no draft before the second factor'
);

SELECT * FROM finish();
ROLLBACK;
