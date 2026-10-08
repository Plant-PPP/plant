-- private.audit_log: no API role reaches it, and while the triggers are on
-- nobody, the owner included, can rewrite or delete a row once written.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(8);

INSERT INTO private.audit_log (user_id, action, outcome, request_id)
VALUES ('a0000000-0000-4000-8000-00000000000a', 'auth.session.created', 'success', 'req-1');

SELECT throws_ok(
  $$ UPDATE private.audit_log SET outcome = 'failure' $$,
  '42501', 'audit_log is append-only',
  'rows cannot be updated, even by the owner'
);

SELECT throws_ok(
  $$ DELETE FROM private.audit_log $$,
  '42501', 'audit_log is append-only',
  'rows cannot be deleted, even by the owner'
);

SELECT throws_ok(
  $$ TRUNCATE private.audit_log $$,
  '42501', 'audit_log is append-only',
  'the table cannot be truncated, even by the owner'
);

SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$ SELECT 1 FROM private.audit_log $$,
  '42501', NULL,
  'authenticated cannot read the audit log, not even its own rows'
);

SELECT throws_ok(
  $$ INSERT INTO private.audit_log (user_id, action, outcome) VALUES (auth.uid(), 'auth.session.created', 'success') $$,
  '42501', NULL,
  'authenticated cannot write the audit log'
);

RESET ROLE;
SET LOCAL ROLE anon;

SELECT throws_ok(
  $$ SELECT 1 FROM private.audit_log $$,
  '42501', NULL,
  'anon cannot read the audit log'
);

RESET ROLE;

SELECT ok(
  NOT has_any_column_privilege('service_role', 'private.audit_log', 'SELECT, INSERT, UPDATE, REFERENCES')
    AND NOT has_table_privilege('service_role', 'private.audit_log', 'DELETE, TRUNCATE, TRIGGER, MAINTAIN'),
  'service_role has no privilege on the audit log until a server-side writer needs one'
);

SELECT is(
  (SELECT outcome FROM private.audit_log WHERE request_id = 'req-1'),
  'success'::private.audit_outcome,
  'the row survived every attempt'
);

SELECT * FROM finish();
ROLLBACK;
