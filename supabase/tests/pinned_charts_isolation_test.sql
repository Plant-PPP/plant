-- Pinned charts: what a user may write, that each user reads and deletes only
-- their own, that a chart is pinned once, and that one of a portfolio goes
-- with it.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(12);

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

-- The SQLSTATE and hint a statement raises, or NULL if it succeeds.
CREATE FUNCTION pg_temp.refusal_of(statement text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE state text; hint text;
BEGIN
  EXECUTE statement;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS state = RETURNED_SQLSTATE, hint = PG_EXCEPTION_HINT;
  RETURN state || ' ' || coalesce(nullif(hint, ''), '-');
END
$f$;

GRANT EXECUTE ON FUNCTION pg_temp.error_of(text) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.refusal_of(text) TO authenticated;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at)
VALUES
  ('a0000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ana@pgtap.invalid', '', now(), '{}', '{}', now(), now()),
  ('b0000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'beto@pgtap.invalid', '', now(), '{}', '{}', now(), now());

-- Ana has four more portfolios to pin charts of.
INSERT INTO public.portfolios (user_id, name)
SELECT 'a0000000-0000-4000-8000-00000000000a', 'Cartera ' || n FROM generate_series(1, 4) n;

-- Beto pinned his net worth.
INSERT INTO public.pinned_charts (user_id, topic)
VALUES ('b0000000-0000-4000-8000-00000000000b', 'net_worth');

-- ── What the API roles hold ─────────────────────────────────────────────────
SELECT set_eq(
  $$ SELECT pg_temp.acl('public.pinned_charts', 'authenticated') $$,
  ARRAY['(table):SELECT', '(table):DELETE', 'topic:INSERT', 'portfolio_id:INSERT'],
  'a user reads, deletes and pins a chart, never naming its owner or id'
);

SELECT is_empty(
  $$ SELECT pg_temp.acl('public.pinned_charts', 'anon')
     UNION ALL SELECT pg_temp.acl('public.pinned_charts', 'service_role')
     UNION ALL SELECT acl.privilege_type FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl
     WHERE c.oid = 'public.pinned_charts'::regclass AND acl.grantee = 0 $$,
  'anon, the service role and PUBLIC hold nothing on pinned charts'
);

-- ── Signed in as Ana ────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

INSERT INTO public.pinned_charts (topic) VALUES ('allocation');
INSERT INTO public.pinned_charts (topic, portfolio_id)
SELECT 'holdings', id FROM public.portfolios WHERE name NOT LIKE 'Cartera %' LIMIT 1;

SELECT results_eq(
  $$ SELECT topic, portfolio_id IS NOT NULL FROM public.pinned_charts ORDER BY topic $$,
  $$ VALUES ('allocation', false), ('holdings', true) $$,
  'a user pins a chart of the whole and one of a portfolio, and reads only their own'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.pinned_charts (topic) VALUES ('allocation') $$),
  '23505',
  'a chart is pinned once'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.pinned_charts (topic) VALUES ('anything') $$),
  '23514',
  'only a chart the assistant draws is pinned'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.pinned_charts (topic, portfolio_id)
                      SELECT 'allocation', id FROM public.portfolios
                      WHERE user_id = 'b0000000-0000-4000-8000-00000000000b' $$),
  NULL,
  'another user''s portfolio is not seen, so nothing is pinned of it'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.pinned_charts (topic, portfolio_id)
                      VALUES ('allocation', 'b1000000-0000-4000-8000-0000000000b1') $$),
  '23503',
  'a chart of a portfolio that is not the user''s is refused'
);

-- Ana's 2 pins, 4 of the whole and 6 of three more portfolios make 12.
INSERT INTO public.pinned_charts (topic)
VALUES ('net_worth'), ('income'), ('debts'), ('holdings');
INSERT INTO public.pinned_charts (topic, portfolio_id)
SELECT t.topic, p.id
FROM (VALUES ('allocation'), ('holdings')) t (topic)
CROSS JOIN (SELECT id FROM public.portfolios WHERE name IN ('Cartera 1', 'Cartera 2', 'Cartera 3')) p;

SELECT is(
  (SELECT count(*)::int FROM public.pinned_charts),
  12,
  'a user pins up to 12 charts'
);

SELECT is(
  pg_temp.refusal_of($$ INSERT INTO public.pinned_charts (topic, portfolio_id)
                        SELECT 'allocation', id FROM public.portfolios WHERE name = 'Cartera 4' $$),
  'P0001 pinned_charts_full',
  'and no more'
);

DELETE FROM public.pinned_charts;

RESET ROLE;

SELECT results_eq(
  $$ SELECT user_id::text, topic FROM public.pinned_charts $$,
  $$ VALUES ('b0000000-0000-4000-8000-00000000000b', 'net_worth') $$,
  'deleting removes only the user''s own'
);

-- ── Enrolled in MFA but signed in at aal1 ───────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'b0000000-0000-4000-8000-00000000000b', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', true)::text, true);
SET LOCAL ROLE authenticated;

SELECT is_empty(
  $$ SELECT id FROM public.pinned_charts $$,
  'a user enrolled in MFA reads no pinned chart before the second factor'
);

RESET ROLE;

-- ── A portfolio's chart goes with it ────────────────────────────────────────
INSERT INTO public.pinned_charts (user_id, topic, portfolio_id)
SELECT user_id, 'holdings', id FROM public.portfolios
WHERE user_id = 'b0000000-0000-4000-8000-00000000000b' LIMIT 1;
ALTER TABLE public.portfolios DISABLE TRIGGER USER;
DELETE FROM public.portfolios WHERE user_id = 'b0000000-0000-4000-8000-00000000000b';
ALTER TABLE public.portfolios ENABLE TRIGGER USER;

SELECT is(
  (SELECT count(*)::int FROM public.pinned_charts WHERE topic = 'holdings'),
  0,
  'deleting a portfolio removes its pinned charts'
);

SELECT * FROM finish();
ROLLBACK;
