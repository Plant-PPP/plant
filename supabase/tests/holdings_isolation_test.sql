-- Holdings and instruments: each user reads and writes only their own
-- holdings; a holding points only at its user's account and portfolio and
-- defaults to the account's portfolio; the guards keep an active holding off
-- an archived account or portfolio and keep an account or portfolio with
-- active holdings from being archived; instruments are read-only market data.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(82);

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

-- Each user has "Principal" from signup, a second active portfolio, an
-- archived portfolio, an account defaulting to Principal, an archived account
-- and one holding; Ana has a second active account and a third active
-- portfolio, both empty.
UPDATE public.portfolios SET id = 'a1000000-0000-4000-8000-0000000000a1'
WHERE user_id = 'a0000000-0000-4000-8000-00000000000a';
UPDATE public.portfolios SET id = 'b1000000-0000-4000-8000-0000000000b1'
WHERE user_id = 'b0000000-0000-4000-8000-00000000000b';
INSERT INTO public.portfolios (id, user_id, name, archived_at) VALUES
  ('a2000000-0000-4000-8000-0000000000a2', 'a0000000-0000-4000-8000-00000000000a', 'Largo', NULL),
  ('a3000000-0000-4000-8000-0000000000a3', 'a0000000-0000-4000-8000-00000000000a', 'Vieja', now()),
  ('a4000000-0000-4000-8000-0000000000a4', 'a0000000-0000-4000-8000-00000000000a', 'Corto', NULL),
  ('b2000000-0000-4000-8000-0000000000b2', 'b0000000-0000-4000-8000-00000000000b', 'Largo', NULL),
  ('b3000000-0000-4000-8000-0000000000b3', 'b0000000-0000-4000-8000-00000000000b', 'Vieja', now());
INSERT INTO public.source_connections (id, user_id, institution, default_portfolio_id, archived_at) VALUES
  ('a5000000-0000-4000-8000-0000000000a5', 'a0000000-0000-4000-8000-00000000000a', 'IOL',
   'a1000000-0000-4000-8000-0000000000a1', NULL),
  ('a6000000-0000-4000-8000-0000000000a6', 'a0000000-0000-4000-8000-00000000000a', 'Balanz',
   'a1000000-0000-4000-8000-0000000000a1', now()),
  ('a9000000-0000-4000-8000-0000000000a9', 'a0000000-0000-4000-8000-00000000000a', 'Cocos',
   'a1000000-0000-4000-8000-0000000000a1', NULL),
  ('b5000000-0000-4000-8000-0000000000b5', 'b0000000-0000-4000-8000-00000000000b', 'IOL',
   'b1000000-0000-4000-8000-0000000000b1', NULL),
  ('b6000000-0000-4000-8000-0000000000b6', 'b0000000-0000-4000-8000-00000000000b', 'Balanz',
   'b1000000-0000-4000-8000-0000000000b1', now());
INSERT INTO public.holdings (id, user_id, source_connection_id, portfolio_id, asset_class,
                             instrument_symbol, amount) VALUES
  ('a7000000-0000-4000-8000-0000000000a7', 'a0000000-0000-4000-8000-00000000000a',
   'a5000000-0000-4000-8000-0000000000a5', 'a2000000-0000-4000-8000-0000000000a2',
   'instrument', 'BTC', '0.5'),
  ('b7000000-0000-4000-8000-0000000000b7', 'b0000000-0000-4000-8000-00000000000b',
   'b5000000-0000-4000-8000-0000000000b5', 'b1000000-0000-4000-8000-0000000000b1',
   'instrument', 'ETH', '2');

-- ── What the API roles hold ─────────────────────────────────────────────────
SELECT set_eq(
  $$ SELECT pg_temp.acl('public.holdings') $$,
  ARRAY['(table):SELECT',
        'source_connection_id:INSERT', 'portfolio_id:INSERT', 'asset_class:INSERT',
        'instrument_symbol:INSERT', 'amount:INSERT', 'currency:INSERT', 'annual_rate:INSERT',
        'started_on:INSERT', 'matures_on:INSERT', 'valued_on:INSERT', 'label:INSERT',
        'portfolio_id:UPDATE', 'amount:UPDATE', 'currency:UPDATE', 'annual_rate:UPDATE',
        'started_on:UPDATE', 'matures_on:UPDATE', 'valued_on:UPDATE', 'label:UPDATE',
        'archived_at:UPDATE'],
  'a user reads holdings and writes only their fields and the archive flag'
);

