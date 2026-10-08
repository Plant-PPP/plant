-- The MFA rule over its truth table: a user with a verified factor needs an
-- aal2 session. A token's mfa_enrolled claim says whether the user has one,
-- and a token without the claim counts as enrolled. Here the access token hook
-- runs on each row that carries the claim: it adds the claim and gives the role
-- the row expects. The hook always adds the claim, so the rows without it
-- describe tokens minted before the hook was on.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;

CREATE TEMP TABLE truth (
  aal text,
  mfa_enrolled boolean,
  expected text NOT NULL CHECK (expected IN ('met', 'verify'))
) ON COMMIT DROP;
-- NULL is a claim the token does not carry. expected: met (the session may
-- read its own rows) or verify (it must verify a factor first).
INSERT INTO truth (aal, mfa_enrolled, expected) VALUES
-- truth-table:start aal,mfa_enrolled,expected
  ('aal1', true, 'verify'),
  ('aal1', false, 'met'),
  ('aal1', NULL, 'verify'),
  ('aal2', true, 'met'),
  ('aal2', false, 'met'),
  ('aal2', NULL, 'met'),
  (NULL, true, 'verify'),
  (NULL, false, 'met'),
  (NULL, NULL, 'verify');
-- truth-table:end

SELECT plan((SELECT count(*) FROM truth WHERE mfa_enrolled IS NOT NULL)::int + 3);

SELECT bag_eq(
  $$SELECT aal, mfa_enrolled FROM truth$$,
  $$SELECT a, m FROM (VALUES ('aal1'), ('aal2'), (NULL)) x (a)
    CROSS JOIN (VALUES (true), (false), (NULL::boolean)) y (m)$$,
  'the truth table has exactly one row for each aal and claim'
);

-- Ena has a verified TOTP factor; Uri's factor was never verified.
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at)
VALUES ('e0000000-0000-4000-8000-00000000000e', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'ena@pgtap.invalid', NULL, now(), '{}', '{}', now(), now()),
       ('b0000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'uri@pgtap.invalid', NULL, now(), '{}', '{}', now(), now());

INSERT INTO auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
VALUES ('f0000000-0000-4000-8000-00000000000e', 'e0000000-0000-4000-8000-00000000000e',
        'phone', 'totp', 'verified', now(), now()),
       ('f0000000-0000-4000-8000-00000000000b', 'b0000000-0000-4000-8000-00000000000b',
        'phone', 'totp', 'unverified', now(), now());

-- The hook takes the user from the event, never from the request: Uri's rows
-- run with Ena's claims set.
SET LOCAL request.jwt.claims = '{"sub": "e0000000-0000-4000-8000-00000000000e"}';

CREATE TEMP TABLE hooked ON COMMIT DROP AS
SELECT t.*, e.event, private.custom_access_token_hook(e.event) AS result,
       CASE t.expected WHEN 'verify' THEN 'authenticated_aal1' ELSE 'authenticated' END AS role
FROM truth t
CROSS JOIN LATERAL (
  SELECT jsonb_build_object(
    'user_id', CASE WHEN t.mfa_enrolled THEN 'e0000000-0000-4000-8000-00000000000e'
                    ELSE 'b0000000-0000-4000-8000-00000000000b' END,
    'authentication_method', 'otp',
    'claims', jsonb_strip_nulls(jsonb_build_object(
      'sub', CASE WHEN t.mfa_enrolled THEN 'e0000000-0000-4000-8000-00000000000e'
                  ELSE 'b0000000-0000-4000-8000-00000000000b' END,
      'role', 'authenticated',
      'aal', t.aal,
      'amr', '[{"method": "otp", "timestamp": 1700000000}]'::jsonb,
      'session_id', '5e550000-0000-4000-8000-000000000001'))) AS event
) e
WHERE t.mfa_enrolled IS NOT NULL;

SELECT is(
  result,
  jsonb_set(event, '{claims}', event->'claims'
    || jsonb_build_object(
         'mfa_enrolled', mfa_enrolled,
         'role', role)),
  format('aal %s, enrolled %s: the hook adds the claim and the role is %s',
         COALESCE(aal, 'absent'), mfa_enrolled::text, role)
)
FROM hooked
ORDER BY aal NULLS LAST, mfa_enrolled;

SELECT is(
  private.custom_access_token_hook(
    '{"user_id": "e0000000-0000-4000-8000-00000000000e",
      "claims": {"sub": "e0000000-0000-4000-8000-00000000000e", "role": "anon", "aal": "aal1"}}'::jsonb
  )->'claims'->>'role',
  'anon',
  'the hook leaves a role other than authenticated alone'
);

-- Any verified factor counts, whatever its type: Pia's only one is a phone factor.
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at)
VALUES ('c0000000-0000-4000-8000-00000000000c', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'pia@pgtap.invalid', NULL, now(), '{}', '{}', now(), now());
INSERT INTO auth.mfa_factors (id, user_id, friendly_name, factor_type, status, phone, created_at, updated_at)
VALUES ('f0000000-0000-4000-8000-00000000000c', 'c0000000-0000-4000-8000-00000000000c',
        'phone', 'phone', 'verified', '+5491100000000', now(), now());
SELECT is(
  (private.custom_access_token_hook(
    '{"user_id": "c0000000-0000-4000-8000-00000000000c",
      "claims": {"sub": "c0000000-0000-4000-8000-00000000000c", "role": "authenticated", "aal": "aal1"}}'::jsonb
  )->'claims') - 'sub'::text - 'aal'::text,
  '{"role": "authenticated_aal1", "mfa_enrolled": true}'::jsonb,
  'a verified factor of any type demotes an aal1 token'
);

SELECT * FROM finish();
ROLLBACK;
