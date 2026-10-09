-- Schema-wide floor for every table and function in public and private, so a
-- new migration that forgets RLS, its grant or a REVOKE fails here.
--
-- - Every public table has RLS enabled AND some grant to authenticated: the
--   app reads it through PostgREST, and auto_expose_new_tables is off.
-- - Every private table has RLS enabled and no grant to authenticated.
-- - anon holds no privilege on any relation in either schema, and no API
--   role, service_role included, can use the private schema.
-- - Every permissive policy in public is exactly the owner predicate, for
--   authenticated only. A table that needs another policy changes this test in
--   its own PR.
-- - Every public table has exactly one RESTRICTIVE policy, the MFA gate: a new
--   table copies it from the mfa_gate migration. The first Storage bucket or
--   private Realtime channel adds the same predicate and its assert here, and a
--   sensitive check written in SQL joins the truth table in mfa_gate_test.sql.
-- - Views granted to authenticated run as the caller, and materialized views
--   and foreign tables grant authenticated nothing.
-- - A foreign key between two owned public tables pairs user_id with user_id.
-- - No extension is installed in either schema, neither anon nor
--   authenticated can execute any function in them, service_role none in
--   private, the only SECURITY DEFINER
--   functions are the signup and session triggers, and no trigger on public,
--   private or auth runs another definer. No table in either schema has rewrite rules.
-- - Only the owner holds TRUNCATE, TRIGGER, REFERENCES or MAINTAIN.
-- - plpgsql_check finds no error in any function, trigger functions checked
--   against each table they fire on.
-- - Every public table granted to authenticated has a policy.
-- - A unique or exclusion key on an owned public table has user_id as an
--   equality column, unless the server mints every key column.
-- - A public table references a table outside public only as user_id ->
--   auth.users.
-- - On an owned public table, user_id is NOT NULL and references auth.users
--   ON DELETE CASCADE, every uuid *_id column is its single-column primary key
--   or a foreign key, no uuid[] column exists, and no column comes from a
--   sequence.
-- - authenticated writes public tables only through column grants, none on
--   user_id.
-- - authenticated_aal1, the role the access token hook gives an enrolled
--   user's token below aal2, uses no schema but public and holds no privilege
--   there, is a member of no role, and only authenticator can switch to it.
--   Only supabase_auth_admin and the owner can execute the hook, which runs as
--   the caller with an empty search_path.
-- - Canaries prove the MFA gate, partition and authenticated_aal1 asserts can
--   fail.
--
-- Partitions are reached through their parent, so the grant and policy asserts
-- skip them and no partition is granted to authenticated: queried directly, a
-- partition answers under its own policies, without the parent's MFA gate. RLS
-- and the revokes still apply. It covers public and private:
-- storage.objects policies and any new schema add their asserts in the PR that
-- creates them.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
CREATE EXTENSION IF NOT EXISTS plpgsql_check WITH SCHEMA extensions;
SELECT plan(35);

SELECT is_empty(
  $$ SELECT c.relname FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
       AND NOT c.relrowsecurity $$,
  'every public table has RLS enabled'
);

SELECT is_empty(
  $$ SELECT c.relname FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
       AND NOT c.relispartition
       AND NOT has_any_column_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE')
       AND NOT has_table_privilege('authenticated', c.oid, 'DELETE') $$,
  'every public table has a grant to authenticated'
);

SELECT is_empty(
  $$ SELECT c.relname FROM pg_class c
     WHERE c.relnamespace = 'private'::regnamespace AND c.relkind IN ('r', 'p')
       AND (NOT c.relrowsecurity
            OR has_any_column_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
            OR has_table_privilege('authenticated', c.oid, 'DELETE, TRUNCATE, TRIGGER')) $$,
  'every private table has RLS enabled and no grant to authenticated'
);

