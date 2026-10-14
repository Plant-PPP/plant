-- The assistant's messages: only the chat route writes them, each in a
-- conversation of its own user and bounded in size; each user reads only
-- their own.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(19);

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

-- A message from the chat route for Ana, in `conversation`.
CREATE FUNCTION pg_temp.write(id text, conversation uuid, role text, parts text,
                              metadata text DEFAULT NULL) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.error_of(format(
    'INSERT INTO public.ai_messages (user_id, id, conversation_id, role, parts, metadata)
     VALUES (%L, %L, %L, %L, %L::jsonb, %L::jsonb)',
    'a0000000-0000-4000-8000-00000000000a', id, conversation, role, parts, metadata))
$f$;

GRANT EXECUTE ON FUNCTION pg_temp.error_of(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION pg_temp.write(text, uuid, text, text, text) TO service_role;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at)
VALUES
  ('a0000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ana@pgtap.invalid', '', now(), '{}', '{}', now(), now()),
  ('b0000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'beto@pgtap.invalid', '', now(), '{}', '{}', now(), now());

INSERT INTO public.ai_conversations (user_id, id, title, unit) VALUES
  ('a0000000-0000-4000-8000-00000000000a', 'ca000000-0000-4000-8000-0000000000ca', 'Hoy', 'ars'),
  ('b0000000-0000-4000-8000-00000000000b', 'cb000000-0000-4000-8000-0000000000cb', 'Deudas', 'ars');
INSERT INTO public.ai_messages (user_id, id, conversation_id, role, parts) VALUES
  ('b0000000-0000-4000-8000-00000000000b', 'msg-b1', 'cb000000-0000-4000-8000-0000000000cb',
   'user', '[{"type": "text", "text": "¿Cuánto debo?"}]');

-- ── What the API roles hold ─────────────────────────────────────────────────
SELECT set_eq(
  $$ SELECT pg_temp.acl('public.ai_messages', 'authenticated') $$,
  ARRAY['(table):SELECT'],
  'a user only reads their messages'
);

SELECT set_eq(
  $$ SELECT pg_temp.acl('public.ai_messages', 'service_role') $$,
  ARRAY['(table):SELECT', 'user_id:INSERT', 'id:INSERT', 'conversation_id:INSERT',
        'role:INSERT', 'parts:INSERT', 'metadata:INSERT'],
  'the chat route reads and adds messages, and changes none'
);

SELECT is_empty(
  $$ SELECT pg_temp.acl('public.ai_messages', 'anon')
     UNION ALL
     SELECT acl.privilege_type FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl
     WHERE c.oid = 'public.ai_messages'::regclass AND acl.grantee = 0 $$,
  'anon and PUBLIC hold nothing on messages'
);

-- ── As the chat route ───────────────────────────────────────────────────────
SET LOCAL ROLE service_role;

SELECT is(
  pg_temp.write('msg-a1', 'ca000000-0000-4000-8000-0000000000ca', 'user',
                '[{"type": "text", "text": "¿Cuánto tengo?"}]'),
  NULL,
  'the chat route adds a message to its user''s conversation'
);

SELECT is(
  pg_temp.write('msg-a2', 'ca000000-0000-4000-8000-0000000000ca', 'assistant',
                '[{"type": "text", "text": "Tenés $ 1.000"}]', '{"asOf": "2026-10-13"}'),
  NULL,
  'and an answer with its metadata'
);

SELECT is(
  pg_temp.write('msg-a3', 'cb000000-0000-4000-8000-0000000000cb', 'user', '[]'),
  '23503',
  'a message never goes in another user''s conversation'
);

SELECT is(
  pg_temp.write('msg-a4', 'ca000000-0000-4000-8000-0000000000ca', 'user',
                jsonb_build_array(jsonb_build_object('type', 'text', 'text', repeat('x', 70000)))::text),
  '23514',
  'a message holds at most 64 KiB of parts'
);

SELECT is(
  pg_temp.write('msg-a5', 'ca000000-0000-4000-8000-0000000000ca', 'assistant', '[]',
                jsonb_build_object('note', repeat('x', 5000))::text),
  '23514',
  'and 4 KiB of metadata'
);

SELECT is(
  pg_temp.write('msg-a6', 'ca000000-0000-4000-8000-0000000000ca', 'user', '{"type": "text"}'),
  '23514',
  'parts are a list'
);

SELECT is(
  pg_temp.write('msg-a7', 'ca000000-0000-4000-8000-0000000000ca', 'system', '[]'),
  '23514',
  'a message is from the user or the assistant'
);

SELECT is(
  pg_temp.write('msg a8', 'ca000000-0000-4000-8000-0000000000ca', 'user', '[]'),
  '23514',
  'an id is letters, digits, - and _'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.ai_messages SET parts = '[]' $$),
  '42501',
  'the chat route never rewrites a message'
);

SELECT is(
  pg_temp.error_of($$ DELETE FROM public.ai_messages $$),
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
  $$ SELECT id, role FROM public.ai_messages ORDER BY id $$,
  $$ VALUES ('msg-a1', 'user'), ('msg-a2', 'assistant') $$,
  'a user reads only their own messages'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.ai_messages (id, conversation_id, role, parts)
                      VALUES ('msg-x', 'ca000000-0000-4000-8000-0000000000ca', 'assistant', '[]') $$),
  '42501',
  'and adds none'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.ai_messages SET parts = '[]' $$),
  '42501',
  'changes none'
);

SELECT is(
  pg_temp.error_of($$ DELETE FROM public.ai_messages $$),
  '42501',
  'and deletes none'
);

-- ── Enrolled in MFA but signed in at aal1 ───────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'b0000000-0000-4000-8000-00000000000b', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', true)::text, true);

SELECT is_empty(
  $$ SELECT id FROM public.ai_messages $$,
  'a user enrolled in MFA reads no message before the second factor'
);

-- ── Anonymous ───────────────────────────────────────────────────────────────
RESET ROLE;
SET LOCAL ROLE anon;

SELECT throws_ok(
  $$ SELECT id FROM public.ai_messages $$,
  '42501',
  NULL,
  'anon reads no message'
);

SELECT * FROM finish();
ROLLBACK;
