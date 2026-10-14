-- The audit row of an export: written only by the server, through
-- audit_data_export as service_role, for the session user it names.
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

GRANT EXECUTE ON FUNCTION pg_temp.error_of(text) TO anon, authenticated, service_role;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at)
VALUES
  ('a0000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ana@pgtap.invalid', '', now(), '{}', '{}', now(), now()),
  ('b0000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'beto@pgtap.invalid', '', now(), '{}', '{}', now(), now());

SELECT ok(
  NOT has_function_privilege('anon', 'public.audit_data_export(uuid,text,text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.audit_data_export(uuid,text,text)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.audit_data_export(uuid,text,text)', 'EXECUTE'),
  'only service_role executes audit_data_export'
);

SELECT ok(
  (SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""']
          AND p.proowner = (SELECT relowner FROM pg_class WHERE oid = 'private.audit_log'::regclass)
   FROM pg_proc p WHERE p.oid = 'public.audit_data_export(uuid,text,text)'::regprocedure),
  'audit_data_export is a definer owned by audit_log''s owner, with an empty search_path'
);

SELECT is(
  to_regprocedure('public.record_data_export(text,text)'),
  NULL,
  'record_data_export, which let a session write any outcome, is gone'
);

SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.error_of($$ SELECT public.audit_data_export('a0000000-0000-4000-8000-00000000000a', 'success', 'req-export-forged') $$),
  '42501',
  'a session cannot write its own export row through the server''s function'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', NULL, true);
SET LOCAL ROLE service_role;

SELECT is(
  pg_temp.error_of($$ SELECT public.audit_data_export('a0000000-0000-4000-8000-00000000000a', 'success', 'req-export-1') $$),
  NULL,
  'the server records a user''s export'
);
SELECT is(
  pg_temp.error_of($$ SELECT public.audit_data_export('b0000000-0000-4000-8000-00000000000b', 'denied', 'req-export-2') $$),
  NULL,
  'and a refused one, for the user it names'
);
SELECT is(
  pg_temp.error_of($$ SELECT public.audit_data_export('a0000000-0000-4000-8000-00000000000a', 'granted', 'req-export-3') $$),
  '22P02',
  'an outcome outside the vocabulary is refused'
);
SELECT is(
  pg_temp.error_of($$ SELECT public.audit_data_export(NULL, 'success', 'req-export-4') $$),
  '22004',
  'without a user nothing is written'
);

RESET ROLE;

SELECT results_eq(
  $$ SELECT user_id, action::text, outcome::text, request_id FROM private.audit_log
     WHERE request_id LIKE 'req-export-%' ORDER BY id $$,
  $$ VALUES ('a0000000-0000-4000-8000-00000000000a'::uuid, 'data.exported', 'success', 'req-export-1'),
            ('b0000000-0000-4000-8000-00000000000b'::uuid, 'data.exported', 'denied', 'req-export-2') $$,
  'the rows are the named users'', with their outcome and request id'
);

SELECT * FROM finish();
ROLLBACK;
