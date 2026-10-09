-- A session raised to aal2 or deleted, and a factor verified or removed, each
-- write exactly one audit_log row for their owner; refreshes and unverified
-- factors write none.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(14);

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at)
VALUES ('a0000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'ana@pgtap.invalid', NULL, now(), '{}', '{}', now(), now()),
       ('b0000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'beto@pgtap.invalid', NULL, now(), '{}', '{}', now(), now());

INSERT INTO auth.sessions (id, user_id, aal)
VALUES ('5e550000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-00000000000a', 'aal1');

UPDATE auth.sessions SET refreshed_at = now(), aal = 'aal1'
WHERE id = '5e550000-0000-4000-8000-0000000000a1';

SELECT is(
  (SELECT count(*)::int FROM private.audit_log
   WHERE user_id = 'a0000000-0000-4000-8000-00000000000a' AND action <> 'auth.session.created'),
  0,
  'a refresh that leaves the session at aal1 writes nothing'
);

UPDATE auth.sessions SET aal = 'aal2'
WHERE id = '5e550000-0000-4000-8000-0000000000a1';

SELECT results_eq(
  $$ SELECT outcome::text, request_id, metadata
     FROM private.audit_log
     WHERE user_id = 'a0000000-0000-4000-8000-00000000000a' AND action = 'auth.mfa.verified' $$,
  $$ VALUES ('success', NULL::text,
             '{"session_id": "5e550000-0000-4000-8000-0000000000a1", "aal": "aal2"}'::jsonb) $$,
  'raising a session to aal2 writes one auth.mfa.verified row with its session id and only those keys'
);

UPDATE auth.sessions SET refreshed_at = now(), aal = 'aal2'
WHERE id = '5e550000-0000-4000-8000-0000000000a1';

SELECT is(
  (SELECT count(*)::int FROM private.audit_log
   WHERE user_id = 'a0000000-0000-4000-8000-00000000000a' AND action = 'auth.mfa.verified'),
  1,
  'a refresh of an aal2 session writes nothing'
);

DELETE FROM auth.sessions WHERE id = '5e550000-0000-4000-8000-0000000000a1';

SELECT results_eq(
  $$ SELECT metadata FROM private.audit_log
     WHERE user_id = 'a0000000-0000-4000-8000-00000000000a' AND action = 'auth.session.deleted' $$,
  $$ VALUES ('{"session_id": "5e550000-0000-4000-8000-0000000000a1", "aal": "aal2"}'::jsonb) $$,
  'deleting a session writes one auth.session.deleted row with its session id and aal'
);

INSERT INTO auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret,
                              created_at, updated_at)
VALUES ('fac00000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-00000000000a',
        'Plant', 'totp', 'unverified', 'NOTASECRET', now(), now()),
       ('fac00000-0000-4000-8000-0000000000a2', 'a0000000-0000-4000-8000-00000000000a',
        'Otro', 'totp', 'unverified', 'NOTASECRET', now(), now());

SELECT is(
  (SELECT count(*)::int FROM private.audit_log
   WHERE user_id = 'a0000000-0000-4000-8000-00000000000a' AND action::text LIKE 'auth.mfa.factor_%'),
  0,
  'enrolling an unverified factor writes nothing'
);

UPDATE auth.mfa_factors SET last_challenged_at = now()
WHERE id = 'fac00000-0000-4000-8000-0000000000a1';
UPDATE auth.mfa_factors SET status = 'verified'
WHERE id = 'fac00000-0000-4000-8000-0000000000a1';
UPDATE auth.mfa_factors SET updated_at = now()
WHERE id = 'fac00000-0000-4000-8000-0000000000a1';

SELECT results_eq(
  $$ SELECT outcome::text, metadata FROM private.audit_log
     WHERE user_id = 'a0000000-0000-4000-8000-00000000000a' AND action = 'auth.mfa.factor_verified' $$,
  $$ VALUES ('success', '{"factor_id": "fac00000-0000-4000-8000-0000000000a1", "factor_type": "totp"}'::jsonb) $$,
  'verifying a factor writes one auth.mfa.factor_verified row with only its id and type, and other updates write none'
);

DELETE FROM auth.mfa_factors WHERE id = 'fac00000-0000-4000-8000-0000000000a2';

SELECT is(
  (SELECT count(*)::int FROM private.audit_log
   WHERE user_id = 'a0000000-0000-4000-8000-00000000000a' AND action = 'auth.mfa.factor_removed'),
  0,
  'removing an unverified factor writes nothing'
);

DELETE FROM auth.mfa_factors WHERE id = 'fac00000-0000-4000-8000-0000000000a1';

SELECT results_eq(
  $$ SELECT metadata FROM private.audit_log
     WHERE user_id = 'a0000000-0000-4000-8000-00000000000a' AND action = 'auth.mfa.factor_removed' $$,
  $$ VALUES ('{"factor_id": "fac00000-0000-4000-8000-0000000000a1", "factor_type": "totp"}'::jsonb) $$,
  'removing a verified factor writes one auth.mfa.factor_removed row'
);

SELECT is(
  (SELECT count(*)::int FROM private.audit_log
   WHERE user_id = 'b0000000-0000-4000-8000-00000000000b'),
  0,
  'one user''s sessions and factors write no row for another user'
);

SELECT is_empty(
  $$ SELECT id FROM private.audit_log
     WHERE metadata ?| ARRAY['secret', 'refresh_token_hmac_key', 'friendly_name', 'user_agent', 'ip'] $$,
  'no row carries a factor secret, a session key, a factor name or client details'
);

INSERT INTO auth.sessions (id, user_id, aal)
VALUES ('5e550000-0000-4000-8000-0000000000b1', 'b0000000-0000-4000-8000-00000000000b', 'aal2'),
       ('5e550000-0000-4000-8000-0000000000b2', 'b0000000-0000-4000-8000-00000000000b', 'aal1');
INSERT INTO auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret,
                              created_at, updated_at)
