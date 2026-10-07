-- profiles and consents: each user reads and writes only their own rows, and
-- anon reaches neither.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(19);

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at)
VALUES
  ('a0000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ana@pgtap.invalid', '', now(), '{}', '{}', now(), now()),
  ('b0000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'beto@pgtap.invalid', '', now(), '{}', '{}', now(), now());

SELECT is(
  (SELECT count(*) FROM public.profiles
   WHERE user_id IN ('a0000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-00000000000b')),
  2::bigint,
  'signing up creates a profile'
);

INSERT INTO public.consents (user_id, kind, version)
VALUES ('b0000000-0000-4000-8000-00000000000b', 'terms', '2026-10');

-- ── Signed in as Ana ────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

SELECT results_eq(
  $$ SELECT user_id FROM public.profiles $$,
  $$ VALUES ('a0000000-0000-4000-8000-00000000000a'::uuid) $$,
  'a user reads only their own profile'
);

-- Both updates run as Ana; their effect is checked after RESET ROLE below.
UPDATE public.profiles SET display_name = 'Ana', reference_dollar = 'ccl'
WHERE user_id = 'a0000000-0000-4000-8000-00000000000a';
UPDATE public.profiles SET display_name = 'pisado'
WHERE user_id = 'b0000000-0000-4000-8000-00000000000b';

SELECT throws_ok(
  $$ UPDATE public.profiles SET user_id = 'b0000000-0000-4000-8000-00000000000b'
     WHERE user_id = 'a0000000-0000-4000-8000-00000000000a' $$,
  '42501', NULL,
  'a user cannot move their profile to another user'
);

SELECT throws_ok(
  $$ INSERT INTO public.profiles (user_id) VALUES ('b0000000-0000-4000-8000-00000000000b') $$,
  '42501', NULL,
  'a user cannot insert profiles'
);

SELECT throws_ok(
  $$ DELETE FROM public.profiles $$,
  '42501', NULL,
  'a user cannot delete profiles'
);

SELECT throws_ok(
  $$ UPDATE public.profiles SET reference_dollar = 'blue' $$,
  '23514', NULL,
  'reference_dollar is MEP or CCL'
);

SELECT is_empty(
  $$ SELECT 1 FROM public.consents $$,
  'a user does not read another user''s consents'
);

SELECT lives_ok(
  $$ INSERT INTO public.consents (kind, version) VALUES ('ai_providers', '2026-10') $$,
  'a user records a consent'
);

SELECT results_eq(
  $$ SELECT user_id, kind, granted FROM public.consents $$,
  $$ VALUES ('a0000000-0000-4000-8000-00000000000a'::uuid, 'ai_providers'::text, true) $$,
  'the consent is stamped with the signed-in user and read back'
);

SELECT throws_ok(
  $$ INSERT INTO public.consents (user_id, kind, version)
     VALUES ('b0000000-0000-4000-8000-00000000000b', 'terms', '2026-10') $$,
  '42501', NULL,
  'a user cannot record a consent for another user'
);

SELECT throws_ok(
  $$ INSERT INTO public.consents (kind, version, accepted_at)
     VALUES ('terms', '2026-10', '2020-01-01') $$,
  '42501', NULL,
  'a user cannot backdate a consent'
);

SELECT throws_ok(
  $$ UPDATE public.consents SET granted = false $$,
  '42501', NULL,
  'consents cannot be updated'
);

SELECT throws_ok(
  $$ DELETE FROM public.consents $$,
  '42501', NULL,
  'consents cannot be deleted'
);

RESET ROLE;

SELECT results_eq(
  $$ SELECT display_name, reference_dollar FROM public.profiles
     WHERE user_id = 'a0000000-0000-4000-8000-00000000000a' $$,
  $$ VALUES ('Ana'::text, 'ccl'::text) $$,
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
  '42501', NULL,
  'anon cannot read profiles'
);

SELECT throws_ok(
  $$ INSERT INTO public.consents (kind, version) VALUES ('terms', '2026-10') $$,
  '42501', NULL,
  'anon cannot record consents'
);

RESET ROLE;

-- ── Account deletion ────────────────────────────────────────────────────────
DELETE FROM auth.users WHERE id = 'b0000000-0000-4000-8000-00000000000b';

SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = 'b0000000-0000-4000-8000-00000000000b')
    AND NOT EXISTS (SELECT 1 FROM public.consents WHERE user_id = 'b0000000-0000-4000-8000-00000000000b'),
  'deleting the account deletes its profile and consents'
);

SELECT * FROM finish();
ROLLBACK;