SELECT is_empty(
  $$ SELECT c.relnamespace::regnamespace || '.' || c.relname FROM pg_class c
     WHERE c.relnamespace IN ('public'::regnamespace, 'private'::regnamespace)
       AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND (has_any_column_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
            OR has_table_privilege('anon', c.oid, 'DELETE, TRUNCATE, TRIGGER, MAINTAIN'))
     UNION ALL
     SELECT c.relnamespace::regnamespace || '.' || c.relname FROM pg_class c
     WHERE c.relnamespace IN ('public'::regnamespace, 'private'::regnamespace)
       -- CASE keeps the planner from calling has_sequence_privilege on a non-sequence.
       AND CASE WHEN c.relkind = 'S' THEN has_sequence_privilege('anon', c.oid, 'USAGE, SELECT, UPDATE') END $$,
  'anon holds no privilege on any relation in public or private'
);

SELECT ok(
  NOT has_schema_privilege('anon', 'private', 'USAGE')
    AND NOT has_schema_privilege('authenticated', 'private', 'USAGE')
    AND NOT has_schema_privilege('service_role', 'private', 'USAGE'),
  'no API role, service_role included, can use the private schema'
);

-- Extensions live in the extensions schema, which the API does not expose:
-- one in public would turn every function it installs into an RPC endpoint.
SELECT is_empty(
  $$ SELECT extname FROM pg_extension
     WHERE extnamespace IN ('public'::regnamespace, 'private'::regnamespace) $$,
  'no extension is installed in public or private'
);

-- has_function_privilege counts EXECUTE granted to PUBLIC.
SELECT is_empty(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p
     WHERE p.pronamespace IN ('public'::regnamespace, 'private'::regnamespace)
       AND (has_function_privilege('anon', p.oid, 'EXECUTE')
            OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
            OR (p.pronamespace = 'private'::regnamespace
                AND has_function_privilege('service_role', p.oid, 'EXECUTE'))) $$,
  'anon, authenticated and PUBLIC cannot execute any function in public or private, nor service_role in private'
);

SELECT is_empty(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p
     WHERE p.pronamespace IN ('public'::regnamespace, 'private'::regnamespace)
       AND p.prosecdef
       AND NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) cfg WHERE cfg LIKE 'search_path=%') $$,
  'every SECURITY DEFINER function sets its search_path'
);

-- Compared as text: this is pg_get_expr's rendering of
-- user_id = (select auth.uid()), so a Postgres upgrade that renders it
-- differently fails this assert until the string is updated.
SELECT is_empty(
  $$ SELECT tablename || '.' || policyname FROM pg_policies
     WHERE schemaname = 'public' AND permissive = 'PERMISSIVE'
       AND (roles <> '{authenticated}'::name[]
            OR (cmd <> 'INSERT' AND qual IS DISTINCT FROM '(user_id = ( SELECT auth.uid() AS uid))')
            OR (cmd IN ('INSERT', 'UPDATE', 'ALL')
                AND with_check IS DISTINCT FROM '(user_id = ( SELECT auth.uid() AS uid))')) $$,
  'every permissive policy in public pins user_id to auth.uid() for authenticated'
);

-- A view reads as its owner, past RLS, unless security_invoker is set.
-- reloptions keeps the spelling it was given (true, on, 1, yes).
SELECT is_empty(
  $$ SELECT c.relname FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('v', 'm', 'f')
       AND (has_any_column_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE')
            OR has_table_privilege('authenticated', c.oid, 'DELETE'))
       AND (c.relkind <> 'v'
            OR NOT COALESCE((SELECT o.option_value::boolean FROM pg_options_to_table(c.reloptions) o
                             WHERE o.option_name = 'security_invoker'), false)) $$,
  'views granted to authenticated are security_invoker; materialized views and foreign tables grant it nothing'
);

-- Without the pair, a user's row can point at a parent another user owns.
SELECT is_empty(
  $$ SELECT con.conrelid::regclass || '.' || con.conname FROM pg_constraint con
     JOIN pg_class child ON child.oid = con.conrelid
     JOIN pg_class parent ON parent.oid = con.confrelid
     WHERE con.contype = 'f'
       AND child.relnamespace = 'public'::regnamespace
       AND parent.relnamespace = 'public'::regnamespace
       AND EXISTS (SELECT 1 FROM pg_attribute a
                   WHERE a.attrelid = con.conrelid AND a.attname = 'user_id' AND NOT a.attisdropped)
       AND EXISTS (SELECT 1 FROM pg_attribute a
                   WHERE a.attrelid = con.confrelid AND a.attname = 'user_id' AND NOT a.attisdropped)
       AND NOT EXISTS (SELECT 1 FROM unnest(con.conkey, con.confkey) k(c, p)
                       JOIN pg_attribute ca ON ca.attrelid = con.conrelid AND ca.attnum = k.c
                       JOIN pg_attribute pa ON pa.attrelid = con.confrelid AND pa.attnum = k.p
                       WHERE ca.attname = 'user_id' AND pa.attname = 'user_id') $$,
  'foreign keys between owned public tables pair user_id with user_id'
);

