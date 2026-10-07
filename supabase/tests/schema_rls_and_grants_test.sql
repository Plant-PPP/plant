-- Schema-wide floor for every table and function in public and private, so a
-- new migration that forgets RLS, its grant or a REVOKE fails here.
--
-- - Every public table has RLS enabled AND some grant to authenticated: the
--   app reads it through PostgREST, and auto_expose_new_tables is off.
-- - Every private table has RLS enabled and no grant to authenticated.
-- - anon holds no privilege on any relation in either schema, and neither
--   anon nor authenticated can use the private schema.
-- - anon and PUBLIC cannot execute any function in either schema, and every
--   SECURITY DEFINER function pins its search_path.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(7);

SELECT is_empty(
  $$ SELECT c.relname FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
       AND NOT c.relrowsecurity $$,
  'every public table has RLS enabled'
);

SELECT is_empty(
  $$ SELECT c.relname FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
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
    AND NOT has_schema_privilege('authenticated', 'private', 'USAGE'),
  'anon and authenticated cannot use the private schema'
);

-- has_function_privilege counts EXECUTE granted to PUBLIC. Functions an
-- extension installed are not ours to revoke.
SELECT is_empty(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p
     WHERE p.pronamespace IN ('public'::regnamespace, 'private'::regnamespace)
       AND NOT EXISTS (SELECT 1 FROM pg_depend d
                       WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
       AND has_function_privilege('anon', p.oid, 'EXECUTE') $$,
  'anon (and PUBLIC) cannot execute any function in public or private'
);

SELECT is_empty(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p
     WHERE p.pronamespace IN ('public'::regnamespace, 'private'::regnamespace)
       AND p.prosecdef
       AND NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) cfg WHERE cfg LIKE 'search_path=%') $$,
  'every SECURITY DEFINER function sets its search_path'
);

SELECT * FROM finish();
ROLLBACK;