SELECT set_eq(
  $$ SELECT pg_temp.acl('public.instruments') $$,
  ARRAY['(table):SELECT'],
  'a user only reads instruments'
);

SELECT is_empty(
  $$ SELECT acl.grantee::regrole::text FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl
     WHERE c.oid IN ('public.holdings'::regclass, 'public.instruments'::regclass)
       AND acl.grantee IN ('anon'::regrole, 'service_role'::regrole, 0)
     UNION ALL
     SELECT acl.grantee::regrole::text FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl
     WHERE a.attrelid IN ('public.holdings'::regclass, 'public.instruments'::regclass)
       AND acl.grantee IN ('anon'::regrole, 'service_role'::regrole, 0) $$,
  'anon, the service role and PUBLIC hold nothing on either table or its columns'
);

-- ── Shape ───────────────────────────────────────────────────────────────────
SELECT ok(
  (SELECT bool_and(NOT p.prosecdef AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=""'])
   FROM pg_proc p
   WHERE p.oid IN ('private.default_holding_portfolio()'::regprocedure,
                   'private.guard_holding_write()'::regprocedure,
                   'private.guard_portfolio_write()'::regprocedure,
                   'private.guard_source_connection_write()'::regprocedure)),
  'the holdings triggers and the replaced guards run as the caller with an empty search_path'
);

SELECT ok(
  NOT bool_or(has_function_privilege(r, p, 'EXECUTE')),
  'no API role may execute the holdings triggers'
)
FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r
CROSS JOIN unnest(ARRAY['private.default_holding_portfolio()'::regprocedure,
                        'private.guard_holding_write()'::regprocedure]) p;

SELECT results_eq(
  $$ SELECT t.tgenabled::text || ' ' || pg_get_triggerdef(t.oid) FROM pg_trigger t
     WHERE t.tgrelid = 'public.holdings'::regclass AND NOT t.tgisinternal
     ORDER BY t.tgname $$,
  ARRAY[
    'O CREATE TRIGGER holdings_set_updated_at BEFORE UPDATE ON public.holdings FOR EACH ROW EXECUTE FUNCTION private.set_updated_at()',
    'O CREATE TRIGGER portfolio_setup_1_lock BEFORE INSERT OR UPDATE OF portfolio_id, archived_at ON public.holdings FOR EACH ROW EXECUTE FUNCTION private.lock_portfolio_setup()',
    'O CREATE TRIGGER portfolio_setup_2_default BEFORE INSERT ON public.holdings FOR EACH ROW EXECUTE FUNCTION private.default_holding_portfolio()',
    'O CREATE TRIGGER portfolio_setup_2_stamp BEFORE UPDATE ON public.holdings FOR EACH ROW EXECUTE FUNCTION private.stamp_archived_at()',
    'O CREATE TRIGGER portfolio_setup_3_guard BEFORE INSERT OR UPDATE OF portfolio_id, archived_at ON public.holdings FOR EACH ROW EXECUTE FUNCTION private.guard_holding_write()'
  ],
  'holdings has the lock, default, stamp and guard triggers, all enabled'
);

SELECT set_eq(
  $$ SELECT pg_get_constraintdef(oid) FROM pg_constraint
     WHERE conrelid = 'public.holdings'::regclass AND contype = 'f'
       AND conname NOT LIKE '%user_id_fkey' $$,
  ARRAY['FOREIGN KEY (user_id, source_connection_id) REFERENCES source_connections(user_id, id)',
        'FOREIGN KEY (user_id, portfolio_id) REFERENCES portfolios(user_id, id)',
        'FOREIGN KEY (instrument_symbol) REFERENCES instruments(symbol)'],
  'a holding points only at its user''s account and portfolio, and at a listed instrument'
);

SELECT set_eq(
  $$ SELECT attname || ' ' || format_type(atttypid, atttypmod) FROM pg_attribute
     WHERE attrelid = 'public.holdings'::regclass
       AND attname IN ('amount', 'annual_rate', 'started_on', 'matures_on', 'valued_on') $$,
  ARRAY['amount numeric(20,8)', 'annual_rate numeric(20,8)', 'started_on date',
        'matures_on date', 'valued_on date'],
  'holdings amounts and dates have the types the app reads as decimal strings and ISO dates'
);

SELECT results_eq(
  $$ SELECT symbol, type::text, currency::text FROM public.instruments ORDER BY symbol $$,
  $$ VALUES ('BTC', 'crypto', 'USD'), ('ETH', 'crypto', 'USD'), ('SOL', 'crypto', 'USD'),
            ('USDC', 'crypto', 'USD'), ('USDT', 'crypto', 'USD') $$,
  'instruments are seeded with the crypto the quote feeds price, in USD'
);

-- ── The lock ────────────────────────────────────────────────────────────────
-- Caro's rows are written with the lock triggers off, so no lock of hers is
-- held until one of her writes takes it. A lock taken in a savepoint goes with
-- it.
ALTER TABLE public.portfolios DISABLE TRIGGER portfolio_setup_1_lock;
ALTER TABLE public.source_connections DISABLE TRIGGER portfolio_setup_1_lock;
ALTER TABLE public.holdings DISABLE TRIGGER portfolio_setup_1_lock;
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at)
VALUES ('c0000000-0000-4000-8000-00000000000c', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'caro@pgtap.invalid', '', now(), '{}', '{}', now(), now());
INSERT INTO public.source_connections (id, user_id, institution, default_portfolio_id)
SELECT 'c5000000-0000-4000-8000-0000000000c5', user_id, 'IOL', id
FROM public.portfolios WHERE user_id = 'c0000000-0000-4000-8000-00000000000c';
INSERT INTO public.holdings (id, user_id, source_connection_id, asset_class, currency, amount)
VALUES ('c7000000-0000-4000-8000-0000000000c7', 'c0000000-0000-4000-8000-00000000000c',
        'c5000000-0000-4000-8000-0000000000c5', 'cash', 'USD', '100');