SELECT set_eq(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p
     WHERE p.pronamespace IN ('public'::regnamespace, 'private'::regnamespace)
       AND p.prosecdef $$,
  ARRAY['private.create_profile_for_new_user()', 'private.record_session_created()'],
  'the signup and session triggers are the only SECURITY DEFINER functions'
);

SELECT ok(
  (SELECT p.proconfig = ARRAY['search_path=""']
          AND p.proowner = (SELECT relowner FROM pg_class WHERE oid = 'public.profiles'::regclass)
   FROM pg_proc p WHERE p.oid = 'private.create_profile_for_new_user()'::regprocedure)
    AND (SELECT t.tgenabled = 'O'
                AND pg_get_triggerdef(t.oid) = 'CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION private.create_profile_for_new_user()'
         FROM pg_trigger t
         WHERE t.tgrelid = 'auth.users'::regclass AND t.tgname = 'on_auth_user_created')
    AND (SELECT count(*) FROM pg_trigger t
         WHERE t.tgfoid = 'private.create_profile_for_new_user()'::regprocedure) = 1,
  'the signup trigger runs as the owner of profiles, with an empty search_path, is enabled and is its function''s only trigger'
);

SELECT ok(
  (SELECT p.proconfig = ARRAY['search_path=""']
          AND p.proowner = (SELECT relowner FROM pg_class WHERE oid = 'private.audit_log'::regclass)
   FROM pg_proc p WHERE p.oid = 'private.record_session_created()'::regprocedure)
    AND (SELECT t.tgenabled = 'O'
                AND pg_get_triggerdef(t.oid) = 'CREATE TRIGGER record_session_created AFTER INSERT ON auth.sessions FOR EACH ROW EXECUTE FUNCTION private.record_session_created()'
         FROM pg_trigger t
         WHERE t.tgrelid = 'auth.sessions'::regclass AND t.tgname = 'record_session_created')
    AND (SELECT count(*) FROM pg_trigger t
         WHERE t.tgfoid = 'private.record_session_created()'::regprocedure) = 1,
  'the session trigger runs as the owner of audit_log, with an empty search_path, is enabled, fires only on insert and is its function''s only trigger'
);

-- Firing a trigger checks neither EXECUTE nor schema USAGE, so a definer in
-- any schema runs as its owner, past RLS, on every write that fires it.
SELECT is_empty(
  $$ SELECT t.tgrelid::regclass || '.' || t.tgname FROM pg_trigger t
     JOIN pg_class c ON c.oid = t.tgrelid
     JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE NOT t.tgisinternal
       AND c.relnamespace IN ('public'::regnamespace, 'private'::regnamespace, 'auth'::regnamespace)
       AND p.prosecdef
       AND (t.tgfoid, t.tgrelid) NOT IN (
             ('private.create_profile_for_new_user()'::regprocedure, 'auth.users'::regclass),
             ('private.record_session_created()'::regprocedure, 'auth.sessions'::regclass)) $$,
  'no trigger on public, private or auth runs a SECURITY DEFINER function besides the signup and session triggers'
);

-- Rule actions run as the table owner, past RLS.
SELECT is_empty(
  $$ SELECT r.ev_class::regclass || '.' || r.rulename FROM pg_rewrite r
     JOIN pg_class c ON c.oid = r.ev_class
     WHERE c.relnamespace IN ('public'::regnamespace, 'private'::regnamespace)
       AND r.rulename <> '_RETURN' $$,
  'no rewrite rules on public or private relations'
);

