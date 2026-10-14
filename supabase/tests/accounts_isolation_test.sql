-- Accounts (source_connections): each user reads and writes only their own;
-- an account points only at its user's portfolio; the portfolio setup
-- triggers lock per user, stamp archives and keep an active account's
-- portfolio active.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(46);

-- The hint a statement raises, or NULL if it succeeds.
CREATE FUNCTION pg_temp.hint_of(statement text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE hint text;
BEGIN
  EXECUTE statement;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS hint = PG_EXCEPTION_HINT;
  RETURN hint;
END
$f$;

-- The SQLSTATE and hint a statement raises, or NULL if it succeeds.
CREATE FUNCTION pg_temp.error_of(statement text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE state text; hint text;
BEGIN
  EXECUTE statement;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS state = RETURNED_SQLSTATE, hint = PG_EXCEPTION_HINT;
  RETURN state || ' ' || coalesce(nullif(hint, ''), '-');
END
$f$;

-- Whether this backend holds the portfolio setup lock of a user.
CREATE FUNCTION pg_temp.holds_setup_lock(owner uuid) RETURNS boolean LANGUAGE sql AS $f$
  SELECT EXISTS (
    SELECT 1 FROM pg_locks l
    WHERE l.locktype = 'advisory' AND l.granted AND l.objsubid = 1
      AND l.pid = pg_backend_pid()
      AND (l.classid::bigint << 32 | l.objid::bigint)
          = hashtextextended('plant.portfolio_setup:' || owner::text, 0))
$f$;

-- The privileges authenticated holds on a table and its columns.
CREATE FUNCTION pg_temp.acl(rel regclass) RETURNS SETOF text LANGUAGE sql AS $f$
  SELECT '(table):' || acl.privilege_type || CASE WHEN acl.is_grantable THEN '+grant' ELSE '' END
  FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl
  WHERE c.oid = rel AND acl.grantee = 'authenticated'::regrole
  UNION ALL
  SELECT a.attname || ':' || acl.privilege_type || CASE WHEN acl.is_grantable THEN '+grant' ELSE '' END
  FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl
  WHERE a.attrelid = rel AND NOT a.attisdropped AND acl.grantee = 'authenticated'::regrole
$f$;

GRANT EXECUTE ON FUNCTION pg_temp.hint_of(text), pg_temp.error_of(text) TO authenticated;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at)
VALUES
  ('a0000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ana@pgtap.invalid', '', now(), '{}', '{}', now(), now()),
  ('b0000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'beto@pgtap.invalid', '', now(), '{}', '{}', now(), now());

-- Fixed ids for the rows the cases name. Each user has "Principal" from
-- signup, an archived portfolio and accounts.
UPDATE public.portfolios SET id = 'a1000000-0000-4000-8000-0000000000a1'
WHERE user_id = 'a0000000-0000-4000-8000-00000000000a';
UPDATE public.portfolios SET id = 'b1000000-0000-4000-8000-0000000000b1'
WHERE user_id = 'b0000000-0000-4000-8000-00000000000b';
INSERT INTO public.portfolios (id, user_id, name, archived_at) VALUES
  ('a2000000-0000-4000-8000-0000000000a2', 'a0000000-0000-4000-8000-00000000000a', 'Vieja', now()),
  ('b2000000-0000-4000-8000-0000000000b2', 'b0000000-0000-4000-8000-00000000000b', 'Vieja', now());
INSERT INTO public.source_connections (id, user_id, institution, default_portfolio_id) VALUES
  ('a5000000-0000-4000-8000-0000000000a5', 'a0000000-0000-4000-8000-00000000000a', 'IOL',
   'a1000000-0000-4000-8000-0000000000a1'),
  ('a6000000-0000-4000-8000-0000000000a6', 'a0000000-0000-4000-8000-00000000000a', 'Balanz',
   'a1000000-0000-4000-8000-0000000000a1'),
  ('b5000000-0000-4000-8000-0000000000b5', 'b0000000-0000-4000-8000-00000000000b', 'IOL',
   'b1000000-0000-4000-8000-0000000000b1');

-- ── What the API roles hold ─────────────────────────────────────────────────
SELECT hasnt_table('public', 'holders', 'there is no holders table');

SELECT hasnt_column('public', 'source_connections', 'holder_id', 'an account has no holder');

SELECT hasnt_function('private', 'guard_holder_write', 'there is no holder guard');

SELECT set_eq(
  $$ SELECT pg_temp.acl('public.source_connections') $$,
  ARRAY['(table):SELECT', '(table):DELETE',
        'institution:INSERT', 'include_in_tax_report:INSERT',
        'default_portfolio_id:INSERT', 'website:INSERT', 'icon:INSERT',
        'institution:UPDATE', 'include_in_tax_report:UPDATE',
        'default_portfolio_id:UPDATE', 'archived_at:UPDATE',
        'website:UPDATE', 'icon:UPDATE'],
  'a user reads and deletes accounts and writes only their fields and the archive flag'
);

-- The import job reads an account's institution (import_items_isolation_test.sql).
SELECT set_eq(
  $$ SELECT acl.grantee::regrole::text || ':(table):' || acl.privilege_type
     FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl
     WHERE c.oid = 'public.source_connections'::regclass
       AND acl.grantee IN ('anon'::regrole, 'service_role'::regrole, 0)
     UNION ALL
     SELECT acl.grantee::regrole::text || ':' || a.attname || ':' || acl.privilege_type
     FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl
     WHERE a.attrelid = 'public.source_connections'::regclass AND NOT a.attisdropped
       AND acl.grantee IN ('anon'::regrole, 'service_role'::regrole, 0) $$,
  ARRAY['service_role:id:SELECT', 'service_role:user_id:SELECT', 'service_role:institution:SELECT'],
  'anon and PUBLIC hold nothing on the table or its columns, the service role only reads an account''s institution'
);

-- ── Shape ───────────────────────────────────────────────────────────────────
SELECT ok(
  (SELECT bool_and(NOT p.prosecdef AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=""'])
   FROM pg_proc p
   WHERE p.oid IN ('private.guard_portfolio_write()'::regprocedure,
                   'private.guard_source_connection_write()'::regprocedure)),
  'the guards run as the caller with an empty search_path'
);

SELECT is_empty(
  $$ SELECT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) acl
     JOIN pg_roles r ON r.oid = acl.grantee
     WHERE p.oid IN ('private.guard_portfolio_write()'::regprocedure,
                       'private.guard_source_connection_write()'::regprocedure)
       AND r.rolname IN ('anon', 'authenticated', 'service_role') $$,
  'no API role may execute the guards'
);

SELECT results_eq(
  $$ SELECT t.tgenabled::text || ' ' || pg_get_triggerdef(t.oid) FROM pg_trigger t
     WHERE t.tgrelid = 'public.source_connections'::regclass AND NOT t.tgisinternal
     ORDER BY t.tgname $$,
  ARRAY[
    'O CREATE TRIGGER portfolio_setup_1_lock BEFORE INSERT OR UPDATE ON public.source_connections FOR EACH ROW EXECUTE FUNCTION private.lock_portfolio_setup()',
    'O CREATE TRIGGER portfolio_setup_2_stamp BEFORE UPDATE ON public.source_connections FOR EACH ROW EXECUTE FUNCTION private.stamp_archived_at()',
    'O CREATE TRIGGER portfolio_setup_3_guard BEFORE INSERT OR UPDATE ON public.source_connections FOR EACH ROW EXECUTE FUNCTION private.guard_source_connection_write()',
    'O CREATE TRIGGER portfolio_setup_3_guard_delete BEFORE DELETE ON public.source_connections FOR EACH ROW EXECUTE FUNCTION private.guard_source_connection_delete()',
    'O CREATE TRIGGER source_connections_set_updated_at BEFORE UPDATE ON public.source_connections FOR EACH ROW EXECUTE FUNCTION private.set_updated_at()'
  ],
  'source_connections has the lock, stamp and guard triggers, all enabled'
);

-- Postgres renders BETWEEN as >= and <=.
SELECT set_eq(
  $$ SELECT conrelid::regclass || ' ' || pg_get_constraintdef(oid) FROM pg_constraint
     WHERE conrelid = 'public.source_connections'::regclass
       AND contype IN ('c', 'u', 'f') AND conname NOT LIKE '%user_id_fkey' $$,
  ARRAY['source_connections CHECK ((((char_length(institution) >= 1) AND (char_length(institution) <= 60)) AND (institution = btrim(institution))))',
        'source_connections UNIQUE (user_id, id)',
        'source_connections FOREIGN KEY (user_id, default_portfolio_id) REFERENCES portfolios(user_id, id)',
        'source_connections CHECK ((((char_length(website) >= 9) AND (char_length(website) <= 200)) AND (website ~ ''^https://[^\s]+$''::text)))',
        'source_connections CHECK (((char_length(icon) <= 87500) AND (icon ~ ''^data:image/(png|x-icon|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$''::text)))'],
  'an institution is bounded with no outer spaces, a site is https, an icon is an image''s data URL, and an account points only at its user''s portfolio'
);

-- ── The lock ────────────────────────────────────────────────────────────────
-- Caro signs up with the lock trigger off, so no lock of hers is held until
-- one of her writes takes it. A lock taken in a savepoint goes with it.
ALTER TABLE public.portfolios DISABLE TRIGGER portfolio_setup_1_lock;
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at)
VALUES ('c0000000-0000-4000-8000-00000000000c', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'caro@pgtap.invalid', '', now(), '{}', '{}', now(), now());
ALTER TABLE public.portfolios ENABLE TRIGGER portfolio_setup_1_lock;

SELECT ok(NOT pg_temp.holds_setup_lock('c0000000-0000-4000-8000-00000000000c'),
          'no lock is held for a user before a write');

SAVEPOINT account_lock;
INSERT INTO public.source_connections (user_id, institution, default_portfolio_id)
SELECT user_id, 'IOL', id FROM public.portfolios WHERE user_id = 'c0000000-0000-4000-8000-00000000000c';
SELECT ok(pg_temp.holds_setup_lock('c0000000-0000-4000-8000-00000000000c'),
          'an account insert takes the user''s lock');
ROLLBACK TO SAVEPOINT account_lock;

-- ── Signed in as Ana ────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

SELECT results_eq(
  $$ SELECT DISTINCT user_id FROM public.source_connections $$,
  $$ VALUES ('a0000000-0000-4000-8000-00000000000a'::uuid) $$,
  'a user reads only their own accounts'
);

SELECT lives_ok(
  $$ INSERT INTO public.source_connections (institution, default_portfolio_id)
     VALUES ('Cocos', 'a1000000-0000-4000-8000-0000000000a1') $$,
  'a user creates an account'
);

SELECT results_eq(
  $$ SELECT user_id, include_in_tax_report FROM public.source_connections
     WHERE institution = 'Cocos' $$,
  $$ VALUES ('a0000000-0000-4000-8000-00000000000a'::uuid, true) $$,
  'the new account is the user''s and is in the tax report by default'
);

SELECT throws_ok(
  $$ INSERT INTO public.source_connections (institution, default_portfolio_id)
     VALUES (' IOL', 'a1000000-0000-4000-8000-0000000000a1') $$,
  '23514', NULL,
  'an institution has no outer spaces'
);

-- Another user's row and a random id answer alike: the foreign key, with no
-- hint, never the guard's PT409 that would tell an archived row apart.
SELECT is(
  pg_temp.error_of($$ INSERT INTO public.source_connections (institution, default_portfolio_id)
                      VALUES ('IOL', 'b2000000-0000-4000-8000-0000000000b2') $$),
  '23503 -',
  'an account cannot default to another user''s archived portfolio'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.source_connections (institution, default_portfolio_id)
                      VALUES ('IOL', 'b1000000-0000-4000-8000-0000000000b1') $$),
  '23503 -',
  'an account cannot default to another user''s active portfolio'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.source_connections (institution, default_portfolio_id)
                      VALUES ('IOL', gen_random_uuid()) $$),
  '23503 -',
  'an account cannot default to a portfolio that does not exist'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.source_connections
                      SET default_portfolio_id = 'b2000000-0000-4000-8000-0000000000b2'
                      WHERE id = 'a5000000-0000-4000-8000-0000000000a5' $$),
  '23503 -',
  'an account cannot be moved to another user''s archived portfolio'
);