ALTER TABLE public.portfolios ENABLE TRIGGER portfolio_setup_1_lock;
ALTER TABLE public.source_connections ENABLE TRIGGER portfolio_setup_1_lock;
ALTER TABLE public.holdings ENABLE TRIGGER portfolio_setup_1_lock;

SELECT ok(NOT pg_temp.holds_setup_lock('c0000000-0000-4000-8000-00000000000c'),
          'no lock is held for a user before a write');

SAVEPOINT amount_lock;
UPDATE public.holdings SET amount = '150' WHERE id = 'c7000000-0000-4000-8000-0000000000c7';
SELECT ok(NOT pg_temp.holds_setup_lock('c0000000-0000-4000-8000-00000000000c'),
          'editing a holding''s amount takes no user lock');
ROLLBACK TO SAVEPOINT amount_lock;

SAVEPOINT archive_lock;
UPDATE public.holdings SET archived_at = now() WHERE id = 'c7000000-0000-4000-8000-0000000000c7';
SELECT ok(pg_temp.holds_setup_lock('c0000000-0000-4000-8000-00000000000c'),
          'archiving a holding takes the user''s lock');
ROLLBACK TO SAVEPOINT archive_lock;

SAVEPOINT move_lock;
UPDATE public.holdings SET portfolio_id = portfolio_id WHERE id = 'c7000000-0000-4000-8000-0000000000c7';
SELECT ok(pg_temp.holds_setup_lock('c0000000-0000-4000-8000-00000000000c'),
          'an update that sets a holding''s portfolio takes the user''s lock');
ROLLBACK TO SAVEPOINT move_lock;

SAVEPOINT insert_lock;
INSERT INTO public.holdings (user_id, source_connection_id, asset_class, currency, amount)
VALUES ('c0000000-0000-4000-8000-00000000000c', 'c5000000-0000-4000-8000-0000000000c5',
        'cash', 'ARS', '5');
SELECT ok(pg_temp.holds_setup_lock('c0000000-0000-4000-8000-00000000000c'),
          'inserting a holding takes the user''s lock');
ROLLBACK TO SAVEPOINT insert_lock;

-- ── Signed in as Ana ────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

SELECT results_eq(
  $$ SELECT DISTINCT user_id FROM public.holdings $$,
  $$ VALUES ('a0000000-0000-4000-8000-00000000000a'::uuid) $$,
  'a user reads only their own holdings'
);

SELECT is(
  (SELECT count(*)::int FROM public.instruments),
  5,
  'a user reads every instrument'
);

SELECT throws_ok(
  $$ INSERT INTO public.instruments (symbol, name, type, currency) VALUES ('X', 'X', 'crypto', 'USD') $$,
  '42501', NULL,
  'a user cannot add an instrument'
);

