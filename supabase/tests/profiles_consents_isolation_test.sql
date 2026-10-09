-- profiles and consents: each user reads and writes only their own rows, and
-- anon reaches neither.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(26);

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at)
VALUES
  ('a0000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ana@pgtap.invalid', '', now(), '{}', '{}', now(), now()),
  ('b0000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'beto@pgtap.invalid', '', now(), '{}', '{}', now(), now()),
  ('c0000000-0000-4000-8000-00000000000c', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'caro@pgtap.invalid', '', now(), '{}', '{}', now(), now());

SELECT is(
  (SELECT count(*) FROM public.profiles
   WHERE user_id IN ('a0000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-00000000000b')),
  2::bigint,
  'signing up creates a profile'
);

INSERT INTO public.consents (id, user_id, kind, version, granted)
VALUES ('cb000000-0000-4000-8000-0000000000cb', 'b0000000-0000-4000-8000-00000000000b',
        'terms', '2026-10', true);

-- ── Signed in as Ana ────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

SELECT results_eq(
  $$ SELECT user_id FROM public.profiles $$,
  $$ VALUES ('a0000000-0000-4000-8000-00000000000a'::uuid) $$,
  'a user reads only their own profile'
);

-- Both updates run as Ana; their effect is checked after RESET ROLE below.
-- The first has no WHERE, so only the update policy's USING limits it (a WHERE
-- would let the select policy hide Beto's row too). The second then sets Ana's
-- own row.
SELECT lives_ok(
  $$ UPDATE public.profiles SET display_name = 'overwritten' $$,
  'an update with no WHERE reaches only the user''s own profile'
);
UPDATE public.profiles SET display_name = 'Ana', reference_dollar = 'ccl'
WHERE user_id = 'a0000000-0000-4000-8000-00000000000a';

SELECT throws_ok(
  $$ UPDATE public.profiles SET user_id = 'b0000000-0000-4000-8000-00000000000b'
     WHERE user_id = 'a0000000-0000-4000-8000-00000000000a' $$,
  '42501', 'permission denied for table profiles',
  'a user cannot move their profile to another user'
);

SELECT throws_ok(
  $$ INSERT INTO public.profiles (user_id) VALUES ('b0000000-0000-4000-8000-00000000000b') $$,
  '42501', 'permission denied for table profiles',
  'a user cannot insert profiles'
);

SELECT throws_ok(
  $$ DELETE FROM public.profiles $$,
  '42501', 'permission denied for table profiles',
  'a user cannot delete profiles'
);

SELECT throws_ok(
  $$ UPDATE public.profiles SET reference_dollar = 'blue' $$,
  '22P02', NULL,
  'reference_dollar is MEP or CCL'
);

SELECT is_empty(
  $$ SELECT 1 FROM public.consents $$,
  'a user does not read another user''s consents'
);

SELECT lives_ok(
  $$ INSERT INTO public.consents (kind, version, granted) VALUES ('ai_providers', '2026-10', true) $$,
  'a user records a consent'
);

SELECT throws_ok(
  $$ INSERT INTO public.consents (kind, version) VALUES ('privacy', '2026-10') $$,
  '23502', NULL,
  'a consent names granted explicitly'
);

SELECT results_eq(
  $$ SELECT user_id, kind, granted FROM public.consents $$,
  $$ VALUES ('a0000000-0000-4000-8000-00000000000a'::uuid, 'ai_providers'::public.consent_kind, true) $$,
  'the consent is stamped with the signed-in user and read back'
);

INSERT INTO public.consents (kind, version, granted)
VALUES ('privacy', '2026-10', true), ('privacy', '2026-10', false);

SELECT is(
  (SELECT count(DISTINCT accepted_at) FROM public.consents WHERE kind = 'privacy'),
  2::bigint,
  'two consents written together get distinct times, so the latest is defined'
);

SELECT throws_ok(
  $$ INSERT INTO public.consents (user_id, kind, version, granted)
     VALUES ('b0000000-0000-4000-8000-00000000000b', 'terms', '2026-10', true) $$,
  '42501', 'permission denied for table consents',
  'a user cannot record a consent for another user'
);

SELECT throws_ok(
  $$ INSERT INTO public.consents (kind, version, granted, accepted_at)
     VALUES ('terms', '2026-10', true, '2020-01-01') $$,
  '42501', 'permission denied for table consents',
  'a user cannot backdate a consent'
);

SELECT throws_ok(
  $$ UPDATE public.consents SET granted = false $$,
  '42501', 'permission denied for table consents',
  'consents cannot be updated'
);

SELECT throws_ok(
  $$ DELETE FROM public.consents $$,
  '42501', 'permission denied for table consents',
  'consents cannot be deleted'
);

RESET ROLE;

SELECT results_eq(
  $$ SELECT display_name, reference_dollar FROM public.profiles
     WHERE user_id = 'a0000000-0000-4000-8000-00000000000a' $$,
  $$ VALUES ('Ana'::text, 'ccl'::public.reference_dollar) $$,
  'a user updates their own profile'
);

SELECT is(
  (SELECT display_name FROM public.profiles WHERE user_id = 'b0000000-0000-4000-8000-00000000000b'),
  NULL,
  'the other user''s profile is untouched'
);

SELECT is(
  (SELECT count(*) FROM public.consents WHERE user_id = 'b0000000-0000-4000-8000-00000000000b'),
  1::bigint,
  'the other user''s consent is untouched'
);

-- ── anon ────────────────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"role": "anon"}', true);
SET LOCAL ROLE anon;

