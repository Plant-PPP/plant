-- The assistant's conversations: only the chat route writes them, each user
-- reads and deletes only their own, and a deletion leaves an audit row and
-- takes its messages.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(16);

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

GRANT EXECUTE ON FUNCTION pg_temp.error_of(text) TO authenticated, service_role;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at)
VALUES
  ('a0000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ana@pgtap.invalid', '', now(), '{}', '{}', now(), now()),
  ('b0000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'beto@pgtap.invalid', '', now(), '{}', '{}', now(), now());

-- ── What the API roles hold ─────────────────────────────────────────────────
SELECT set_eq(
  $$ SELECT pg_temp.acl('public.ai_conversations', 'authenticated') $$,
  ARRAY['(table):SELECT', '(table):DELETE'],
  'a user reads and deletes their conversations, and writes none'
);

SELECT set_eq(
  $$ SELECT pg_temp.acl('public.ai_conversations', 'service_role') $$,
  ARRAY['(table):SELECT', 'user_id:INSERT', 'id:INSERT', 'title:INSERT', 'unit:INSERT',
        'title:UPDATE', 'questions:UPDATE'],
  'the chat route reads and starts conversations, and changes only their title and count'
);

SELECT is_empty(
  $$ SELECT pg_temp.acl('public.ai_conversations', 'anon')
     UNION ALL
     SELECT acl.privilege_type FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl
     WHERE c.oid = 'public.ai_conversations'::regclass AND acl.grantee = 0 $$,
  'anon and PUBLIC hold nothing on conversations'
);

-- ── As the chat route ───────────────────────────────────────────────────────
SET LOCAL ROLE service_role;

-- Beto's browser sends the id of Ana's conversation: it starts his own.
INSERT INTO public.ai_conversations (user_id, id, title, unit) VALUES
  ('a0000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-0000000000c1',
   '¿Cuánto tengo?', 'ars'),
  ('b0000000-0000-4000-8000-00000000000b', 'c0000000-0000-4000-8000-0000000000c1',
   'Mis deudas', 'usd_mep');
INSERT INTO public.ai_messages (user_id, id, conversation_id, role, parts) VALUES
  ('a0000000-0000-4000-8000-00000000000a', 'msg-a1', 'c0000000-0000-4000-8000-0000000000c1',
   'user', '[{"type": "text", "text": "¿Cuánto tengo?"}]'),
  ('b0000000-0000-4000-8000-00000000000b', 'msg-b1', 'c0000000-0000-4000-8000-0000000000c1',
   'user', '[{"type": "text", "text": "Mis deudas"}]');

SELECT results_eq(
  $$ SELECT user_id::text, title FROM public.ai_conversations
     WHERE id = 'c0000000-0000-4000-8000-0000000000c1' ORDER BY user_id $$,
  $$ VALUES ('a0000000-0000-4000-8000-00000000000a', '¿Cuánto tengo?'),
            ('b0000000-0000-4000-8000-00000000000b', 'Mis deudas') $$,
  'one id names a conversation per user'
);

UPDATE public.ai_conversations SET questions = questions + 1
WHERE user_id = 'a0000000-0000-4000-8000-00000000000a';

SELECT is(
  pg_temp.error_of($$ UPDATE public.ai_conversations
                      SET user_id = 'b0000000-0000-4000-8000-00000000000b' $$),
  '42501',
  'the chat route never moves a conversation to another owner'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.ai_conversations SET unit = 'usd_ccl' $$),
  '42501',
  'nor changes its unit'
);

SELECT is(
  pg_temp.error_of($$ DELETE FROM public.ai_conversations $$),
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
  $$ SELECT title, unit::text, questions FROM public.ai_conversations $$,
  $$ VALUES ('¿Cuánto tengo?', 'ars', 1::bigint) $$,
  'a user reads only their own conversation'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.ai_conversations (id, title, unit)
                      VALUES (gen_random_uuid(), 'Otra', 'ars') $$),
  '42501',
  'and starts none'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.ai_conversations SET title = 'Otra' $$),
  '42501',
  'nor renames one'
);

-- Beto's has the same id; RLS leaves it out.
DELETE FROM public.ai_conversations WHERE id = 'c0000000-0000-4000-8000-0000000000c1';

SELECT is_empty(
  $$ SELECT id FROM public.ai_conversations $$,
  'a user deletes their own conversation'
);

-- ── Signed in as Beto ───────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'b0000000-0000-4000-8000-00000000000b', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);

SELECT results_eq(
  $$ SELECT c.title, m.id FROM public.ai_conversations c
     JOIN public.ai_messages m ON m.user_id = c.user_id AND m.conversation_id = c.id $$,
  $$ VALUES ('Mis deudas', 'msg-b1') $$,
  'another user''s deletion leaves a conversation and its messages as they were'
);

-- ── Enrolled in MFA but signed in at aal1 ───────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'b0000000-0000-4000-8000-00000000000b', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', true)::text, true);

SELECT is_empty(
  $$ SELECT id FROM public.ai_conversations $$,
  'a user enrolled in MFA reads no conversation before the second factor'
);

-- ── Anonymous ───────────────────────────────────────────────────────────────
RESET ROLE;
SET LOCAL ROLE anon;

SELECT throws_ok(
  $$ SELECT id FROM public.ai_conversations $$,
  '42501',
  NULL,
  'anon reads no conversation'
);

RESET ROLE;

SELECT results_eq(
  $$ SELECT user_id::text, action::text, outcome::text, metadata
     FROM private.audit_log
     WHERE action = 'assistant.conversation.deleted'
       AND user_id IN ('a0000000-0000-4000-8000-00000000000a',
                       'b0000000-0000-4000-8000-00000000000b') $$,
  $$ VALUES ('a0000000-0000-4000-8000-00000000000a', 'assistant.conversation.deleted', 'success',
             '{"conversation_id": "c0000000-0000-4000-8000-0000000000c1"}'::jsonb) $$,
  'deleting a conversation leaves one audit row, with its owner and only its id'
);

SELECT is_empty(
  $$ SELECT id FROM public.ai_messages WHERE user_id = 'a0000000-0000-4000-8000-00000000000a' $$,
  'and takes its messages'
);

SELECT * FROM finish();
ROLLBACK;