-- aclexplode: has_table_privilege is always true for supabase_admin, a superuser.
SELECT is_empty(
  $$ SELECT c.oid::regclass || ' ' || a.grantee::regrole || ' ' || a.privilege_type
     FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
     WHERE c.relnamespace IN ('public'::regnamespace, 'private'::regnamespace)
       AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND a.grantee <> c.relowner
       AND a.privilege_type IN ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')
     UNION ALL
     SELECT c.oid::regclass || '.' || att.attname || ' ' || a.grantee::regrole || ' ' || a.privilege_type
     FROM pg_attribute att
     JOIN pg_class c ON c.oid = att.attrelid
     CROSS JOIN LATERAL aclexplode(att.attacl) a
     WHERE c.relnamespace IN ('public'::regnamespace, 'private'::regnamespace)
       AND att.attnum > 0 AND NOT att.attisdropped
       AND a.grantee <> c.relowner
       AND a.privilege_type = 'REFERENCES' $$,
  'only the owner holds TRUNCATE, TRIGGER, REFERENCES or MAINTAIN in public or private'
);

-- plpgsql_check_function_tb aborts the transaction on a trigger function
-- checked without its table, so each one is checked once per trigger and the
-- next assert makes sure every trigger function has one.
SELECT is_empty(
  $$ WITH targets AS MATERIALIZED (
       SELECT p.oid AS fn, COALESCE(t.tgrelid, 0) AS rel FROM pg_proc p
       JOIN pg_language l ON l.oid = p.prolang AND l.lanname = 'plpgsql'
       LEFT JOIN pg_trigger t ON t.tgfoid = p.oid AND NOT t.tgisinternal
       WHERE p.pronamespace IN ('public'::regnamespace, 'private'::regnamespace)
         AND (p.prorettype <> 'trigger'::regtype OR t.tgrelid IS NOT NULL)
     )
     SELECT fn::regprocedure || ': ' || r.message FROM targets
     CROSS JOIN LATERAL extensions.plpgsql_check_function_tb(fn::regprocedure, rel::regclass) r
     WHERE r.level = 'error' $$,
  'plpgsql_check finds no error in public or private functions'
);

SELECT is_empty(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p
     WHERE p.pronamespace IN ('public'::regnamespace, 'private'::regnamespace)
       AND p.prorettype = 'trigger'::regtype
       AND NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgfoid = p.oid) $$,
  'every trigger function in public or private has a trigger'
);

-- RLS with a grant and no policy returns nothing to the owner.
SELECT is_empty(
  $$ SELECT c.relname FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
       AND NOT c.relispartition
       AND (has_any_column_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE')
            OR has_table_privilege('authenticated', c.oid, 'DELETE'))
       AND NOT EXISTS (SELECT 1 FROM pg_policies p
                       WHERE p.schemaname = 'public' AND p.tablename = c.relname
                         AND p.permissive = 'PERMISSIVE') $$,
  'every public table granted to authenticated has a policy'
);

-- A key unique across users lets one user find out that another holds a value
-- (the write fails) and squat it first. INCLUDE columns are not part of the
-- key, an exclusion on user_id WITH <> fires only across users, and a
-- generated or trigger-filled column derives from values the user chose, so
-- only random-uuid defaults count as server-minted.
SELECT is_empty(
  $$ SELECT i.indexrelid::regclass::text FROM pg_index i
     JOIN pg_class c ON c.oid = i.indrelid
     LEFT JOIN pg_constraint x ON x.conindid = i.indexrelid AND x.contype = 'x'
     WHERE c.relnamespace = 'public'::regnamespace
       AND (i.indisunique OR i.indisexclusion)
       AND EXISTS (SELECT 1 FROM pg_attribute a
                   WHERE a.attrelid = c.oid AND a.attname = 'user_id' AND NOT a.attisdropped)
       AND NOT EXISTS (SELECT 1 FROM generate_series(0, i.indnkeyatts - 1) g(o)
                       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = i.indkey[g.o]
                       WHERE a.attname = 'user_id'
                         AND (x.oid IS NULL
                              OR (SELECT oprname FROM pg_operator WHERE oid = x.conexclop[g.o + 1]) = '='))
       AND (i.indexprs IS NOT NULL
            OR EXISTS (SELECT 1 FROM generate_series(0, i.indnkeyatts - 1) g(o)
                       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = i.indkey[g.o]
                       LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
                       WHERE has_column_privilege('authenticated', c.oid, a.attnum, 'INSERT')
                          OR has_column_privilege('authenticated', c.oid, a.attnum, 'UPDATE')
                          OR a.attgenerated <> ''
                          OR COALESCE(pg_get_expr(d.adbin, d.adrelid), '')
                             !~ '^(extensions\.)?(gen_random_uuid|uuid_generate_v4)\(\)$')) $$,
  'every unique or exclusion key on an owned public table has user_id as an equality column or only server-minted columns'
);