SELECT throws_ok(
  $$ SELECT 1 FROM public.profiles $$,
  '42501', 'permission denied for table profiles',
  'anon cannot read profiles'
);

SELECT throws_ok(
  $$ INSERT INTO public.consents (kind, version, granted) VALUES ('terms', '2026-10', true) $$,
  '42501', 'permission denied for table consents',
  'anon cannot record consents'
);

RESET ROLE;

-- ── The policies, past the column grants ────────────────────────────────────
-- The grants above already stop a user from naming user_id, so these grant it
-- (rolled back with the test) to prove WITH CHECK stops the write on its own.
-- Caro has no profile, so moving Ana's row to her breaks no unique key.
DELETE FROM public.profiles WHERE user_id = 'c0000000-0000-4000-8000-00000000000c';
GRANT INSERT (id, user_id) ON TABLE public.consents TO authenticated;
GRANT UPDATE (user_id) ON TABLE public.consents, public.profiles TO authenticated;

SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$ INSERT INTO public.consents (user_id, kind, version, granted)
     VALUES ('c0000000-0000-4000-8000-00000000000c', 'terms', '2026-10', true) $$,
  '42501', 'new row violates row-level security policy for table "consents"',
  'the insert policy rejects a consent for another user'
);

-- No WHERE: USING already limits the update to Ana's row, and a WHERE needs
-- SELECT, so the select policy would also check the new row and reject it even
-- if WITH CHECK let it through.
SELECT throws_ok(
  $$ UPDATE public.profiles SET user_id = 'c0000000-0000-4000-8000-00000000000c' $$,
  '42501', 'new row violates row-level security policy for table "profiles"',
  'the update policy rejects moving a profile to another user'
);

-- Ana's own row passes the insert policy, so only the policies on Beto's
-- existing row can stop the conflict update from taking it over.
SELECT throws_ok(
  $$ INSERT INTO public.consents (id, user_id, kind, version, granted)
     VALUES ('cb000000-0000-4000-8000-0000000000cb', 'a0000000-0000-4000-8000-00000000000a',
             'terms', '2026-10', true)
     ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id $$,
  '42501', NULL,
  'an upsert cannot take over another user''s consent by id'
);

RESET ROLE;

SELECT is(
  (SELECT user_id FROM public.consents WHERE id = 'cb000000-0000-4000-8000-0000000000cb'),
  'b0000000-0000-4000-8000-00000000000b'::uuid,
  'the consent stays the other user''s'
);

-- ── Account deletion ────────────────────────────────────────────────────────
DELETE FROM auth.users WHERE id = 'b0000000-0000-4000-8000-00000000000b';

SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = 'b0000000-0000-4000-8000-00000000000b')
    AND NOT EXISTS (SELECT 1 FROM public.consents WHERE user_id = 'b0000000-0000-4000-8000-00000000000b'),
  'deleting the account deletes its profile and consents'
);

SELECT * FROM finish();
ROLLBACK;
