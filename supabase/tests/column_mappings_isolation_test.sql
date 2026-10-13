-- A spreadsheet format's column mapping: only the job writes one, and each
-- user reads only their own.
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

-- ── What the API roles hold ─────────────────────────────────────────────────
SELECT set_eq(
  $$ SELECT pg_temp.acl('public.column_mappings', 'authenticated') $$,
  ARRAY['(table):SELECT'],
  'a user only reads their mappings'
);

SELECT set_eq(
  $$ SELECT pg_temp.acl('public.column_mappings', 'service_role') $$,
  ARRAY['user_id:SELECT', 'institution:SELECT', 'header_signature:SELECT', 'mapping:SELECT',
        'user_id:INSERT', 'institution:INSERT', 'header_signature:INSERT', 'mapping:INSERT'],
  'the job reads and adds mappings, and changes none'
);

-- ── As the job ──────────────────────────────────────────────────────────────
SET LOCAL ROLE service_role;

INSERT INTO public.column_mappings (user_id, institution, header_signature, mapping)
VALUES ('a0000000-0000-4000-8000-00000000000a', 'IOL', repeat('a', 64), '{"symbol": "Especie"}'),
       ('b0000000-0000-4000-8000-00000000000b', 'IOL', repeat('a', 64), '{"symbol": "Ticker"}');

SELECT is(
  pg_temp.error_of($$ UPDATE public.column_mappings SET mapping = '{}' $$),
  '42501',
  'the job never rewrites a mapping'
);

RESET ROLE;

-- ── Signed in as Ana ────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

SELECT results_eq(
  $$ SELECT mapping->>'symbol' FROM public.column_mappings $$,
  $$ VALUES ('Especie') $$,
  'a user reads their own mapping, not another user''s for the same headers'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.column_mappings (user_id, institution, header_signature, mapping)
                      VALUES ('a0000000-0000-4000-8000-00000000000a', 'IOL', repeat('c', 64), '{}') $$),
  '42501',
  'and adds none'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.column_mappings SET mapping = '{}' $$),
  '42501',
  'changes none'
);

SELECT is(
  pg_temp.error_of($$ DELETE FROM public.column_mappings $$),
  '42501',
  'and deletes none'
);

-- ── Signed in as Beto ───────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'b0000000-0000-4000-8000-00000000000b', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);

SELECT results_eq(
  $$ SELECT mapping->>'symbol' FROM public.column_mappings $$,
  $$ VALUES ('Ticker') $$,
  'another user reads only theirs'
);

-- ── Enrolled in MFA but signed in at aal1 ───────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', true)::text, true);

SELECT is_empty(
  $$ SELECT id FROM public.column_mappings $$,
  'a user enrolled in MFA reads no mapping before the second factor'
);

SELECT * FROM finish();
ROLLBACK;
