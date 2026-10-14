-- A card statement's draft of debts and confirm_import_debts: what the job may
-- write as service_role, that each user reads only their own draft, and that
-- a user confirms only their own ready import, writing their own card debts,
-- all or nothing.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(18);

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
  SELECT '(table):' || acl.privilege_type
  FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl
  WHERE c.oid = rel AND acl.grantee = role
  UNION ALL
  SELECT a.attname || ':' || acl.privilege_type
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

ALTER TABLE public.source_connections DISABLE TRIGGER portfolio_setup_1_lock;
INSERT INTO public.source_connections (id, user_id, institution, default_portfolio_id)
SELECT CASE user_id WHEN 'a0000000-0000-4000-8000-00000000000a'
                    THEN 'a5000000-0000-4000-8000-0000000000a5'::uuid
                    ELSE 'b5000000-0000-4000-8000-0000000000b5'::uuid END,
       user_id, 'Galicia', id
FROM public.portfolios
WHERE user_id IN ('a0000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-00000000000b');
ALTER TABLE public.source_connections ENABLE TRIGGER portfolio_setup_1_lock;

-- Ana has three card statements ready to review; Beto has one.
INSERT INTO public.uploaded_documents (id, user_id, source_connection_id, storage_path,
                                       file_name, mime_type, size_bytes, sha256)
SELECT id, owner, connection, owner || '/imports/' || id || '/' || id,
       'tarjeta.pdf', 'application/pdf', 1024, repeat(digit, 64)
FROM (VALUES
  ('a8000000-0000-4000-8000-0000000000a1'::uuid, 'a0000000-0000-4000-8000-00000000000a'::uuid,
   'a5000000-0000-4000-8000-0000000000a5'::uuid, '1'),
  ('a8000000-0000-4000-8000-0000000000a2'::uuid, 'a0000000-0000-4000-8000-00000000000a'::uuid,
   'a5000000-0000-4000-8000-0000000000a5'::uuid, '2'),
  ('a8000000-0000-4000-8000-0000000000a3'::uuid, 'a0000000-0000-4000-8000-00000000000a'::uuid,
   'a5000000-0000-4000-8000-0000000000a5'::uuid, '4'),
  ('b8000000-0000-4000-8000-0000000000b1'::uuid, 'b0000000-0000-4000-8000-00000000000b'::uuid,
   'b5000000-0000-4000-8000-0000000000b5'::uuid, '3')) AS docs (id, owner, connection, digit);
INSERT INTO public.imports (id, user_id, document_id, status) VALUES
  ('a9000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-00000000000a',
   'a8000000-0000-4000-8000-0000000000a1', 'ready'),
  ('a9000000-0000-4000-8000-0000000000a2', 'a0000000-0000-4000-8000-00000000000a',
   'a8000000-0000-4000-8000-0000000000a2', 'ready'),
  ('a9000000-0000-4000-8000-0000000000a3', 'a0000000-0000-4000-8000-00000000000a',
   'a8000000-0000-4000-8000-0000000000a3', 'ready'),
  ('b9000000-0000-4000-8000-0000000000b1', 'b0000000-0000-4000-8000-00000000000b',
   'b8000000-0000-4000-8000-0000000000b1', 'ready');

-- Beto already owes on a card in pesos.
INSERT INTO public.liabilities (id, user_id, kind, label, currency, balance) VALUES
  ('b4000000-0000-4000-8000-0000000000b4', 'b0000000-0000-4000-8000-00000000000b',
   'credit_card', 'Visa', 'ARS', '1000');

-- ── What the API roles hold ─────────────────────────────────────────────────
SELECT set_eq(
  $$ SELECT pg_temp.acl('public.import_debts', 'authenticated') $$,
  ARRAY['(table):SELECT'],
  'a user only reads a draft of debts'
);

SELECT set_eq(
  $$ SELECT pg_temp.acl('public.import_debts', 'service_role') $$,
  ARRAY['(table):DELETE', 'id:SELECT', 'user_id:SELECT', 'import_id:SELECT',
        'user_id:INSERT', 'import_id:INSERT', 'position:INSERT', 'label:INSERT', 'lender:INSERT',
        'currency:INSERT', 'balance:INSERT', 'minimum_payment:INSERT', 'due_date:INSERT',
        'confidence:INSERT', 'source_page:INSERT'],
  'the job writes and replaces a draft of debts, nothing more'
);

SELECT is_empty(
  $$ SELECT pg_temp.acl('public.import_debts', 'anon')
     UNION ALL SELECT acl.privilege_type FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl
     WHERE c.oid = 'public.import_debts'::regclass AND acl.grantee = 0 $$,
  'anon and PUBLIC hold nothing on a draft of debts'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.confirm_import_debts(uuid,jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.confirm_import_debts(uuid,jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'public.confirm_import_debts(uuid,jsonb)', 'EXECUTE'),
  'only authenticated confirms a card statement'
);

-- ── As the job ──────────────────────────────────────────────────────────────
SET LOCAL ROLE service_role;

INSERT INTO public.import_debts (user_id, import_id, position, label, lender, currency, balance,
                                 minimum_payment, due_date, confidence, source_page)
VALUES ('a0000000-0000-4000-8000-00000000000a', 'a9000000-0000-4000-8000-0000000000a1', 0,
        'Visa', 'Galicia', 'ARS', '250000.5', '25000', '2026-10-20', 'high', 1);
-- What the statement does not say stays null.
INSERT INTO public.import_debts (user_id, import_id, position, currency, confidence)
VALUES ('a0000000-0000-4000-8000-00000000000a', 'a9000000-0000-4000-8000-0000000000a1', 1,
        'USD', 'low');

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.import_debts (user_id, import_id, position, currency,
                        confidence)
                      VALUES ('a0000000-0000-4000-8000-00000000000a',
                              'b9000000-0000-4000-8000-0000000000b1', 0, 'ARS', 'high') $$),
  '23503',
  'the job never files a debt under another user''s import'
);

