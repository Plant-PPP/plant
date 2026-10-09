-- Portfolios: each user reads and writes only their own, starts with
-- "Principal" and always keeps one active; the shared portfolio setup triggers
-- lock per user, stamp archives and guard the last active portfolio.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(42);

-- The hint a statement raises, or NULL if it succeeds. throws_ok checks only
-- the code and the message, and the app maps the hint to its copy.
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

-- Whether this backend holds the portfolio setup lock of a user.
CREATE FUNCTION pg_temp.holds_setup_lock(owner uuid) RETURNS boolean LANGUAGE sql AS $f$
  SELECT EXISTS (
    SELECT 1 FROM pg_locks l
    WHERE l.locktype = 'advisory' AND l.granted AND l.objsubid = 1
      AND l.pid = pg_backend_pid()
      AND (l.classid::bigint << 32 | l.objid::bigint)
          = hashtextextended('plant.portfolio_setup:' || owner::text, 0))
$f$;

GRANT EXECUTE ON FUNCTION pg_temp.hint_of(text) TO authenticated;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at)
VALUES
  ('a0000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ana@pgtap.invalid', '', now(), '{}', '{}', now(), now()),
  ('b0000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'beto@pgtap.invalid', '', now(), '{}', '{}', now(), now());

-- ── What the API roles hold ─────────────────────────────────────────────────
-- Only the user's name and the archive flag are theirs to write: an insert
-- that could set archived_at would skip the stamp trigger, which fires on
-- update only, and created_at would no longer be the server's.
SELECT set_eq(
  $$ SELECT '(table):' || acl.privilege_type
              || CASE WHEN acl.is_grantable THEN '+grant' ELSE '' END
     FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl
     WHERE c.oid = 'public.portfolios'::regclass AND acl.grantee = 'authenticated'::regrole
     UNION ALL
     SELECT a.attname || ':' || acl.privilege_type
              || CASE WHEN acl.is_grantable THEN '+grant' ELSE '' END
     FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl
     WHERE a.attrelid = 'public.portfolios'::regclass AND acl.grantee = 'authenticated'::regrole $$,
  ARRAY['(table):SELECT', 'name:INSERT', 'name:UPDATE', 'archived_at:UPDATE'],
  'a user reads portfolios, inserts a name and updates the name and the archive flag'
);

SELECT is_empty(
  $$ SELECT acl.grantee::regrole::text FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl
     WHERE c.oid = 'public.portfolios'::regclass
       AND acl.grantee IN ('anon'::regrole, 'service_role'::regrole, 0)
     UNION ALL
     SELECT acl.grantee::regrole::text FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl
     WHERE a.attrelid = 'public.portfolios'::regclass
       AND acl.grantee IN ('anon'::regrole, 'service_role'::regrole, 0) $$,
  'anon, the service role and PUBLIC hold nothing on the table or its columns'
);

-- ── Shape ───────────────────────────────────────────────────────────────────
SELECT ok(
  (SELECT bool_and(NOT p.prosecdef AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=""'])
   FROM pg_proc p
   WHERE p.oid IN ('private.lock_portfolio_setup()'::regprocedure,
                   'private.stamp_archived_at()'::regprocedure,
                   'private.guard_portfolio_write()'::regprocedure)),
  'the portfolio setup trigger functions run as the caller with an empty search_path'
);

SELECT ok(
  position('pg_catalog.hashtextextended(''plant.portfolio_setup:'' || NEW.user_id::text, 0)'
           IN (SELECT prosrc FROM pg_proc WHERE oid = 'private.lock_portfolio_setup()'::regprocedure)) > 0,
  'the lock is keyed on the row''s user'
);

-- BEFORE triggers fire in name order, so this list is also the firing order.
SELECT results_eq(
  $$ SELECT t.tgenabled::text || ' ' || pg_get_triggerdef(t.oid) FROM pg_trigger t
     WHERE t.tgrelid = 'public.portfolios'::regclass AND NOT t.tgisinternal
     ORDER BY t.tgname $$,
  ARRAY[
    'O CREATE TRIGGER portfolio_setup_1_lock BEFORE INSERT OR UPDATE ON public.portfolios FOR EACH ROW EXECUTE FUNCTION private.lock_portfolio_setup()',
    'O CREATE TRIGGER portfolio_setup_2_stamp BEFORE UPDATE ON public.portfolios FOR EACH ROW EXECUTE FUNCTION private.stamp_archived_at()',
    'O CREATE TRIGGER portfolio_setup_3_guard BEFORE UPDATE ON public.portfolios FOR EACH ROW EXECUTE FUNCTION private.guard_portfolio_write()',
    'O CREATE TRIGGER portfolios_set_updated_at BEFORE UPDATE ON public.portfolios FOR EACH ROW EXECUTE FUNCTION private.set_updated_at()'
  ],
  'portfolios fires lock, stamp, guard and then updated_at, all enabled'
);

-- Postgres renders BETWEEN as >= and <=.
SELECT set_eq(
  $$ SELECT conrelid::regclass || ' ' || pg_get_constraintdef(oid) FROM pg_constraint
     WHERE conrelid = 'public.portfolios'::regclass AND contype IN ('c', 'u') $$,
  ARRAY['portfolios CHECK ((((char_length(name) >= 1) AND (char_length(name) <= 40)) AND (name = btrim(name))))',
        'portfolios UNIQUE (user_id, id)'],
  'a name is 1 to 40 characters with no outer spaces, and (user_id, id) is unique'
);

SELECT is_empty(
  $$ SELECT u.id FROM auth.users u
     WHERE NOT EXISTS (SELECT 1 FROM public.portfolios p
                       WHERE p.user_id = u.id AND p.archived_at IS NULL) $$,
  'every user has an active portfolio'
);

SELECT results_eq(
  $$ SELECT user_id, name FROM public.portfolios
     WHERE user_id IN ('a0000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-00000000000b')
     ORDER BY user_id $$,
  $$ VALUES ('a0000000-0000-4000-8000-00000000000a'::uuid, 'Principal'::text),
            ('b0000000-0000-4000-8000-00000000000b'::uuid, 'Principal'::text) $$,
  'signing up creates "Principal"'
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

SAVEPOINT update_lock;
UPDATE public.portfolios SET name = 'Caro' WHERE user_id = 'c0000000-0000-4000-8000-00000000000c';
SELECT ok(pg_temp.holds_setup_lock('c0000000-0000-4000-8000-00000000000c'),
          'an update takes the user''s lock');
ROLLBACK TO SAVEPOINT update_lock;

SELECT ok(NOT pg_temp.holds_setup_lock('c0000000-0000-4000-8000-00000000000c'),
          'the lock goes with the savepoint');

SAVEPOINT insert_lock;
INSERT INTO public.portfolios (user_id, name) VALUES ('c0000000-0000-4000-8000-00000000000c', 'Otra');
SELECT ok(pg_temp.holds_setup_lock('c0000000-0000-4000-8000-00000000000c'),
          'an insert takes the user''s lock');
ROLLBACK TO SAVEPOINT insert_lock;

-- ── Signed in as Ana ────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

SELECT results_eq(
  $$ SELECT user_id FROM public.portfolios $$,
  $$ VALUES ('a0000000-0000-4000-8000-00000000000a'::uuid) $$,
  'a user reads only their own portfolios'
);

SELECT lives_ok(
  $$ INSERT INTO public.portfolios (name) VALUES ('Largo plazo') $$,
  'a user creates a portfolio'
);

SELECT lives_ok(
  $$ UPDATE public.portfolios SET name = 'Corto plazo' WHERE name = 'Largo plazo' $$,
  'a user renames their portfolio'
);

SELECT results_eq(
  $$ SELECT user_id, name FROM public.portfolios WHERE name = 'Corto plazo' $$,
  $$ VALUES ('a0000000-0000-4000-8000-00000000000a'::uuid, 'Corto plazo'::text) $$,
  'the new portfolio is the user''s, with its new name'
);

SELECT throws_ok(
  $$ INSERT INTO public.portfolios (user_id, name) VALUES ('b0000000-0000-4000-8000-00000000000b', 'Ajena') $$,
  '42501', 'permission denied for table portfolios',
  'a user cannot create a portfolio for another user'
);

SELECT throws_ok(
  $$ UPDATE public.portfolios SET user_id = 'b0000000-0000-4000-8000-00000000000b' $$,
  '42501', 'permission denied for table portfolios',
  'a user cannot move a portfolio to another user'
);

SELECT throws_ok(
  $$ UPDATE public.portfolios SET id = gen_random_uuid(), created_at = now() $$,
  '42501', 'permission denied for table portfolios',
  'a user cannot rewrite a portfolio''s id or creation time'
);

SELECT throws_ok(
  $$ DELETE FROM public.portfolios $$,
  '42501', 'permission denied for table portfolios',
  'a user cannot delete portfolios'
);

SELECT throws_ok(
  $$ INSERT INTO public.portfolios (name) VALUES ('CORTO PLAZO') $$,
  '23505', NULL,
  'two active portfolios of one user cannot share a name, in any case'
);

-- lower() follows the database's locale: accented capitals must fold too.
SELECT throws_ok(
  $$ INSERT INTO public.portfolios (name) VALUES ('Ñandú'), ('ÑANDÚ') $$,
  '23505', NULL,
  'names that differ only in accented capitals collide'
);

SELECT throws_ok(
  $$ INSERT INTO public.portfolios (name) VALUES (' Espacios ') $$,
  '23514', NULL,
  'a name has no outer spaces'
);

-- The time the client sends is ignored: the trigger stamps the archive.
UPDATE public.portfolios SET archived_at = '2000-01-01' WHERE name = 'Corto plazo';

SELECT ok(
  (SELECT archived_at = now() FROM public.portfolios WHERE name = 'Corto plazo'),
  'archiving stamps the server''s time'
);

SELECT lives_ok(
  $$ INSERT INTO public.portfolios (name) VALUES ('Corto plazo') $$,
  'an archived portfolio''s name can be reused'
);

SELECT is(
  pg_temp.hint_of($$ UPDATE public.portfolios SET archived_at = now() $$),
  'last_active_portfolio',
  'archiving every active portfolio is refused with its hint'
);

SELECT throws_ok(
  $$ UPDATE public.portfolios SET archived_at = now() $$,
  'PT409', 'a user keeps at least one active portfolio',
  'archiving every active portfolio raises PT409'
);

-- An update with no WHERE reaches only the user's own rows: every row an
-- update touches gets a new ctid, so Beto's must keep theirs.
RESET ROLE;
CREATE TEMP TABLE beto_ctids ON COMMIT DROP AS
  SELECT id, ctid::text AS row_ctid FROM public.portfolios
  WHERE user_id = 'b0000000-0000-4000-8000-00000000000b';
GRANT SELECT ON beto_ctids TO authenticated;
SET LOCAL ROLE authenticated;

UPDATE public.portfolios SET name = name || '';

RESET ROLE;

SELECT set_eq(
  $$ SELECT id, ctid::text AS row_ctid FROM public.portfolios
     WHERE user_id = 'b0000000-0000-4000-8000-00000000000b' $$,
  $$ SELECT id, row_ctid FROM beto_ctids $$,
  'an update with no WHERE leaves another user''s portfolios untouched'
);

SELECT ok(
  (SELECT count(*) FROM beto_ctids) > 0,
  'the other user has portfolios to compare'
);

-- ── Signed in as Beto ───────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'b0000000-0000-4000-8000-00000000000b', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$ INSERT INTO public.portfolios (name) VALUES ('Corto plazo') $$,
  'another user may use the same name'
);

SELECT is_empty(
  $$ UPDATE public.portfolios SET name = 'Tomada'
     WHERE user_id = 'a0000000-0000-4000-8000-00000000000a' RETURNING id $$,
  'a user cannot rename another user''s portfolio'
);

SELECT is_empty(
  $$ UPDATE public.portfolios SET archived_at = now()
     WHERE user_id = 'a0000000-0000-4000-8000-00000000000a' RETURNING id $$,
  'a user cannot archive another user''s portfolio'
);

RESET ROLE;

-- ── Past RLS ────────────────────────────────────────────────────────────────
-- The guard keys on the row's user, so it holds for the owner and the signup
-- function too, whoever's claims are set. Beto's claims stay set here: a guard
-- that read auth.uid() would count his portfolios and let this through.
SELECT is(
  pg_temp.hint_of($$ UPDATE public.portfolios SET archived_at = now()
                     WHERE user_id = 'a0000000-0000-4000-8000-00000000000a' $$),
  'last_active_portfolio',
  'the guard counts the row''s user''s portfolios, not the caller''s'
);

-- A re-archive keeps the first stamp. The first one is set in the past with
-- the stamp trigger off, so a trigger that rewrote it to now() fails this.
ALTER TABLE public.portfolios DISABLE TRIGGER portfolio_setup_2_stamp;
UPDATE public.portfolios SET archived_at = '2020-01-01'
WHERE user_id = 'a0000000-0000-4000-8000-00000000000a' AND archived_at IS NOT NULL;
ALTER TABLE public.portfolios ENABLE TRIGGER portfolio_setup_2_stamp;
UPDATE public.portfolios SET archived_at = now()
WHERE user_id = 'a0000000-0000-4000-8000-00000000000a' AND archived_at IS NOT NULL;

SELECT ok(
  (SELECT archived_at = '2020-01-01'::timestamptz FROM public.portfolios
   WHERE user_id = 'a0000000-0000-4000-8000-00000000000a' AND archived_at IS NOT NULL),
  're-archiving keeps the first archive time'
);

SELECT lives_ok(
  $$ UPDATE public.portfolios SET archived_at = NULL, name = 'Restaurada'
     WHERE user_id = 'a0000000-0000-4000-8000-00000000000a' AND archived_at IS NOT NULL $$,
  'an archived portfolio is restored'
);

SELECT is(
  (SELECT count(*) FROM public.portfolios
   WHERE user_id = 'a0000000-0000-4000-8000-00000000000a' AND archived_at IS NULL),
  3::bigint,
  'the restored portfolio is active again'
);

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at)
VALUES ('d0000000-0000-4000-8000-00000000000d', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'dani@pgtap.invalid', '', now(), '{}', '{}', now(), now());

SELECT results_eq(
  $$ SELECT name FROM public.portfolios WHERE user_id = 'd0000000-0000-4000-8000-00000000000d' $$,
  ARRAY['Principal'],
  'a user who signs up while other claims are set still gets "Principal"'
);

-- ── The policy, past the column grants ──────────────────────────────────────
-- The grants already stop a user from naming user_id or id, so these grant
-- them (rolled back with the test) to prove the policy stops the writes on its
-- own. Beto's row gets a fixed id and a name none of Ana's active rows has, so
-- an open USING would let the takeover through instead of hitting 23505.
UPDATE public.portfolios SET id = 'be000000-0000-4000-8000-0000000000be', name = 'De Beto'
WHERE user_id = 'b0000000-0000-4000-8000-00000000000b' AND name = 'Corto plazo';
GRANT INSERT (id, user_id), UPDATE (user_id) ON TABLE public.portfolios TO authenticated;

SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$ INSERT INTO public.portfolios (user_id, name)
     VALUES ('b0000000-0000-4000-8000-00000000000b', 'Ajena') $$,
  '42501', 'new row violates row-level security policy for table "portfolios"',
  'the insert policy rejects a portfolio for another user'
);