-- Any other reference out of public lets a user point a row at another account
-- or probe which ids exist.
SELECT is_empty(
  $$ SELECT con.conrelid::regclass || '.' || con.conname FROM pg_constraint con
     JOIN pg_class child ON child.oid = con.conrelid
     JOIN pg_class parent ON parent.oid = con.confrelid
     WHERE con.contype = 'f'
       AND child.relnamespace = 'public'::regnamespace
       AND parent.relnamespace <> 'public'::regnamespace
       AND NOT (con.confrelid = 'auth.users'::regclass
                AND con.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a
                                        WHERE a.attrelid = con.conrelid AND a.attname = 'user_id')]) $$,
  'a public table references a table outside public only as user_id -> auth.users'
);

SELECT is_empty(
  $$ SELECT c.relname FROM pg_class c
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'user_id' AND NOT a.attisdropped
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
       AND NOT a.attnotnull $$,
  'user_id is NOT NULL on every public table'
);

-- Deleting the account must take every row with it.
SELECT is_empty(
  $$ SELECT c.relname FROM pg_class c
     JOIN pg_attribute u ON u.attrelid = c.oid AND u.attname = 'user_id' AND NOT u.attisdropped
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
       AND NOT c.relispartition
       AND NOT EXISTS (SELECT 1 FROM pg_constraint con
                       WHERE con.conrelid = c.oid AND con.contype = 'f'
                         AND con.conkey = ARRAY[u.attnum]
                         AND con.confrelid = 'auth.users'::regclass
                         AND con.confdeltype = 'c') $$,
  'user_id on every public table references auth.users ON DELETE CASCADE'
);

-- An id column with no foreign key lets a user point a row at another user's
-- parent; the pairing assert above only sees keys that exist. A single-column
-- primary key is the row's own id, which the unique-key assert requires the
-- server to mint. A list of references goes in a join table, never a uuid[].
SELECT is_empty(
  $$ SELECT c.relname || '.' || a.attname FROM pg_class c
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     JOIN pg_type t ON t.oid = a.atttypid
     CROSS JOIN LATERAL (SELECT COALESCE(NULLIF(t.typbasetype, 0), t.oid)::regtype AS base) b
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
       AND a.attname <> 'user_id'
       AND EXISTS (SELECT 1 FROM pg_attribute u
                   WHERE u.attrelid = c.oid AND u.attname = 'user_id' AND NOT u.attisdropped)
       AND (b.base = 'uuid[]'::regtype
            OR (b.base = 'uuid'::regtype AND a.attname LIKE '%\_id'
                AND NOT EXISTS (SELECT 1 FROM pg_constraint con
                                WHERE con.conrelid = c.oid
                                  AND (con.contype = 'f' OR (con.contype = 'p' AND cardinality(con.conkey) = 1))
                                  AND a.attnum = ANY (con.conkey)))) $$,
  'every uuid *_id column on an owned public table is its single-column primary key or a foreign key, and no uuid[] column exists'
);

-- A sequence is shared by every user, so the ids a user gets back show how
-- much the others wrote.
SELECT is_empty(
  $$ SELECT c.relname || '.' || a.attname FROM pg_class c
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
       AND EXISTS (SELECT 1 FROM pg_attribute u
                   WHERE u.attrelid = c.oid AND u.attname = 'user_id' AND NOT u.attisdropped)
       AND (a.attidentity <> '' OR pg_get_expr(d.adbin, d.adrelid) LIKE '%nextval(%') $$,
  'no owned public table has a column that comes from a sequence'
);