SELECT is(
  pg_temp.hint_of($$ INSERT INTO public.source_connections (institution, default_portfolio_id)
                     VALUES ('IOL', 'a2000000-0000-4000-8000-0000000000a2') $$),
  'portfolio_archived',
  'a new account cannot default to an archived portfolio'
);

SELECT is(
  pg_temp.hint_of($$ UPDATE public.source_connections
                     SET default_portfolio_id = 'a2000000-0000-4000-8000-0000000000a2'
                     WHERE id = 'a5000000-0000-4000-8000-0000000000a5' $$),
  'portfolio_archived',
  'an account cannot move to an archived portfolio'
);

SELECT is(
  pg_temp.hint_of($$ UPDATE public.portfolios SET archived_at = now()
                     WHERE id = 'a1000000-0000-4000-8000-0000000000a1' $$),
  'last_active_portfolio',
  'the last active portfolio raises its own hint first, even when an account uses it'
);

SELECT lives_ok(
  $$ INSERT INTO public.portfolios (name) VALUES ('Largo plazo') $$,
  'a user creates a second portfolio'
);

SELECT is(
  pg_temp.hint_of($$ UPDATE public.portfolios SET archived_at = now()
                     WHERE id = 'a1000000-0000-4000-8000-0000000000a1' $$),
  'portfolio_in_use',
  'a portfolio an active account defaults to cannot be archived'
);