SELECT lives_ok(
  $$ INSERT INTO public.holdings (source_connection_id, asset_class, currency, amount)
     VALUES ('a5000000-0000-4000-8000-0000000000a5', 'cash', 'USD', '1000') $$,
  'a user adds a holding to their account with no portfolio'
);

SELECT results_eq(
  $$ SELECT user_id, portfolio_id FROM public.holdings WHERE asset_class = 'cash' $$,
  $$ VALUES ('a0000000-0000-4000-8000-00000000000a'::uuid, 'a1000000-0000-4000-8000-0000000000a1'::uuid) $$,
  'the holding is the user''s and goes to its account''s default portfolio'
);

-- What the user may do with their own holding.
SELECT results_eq(
  $$ UPDATE public.holdings SET portfolio_id = 'a2000000-0000-4000-8000-0000000000a2', amount = '1500'
     WHERE asset_class = 'cash' RETURNING portfolio_id, amount::text $$,
  $$ VALUES ('a2000000-0000-4000-8000-0000000000a2'::uuid, '1500.00000000') $$,
  'a user moves a holding to another active portfolio and edits its amount'
);

SELECT results_eq(
  $$ UPDATE public.holdings SET archived_at = now() WHERE asset_class = 'cash'
     RETURNING archived_at IS NOT NULL $$,
  $$ VALUES (true) $$,
  'a user archives a holding'
);

SELECT results_eq(
  $$ UPDATE public.holdings SET archived_at = NULL WHERE asset_class = 'cash'
     RETURNING archived_at IS NULL $$,
  $$ VALUES (true) $$,
  'a user restores a holding into an active account and portfolio'
);

SELECT lives_ok(
  $$ INSERT INTO public.holdings (source_connection_id, portfolio_id, asset_class, instrument_symbol, amount)
     VALUES ('a5000000-0000-4000-8000-0000000000a5', 'a1000000-0000-4000-8000-0000000000a1',
             'instrument', 'BTC', '0.1') $$,
  'one instrument can sit in two portfolios of one account'
);

SELECT throws_ok(
  $$ INSERT INTO public.holdings (source_connection_id, portfolio_id, asset_class, instrument_symbol, amount)
     VALUES ('a5000000-0000-4000-8000-0000000000a5', 'a2000000-0000-4000-8000-0000000000a2',
             'instrument', 'BTC', '0.2') $$,
  '23505', NULL,
  'an account''s portfolio holds one active position per instrument'
);

SAVEPOINT positions;
UPDATE public.holdings SET archived_at = now() WHERE id = 'a7000000-0000-4000-8000-0000000000a7';
SELECT lives_ok(
  $$ INSERT INTO public.holdings (source_connection_id, portfolio_id, asset_class, instrument_symbol, amount)
     VALUES ('a5000000-0000-4000-8000-0000000000a5', 'a2000000-0000-4000-8000-0000000000a2',
             'instrument', 'BTC', '1') $$,
  'an archived position does not block a new one'
);
SELECT is(
  pg_temp.error_of($$ UPDATE public.holdings SET archived_at = NULL
                      WHERE id = 'a7000000-0000-4000-8000-0000000000a7' $$),
  '23505 -',
  'a position cannot be restored beside an active one of the same instrument'
);
SELECT lives_ok(
  $$ INSERT INTO public.holdings (source_connection_id, portfolio_id, asset_class, instrument_symbol, amount)
     VALUES ('a9000000-0000-4000-8000-0000000000a9', 'a2000000-0000-4000-8000-0000000000a2',
             'instrument', 'BTC', '1') $$,
  'one instrument sits in one portfolio through two accounts'
);
ROLLBACK TO SAVEPOINT positions;

-- The key starts with the caller's user_id, so another user's position never
-- collides: it answers like any account the caller cannot see.
SELECT is(
  pg_temp.error_of($$ INSERT INTO public.holdings (source_connection_id, portfolio_id, asset_class, instrument_symbol, amount)
                      VALUES ('b5000000-0000-4000-8000-0000000000b5', 'b1000000-0000-4000-8000-0000000000b1',
                              'instrument', 'ETH', '1') $$),
  '23503 -',
  'another user''s position answers like a random account, not as a duplicate'
);

