-- The assistant's monthly question quota: only the chat route records a
-- question, 30 a calendar month per user, and deleting a conversation gives
-- none back; each user reads only their own.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(15);

-- The SQLSTATE a statement raises, or NULL if it succeeds.
CREATE FUNCTION pg_temp.error_of(statement text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE statement;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$f$;

-- The privileges a role holds on a table and its columns.
CREATE FUNCTION pg_temp.acl(rel regclass, role regrole) RETURNS SETOF text LANGUAGE sql AS $f$
  SELECT '(table):' || acl.privilege_type || CASE WHEN acl.is_grantable THEN '+grant' ELSE '' END
  FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl
  WHERE c.oid = rel AND acl.grantee = role
  UNION ALL
  SELECT a.attname || ':' || acl.privilege_type || CASE WHEN acl.is_grantable THEN '+grant' ELSE '' END
  FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl
  WHERE a.attrelid = rel AND acl.grantee = role
$f$;

-- One question for `asker`, as the chat route records it.
CREATE FUNCTION pg_temp.ask(asker uuid) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.error_of(format('INSERT INTO public.ai_questions (user_id) VALUES (%L)', asker))
$f$;

GRANT EXECUTE ON FUNCTION pg_temp.error_of(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION pg_temp.ask(uuid) TO service_role;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at)
VALUES
  ('a0000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ana@pgtap.invalid', '', now(), '{}', '{}', now(), now()),
  ('b0000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'beto@pgtap.invalid', '', now(), '{}', '{}', now(), now());

-- Ana asked one question last month and has a conversation.
INSERT INTO public.ai_questions (user_id, asked_at) VALUES
  ('a0000000-0000-4000-8000-00000000000a', now() - interval '40 days');
INSERT INTO public.ai_conversations (user_id, id, title, unit) VALUES
  ('a0000000-0000-4000-8000-00000000000a', 'ca000000-0000-4000-8000-0000000000ca', 'Hoy', 'ars');

-- ── What the API roles hold ─────────────────────────────────────────────────
SELECT set_eq(
  $$ SELECT pg_temp.acl('public.ai_questions', 'authenticated') $$,
  ARRAY['(table):SELECT'],
  'a user only reads their questions'
);

SELECT set_eq(
  $$ SELECT pg_temp.acl('public.ai_questions', 'service_role') $$,
  ARRAY['(table):SELECT', 'user_id:INSERT'],
  'the chat route reads and records questions, only naming their user'
);

SELECT is_empty(
  $$ SELECT pg_temp.acl('public.ai_questions', 'anon')
     UNION ALL
     SELECT acl.privilege_type FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl
     WHERE c.oid = 'public.ai_questions'::regclass AND acl.grantee = 0 $$,
  'anon and PUBLIC hold nothing on questions'
);

-- ── As the chat route ───────────────────────────────────────────────────────
SET LOCAL ROLE service_role;

SELECT is(
  ARRAY(SELECT DISTINCT pg_temp.ask('a0000000-0000-4000-8000-00000000000a')
        FROM generate_series(1, 30)),
  ARRAY[NULL::text],
  'a user asks 30 questions this month, last month''s not counted'
);

SELECT is(pg_temp.ask('a0000000-0000-4000-8000-00000000000a'), 'PT429', 'and not a 31st');

SELECT is(
  pg_temp.ask('b0000000-0000-4000-8000-00000000000b'),
  NULL,
  'another user''s questions count against nobody else'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.ai_questions (user_id, asked_at)
                      VALUES ('b0000000-0000-4000-8000-00000000000b', now() - interval '40 days') $$),
  '42501',
  'the chat route never backdates a question'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.ai_questions SET asked_at = now() - interval '40 days' $$),
  '42501',
  'nor moves one'
);

SELECT is(
  pg_temp.error_of($$ DELETE FROM public.ai_questions $$),
  '42501',
  'nor deletes one'
);

RESET ROLE;

-- ── Signed in as Ana ────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

SELECT results_eq(
  $$ SELECT count(*)::int, bool_and(user_id = 'a0000000-0000-4000-8000-00000000000a')
     FROM public.ai_questions $$,
  $$ VALUES (31, true) $$,
  'a user reads only their own questions'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.ai_questions DEFAULT VALUES $$),
  '42501',
  'and records none'
);

SELECT is(
  pg_temp.error_of($$ DELETE FROM public.ai_questions $$),
  '42501',
  'nor deletes one'
);

DELETE FROM public.ai_conversations;

RESET ROLE;
SET LOCAL ROLE service_role;

SELECT is(
  pg_temp.ask('a0000000-0000-4000-8000-00000000000a'),
  'PT429',
  'deleting a conversation gives no question back'
);

RESET ROLE;

-- ── Enrolled in MFA but signed in at aal1 ───────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', true)::text, true);
SET LOCAL ROLE authenticated;

SELECT is_empty(
  $$ SELECT id FROM public.ai_questions $$,
  'a user enrolled in MFA reads no question before the second factor'
);

-- ── Anonymous ───────────────────────────────────────────────────────────────
RESET ROLE;
SET LOCAL ROLE anon;

SELECT throws_ok(
  $$ SELECT id FROM public.ai_questions $$,
  '42501',
  NULL,
  'anon reads no question'
);

SELECT * FROM finish();
ROLLBACK;