SELECT lives_ok(
  $$ UPDATE public.source_connections
     SET default_portfolio_id = (SELECT id FROM public.portfolios WHERE name = 'Largo plazo'),
         institution = 'IOL Inversiones', include_in_tax_report = false
     WHERE id = 'a5000000-0000-4000-8000-0000000000a5' $$,
  'a user edits their account'
);

-- Archiving IOL leaves Largo plazo with no active account.
UPDATE public.source_connections SET archived_at = '2000-01-01'
WHERE id = 'a5000000-0000-4000-8000-0000000000a5';

SELECT ok(
  (SELECT archived_at = now() FROM public.source_connections
   WHERE id = 'a5000000-0000-4000-8000-0000000000a5'),
  'archiving an account stamps the server''s time'
);

SELECT lives_ok(
  $$ UPDATE public.portfolios SET archived_at = now()
     WHERE name = 'Largo plazo' $$,
  'a portfolio only archived accounts default to can be archived'
);

SELECT lives_ok(
  $$ UPDATE public.source_connections SET include_in_tax_report = true
     WHERE id = 'a5000000-0000-4000-8000-0000000000a5' $$,
  'an archived account onto an archived portfolio can still be edited while archived'
);

-- With the portfolio unchanged, only the restore itself makes the guard check it.
SELECT is(
  pg_temp.hint_of($$ UPDATE public.source_connections SET archived_at = NULL
                     WHERE id = 'a5000000-0000-4000-8000-0000000000a5' $$),
  'portfolio_archived',
  'restoring an account onto an archived portfolio is refused'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.source_connections
                      SET archived_at = NULL, default_portfolio_id = 'b2000000-0000-4000-8000-0000000000b2'
                      WHERE id = 'a5000000-0000-4000-8000-0000000000a5' $$),
  '23503 -',
  'restoring an account onto another user''s archived portfolio fails on the foreign key'
);