VALUES ('fac00000-0000-4000-8000-0000000000b1', 'b0000000-0000-4000-8000-00000000000b',
        'Plant', 'totp', 'verified', 'NOTASECRET', now(), now()),
       ('fac00000-0000-4000-8000-0000000000b2', 'b0000000-0000-4000-8000-00000000000b',
        'Otro', 'totp', 'unverified', 'NOTASECRET', now(), now());

SELECT lives_ok(
  $$ DELETE FROM auth.users WHERE id = 'b0000000-0000-4000-8000-00000000000b' $$,
  'deleting a user with sessions and factors succeeds'
);

SELECT results_eq(
  $$ SELECT action::text, count(*)::int FROM private.audit_log
     WHERE user_id = 'b0000000-0000-4000-8000-00000000000b'
       AND action IN ('auth.session.deleted', 'auth.mfa.factor_removed')
     GROUP BY 1 ORDER BY 1 $$,
  $$ VALUES ('auth.mfa.factor_removed', 1), ('auth.session.deleted', 2) $$,
  'deleting a user writes one row per session and one per verified factor'
);

SELECT is(
  (SELECT count(*)::int FROM private.audit_log
   WHERE user_id = 'a0000000-0000-4000-8000-00000000000a'
     AND action IN ('auth.session.deleted', 'auth.mfa.factor_removed')),
  2,
  'deleting one user writes nothing for another user'
);

SELECT set_eq(
  $$ SELECT unnest(enum_range(NULL::private.audit_action))::text $$,
  ARRAY['auth.session.created', 'auth.session.deleted', 'auth.mfa.verified',
        'auth.mfa.factor_verified', 'auth.mfa.factor_removed'],
  'the audit vocabulary is exactly the session and MFA actions'
);

SELECT * FROM finish();
ROLLBACK;
