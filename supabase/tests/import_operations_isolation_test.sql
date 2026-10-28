-- The import job's draft of operations: what the job may write as
-- service_role, that each user reads only their own and writes none of it.
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
  $$ SELECT pg_temp.acl('public.import_operations', 'authenticated') $$,
  ARRAY['(table):SELECT'],
  'a user only reads a draft of operations'
);

SELECT set_eq(
  $$ SELECT pg_temp.acl('public.import_operations', 'service_role') $$,
  ARRAY['(table):DELETE', 'id:SELECT', 'user_id:SELECT', 'import_id:SELECT',
        'user_id:INSERT', 'import_id:INSERT', 'position:INSERT', 'date:INSERT', 'kind:INSERT',
        'symbol:INSERT', 'quantity:INSERT', 'price:INSERT', 'amount:INSERT', 'charges:INSERT',
        'reference:INSERT', 'currency:INSERT', 'confidence:INSERT', 'source_page:INSERT',
        'direction:INSERT'],
  'the job writes and replaces a draft of operations, nothing more'
);

SELECT is_empty(
  $$ SELECT pg_temp.acl('public.import_operations', 'anon')
     UNION ALL SELECT acl.privilege_type FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl
     WHERE c.oid = 'public.import_operations'::regclass AND acl.grantee = 0 $$,
  'anon and PUBLIC hold nothing on a draft of operations'
);

-- ── As the job ──────────────────────────────────────────────────────────────
SET LOCAL ROLE service_role;

UPDATE public.imports SET status = 'ready' WHERE id = 'a1000000-0000-4000-8000-0000000000a1';
INSERT INTO public.import_operations (user_id, import_id, position, date, kind, symbol, quantity,
                                      price, charges, reference, currency, confidence, source_page)
VALUES ('a0000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-0000000000a1', 0,
        '2026-09-01', 'purchase', 'AAPL', '5', '18000', '120.5', '123456', 'ARS', 'high', 1);
-- What the document does not say stays null.
INSERT INTO public.import_operations (user_id, import_id, position, currency, confidence)
VALUES ('a0000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-0000000000a1', 1,
        'USD', 'low');

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.import_operations (user_id, import_id, position, currency,
                        confidence)
                      VALUES ('a0000000-0000-4000-8000-00000000000a',
                              'b1000000-0000-4000-8000-0000000000b1', 0, 'ARS', 'high') $$),
  '23503',
  'the job never files an operation under another user''s import'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.import_operations (user_id, import_id, position, kind,
                        currency, confidence)
                      VALUES ('a0000000-0000-4000-8000-00000000000a',
                              'a1000000-0000-4000-8000-0000000000a1', 2, 'yield', 'ARS', 'high') $$),
  '23514',
  'a draft holds no kind of operation the review cannot name'
);

RESET ROLE;

-- ── Signed in as Ana ────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

SELECT results_eq(
  $$ SELECT o.kind::text, o.symbol, o.quantity::text, o.charges::text, o.confidence::text
     FROM public.import_operations o ORDER BY o.position $$,
  $$ VALUES ('purchase', 'AAPL', '5.00000000', '120.50000000', 'high'),
            (NULL, NULL, NULL, NULL, 'low') $$,
  'a user reads their own draft of operations'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.import_operations SET quantity = '1' $$),
  '42501',
  'and changes none of it'
);

-- ── Signed in as Beto ───────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'b0000000-0000-4000-8000-00000000000b', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);

SELECT is_empty(
  $$ SELECT id FROM public.import_operations $$,
  'another user reads no operation of it'
);

-- ── Enrolled in MFA but signed in at aal1 ───────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', true)::text, true);

SELECT is_empty(
  $$ SELECT id FROM public.import_operations $$,
  'a user enrolled in MFA reads no draft of operations before the second factor'
);

SELECT * FROM finish();
ROLLBACK;