RESET ROLE;

-- ── Signed in as Beto ───────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'b0000000-0000-4000-8000-00000000000b', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

SELECT is_empty(
  $$ SELECT 1 FROM public.import_debts $$,
  'a user never reads another user''s draft of debts'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.confirm_import_debts('a9000000-0000-4000-8000-0000000000a1', '[]') $$),
  'PT404',
  'a user never confirms another user''s card statement'
);

-- ── Signed in as Ana ────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);

SELECT results_eq(
  $$ SELECT d.label, d.balance::text, d.due_date::text, d.confidence::text
     FROM public.import_debts d ORDER BY d.position $$,
  $$ VALUES ('Visa', '250000.50000000', '2026-10-20', 'high'),
            (NULL, NULL, NULL, 'low') $$,
  'a user reads their own draft of debts'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.import_debts SET balance = '1' $$),
  '42501',
  'and changes none of it'
);

SELECT is(
  public.confirm_import_debts('a9000000-0000-4000-8000-0000000000a1',
    jsonb_build_array(jsonb_build_object(
      'liability_id', NULL, 'label', 'Visa', 'lender', 'Galicia', 'currency', 'ARS',
      'balance', '250000.5', 'installment', '25000', 'next_due_on', '2026-10-20'))),
  'a9000000-0000-4000-8000-0000000000a1'::uuid,
  'a user confirms their card statement'
);

SELECT results_eq(
  $$ SELECT (SELECT status::text FROM public.imports WHERE id = 'a9000000-0000-4000-8000-0000000000a1'),
            (SELECT string_agg(kind || ':' || label || ':' || balance::text || ':' || next_due_on, ',')
             FROM public.liabilities) $$,
  $$ VALUES ('confirmed', 'credit_card:Visa:250000.50000000:2026-10-20') $$,
  'with a new card debt, and the import marked confirmed'
);

SELECT is(
  pg_temp.error_of($$ SELECT public.confirm_import_debts('a9000000-0000-4000-8000-0000000000a1', '[]') $$),
  'PT404',
  'a card statement is confirmed once'
);

-- Updating Beto's card debt is refused, and refuses the whole import.
SELECT is(
  pg_temp.error_of($$ SELECT public.confirm_import_debts('a9000000-0000-4000-8000-0000000000a2',
    jsonb_build_array(
      jsonb_build_object('liability_id', NULL, 'label', 'Master', 'currency', 'USD',
                         'balance', '10'),
      jsonb_build_object('liability_id', 'b4000000-0000-4000-8000-0000000000b4',
                         'currency', 'ARS', 'balance', '1'))) $$),
  'PT404',
  'a user never updates another user''s debt'
);

SELECT results_eq(
  $$ SELECT (SELECT status::text FROM public.imports WHERE id = 'a9000000-0000-4000-8000-0000000000a2'),
            (SELECT count(*)::int FROM public.liabilities) $$,
  $$ VALUES ('ready', 1) $$,
  'and writes none of its debts'
);

-- Her own card debt in pesos takes the new balance; nothing else about it moves.
SELECT lives_ok(
  $$ SELECT public.confirm_import_debts('a9000000-0000-4000-8000-0000000000a2',
       jsonb_build_array(jsonb_build_object(
         'liability_id', (SELECT id FROM public.liabilities), 'label', 'Otra', 'currency', 'ARS',
         'balance', '300000', 'installment', '30000', 'next_due_on', '2026-11-20'))) $$,
  'a user updates their own card debt from a statement'
);

SELECT results_eq(
  $$ SELECT label, balance::text, installment::text, next_due_on::text FROM public.liabilities $$,
  $$ VALUES ('Visa', '300000.00000000', '30000.00000000', '2026-11-20') $$,
  'its balance, minimum payment and due date, keeping its name'
);

-- A statement that gives no minimum payment or due date keeps the debt's own.
SELECT lives_ok(
  $$ SELECT public.confirm_import_debts('a9000000-0000-4000-8000-0000000000a3',
       jsonb_build_array(jsonb_build_object(
         'liability_id', (SELECT id FROM public.liabilities), 'currency', 'ARS',
         'balance', '310000', 'installment', NULL, 'next_due_on', NULL))) $$,
  'a statement with no minimum payment or due date updates a card debt'
);

SELECT results_eq(
  $$ SELECT balance::text, installment::text, next_due_on::text FROM public.liabilities $$,
  $$ VALUES ('310000.00000000', '30000.00000000', '2026-11-20') $$,
  'keeping the minimum payment and due date it had'
);

SELECT * FROM finish();
ROLLBACK;