-- Each class with the fields it needs.
SELECT lives_ok(
  $$ INSERT INTO public.holdings (source_connection_id, asset_class, currency, amount, annual_rate,
                                  started_on, matures_on)
     VALUES ('a5000000-0000-4000-8000-0000000000a5', 'fixed_term', 'ARS', '100000', '0.35',
             '2026-10-01', '2026-10-31') $$,
  'a fixed term has a currency, a rate and its dates'
);

SELECT lives_ok(
  $$ INSERT INTO public.holdings (source_connection_id, asset_class, currency, amount, valued_on, label)
     VALUES ('a5000000-0000-4000-8000-0000000000a5', 'real_estate', 'USD', '120000',
             '2026-10-01', 'Depto') $$,
  'a property has a currency, a valuation date and a label'
);

SELECT lives_ok(
  $$ INSERT INTO public.holdings (source_connection_id, asset_class, currency, amount, valued_on, label)
     VALUES ('a5000000-0000-4000-8000-0000000000a5', 'other', 'ARS', '5000', '2026-10-01', 'Auto') $$,
  'another asset has a currency, a valuation date and a label'
);

SELECT throws_ok(
  $$ INSERT INTO public.holdings (source_connection_id, asset_class, instrument_symbol, currency, amount)
     VALUES ('a5000000-0000-4000-8000-0000000000a5', 'instrument', 'BTC', 'USD', '1') $$,
  '23514', NULL,
  'an instrument holding has no currency'
);

SELECT throws_ok(
  $$ INSERT INTO public.holdings (source_connection_id, asset_class, currency, instrument_symbol, amount)
     VALUES ('a5000000-0000-4000-8000-0000000000a5', 'cash', 'USD', 'BTC', '1') $$,
  '23514', NULL,
  'cash names no instrument'
);

SELECT throws_ok(
  $$ INSERT INTO public.holdings (source_connection_id, asset_class, currency, amount, annual_rate,
                                  started_on, matures_on)
     VALUES ('a5000000-0000-4000-8000-0000000000a5', 'fixed_term', 'ARS', '1', '0.35',
             '2026-10-31', '2026-10-01') $$,
  '23514', NULL,
  'a fixed term matures after it starts'
);

SELECT throws_ok(
  $$ INSERT INTO public.holdings (source_connection_id, asset_class, currency, amount, annual_rate,
                                  started_on, matures_on)
     VALUES ('a5000000-0000-4000-8000-0000000000a5', 'fixed_term', 'ARS', '1', '0.35',
             '2026-10-01', '2026-10-01') $$,
  '23514', NULL,
  'a fixed term does not mature the day it starts'
);

SELECT throws_ok(
  $$ INSERT INTO public.holdings (source_connection_id, asset_class, currency, amount, annual_rate,
                                  started_on, matures_on)
     VALUES ('a5000000-0000-4000-8000-0000000000a5', 'fixed_term', 'ARS', '1', '-0.01',
             '2026-10-01', '2026-10-31') $$,
  '23514', NULL,
  'a rate is not negative'
);

SELECT throws_ok(
  $$ INSERT INTO public.holdings (source_connection_id, asset_class, currency, amount, annual_rate,
                                  started_on, matures_on)
     VALUES ('a5000000-0000-4000-8000-0000000000a5', 'fixed_term', 'ARS', '1', '10.00000001',
             '2026-10-01', '2026-10-31') $$,
  '23514', NULL,
  'a rate is at most 10 (1000% a year)'
);

SELECT throws_ok(
  $$ INSERT INTO public.holdings (source_connection_id, asset_class, currency, amount, annual_rate,
                                  started_on, matures_on)
     VALUES ('a5000000-0000-4000-8000-0000000000a5', 'fixed_term', 'ARS', '1', '0.35',
             '-infinity', '2026-10-31') $$,
  '23514', NULL,
  'a start date is finite'
);

SELECT throws_ok(
  $$ INSERT INTO public.holdings (source_connection_id, asset_class, currency, amount, annual_rate,
                                  started_on, matures_on)
     VALUES ('a5000000-0000-4000-8000-0000000000a5', 'fixed_term', 'ARS', '1', '0.35',
             '2026-10-01', 'infinity') $$,
  '23514', NULL,
  'a maturity date is finite'
);

