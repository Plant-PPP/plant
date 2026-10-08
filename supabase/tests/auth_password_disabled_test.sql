-- No auth.users row keeps a password: Plant signs in with an email code or
-- Google only.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(4);

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at)
VALUES
  ('a0000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ana@pgtap.invalid', 'planted', NULL, '{}', '{}', now(), now()),
  ('b0000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'beto@pgtap.invalid', NULL, now(), '{}', '{}', now(), now());

SELECT is(
  (SELECT encrypted_password FROM auth.users WHERE id = 'a0000000-0000-4000-8000-00000000000a'),
  NULL::varchar,
  'a user created with a password has none'
);

UPDATE auth.users SET email_confirmed_at = now(), encrypted_password = 'planted'
WHERE id = 'a0000000-0000-4000-8000-00000000000a';

SELECT is(
  (SELECT encrypted_password FROM auth.users WHERE id = 'a0000000-0000-4000-8000-00000000000a'),
  NULL::varchar,
  'confirming the address does not keep a password'
);

UPDATE auth.users SET encrypted_password = 'planted'
WHERE id = 'b0000000-0000-4000-8000-00000000000b';

SELECT is(
  (SELECT encrypted_password FROM auth.users WHERE id = 'b0000000-0000-4000-8000-00000000000b'),
  NULL::varchar,
  'a confirmed user cannot set a password'
);

-- The admin API confirms a new user with an UPDATE of email_confirmed_at
-- alone, which the statements above cannot isolate.
SELECT is(
  (SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t
   WHERE t.tgrelid = 'auth.users'::regclass AND t.tgname = 'clear_password' AND t.tgenabled = 'O'),
  'CREATE TRIGGER clear_password BEFORE INSERT OR UPDATE OF encrypted_password, email_confirmed_at ON auth.users FOR EACH ROW EXECUTE FUNCTION private.clear_password()',
  'the trigger is enabled and fires on insert, password change and confirmation'
);

SELECT * FROM finish();
ROLLBACK;
