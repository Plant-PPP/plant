-- Installment plans: what a user may write, that each user reads and writes
-- only their own, and that replace_liability_installments swaps a plan whole.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(14);

CREATE FUNCTION pg_temp.error_of(statement text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE statement;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$f$;

CREATE FUNCTION pg_temp.acl(rel regclass) RETURNS SETOF text LANGUAGE sql AS $f$
  SELECT '(table):' || acl.privilege_type
  FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl
  WHERE c.oid = rel AND acl.grantee = 'authenticated'::regrole
  UNION ALL
  SELECT a.attname || ':' || acl.privilege_type
  FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl
  WHERE a.attrelid = rel AND acl.grantee = 'authenticated'::regrole
$f$;

GRANT EXECUTE ON FUNCTION pg_temp.error_of(text) TO authenticated;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at)
VALUES
  ('a0000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ana@pgtap.invalid', '', now(), '{}', '{}', now(), now()),
  ('b0000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'beto@pgtap.invalid', '', now(), '{}', '{}', now(), now());

INSERT INTO public.liabilities (id, user_id, kind, label, currency, balance) VALUES
  ('a9000000-0000-4000-8000-0000000000a9', 'a0000000-0000-4000-8000-00000000000a',
   'usd_debt', 'Cochera', 'USD', '35000'),
  ('b9000000-0000-4000-8000-0000000000b9', 'b0000000-0000-4000-8000-00000000000b',
   'usd_debt', 'Auto', 'USD', '10000');
INSERT INTO public.liability_installments (user_id, liability_id, due_on, amount, position) VALUES
  ('b0000000-0000-4000-8000-00000000000b', 'b9000000-0000-4000-8000-0000000000b9',
   '2026-12-01', '500', 0);

SELECT set_eq(
  $$ SELECT pg_temp.acl('public.liability_installments') $$,
  ARRAY['(table):SELECT', '(table):DELETE', 'liability_id:INSERT', 'due_on:INSERT',
        'amount:INSERT', 'position:INSERT'],
  'a user reads, deletes and adds installments, never their owner or id'
);

SELECT is_empty(
  $$ SELECT acl.grantee::regrole::text FROM pg_class c
     CROSS JOIN LATERAL aclexplode(c.relacl) acl
     WHERE c.oid = 'public.liability_installments'::regclass
       AND acl.grantee IN ('anon'::regrole, 'service_role'::regrole, 0) $$,
  'anon, the service role and PUBLIC hold nothing on liability_installments'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.replace_liability_installments(uuid,jsonb)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.replace_liability_installments(uuid,jsonb)', 'EXECUTE'),
  'only authenticated replaces a plan'
);

-- ── Signed in as Ana ────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(
  public.replace_liability_installments('a9000000-0000-4000-8000-0000000000a9',
    '[{"due_on": "2026-10-31", "amount": "3160"}, {"due_on": "2026-11-30", "amount": "8160"}]'),
  2,
  'a user writes a plan for their debt'
);

SELECT results_eq(
  $$ SELECT due_on::text, amount::text, position::int, user_id::text
     FROM public.liability_installments ORDER BY position $$,
  $$ VALUES ('2026-10-31', '3160.00000000', 0, 'a0000000-0000-4000-8000-00000000000a'),
            ('2026-11-30', '8160.00000000', 1, 'a0000000-0000-4000-8000-00000000000a') $$,
  'the plan is kept in order under the user''s id, and only their rows are read'
);

SELECT is(
  public.replace_liability_installments('a9000000-0000-4000-8000-0000000000a9',
    '[{"due_on": "2027-05-06", "amount": "4080"}]'),
  1,
  'a new plan replaces the old one'
);

SELECT results_eq(
  $$ SELECT due_on::text FROM public.liability_installments $$,
  $$ VALUES ('2027-05-06') $$,
  'only the new plan remains'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.replace_liability_installments(
    'b9000000-0000-4000-8000-0000000000b9', '[]') $$),
  'PT404',
  'another user''s debt is not found'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.replace_liability_installments(
    'a9000000-0000-4000-8000-0000000000a9',
    '[{"due_on": "2026-10-31", "amount": "0"}]') $$),
  '23514',
  'an installment owes more than 0'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.replace_liability_installments(
    'a9000000-0000-4000-8000-0000000000a9',
    (SELECT jsonb_agg(jsonb_build_object('due_on', '2026-10-31', 'amount', '1'))
     FROM generate_series(1, 601))) $$),
  '22023',
  'a plan has at most 600 installments'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.liability_installments (liability_id, due_on, amount, position)
                      VALUES ('b9000000-0000-4000-8000-0000000000b9', '2026-10-31', '1', 5) $$),
  '23503',
  'a user adds no installment to another user''s debt'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.liability_installments (liability_id, due_on, amount, position)
                      VALUES ('a9000000-0000-4000-8000-0000000000a9', '2026-10-31', '1', 600) $$),
  '23514',
  'a position past the cap is refused'
);

DELETE FROM public.liability_installments
  WHERE liability_id = 'b9000000-0000-4000-8000-0000000000b9';

RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.liability_installments
   WHERE user_id = 'b0000000-0000-4000-8000-00000000000b'),
  1,
  'another user''s plan is untouched'
);

DELETE FROM public.liabilities WHERE id = 'a9000000-0000-4000-8000-0000000000a9';
SELECT is(
  (SELECT count(*)::int FROM public.liability_installments
   WHERE liability_id = 'a9000000-0000-4000-8000-0000000000a9'),
  0,
  'deleting a debt deletes its plan'
);

SELECT * FROM finish();
ROLLBACK;