-- A table-wide grant also opens id, user_id and any column the server keeps
-- (a quota counter), so writes go through column grants, never on user_id.
SELECT is_empty(
  $$ SELECT c.oid::regclass || ' ' || a.privilege_type FROM pg_class c
     CROSS JOIN LATERAL aclexplode(c.relacl) a
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
       AND a.grantee = 'authenticated'::regrole
       AND a.privilege_type IN ('INSERT', 'UPDATE')
     UNION ALL
     SELECT c.oid::regclass || '.user_id ' || x.privilege_type FROM pg_class c
     JOIN pg_attribute u ON u.attrelid = c.oid AND u.attname = 'user_id' AND NOT u.attisdropped
     CROSS JOIN LATERAL aclexplode(u.attacl) x
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
       AND x.grantee = 'authenticated'::regrole
       AND x.privilege_type IN ('INSERT', 'UPDATE') $$,
  'authenticated writes public tables only through column grants, none on user_id'
);

-- The asserts below run against canaries further down, each of which breaks
-- one rule.
CREATE TEMP TABLE canaried (name text PRIMARY KEY, canaries text[] NOT NULL, query text NOT NULL)
  ON COMMIT DROP;
INSERT INTO canaried VALUES
-- pg_get_expr's rendering of the predicate in the mfa_gate migration, compared
-- as text like the owner predicate above.
('every public table has one RESTRICTIVE policy, the MFA gate for authenticated',
 ARRAY['pgtap_canary_no_gate', 'pgtap_canary_permissive_gate', 'pgtap_canary_two_gates',
       'pgtap_canary_two_gates.pgtap_canary', 'pgtap_canary_gate_name.pgtap_canary',
       'pgtap_canary_gate_role.Requires two-factor authentication',
       'pgtap_canary_gate_cmd.Requires two-factor authentication',
       'pgtap_canary_gate_using.Requires two-factor authentication',
       'pgtap_canary_gate_check.Requires two-factor authentication'],
 $$ SELECT c.relname FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
      AND NOT c.relispartition
      AND (SELECT count(*) FROM pg_policies p
           WHERE p.schemaname = 'public' AND p.tablename = c.relname
             AND p.permissive = 'RESTRICTIVE') <> 1
    UNION ALL
    SELECT tablename || '.' || policyname FROM pg_policies
    WHERE schemaname = 'public' AND permissive = 'RESTRICTIVE'
      AND (policyname <> 'Requires two-factor authentication'
           OR roles <> '{authenticated}'::name[] OR cmd <> 'ALL'
           OR qual IS DISTINCT FROM '((( SELECT (auth.jwt() ->> ''aal''::text)) = ''aal2''::text) OR (( SELECT (auth.jwt() -> ''mfa_enrolled''::text)) = ''false''::jsonb))'
           OR with_check IS DISTINCT FROM '((( SELECT (auth.jwt() ->> ''aal''::text)) = ''aal2''::text) OR (( SELECT (auth.jwt() -> ''mfa_enrolled''::text)) = ''false''::jsonb))') $$),
('no partition in public is granted to authenticated', ARRAY['pgtap_canary_partition'],
 $$ SELECT c.relname FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relispartition
      AND (has_any_column_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
           OR has_table_privilege('authenticated', c.oid, 'DELETE, TRUNCATE, TRIGGER, MAINTAIN')) $$),
