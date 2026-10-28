-- A draft's outflows: an adjustment's direction, a transfer out to another of
-- the user's accounts, never to someone else's, and an adjustment written
-- before the direction existed still reads as one in.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(8);

-- The SQLSTATE a statement raises, or NULL if it succeeds.
CREATE FUNCTION pg_temp.error_of(statement text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE statement;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$f$;

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
SELECT ids.id, p.user_id, ids.institution, p.id
FROM public.portfolios p
JOIN (VALUES ('a5000000-0000-4000-8000-0000000000a5'::uuid, 'a0000000-0000-4000-8000-00000000000a'::uuid, 'Exchange A'),
             ('a6000000-0000-4000-8000-0000000000a6'::uuid, 'a0000000-0000-4000-8000-00000000000a'::uuid, 'Exchange B'),
             ('b5000000-0000-4000-8000-0000000000b5'::uuid, 'b0000000-0000-4000-8000-00000000000b'::uuid, 'Exchange B'))
  AS ids (id, user_id, institution) ON ids.user_id = p.user_id;
ALTER TABLE public.source_connections ENABLE TRIGGER portfolio_setup_1_lock;

INSERT INTO public.uploaded_documents (id, user_id, source_connection_id, storage_path,
                                       file_name, mime_type, size_bytes, sha256)
VALUES ('a8000000-0000-4000-8000-0000000000a8', 'a0000000-0000-4000-8000-00000000000a',
        'a5000000-0000-4000-8000-0000000000a5',
        'a0000000-0000-4000-8000-00000000000a/imports/a9000000-0000-4000-8000-0000000000a9/a7000000-0000-4000-8000-0000000000a7',
        'log.png', 'image/png', 1024, repeat('a', 64));
INSERT INTO public.imports (id, user_id, document_id) VALUES
  ('a1000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-00000000000a',
   'a8000000-0000-4000-8000-0000000000a8');

-- A row of Ana's draft at a position, with the given kind, direction and
-- counterpart.
CREATE FUNCTION pg_temp.row_of(at_position int, kind text, direction text, counterpart uuid)
RETURNS text LANGUAGE sql AS $f$
  SELECT format(
    $$ INSERT INTO public.import_operations
         (user_id, import_id, position, kind, direction, counterpart_connection_id,
          symbol, quantity, currency, confidence)
       VALUES ('a0000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-0000000000a1',
               %s, %L, %L, %L, 'BTC', 0.05, 'USD', 'medium') $$,
    at_position, kind, direction, counterpart)
$f$;

SELECT is(pg_temp.error_of(pg_temp.row_of(0, 'adjustment', 'out', NULL)), NULL,
  'an adjustment may take units out');

SELECT is(pg_temp.error_of(pg_temp.row_of(1, 'adjustment', NULL, NULL)), NULL,
  'an adjustment with no direction is one written before it, which came in');

SELECT is(pg_temp.error_of(pg_temp.row_of(2, 'purchase', 'in', NULL)), '23514',
  'only an adjustment or a transfer has a direction');

SELECT is(pg_temp.error_of(pg_temp.row_of(3, 'transfer', 'in', NULL)), '23514',
  'a transfer in a draft is its units leaving');

SELECT is(pg_temp.error_of(pg_temp.row_of(4, 'transfer', 'out', 'a6000000-0000-4000-8000-0000000000a6')), NULL,
  'a transfer goes to another of the user''s accounts');

SELECT is(pg_temp.error_of(pg_temp.row_of(5, 'transfer', 'out', 'b5000000-0000-4000-8000-0000000000b5')), '23503',
  'never to another user''s account');

SELECT is(pg_temp.error_of(pg_temp.row_of(6, 'adjustment', 'out', 'a6000000-0000-4000-8000-0000000000a6')), '23514',
  'only a transfer names an account');

SELECT ok(
  has_column_privilege('service_role', 'public.import_operations', 'direction', 'INSERT')
    AND NOT has_column_privilege('service_role', 'public.import_operations', 'counterpart_connection_id', 'INSERT'),
  'the job writes a direction, never a transfer''s account'
);

SELECT * FROM finish();
ROLLBACK;