SELECT lives_ok(
  $$ UPDATE public.source_connections
     SET archived_at = NULL, default_portfolio_id = 'a1000000-0000-4000-8000-0000000000a1'
     WHERE id = 'a5000000-0000-4000-8000-0000000000a5' $$,
  'an account is restored onto an active portfolio'
);

SELECT throws_ok(
  $$ INSERT INTO public.source_connections (user_id, institution, default_portfolio_id)
     VALUES ('b0000000-0000-4000-8000-00000000000b', 'IOL', 'b1000000-0000-4000-8000-0000000000b1') $$,
  '42501', 'permission denied for table source_connections',
  'a user cannot create an account for another user'
);

SELECT throws_ok(
  $$ INSERT INTO public.source_connections (institution, default_portfolio_id, archived_at)
     VALUES ('IOL', 'a1000000-0000-4000-8000-0000000000a1', now()) $$,
  '42501', 'permission denied for table source_connections',
  'a user cannot create an archived account, which would skip the guard''s checks'
);

SELECT throws_ok(
  $$ UPDATE public.source_connections SET id = gen_random_uuid(), created_at = now() $$,
  '42501', 'permission denied for table source_connections',
  'a user cannot rewrite an account''s id or creation time'
);

-- Updates with no WHERE reach only the user's own rows: every row an update
-- touches gets a new ctid, so Beto's must keep theirs.
RESET ROLE;
CREATE TEMP TABLE beto_ctids ON COMMIT DROP AS
  SELECT id, ctid::text AS row_ctid FROM public.source_connections
  WHERE user_id = 'b0000000-0000-4000-8000-00000000000b';
GRANT SELECT ON beto_ctids TO authenticated;
SET LOCAL ROLE authenticated;

UPDATE public.source_connections SET institution = institution || '';

RESET ROLE;

SELECT set_eq(
  $$ SELECT id, ctid::text AS row_ctid FROM public.source_connections
     WHERE user_id = 'b0000000-0000-4000-8000-00000000000b' $$,
  $$ SELECT id, row_ctid FROM beto_ctids $$,
  'updates with no WHERE leave another user''s accounts untouched'
);

SELECT is(
  (SELECT count(*) FROM beto_ctids),
  1::bigint,
  'the other user has an account to compare'
);

-- ── Signed in as Beto ───────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'b0000000-0000-4000-8000-00000000000b', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