-- No WHERE: a WHERE needs SELECT, whose policy would also check the new row.
SELECT throws_ok(
  $$ UPDATE public.portfolios SET user_id = 'b0000000-0000-4000-8000-00000000000b' $$,
  '42501', 'new row violates row-level security policy for table "portfolios"',
  'the update policy rejects moving a portfolio to another user'
);

SELECT throws_ok(
  $$ INSERT INTO public.portfolios (id, user_id, name)
     VALUES ('be000000-0000-4000-8000-0000000000be', 'a0000000-0000-4000-8000-00000000000a', 'Tomada')
     ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id $$,
  '42501', 'new row violates row-level security policy (USING expression) for table "portfolios"',
  'an upsert cannot take over another user''s portfolio by id'
);

RESET ROLE;

SELECT is(
  (SELECT user_id FROM public.portfolios WHERE id = 'be000000-0000-4000-8000-0000000000be'),
  'b0000000-0000-4000-8000-00000000000b'::uuid,
  'the other user''s portfolio stays theirs'
);

-- ── Account deletion ────────────────────────────────────────────────────────
DELETE FROM auth.users WHERE id = 'a0000000-0000-4000-8000-00000000000a';

SELECT is_empty(
  $$ SELECT 1 FROM public.portfolios WHERE user_id = 'a0000000-0000-4000-8000-00000000000a' $$,
  'deleting the account deletes its portfolios'
);

SELECT * FROM finish();
ROLLBACK;
