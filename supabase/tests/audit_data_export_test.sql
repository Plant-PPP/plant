-- The audit row an export writes through record_data_export: always the
-- caller's, with the outcome the action states.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(7);

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
  NOT has_function_privilege('anon', 'public.record_data_export(text,text)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.record_data_export(text,text)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'public.record_data_export(text,text)', 'EXECUTE'),
  'only authenticated executes record_data_export'
);

SELECT ok(
  (SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""']
          AND p.proowner = (SELECT relowner FROM pg_class WHERE oid = 'private.audit_log'::regclass)
   FROM pg_proc p WHERE p.oid = 'public.record_data_export(text,text)'::regprocedure),
  'record_data_export is a definer owned by audit_log''s owner, with an empty search_path'
);

SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.error_of($$ SELECT public.record_data_export('success', 'req-export-1') $$),
  NULL,
  'a user records their export'
);
SELECT is(
  pg_temp.error_of($$ SELECT public.record_data_export('denied', 'req-export-2') $$),
  NULL,
  'and a refused one'
);
SELECT is(
  pg_temp.error_of($$ SELECT public.record_data_export('granted', 'req-export-3') $$),
  '22P02',
  'an outcome outside the vocabulary is refused'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', NULL, true);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.error_of($$ SELECT public.record_data_export('success', 'req-export-4') $$),
  '42501',
  'without a user nothing is written'
);

RESET ROLE;

SELECT results_eq(
  $$ SELECT user_id, action::text, outcome::text, request_id FROM private.audit_log
     WHERE request_id LIKE 'req-export-%' ORDER BY id $$,
  $$ VALUES ('a0000000-0000-4000-8000-00000000000a'::uuid, 'data.exported', 'success', 'req-export-1'),
            ('a0000000-0000-4000-8000-00000000000a'::uuid, 'data.exported', 'denied', 'req-export-2') $$,
  'the rows are the caller''s, with their outcome and request id'
);

SELECT * FROM finish();
ROLLBACK;