SELECT is_empty(
  $$ UPDATE public.source_connections SET archived_at = now()
     WHERE user_id = 'a0000000-0000-4000-8000-00000000000a' RETURNING id $$,
  'a user cannot archive another user''s account'
);

RESET ROLE;

-- ── Past RLS ────────────────────────────────────────────────────────────────
-- The guards key on the row's user. Beto's claims stay set here: a guard that
-- read auth.uid() would look at his rows and let these through.
UPDATE public.portfolios SET archived_at = NULL
WHERE user_id = 'a0000000-0000-4000-8000-00000000000a' AND name = 'Largo plazo';

SELECT is(
  pg_temp.hint_of($$ UPDATE public.portfolios SET archived_at = now()
                     WHERE id = 'a1000000-0000-4000-8000-0000000000a1' $$),
  'portfolio_in_use',
  'the portfolio guard looks at the row''s user''s accounts, not the caller''s'
);

UPDATE public.source_connections SET archived_at = now()
WHERE id = 'a6000000-0000-4000-8000-0000000000a6';

SELECT is(
  pg_temp.hint_of($$ UPDATE public.source_connections
                     SET archived_at = NULL, default_portfolio_id = 'a2000000-0000-4000-8000-0000000000a2'
                     WHERE id = 'a6000000-0000-4000-8000-0000000000a6' $$),
  'portfolio_archived',
  'the account guard looks at the row''s user''s portfolio, not the caller''s'
);

INSERT INTO public.holdings (user_id, source_connection_id, portfolio_id, asset_class, amount, currency)
VALUES ('a0000000-0000-4000-8000-00000000000a', 'a5000000-0000-4000-8000-0000000000a5',
        'a1000000-0000-4000-8000-0000000000a1', 'cash', 1, 'ARS');

SELECT is(
  pg_temp.hint_of($$ UPDATE public.source_connections SET archived_at = now()
                     WHERE id = 'a5000000-0000-4000-8000-0000000000a5' $$),
  'source_connection_has_holdings',
  'the account guard looks at the row''s user''s holdings, not the caller''s'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.source_connections (user_id, institution, default_portfolio_id)
                      VALUES ('a0000000-0000-4000-8000-00000000000a', 'IOL',
                              'b2000000-0000-4000-8000-0000000000b2') $$),
  '23503 -',
  'past RLS, an account still cannot default to another user''s portfolio'
);

-- ── The policies, past the column grants ────────────────────────────────────
-- The grants already stop a user from naming user_id or id, so these grant
-- them (rolled back with the test) to prove the policies stop the writes on
-- their own.
GRANT INSERT (id, user_id), UPDATE (user_id) ON TABLE public.source_connections TO authenticated;

SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$ INSERT INTO public.source_connections (user_id, institution, default_portfolio_id)
     VALUES ('b0000000-0000-4000-8000-00000000000b', 'IOL', 'b1000000-0000-4000-8000-0000000000b1') $$,
  '42501', 'new row violates row-level security policy for table "source_connections"',
  'the insert policy rejects an account for another user'
);

SELECT throws_ok(
  $$ UPDATE public.source_connections SET user_id = 'b0000000-0000-4000-8000-00000000000b' $$,
  '42501', 'new row violates row-level security policy for table "source_connections"',
  'the update policy rejects moving an account to another user'
);

SELECT throws_ok(
  $$ INSERT INTO public.source_connections (id, user_id, institution, default_portfolio_id)
     VALUES ('b5000000-0000-4000-8000-0000000000b5', 'a0000000-0000-4000-8000-00000000000a', 'IOL',
             'a1000000-0000-4000-8000-0000000000a1')
     ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id $$,
  '42501', 'new row violates row-level security policy (USING expression) for table "source_connections"',
  'an upsert cannot take over another user''s account by id'
);

RESET ROLE;

SELECT is(
  (SELECT user_id FROM public.source_connections WHERE id = 'b5000000-0000-4000-8000-0000000000b5'),
  'b0000000-0000-4000-8000-00000000000b'::uuid,
  'the other user''s account stays theirs'
);

-- ── Account deletion ────────────────────────────────────────────────────────
DELETE FROM auth.users WHERE id = 'a0000000-0000-4000-8000-00000000000a';

SELECT is_empty(
  $$ SELECT 1 FROM public.source_connections WHERE user_id = 'a0000000-0000-4000-8000-00000000000a'
     UNION ALL
     SELECT 1 FROM public.portfolios WHERE user_id = 'a0000000-0000-4000-8000-00000000000a' $$,
  'deleting the account deletes its accounts and portfolios'
);

SELECT * FROM finish();
ROLLBACK;
