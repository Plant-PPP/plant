-- ai_costs: only the service role writes, and only new rows; each user reads
-- only their own rows; anon reaches nothing.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(23);

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at)
VALUES
  ('a0000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ana@pgtap.invalid', '', now(), '{}', '{}', now(), now()),
  ('b0000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'beto@pgtap.invalid', '', now(), '{}', '{}', now(), now());

-- ── The service role (the server's cost writer) ─────────────────────────────
-- It bypasses RLS, so its grants are the whole boundary: exactly INSERT on
-- the data columns, on the table and on every column.
SELECT set_eq(
  $$ SELECT a.attname || ':' || acl.privilege_type
     FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl
     WHERE a.attrelid = 'public.ai_costs'::regclass AND acl.grantee = 'service_role'::regrole
     UNION ALL
     SELECT '(table):' || acl.privilege_type
     FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl
     WHERE c.oid = 'public.ai_costs'::regclass AND acl.grantee = 'service_role'::regrole $$,
  ARRAY['user_id:INSERT', 'cost_type:INSERT', 'model_id:INSERT', 'amount_usd:INSERT',
        'input_tokens:INSERT', 'cache_read_tokens:INSERT', 'cache_write_tokens:INSERT',
        'output_tokens:INSERT'],
  'the service role holds only INSERT on the data columns'
);

SELECT set_config('request.jwt.claims', '{"role": "service_role"}', true);
SET LOCAL ROLE service_role;

SELECT lives_ok(
  $$ INSERT INTO public.ai_costs (user_id, cost_type, model_id, amount_usd, input_tokens,
                                  cache_read_tokens, cache_write_tokens, output_tokens)
     VALUES ('a0000000-0000-4000-8000-00000000000a', 'import_extraction',
             'gemini-3.5-flash-lite', 0.0087, 4000, 0, 0, 3000) $$,
  'the service role records a cost for Ana'
);

SELECT lives_ok(
  $$ INSERT INTO public.ai_costs (user_id, cost_type, model_id, amount_usd, input_tokens,
                                  cache_read_tokens, cache_write_tokens, output_tokens)
     VALUES ('b0000000-0000-4000-8000-00000000000b', 'import_extraction',
             'claude-haiku-4-5', 0.001, 1000, 0, 0, 0) $$,
  'the service role records a cost for Beto'
);

SELECT throws_ok(
  $$ SELECT 1 FROM public.ai_costs $$,
  '42501', 'permission denied for table ai_costs',
  'the service role cannot read costs'
);

SELECT throws_ok(
  $$ UPDATE public.ai_costs SET amount_usd = 0 $$,
  '42501', 'permission denied for table ai_costs',
  'the service role cannot update costs'
);

SELECT throws_ok(
  $$ DELETE FROM public.ai_costs $$,
  '42501', 'permission denied for table ai_costs',
  'the service role cannot delete costs'
);

SELECT throws_ok(
  $$ TRUNCATE public.ai_costs $$,
  '42501', 'permission denied for table ai_costs',
  'the service role cannot truncate costs'
);

SELECT throws_ok(
  $$ INSERT INTO public.ai_costs (id, user_id, cost_type, model_id, amount_usd, input_tokens,
                                  cache_read_tokens, cache_write_tokens, output_tokens)
     VALUES (gen_random_uuid(), 'a0000000-0000-4000-8000-00000000000a', 'import_extraction',
             'gemini-3.5-flash-lite', 0, 0, 0, 0, 0) $$,
  '42501', 'permission denied for table ai_costs',
  'the service role cannot choose the id'
);

SELECT throws_ok(
  $$ INSERT INTO public.ai_costs (user_id, cost_type, model_id, amount_usd, input_tokens,
                                  cache_read_tokens, cache_write_tokens, output_tokens, created_at)
     VALUES ('a0000000-0000-4000-8000-00000000000a', 'import_extraction',
             'gemini-3.5-flash-lite', 0, 0, 0, 0, 0, '2020-01-01') $$,
  '42501', 'permission denied for table ai_costs',
  'the service role cannot backdate a cost'
);

SELECT throws_ok(
  $$ INSERT INTO public.ai_costs (cost_type, model_id, amount_usd, input_tokens,
                                  cache_read_tokens, cache_write_tokens, output_tokens)
     VALUES ('import_extraction', 'gemini-3.5-flash-lite', 0, 0, 0, 0, 0) $$,
  '23502', NULL,
  'every cost names its user'
);

SELECT throws_ok(
  $$ INSERT INTO public.ai_costs (user_id, cost_type, model_id, amount_usd, input_tokens,
                                  cache_read_tokens, cache_write_tokens, output_tokens)
     VALUES ('a0000000-0000-4000-8000-00000000000a', 'import_extraction',
             'gemini-3.5-flash-lite', -0.01, 0, 0, 0, 0) $$,
  '23514', NULL,
  'a cost is never negative'
);

RESET ROLE;

-- ── Signed in as Ana ────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

SELECT results_eq(
  $$ SELECT user_id, model_id FROM public.ai_costs $$,
  $$ VALUES ('a0000000-0000-4000-8000-00000000000a'::uuid, 'gemini-3.5-flash-lite'::text) $$,
  'a user reads only their own costs'
);

SELECT throws_ok(
  $$ INSERT INTO public.ai_costs (cost_type, model_id, amount_usd, input_tokens,
                                  cache_read_tokens, cache_write_tokens, output_tokens)
     VALUES ('import_extraction', 'gemini-3.5-flash-lite', 0, 0, 0, 0, 0) $$,
  '42501', 'permission denied for table ai_costs',
  'a user cannot record a cost'
);

SELECT throws_ok(
  $$ INSERT INTO public.ai_costs (user_id, cost_type, model_id, amount_usd, input_tokens,
                                  cache_read_tokens, cache_write_tokens, output_tokens)
     VALUES ('a0000000-0000-4000-8000-00000000000a', 'import_extraction',
             'gemini-3.5-flash-lite', 0, 0, 0, 0, 0) $$,
  '42501', 'permission denied for table ai_costs',
  'a user cannot record a cost in their own name'
);

SELECT throws_ok(
  $$ UPDATE public.ai_costs SET amount_usd = 0 $$,
  '42501', 'permission denied for table ai_costs',
  'a user cannot change what a call cost'
);

SELECT throws_ok(
  $$ UPDATE public.ai_costs SET user_id = 'b0000000-0000-4000-8000-00000000000b' $$,
  '42501', 'permission denied for table ai_costs',
  'a user cannot move a cost to another user'
);

SELECT throws_ok(
  $$ DELETE FROM public.ai_costs $$,
  '42501', 'permission denied for table ai_costs',
  'a user cannot delete costs'
);

RESET ROLE;

-- ── anon ────────────────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"role": "anon"}', true);
SET LOCAL ROLE anon;

SELECT throws_ok(
  $$ SELECT 1 FROM public.ai_costs $$,
  '42501', 'permission denied for table ai_costs',
  'anon cannot read costs'
);

RESET ROLE;

-- ── The policies, past the grants ───────────────────────────────────────────
-- The grants above already stop every write by a user, so these grant them
-- (rolled back with the test) to prove the policies stop the write on their own.
GRANT INSERT (user_id, cost_type, model_id, amount_usd, input_tokens,
              cache_read_tokens, cache_write_tokens, output_tokens)
  ON TABLE public.ai_costs TO authenticated;
GRANT UPDATE (user_id, amount_usd) ON TABLE public.ai_costs TO authenticated;
GRANT DELETE ON TABLE public.ai_costs TO authenticated;

SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$ INSERT INTO public.ai_costs (user_id, cost_type, model_id, amount_usd, input_tokens,
                                  cache_read_tokens, cache_write_tokens, output_tokens)
     VALUES ('a0000000-0000-4000-8000-00000000000a', 'import_extraction',
             'gemini-3.5-flash-lite', 0, 0, 0, 0, 0) $$,
  '42501', 'new row violates row-level security policy for table "ai_costs"',
  'no policy lets a user record a cost, even in their own name'
);