-- has_*_privilege counts grants to PUBLIC and through inherited roles, so
-- these see everything authenticated_aal1 could use. PUBLIC keeps USAGE on the
-- public schema, which reaches nothing by itself; a schema without USAGE hides
-- whatever PUBLIC may execute in it.
('authenticated_aal1 uses no schema but public and holds no privilege on any relation, column or function there',
 ARRAY['schema private', 'schema graphql_public', 'profiles', 'consents', 'pgtap_canary_insert',
       'pgtap_canary_update', 'pgtap_canary_partitioned', 'pgtap_canary_matview',
       'private.audit_log_id_seq', 'private.audit_log', 'private.set_updated_at()'],
 $$ SELECT 'schema ' || n.nspname FROM pg_namespace n
    WHERE n.nspname NOT IN ('public', 'pg_catalog', 'information_schema')
      AND n.nspname !~ '^pg_(toast_)?temp_'
      AND has_schema_privilege('authenticated_aal1', n.oid, 'USAGE')
    UNION ALL
    SELECT c.oid::regclass::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND n.nspname !~ '^pg_(toast_)?temp_'
      AND has_schema_privilege('authenticated_aal1', n.oid, 'USAGE')
      AND CASE WHEN c.relkind = 'S'
               THEN has_sequence_privilege('authenticated_aal1', c.oid, 'USAGE, SELECT, UPDATE')
               WHEN c.relkind IN ('r', 'p', 'v', 'm', 'f')
               THEN has_any_column_privilege('authenticated_aal1', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
                    OR has_table_privilege('authenticated_aal1', c.oid, 'DELETE, TRUNCATE, TRIGGER, MAINTAIN')
          END
    UNION ALL
    SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname !~ '^pg_(toast_)?temp_'
      AND has_schema_privilege('authenticated_aal1', n.oid, 'USAGE')
      AND has_function_privilege('authenticated_aal1', p.oid, 'EXECUTE') $$),
-- Creating a role gives its creator a membership with ADMIN only, which
-- neither inherits nor switches.
('authenticated_aal1 is a member of no role, and only authenticator can switch to it',
 ARRAY['pgtap_canary > authenticated_aal1', 'authenticated_aal1 > anon'],
 $$ SELECT m.roleid::regrole || ' > ' || m.member::regrole FROM pg_auth_members m
    WHERE m.member = 'authenticated_aal1'::regrole
       OR (m.roleid = 'authenticated_aal1'::regrole
           AND m.member <> 'authenticator'::regrole
           AND (m.set_option OR m.inherit_option)) $$),
('only supabase_auth_admin and the owner can execute the access token hook', ARRAY['authenticated'],
 $$ SELECT a.grantee::regrole::text FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
    WHERE p.oid = 'private.custom_access_token_hook(jsonb)'::regprocedure
      AND a.privilege_type = 'EXECUTE'
      AND a.grantee NOT IN (p.proowner, 'supabase_auth_admin'::regrole) $$);

SELECT is_empty(query, name) FROM canaried ORDER BY name;

SELECT ok(
  (SELECT NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreaterole
          AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls
   FROM pg_roles WHERE rolname = 'authenticated_aal1')
    AND EXISTS (SELECT 1 FROM pg_auth_members
                WHERE roleid = 'authenticated_aal1'::regrole
                  AND member = 'authenticator'::regrole AND set_option),
  'authenticated_aal1 cannot log in, inherit or bypass RLS, and authenticator can switch to it'
);

SELECT ok(
  (SELECT NOT p.prosecdef AND p.proconfig = ARRAY['search_path=""']
   FROM pg_proc p WHERE p.oid = 'private.custom_access_token_hook(jsonb)'::regprocedure)
    AND has_schema_privilege('supabase_auth_admin', 'private', 'USAGE')
    AND has_function_privilege('supabase_auth_admin', 'private.custom_access_token_hook(jsonb)', 'EXECUTE')
    AND has_table_privilege('supabase_auth_admin', 'auth.mfa_factors', 'SELECT'),
  'the access token hook runs as supabase_auth_admin, which can reach and execute it and read the factors, with an empty search_path'
);

-- Each canary breaks one rule above, and each assert must name every canary
-- it is given. A sequence keeps its value through ROLLBACK TO, so it carries
-- the number of missed canaries out of the savepoint; it stays at -1 if the
-- count never ran.
CREATE TEMP SEQUENCE canary_misses MINVALUE -1 START -1;
CREATE FUNCTION pg_temp.misses(query text, canaries text[]) RETURNS bigint LANGUAGE plpgsql AS $f$
DECLARE n bigint;
BEGIN
  EXECUTE format('SELECT count(*) FROM (SELECT unnest($1) EXCEPT SELECT * FROM (%s) q) d', query)
    USING canaries INTO n;
  RETURN n;
END
$f$;

SAVEPOINT canaries;
GRANT DELETE ON public.profiles TO authenticated_aal1;
GRANT SELECT (kind) ON public.consents TO authenticated_aal1;
CREATE VIEW public.pgtap_canary_insert WITH (security_invoker) AS SELECT 1 AS x;
CREATE VIEW public.pgtap_canary_update WITH (security_invoker) AS SELECT 1 AS x;
GRANT INSERT (x) ON public.pgtap_canary_insert TO authenticated_aal1;
GRANT UPDATE (x) ON public.pgtap_canary_update TO authenticated_aal1;
CREATE TABLE public.pgtap_canary_partitioned (x int) PARTITION BY RANGE (x);
GRANT SELECT ON public.pgtap_canary_partitioned TO authenticated_aal1;
CREATE MATERIALIZED VIEW public.pgtap_canary_matview AS SELECT 1 AS x;
GRANT SELECT ON public.pgtap_canary_matview TO authenticated_aal1;
GRANT EXECUTE ON FUNCTION private.set_updated_at() TO authenticated_aal1;
GRANT USAGE ON SCHEMA private TO authenticated_aal1;
GRANT USAGE ON SEQUENCE private.audit_log_id_seq TO authenticated_aal1;
GRANT TRUNCATE ON private.audit_log TO authenticated_aal1;
GRANT USAGE ON SCHEMA graphql_public TO authenticated_aal1;
CREATE ROLE pgtap_canary NOLOGIN;
GRANT pgtap_canary TO authenticated_aal1;
GRANT authenticated_aal1 TO anon;
GRANT EXECUTE ON FUNCTION private.custom_access_token_hook(jsonb) TO authenticated;
CREATE TABLE public.pgtap_canary_partition PARTITION OF public.pgtap_canary_partitioned
  FOR VALUES FROM (0) TO (1);
GRANT SELECT ON public.pgtap_canary_partition TO authenticated;
-- Each gate canary copies the gate on profiles and changes one thing.
DO $$
DECLARE
  gate text := (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles'
                  AND policyname = 'Requires two-factor authentication');
  canary text;
BEGIN
  FOREACH canary IN ARRAY ARRAY['no_gate', 'permissive_gate', 'two_gates', 'gate_name', 'gate_role',
                                'gate_cmd', 'gate_using', 'gate_check'] LOOP
    EXECUTE format('CREATE TABLE public.%I ()', 'pgtap_canary_' || canary);
  END LOOP;
  EXECUTE format($f$
    CREATE POLICY "Requires two-factor authentication" ON public.pgtap_canary_permissive_gate
      AS PERMISSIVE FOR ALL TO authenticated USING (%1$s) WITH CHECK (%1$s);
    CREATE POLICY "Requires two-factor authentication" ON public.pgtap_canary_two_gates
      AS RESTRICTIVE FOR ALL TO authenticated USING (%1$s) WITH CHECK (%1$s);
    CREATE POLICY pgtap_canary ON public.pgtap_canary_two_gates
      AS RESTRICTIVE FOR ALL TO authenticated USING (%1$s) WITH CHECK (%1$s);
    CREATE POLICY pgtap_canary ON public.pgtap_canary_gate_name
      AS RESTRICTIVE FOR ALL TO authenticated USING (%1$s) WITH CHECK (%1$s);
    CREATE POLICY "Requires two-factor authentication" ON public.pgtap_canary_gate_role
      AS RESTRICTIVE FOR ALL TO authenticated, authenticated_aal1 USING (%1$s) WITH CHECK (%1$s);
    CREATE POLICY "Requires two-factor authentication" ON public.pgtap_canary_gate_cmd
      AS RESTRICTIVE FOR UPDATE TO authenticated USING (%1$s) WITH CHECK (%1$s);
    CREATE POLICY "Requires two-factor authentication" ON public.pgtap_canary_gate_using
      AS RESTRICTIVE FOR ALL TO authenticated USING (true) WITH CHECK (%1$s);
    CREATE POLICY "Requires two-factor authentication" ON public.pgtap_canary_gate_check
      AS RESTRICTIVE FOR ALL TO authenticated USING (%1$s) WITH CHECK (true);
  $f$, gate);
END
$$;
DO $$
BEGIN
  PERFORM setval('canary_misses',
                 (SELECT sum(pg_temp.misses(query, canaries))::bigint FROM canaried));
END
$$;
ROLLBACK TO SAVEPOINT canaries;

SELECT is((SELECT last_value FROM canary_misses), 0::bigint,
          'every canaried assert catches its canaries');

SELECT * FROM finish();
ROLLBACK;