SELECT throws_ok(
  $$ INSERT INTO public.holdings (source_connection_id, asset_class, currency, amount, annual_rate,
                                  started_on, matures_on)
     VALUES ('a5000000-0000-4000-8000-0000000000a5', 'fixed_term', 'ARS', '1', '0.35',
             '1899-12-31', '2026-10-31') $$,
  '23514', NULL,
  'a date is not before 1900'
);

SELECT lives_ok(
  $$ INSERT INTO public.holdings (source_connection_id, asset_class, currency, amount, valued_on, label)
     VALUES ('a5000000-0000-4000-8000-0000000000a5', 'other', 'ARS', '1', '1900-01-01', 'Viejo'),
            ('a5000000-0000-4000-8000-0000000000a5', 'other', 'ARS', '1', '9999-12-31', 'Nuevo') $$,
  'a date may be the first or last day of the range'
);

SELECT throws_ok(
  $$ INSERT INTO public.holdings (source_connection_id, asset_class, currency, amount, valued_on, label)
     VALUES ('a5000000-0000-4000-8000-0000000000a5', 'other', 'ARS', '1', '10000-01-01', 'Auto') $$,
  '23514', NULL,
  'a date has a four-digit year'
);

SELECT throws_ok(
  $$ INSERT INTO public.holdings (source_connection_id, asset_class, currency, amount, valued_on, label)
     VALUES ('a5000000-0000-4000-8000-0000000000a5', 'other', 'ARS', '1', '1899-12-31', 'Auto') $$,
  '23514', NULL,
  'a valuation date is not before 1900'
);

SELECT throws_ok(
  $$ INSERT INTO public.holdings (source_connection_id, asset_class, currency, amount, valued_on)
     VALUES ('a5000000-0000-4000-8000-0000000000a5', 'real_estate', 'USD', '1', '2026-10-01') $$,
  '23514', NULL,
  'a property has a label'
);

SELECT throws_ok(
  $$ INSERT INTO public.holdings (source_connection_id, asset_class, currency, amount, valued_on)
     VALUES ('a5000000-0000-4000-8000-0000000000a5', 'other', 'ARS', '1', '2026-10-01') $$,
  '23514', NULL,
  'another asset has a label'
);

SELECT throws_ok(
  $$ INSERT INTO public.holdings (source_connection_id, asset_class, currency, amount, valued_on, label)
     VALUES ('a5000000-0000-4000-8000-0000000000a5', 'other', 'ARS', '1', '2026-10-01', ' Auto') $$,
  '23514', NULL,
  'a label has no surrounding spaces'
);

SELECT throws_ok(
  $$ INSERT INTO public.holdings (source_connection_id, asset_class, currency, amount, valued_on, label)
     VALUES ('a5000000-0000-4000-8000-0000000000a5', 'other', 'ARS', '1', '2026-10-01', '') $$,
  '23514', NULL,
  'a label is not empty'
);

SELECT throws_ok(
  $$ INSERT INTO public.holdings (source_connection_id, asset_class, currency, amount, valued_on, label)
     VALUES ('a5000000-0000-4000-8000-0000000000a5', 'other', 'ARS', '1', '2026-10-01', repeat('x', 81)) $$,
  '23514', NULL,
  'a label has at most 80 characters'
);

SELECT lives_ok(
  $$ INSERT INTO public.holdings (source_connection_id, asset_class, currency, amount, valued_on, label)
     VALUES ('a5000000-0000-4000-8000-0000000000a5', 'other', 'ARS', '1', '2026-10-01', repeat('x', 80)) $$,
  'a label may have 80 characters'
);

SELECT throws_ok(
  $$ INSERT INTO public.holdings (source_connection_id, asset_class, currency, amount)
     VALUES ('a5000000-0000-4000-8000-0000000000a5', 'cash', 'USD', 'NaN') $$,
  '23514', NULL,
  'an amount is not NaN'
);

SELECT throws_ok(
  $$ INSERT INTO public.holdings (source_connection_id, asset_class, currency, amount, annual_rate,
                                  started_on, matures_on)
     VALUES ('a5000000-0000-4000-8000-0000000000a5', 'fixed_term', 'ARS', '1', 'NaN',
             '2026-10-01', '2026-10-31') $$,
  '23514', NULL,
  'a rate is not NaN'
);

SELECT throws_ok(
  $$ INSERT INTO public.holdings (source_connection_id, asset_class, currency, amount)
     VALUES ('a5000000-0000-4000-8000-0000000000a5', 'cash', 'USD', '0') $$,
  '23514', NULL,
  'an amount is above zero'
);

