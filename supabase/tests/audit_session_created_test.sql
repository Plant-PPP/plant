-- Every new Auth session writes exactly one audit_log row, and the row's
-- vocabulary is closed.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(9);

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at)
VALUES ('a0000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'ana@pgtap.invalid', NULL, now(), '{}', '{}', now(), now());

SELECT ok(
  NOT has_table_privilege('supabase_auth_admin', 'private.audit_log', 'INSERT'),
  'Auth''s role cannot write the audit log itself, so the trigger needs its definer'
);

SELECT ok(
  NOT has_any_column_privilege('anon', 'auth.sessions', 'INSERT')
    AND NOT has_any_column_privilege('authenticated', 'auth.sessions', 'INSERT')
    AND NOT has_any_column_privilege('service_role', 'auth.sessions', 'INSERT'),
  'no API role can insert a session to write an audit row'
);

INSERT INTO auth.sessions (id, user_id, aal)
VALUES ('5e550000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'aal1');

SELECT results_eq(
  $$ SELECT action::text, outcome::text, request_id, metadata->>'session_id'
     FROM private.audit_log WHERE user_id = 'a0000000-0000-4000-8000-00000000000a' $$,
  $$ VALUES ('auth.session.created', 'success', NULL::text, '5e550000-0000-4000-8000-000000000001') $$,
  'a new session writes one auth.session.created row with its session id'
);

SELECT ok(
  (SELECT metadata->>'aal' = 'aal1' FROM private.audit_log
   WHERE user_id = 'a0000000-0000-4000-8000-00000000000a'),
  'the row records the session''s assurance level'
);

INSERT INTO auth.sessions (id, user_id)
VALUES ('5e550000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-00000000000a');

SELECT is(
  (SELECT count(*)::int FROM private.audit_log
   WHERE user_id = 'a0000000-0000-4000-8000-00000000000a'),
  2,
  'a second session writes a second row'
);

UPDATE auth.sessions SET updated_at = now()
WHERE id = '5e550000-0000-4000-8000-000000000001';

SELECT is(
  (SELECT count(*)::int FROM private.audit_log
   WHERE user_id = 'a0000000-0000-4000-8000-00000000000a'),
  2,
  'refreshing a session writes nothing'
);

SELECT throws_ok(
  $$ INSERT INTO private.audit_log (user_id, action)
     VALUES ('a0000000-0000-4000-8000-00000000000a', 'auth.session.created') $$,
  '23502', NULL,
  'every row states its outcome'
);

SELECT throws_ok(
  $$ INSERT INTO private.audit_log (user_id, action, outcome)
     VALUES ('a0000000-0000-4000-8000-00000000000a', 'login', 'success') $$,
  '22P02', NULL,
  'an action outside the vocabulary is rejected'
);

SELECT throws_ok(
  $$ INSERT INTO private.audit_log (user_id, action, outcome)
     VALUES ('a0000000-0000-4000-8000-00000000000a', 'auth.session.created', 'ok') $$,
  '22P02', NULL,
  'an outcome outside the vocabulary is rejected'
);

SELECT * FROM finish();
ROLLBACK;