-- No WHERE: one would AND the select policy into the check and could hide a
-- loose update or delete policy; without it, only those policies decide.
SELECT lives_ok(
  $$ UPDATE public.ai_costs SET amount_usd = 0, user_id = 'b0000000-0000-4000-8000-00000000000b' $$,
  'no policy lets an update reach a row'
);

SELECT lives_ok(
  $$ DELETE FROM public.ai_costs $$,
  'no policy lets a delete reach a row'
);

RESET ROLE;

SELECT results_eq(
  $$ SELECT user_id, model_id, amount_usd FROM public.ai_costs ORDER BY model_id $$,
  $$ VALUES ('b0000000-0000-4000-8000-00000000000b'::uuid, 'claude-haiku-4-5'::text, 0.001::numeric),
            ('a0000000-0000-4000-8000-00000000000a'::uuid, 'gemini-3.5-flash-lite'::text, 0.0087::numeric) $$,
  'both users'' costs are unchanged'
);

-- ── Account deletion ────────────────────────────────────────────────────────
DELETE FROM auth.users WHERE id = 'a0000000-0000-4000-8000-00000000000a';

SELECT is_empty(
  $$ SELECT 1 FROM public.ai_costs WHERE user_id = 'a0000000-0000-4000-8000-00000000000a' $$,
  'deleting the account deletes its costs'
);

SELECT * FROM finish();
ROLLBACK;