-- Another user's account and a random id answer alike, with no hint.
SELECT is(
  pg_temp.error_of($$ INSERT INTO public.holdings (source_connection_id, portfolio_id, asset_class, currency, amount)
                      VALUES ('b5000000-0000-4000-8000-0000000000b5', 'a1000000-0000-4000-8000-0000000000a1',
                              'cash', 'USD', '1') $$),
  '23503 -',
  'a holding cannot point at another user''s account'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.holdings (source_connection_id, portfolio_id, asset_class, currency, amount)
                      VALUES ('d5000000-0000-4000-8000-0000000000d5', 'a1000000-0000-4000-8000-0000000000a1',
                              'cash', 'USD', '1') $$),
  '23503 -',
  'a random account answers like another user''s'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.holdings (source_connection_id, asset_class, currency, amount)
                      VALUES ('b5000000-0000-4000-8000-0000000000b5', 'cash', 'USD', '1') $$),
  '23502 -',
  'with no portfolio, another user''s account leaves the holding without one'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.holdings (source_connection_id, portfolio_id, asset_class, currency, amount)
                      VALUES ('a5000000-0000-4000-8000-0000000000a5', 'b1000000-0000-4000-8000-0000000000b1',
                              'cash', 'USD', '1') $$),
  '23503 -',
  'a holding cannot sit in another user''s portfolio'
);

-- Another user's archived account or portfolio answers the same, never with a
-- guard's hint.
SELECT is(
  pg_temp.error_of($$ INSERT INTO public.holdings (source_connection_id, portfolio_id, asset_class, currency, amount)
                      VALUES ('b6000000-0000-4000-8000-0000000000b6', 'a1000000-0000-4000-8000-0000000000a1',
                              'cash', 'USD', '1') $$),
  '23503 -',
  'another user''s archived account answers like a random one'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.holdings (source_connection_id, asset_class, currency, amount)
                      VALUES ('b6000000-0000-4000-8000-0000000000b6', 'cash', 'USD', '1') $$),
  '23502 -',
  'with no portfolio, another user''s archived account leaves the holding without one'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.holdings (source_connection_id, portfolio_id, asset_class, currency, amount)
                      VALUES ('a5000000-0000-4000-8000-0000000000a5', 'b3000000-0000-4000-8000-0000000000b3',
                              'cash', 'USD', '1') $$),
  '23503 -',
  'another user''s archived portfolio answers like a random one'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.holdings SET portfolio_id = 'b3000000-0000-4000-8000-0000000000b3'
                      WHERE id = 'a7000000-0000-4000-8000-0000000000a7' $$),
  '23503 -',
  'a holding cannot move into another user''s archived portfolio'
);

-- The guards.
SELECT is(
  pg_temp.error_of($$ INSERT INTO public.holdings (source_connection_id, portfolio_id, asset_class, currency, amount)
                      VALUES ('a6000000-0000-4000-8000-0000000000a6', 'a1000000-0000-4000-8000-0000000000a1',
                              'cash', 'USD', '1') $$),
  'PT409 source_connection_archived',
  'an active holding cannot go into an archived account'
);

SELECT is(
  pg_temp.error_of($$ INSERT INTO public.holdings (source_connection_id, portfolio_id, asset_class, currency, amount)
                      VALUES ('a5000000-0000-4000-8000-0000000000a5', 'a3000000-0000-4000-8000-0000000000a3',
                              'cash', 'USD', '1') $$),
  'PT409 portfolio_archived',
  'an active holding cannot go into an archived portfolio'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.holdings SET portfolio_id = 'a3000000-0000-4000-8000-0000000000a3'
                      WHERE id = 'a7000000-0000-4000-8000-0000000000a7' $$),
  'PT409 portfolio_archived',
  'an active holding cannot move into an archived portfolio'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.portfolios SET archived_at = now()
                      WHERE id = 'a2000000-0000-4000-8000-0000000000a2' $$),
  'PT409 portfolio_has_holdings',
  'a portfolio an active holding sits in stays active'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.source_connections SET archived_at = now()
                      WHERE id = 'a5000000-0000-4000-8000-0000000000a5' $$),
  'PT409 source_connection_has_holdings',
  'an account with an active holding stays active'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.source_connections SET default_portfolio_id = 'a3000000-0000-4000-8000-0000000000a3'
                      WHERE id = 'a5000000-0000-4000-8000-0000000000a5' $$),
  'PT409 portfolio_archived',
  'an account still cannot default to an archived portfolio'
);

