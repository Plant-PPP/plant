-- private.audit_log: no API role reaches it, and nobody, the owner included,
-- can rewrite or delete a row once written.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(7);

INSERT INTO private.audit_log (user_id, action, request_id)
VALUES ('a0000000-0000-4000-8000-00000000000a', 'login', 'req-1');

SELECT throws_ok(
  $$ UPDATE private.audit_log SET action = 'otra' $$,
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
  $$ INSERT INTO private.audit_log (user_id, action) VALUES (auth.uid(), 'forjado') $$,
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

SELECT is(
  (SELECT action FROM private.audit_log WHERE request_id = 'req-1'),
  'login',
  'the row survived every attempt'
);

SELECT * FROM finish();
ROLLBACK;