-- Only the archived account's or portfolio's own holdings keep it active.
SELECT lives_ok(
  $$ UPDATE public.source_connections SET archived_at = now()
     WHERE id = 'a9000000-0000-4000-8000-0000000000a9' $$,
  'an account with no holdings is archived while another account holds one'
);

SELECT lives_ok(
  $$ UPDATE public.portfolios SET archived_at = now()
     WHERE id = 'a4000000-0000-4000-8000-0000000000a4' $$,
  'a portfolio with no holdings is archived while another portfolio holds one'
);

SELECT lives_ok(
  $$ UPDATE public.holdings SET archived_at = now() WHERE source_connection_id = 'a5000000-0000-4000-8000-0000000000a5' $$,
  'a user archives their holdings'
);

SELECT lives_ok(
  $$ UPDATE public.portfolios SET archived_at = now() WHERE id = 'a2000000-0000-4000-8000-0000000000a2' $$,
  'a portfolio with only archived holdings can be archived'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.holdings SET archived_at = NULL
                      WHERE id = 'a7000000-0000-4000-8000-0000000000a7' $$),
  'PT409 portfolio_archived',
  'a holding cannot be restored into an archived portfolio'
);

SELECT lives_ok(
  $$ UPDATE public.source_connections SET archived_at = now() WHERE id = 'a5000000-0000-4000-8000-0000000000a5' $$,
  'an account with only archived holdings can be archived'
);

SELECT lives_ok(
  $$ UPDATE public.holdings SET archived_at = now() WHERE id = 'a7000000-0000-4000-8000-0000000000a7' $$,
  'an archived holding under an archived account is archived again'
);

SELECT is(
  pg_temp.error_of($$ UPDATE public.holdings SET archived_at = NULL, portfolio_id = 'a1000000-0000-4000-8000-0000000000a1'
                      WHERE id = 'a7000000-0000-4000-8000-0000000000a7' $$),
  'PT409 source_connection_archived',
  'a holding cannot be restored into an archived account'
);

-- Columns the user may not write.
SELECT throws_ok(
  $$ UPDATE public.holdings SET user_id = 'b0000000-0000-4000-8000-00000000000b'
     WHERE id = 'a7000000-0000-4000-8000-0000000000a7' $$,
  '42501', NULL,
  'a user cannot hand a holding to another user'
);

SELECT throws_ok(
  $$ UPDATE public.holdings SET source_connection_id = 'a6000000-0000-4000-8000-0000000000a6'
     WHERE id = 'a7000000-0000-4000-8000-0000000000a7' $$,
  '42501', NULL,
  'a holding cannot change account'
);

SELECT throws_ok(
  $$ UPDATE public.holdings SET asset_class = 'cash' WHERE id = 'a7000000-0000-4000-8000-0000000000a7' $$,
  '42501', NULL,
  'a holding cannot change class'
);

SELECT throws_ok(
  $$ UPDATE public.holdings SET instrument_symbol = 'ETH' WHERE id = 'a7000000-0000-4000-8000-0000000000a7' $$,
  '42501', NULL,
  'a holding cannot change instrument'
);

-- Another user's holding is out of reach.
SELECT is_empty(
  $$ UPDATE public.holdings SET amount = '9' WHERE id = 'b7000000-0000-4000-8000-0000000000b7'
     RETURNING id $$,
  'a user cannot update another user''s holding'
);

SELECT throws_ok(
  $$ DELETE FROM public.holdings WHERE id = 'a7000000-0000-4000-8000-0000000000a7' $$,
  '42501', NULL,
  'a holding is archived, never deleted'
);

RESET ROLE;

SELECT results_eq(
  $$ SELECT amount::text FROM public.holdings WHERE id = 'b7000000-0000-4000-8000-0000000000b7' $$,
  $$ VALUES ('2.00000000') $$,
  'the other user''s holding is unchanged'
);

DELETE FROM auth.users WHERE id = 'a0000000-0000-4000-8000-00000000000a';
SELECT is_empty(
  $$ SELECT 1 FROM public.holdings WHERE user_id = 'a0000000-0000-4000-8000-00000000000a' $$,
  'deleting a user deletes their holdings'
);

SELECT * FROM finish();
ROLLBACK;
