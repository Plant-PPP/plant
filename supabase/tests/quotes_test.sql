-- fx_rates and prices: every signed-in user reads every row; only the service
-- role inserts, only rows dated today in Buenos Aires, and no API role changes
-- or deletes a quote. The table owner backfills and corrects through the
-- documented path.
--
-- Run with: pnpm exec supabase test db --local

BEGIN;
SELECT plan(59);

-- A local database may hold rows from a cron or pentest run.
DELETE FROM public.fx_rates;
DELETE FROM public.prices;

CREATE TEMP TABLE day AS
  SELECT (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS today;
CREATE TEMP TABLE returned (attempt text, key text);
GRANT SELECT ON day TO service_role, authenticated, anon;
GRANT INSERT ON returned TO service_role;

-- ── What the API roles hold ─────────────────────────────────────────────────
-- service_role bypasses RLS, so its grants are the whole boundary.
CREATE FUNCTION pg_temp.acl(rel regclass, holder regrole) RETURNS SETOF text LANGUAGE sql AS $f$
  SELECT '(table):' || acl.privilege_type || CASE WHEN acl.is_grantable THEN '+grant' ELSE '' END
  FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl
  WHERE c.oid = rel AND acl.grantee = holder
  UNION ALL
  SELECT a.attname || ':' || acl.privilege_type || CASE WHEN acl.is_grantable THEN '+grant' ELSE '' END
  FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl
  WHERE a.attrelid = rel AND acl.grantee = holder
$f$;

SELECT set_eq(
  $$ SELECT pg_temp.acl('public.fx_rates', 'service_role') $$,
  ARRAY['kind:SELECT', 'rate_date:SELECT', 'kind:INSERT', 'rate_date:INSERT', 'buy:INSERT',
        'sell:INSERT', 'source:INSERT', 'quoted_at:INSERT', 'fetched_at:INSERT'],
  'the service role reads the fx_rates key and inserts every column, nothing more'
);

SELECT set_eq(
  $$ SELECT pg_temp.acl('public.prices', 'service_role') $$,
  ARRAY['symbol:SELECT', 'price_date:SELECT', 'symbol:INSERT', 'price_date:INSERT', 'price:INSERT',
        'currency:INSERT', 'source:INSERT', 'quoted_at:INSERT', 'fetched_at:INSERT'],
  'the service role reads the prices key and inserts every column, nothing more'
);

SELECT set_eq(
  $$ SELECT t::text || ' ' || pg_temp.acl(t, 'authenticated')
     FROM unnest(ARRAY['public.fx_rates', 'public.prices']::regclass[]) t $$,
  ARRAY['fx_rates (table):SELECT', 'prices (table):SELECT'],
  'a user holds only SELECT on each table, without the grant option'
);

SELECT is_empty(
  $$ SELECT pg_temp.acl(t, 'anon') FROM unnest(ARRAY['public.fx_rates', 'public.prices']::regclass[]) t $$,
  'anon holds nothing on either table'
);

SELECT set_eq(
  $$ SELECT t.tgenabled::text || ' ' || pg_get_triggerdef(t.oid)
     FROM pg_trigger t
     WHERE t.tgrelid IN ('public.fx_rates'::regclass, 'public.prices'::regclass) AND NOT t.tgisinternal $$,
  ARRAY['O CREATE TRIGGER fx_rates_guard BEFORE INSERT ON public.fx_rates FOR EACH ROW EXECUTE FUNCTION private.guard_fx_rate_insert()',
        'O CREATE TRIGGER prices_guard BEFORE INSERT ON public.prices FOR EACH ROW EXECUTE FUNCTION private.guard_price_insert()'],
  'each quote table has exactly its guard trigger, enabled'
);

-- A guard on UTC or any other zone would pass the date asserts below for most
-- of the day.
SELECT ok(
  (SELECT bool_and(prosrc LIKE '%(now() AT TIME ZONE ''America/Argentina/Buenos_Aires'')::date%')
   FROM pg_proc WHERE oid IN ('private.guard_fx_rate_insert()'::regprocedure,
                              'private.guard_price_insert()'::regprocedure)),
  'each guard dates today in Buenos Aires'
);

SELECT ok(
  (SELECT bool_and(proconfig IS NOT DISTINCT FROM ARRAY['search_path=""'])
   FROM pg_proc WHERE oid IN ('private.guard_fx_rate_insert()'::regprocedure,
                              'private.guard_price_insert()'::regprocedure)),
  'each guard runs with an empty search_path'
);

-- ── The columns ─────────────────────────────────────────────────────────────
SELECT set_eq(
  $$ SELECT attrelid::regclass || '.' || attname || ' ' || format_type(atttypid, atttypmod)
            || CASE WHEN attnotnull THEN ' not null' ELSE '' END
            || CASE WHEN atthasdef THEN ' default' ELSE '' END
     FROM pg_attribute
     WHERE attrelid IN ('public.fx_rates'::regclass, 'public.prices'::regclass)
       AND attnum > 0 AND NOT attisdropped $$,
  ARRAY['fx_rates.kind fx_rate_kind not null',
        'fx_rates.rate_date date not null',
        'fx_rates.buy numeric(20,8)',
        'fx_rates.sell numeric(20,8) not null',
        'fx_rates.source quote_source not null',
        'fx_rates.quoted_at timestamp with time zone not null',
        'fx_rates.fetched_at timestamp with time zone not null',
        'prices.symbol text not null',
        'prices.price_date date not null',
        'prices.price numeric(20,8) not null',
        'prices.currency currency not null',
        'prices.source quote_source not null',
        'prices.quoted_at timestamp with time zone not null',
        'prices.fetched_at timestamp with time zone not null'],
  'each quote table has exactly its columns, types and nullability, and no defaults'
);

SELECT set_eq(
  $$ SELECT conrelid::regclass || ' ' || pg_get_constraintdef(oid) FROM pg_constraint
     WHERE conrelid IN ('public.fx_rates'::regclass, 'public.prices'::regclass) AND contype <> 'n' $$,
  ARRAY['fx_rates CHECK (((buy IS NULL) OR (buy <= sell)))',
        'fx_rates CHECK ((buy > (0)::numeric))',
        'fx_rates CHECK ((sell > (0)::numeric))',
        'fx_rates PRIMARY KEY (kind, rate_date)',
        'prices CHECK ((price > (0)::numeric))',
        $q$prices CHECK ((symbol ~ '^[A-Z0-9]{1,15}$'::text))$q$,
        'prices PRIMARY KEY (symbol, price_date)'],
  'each quote table has exactly its constraints'
);

-- The guards are triggers, so a role that owns the table, the guard function
-- or the private schema, adds a trigger or turns triggers off gets past them.
-- INSERT is left out: service_role holds it.
CREATE FUNCTION pg_temp.bypasses() RETURNS SETOF text LANGUAGE sql AS $f$
  SELECT r.rolname || ' ' || t
  FROM pg_roles r, unnest(ARRAY['public.fx_rates', 'public.prices']) t
  WHERE pg_has_role('authenticator', r.oid, 'MEMBER')
    AND (has_any_column_privilege(r.oid, t, 'UPDATE')
         OR has_table_privilege(r.oid, t, 'DELETE, TRUNCATE, TRIGGER')
         OR pg_has_role(r.oid, (SELECT relowner FROM pg_class WHERE oid = t::regclass), 'MEMBER')
         OR pg_has_role(r.oid, (SELECT nspowner FROM pg_namespace WHERE nspname = 'private'), 'MEMBER')
         OR EXISTS (SELECT 1 FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
                    WHERE tg.tgrelid = t::regclass AND pg_has_role(r.oid, p.proowner, 'MEMBER'))
         OR has_parameter_privilege(r.oid, 'session_replication_role', 'SET')
         OR coalesce(pg_has_role(r.oid, (SELECT oid FROM pg_roles
                                         WHERE rolname = current_setting('supautils.privileged_role', true)),
                                 'MEMBER'), true))
$f$;

SELECT is_empty(
  $$ SELECT pg_temp.bypasses() $$,
  'no role the API can become can change, delete, own or add a trigger to a quote table, or switch triggers off'
);

-- Each canary breaks one clause; owning a table or a guard function, or
-- setting session_replication_role, takes a superuser to grant. A sequence keeps its value through ROLLBACK
-- TO, so it carries the number of missed canaries out of the savepoint.
CREATE TEMP SEQUENCE bypass_misses MINVALUE -1 START -1;
SAVEPOINT canary;
GRANT TRIGGER ON public.fx_rates TO anon;
GRANT UPDATE (sell) ON public.fx_rates TO authenticated;
GRANT DELETE ON public.prices TO anon;
GRANT TRUNCATE ON public.prices TO authenticated_aal1;
ALTER SCHEMA private OWNER TO service_role;
SELECT setval('bypass_misses',
              (SELECT count(*) FROM (VALUES ('service_role public.fx_rates'),
                                            ('service_role public.prices'),
                                            ('authenticated public.fx_rates'),
                                            ('anon public.fx_rates'),
                                            ('anon public.prices'),
                                            ('authenticated_aal1 public.prices')) c(x)
               WHERE x NOT IN (SELECT pg_temp.bypasses())));
ROLLBACK TO SAVEPOINT canary;

SELECT is((SELECT last_value FROM bypass_misses), 0::bigint,
          'the bypass assert catches TRIGGER, UPDATE, DELETE and TRUNCATE grants and owning the private schema');

-- ── The table owner (a migration) ───────────────────────────────────────────
ALTER TABLE public.fx_rates DISABLE TRIGGER fx_rates_guard;
INSERT INTO public.fx_rates (kind, rate_date, buy, sell, source, quoted_at, fetched_at)
VALUES ('official', (SELECT today FROM day) - 1, 1000, 1050, 'dolarapi', now(), now());
ALTER TABLE public.fx_rates ENABLE TRIGGER fx_rates_guard;
ALTER TABLE public.prices DISABLE TRIGGER prices_guard;
INSERT INTO public.prices (symbol, price_date, price, currency, source, quoted_at, fetched_at)
VALUES ('BTC', (SELECT today FROM day) - 1, 60000, 'USD', 'kraken', now(), now());
ALTER TABLE public.prices ENABLE TRIGGER prices_guard;

UPDATE public.fx_rates SET sell = 1060
WHERE kind = 'official' AND rate_date = (SELECT today FROM day) - 1;
UPDATE public.prices SET price = 61000
WHERE symbol = 'BTC' AND price_date = (SELECT today FROM day) - 1;

SELECT is(
  (SELECT sell FROM public.fx_rates WHERE kind = 'official' AND rate_date = (SELECT today FROM day) - 1),
  1060::numeric,
  'the owner backfills and corrects a past dollar rate'
);

SELECT is(
  (SELECT price FROM public.prices WHERE symbol = 'BTC' AND price_date = (SELECT today FROM day) - 1),
  61000::numeric,
  'the owner backfills and corrects a past price'
);

SELECT throws_ok(
  $$ INSERT INTO public.fx_rates (kind, rate_date, buy, sell, source, quoted_at, fetched_at)
     VALUES ('blue', (SELECT today FROM day) - 1, 1000, 1050, 'dolarapi', now(), now()) $$,
  'PT403', 'a quote is dated today',
  'with the guard back on, the owner cannot insert a past dollar rate either'
);

SELECT throws_ok(
  $$ INSERT INTO public.prices (symbol, price_date, price, currency, source, quoted_at, fetched_at)
     VALUES ('ETH', (SELECT today FROM day) - 1, 3000, 'USD', 'kraken', now(), now()) $$,
  'PT403', 'a quote is dated today',
  'with the guard back on, the owner cannot insert a past price either'
);

-- ── The service role (the daily job's writer) ───────────────────────────────
SELECT set_config('request.jwt.claims', '{"role": "service_role"}', true);
SET LOCAL ROLE service_role;

-- PostgREST's shape for upsert with ignoreDuplicates and a select. Each table
-- is written under both session time zones, and at any hour one of them puts
-- the session's date on another day than Buenos Aires, so a guard that dated
-- by the session would refuse one of its inserts.
SET LOCAL TIME ZONE 'Etc/GMT-14';
SELECT lives_ok(
  $$ WITH ins AS (
       INSERT INTO public.fx_rates (kind, rate_date, buy, sell, source, quoted_at, fetched_at)
       VALUES ('mep', (SELECT today FROM day), 1180, 1200, 'dolarapi', now(), now())
       ON CONFLICT (kind, rate_date) DO NOTHING RETURNING kind)
     INSERT INTO returned SELECT 'first', kind::text FROM ins $$,
  'the service role inserts today''s dollar rate'
);
SELECT lives_ok(
  $$ WITH ins AS (
       INSERT INTO public.prices (symbol, price_date, price, currency, source, quoted_at, fetched_at)
       VALUES ('BTC', (SELECT today FROM day), 62000.12345678, 'USD', 'kraken', now(), now())
       ON CONFLICT (symbol, price_date) DO NOTHING RETURNING symbol)
     INSERT INTO returned SELECT 'first', symbol FROM ins $$,
  'the service role inserts today''s price'
);
SET LOCAL TIME ZONE 'Etc/GMT+12';

SELECT lives_ok(
  $$ WITH ins AS (
       INSERT INTO public.fx_rates (kind, rate_date, buy, sell, source, quoted_at, fetched_at)
       VALUES ('mep', (SELECT today FROM day), 1, 2, 'dolarapi', now(), now())
       ON CONFLICT (kind, rate_date) DO NOTHING RETURNING kind)
     INSERT INTO returned SELECT 'again', kind::text FROM ins $$,
  'inserting today''s dollar rate again does not fail'
);

SELECT lives_ok(
  $$ WITH ins AS (
       INSERT INTO public.fx_rates (kind, rate_date, buy, sell, source, quoted_at, fetched_at)
       VALUES ('uva', (SELECT today FROM day), NULL, 1650.5, 'argentinadatos', now(), now())
       ON CONFLICT (kind, rate_date) DO NOTHING RETURNING kind)
     INSERT INTO returned SELECT 'first', kind::text FROM ins $$,
  'the service role inserts today''s UVA with only sell'
);

SELECT lives_ok(
  $$ WITH ins AS (
       INSERT INTO public.prices (symbol, price_date, price, currency, source, quoted_at, fetched_at)
       VALUES ('BTC', (SELECT today FROM day), 1, 'USD', 'kraken', now(), now())
       ON CONFLICT (symbol, price_date) DO NOTHING RETURNING symbol)
     INSERT INTO returned SELECT 'again', symbol FROM ins $$,
  'inserting today''s price again does not fail'
);
RESET TIME ZONE;

SELECT throws_ok(
  $$ INSERT INTO public.fx_rates (kind, rate_date, buy, sell, source, quoted_at, fetched_at)
     VALUES ('blue', (SELECT today FROM day) - 1, 1180, 1200, 'dolarapi', now(), now())
     ON CONFLICT (kind, rate_date) DO NOTHING $$,
  'PT403', 'a quote is dated today',
  'the service role cannot insert yesterday''s dollar rate'
);

-- A BEFORE INSERT trigger runs before ON CONFLICT finds the owner's row.
SELECT throws_ok(
  $$ INSERT INTO public.fx_rates (kind, rate_date, buy, sell, source, quoted_at, fetched_at)
     VALUES ('official', (SELECT today FROM day) - 1, 1000, 1050, 'dolarapi', now(), now())
     ON CONFLICT (kind, rate_date) DO NOTHING $$,
  'PT403', 'a quote is dated today',
  'the service role cannot insert a past dollar rate that already exists'
);

SELECT throws_ok(
  $$ INSERT INTO public.prices (symbol, price_date, price, currency, source, quoted_at, fetched_at)
     VALUES ('BTC', (SELECT today FROM day) - 1, 60000, 'USD', 'kraken', now(), now())
     ON CONFLICT (symbol, price_date) DO NOTHING $$,
  'PT403', 'a quote is dated today',
  'the service role cannot insert a past price that already exists'
);

SELECT throws_ok(
  $$ INSERT INTO public.fx_rates (kind, rate_date, buy, sell, source, quoted_at, fetched_at)
     VALUES ('blue', (SELECT today FROM day) + 1, 1180, 1200, 'dolarapi', now(), now())
     ON CONFLICT (kind, rate_date) DO NOTHING $$,
  'PT403', 'a quote is dated today',
  'the service role cannot insert tomorrow''s dollar rate'
);

SELECT throws_ok(
  $$ INSERT INTO public.fx_rates (kind, rate_date, buy, sell, source, quoted_at, fetched_at)
     VALUES ('uva', (SELECT today FROM day) + 1, NULL, 1651, 'argentinadatos', now(), now())
     ON CONFLICT (kind, rate_date) DO NOTHING $$,
  'PT403', 'a quote is dated today',
  'the service role cannot insert tomorrow''s UVA'
);

SELECT throws_ok(
  $$ INSERT INTO public.prices (symbol, price_date, price, currency, source, quoted_at, fetched_at)
     VALUES ('ETH', (SELECT today FROM day) - 1, 3000, 'USD', 'kraken', now(), now())
     ON CONFLICT (symbol, price_date) DO NOTHING $$,
  'PT403', 'a quote is dated today',
  'the service role cannot insert yesterday''s price'
);

SELECT throws_ok(
  $$ INSERT INTO public.prices (symbol, price_date, price, currency, source, quoted_at, fetched_at)
     VALUES ('ETH', (SELECT today FROM day) + 1, 3000, 'USD', 'kraken', now(), now())
     ON CONFLICT (symbol, price_date) DO NOTHING $$,
  'PT403', 'a quote is dated today',
  'the service role cannot insert tomorrow''s price'
);

SELECT throws_ok(
  $$ UPDATE public.fx_rates SET sell = 1 $$,
  '42501', 'permission denied for table fx_rates',
  'the service role cannot update a dollar rate'
);

SELECT throws_ok(
  $$ DELETE FROM public.fx_rates $$,
  '42501', 'permission denied for table fx_rates',
  'the service role cannot delete a dollar rate'
);

SELECT throws_ok(
  $$ TRUNCATE public.fx_rates $$,
  '42501', 'permission denied for table fx_rates',
  'the service role cannot truncate fx_rates'
);

SELECT throws_ok(
  $$ UPDATE public.prices SET price = 1 $$,
  '42501', 'permission denied for table prices',
  'the service role cannot update a price'
);

SELECT throws_ok(
  $$ DELETE FROM public.prices $$,
  '42501', 'permission denied for table prices',
  'the service role cannot delete a price'
);

SELECT throws_ok(
  $$ TRUNCATE public.prices $$,
  '42501', 'permission denied for table prices',
  'the service role cannot truncate prices'
);

RESET ROLE;

SELECT set_eq(
  $$ SELECT attempt || ' ' || key FROM returned $$,
  ARRAY['first mep', 'first uva', 'first BTC'],
  'each insert returns its key the first time and nothing the second'
);

SELECT results_eq(
  $$ SELECT kind::text, buy, sell FROM public.fx_rates
     WHERE rate_date = (SELECT today FROM day) ORDER BY kind $$,
  $$ VALUES ('mep'::text, 1180::numeric, 1200::numeric), ('uva', NULL, 1650.5) $$,
  'the second insert leaves today''s dollar rate unchanged'
);

SELECT results_eq(
  $$ SELECT symbol, price, currency::text FROM public.prices
     WHERE price_date = (SELECT today FROM day) $$,
  $$ VALUES ('BTC'::text, 62000.12345678::numeric, 'USD'::text) $$,
  'the second insert leaves today''s price unchanged'
);

-- ── Signed in, without a second factor ──────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', false)::text, true);
SET LOCAL ROLE authenticated;

SELECT is((SELECT count(*)::int FROM public.fx_rates), 3, 'a user reads every dollar rate');
SELECT is((SELECT count(*)::int FROM public.prices), 2, 'a user reads every price');

SELECT throws_ok(
  $$ INSERT INTO public.fx_rates (kind, rate_date, buy, sell, source, quoted_at, fetched_at)
     VALUES ('blue', (SELECT today FROM day), 1180, 1200, 'dolarapi', now(), now()) $$,
  '42501', 'permission denied for table fx_rates',
  'a user cannot insert a dollar rate'
);

SELECT throws_ok(
  $$ UPDATE public.fx_rates SET sell = 1 $$,
  '42501', 'permission denied for table fx_rates',
  'a user cannot update a dollar rate'
);

SELECT throws_ok(
  $$ DELETE FROM public.fx_rates $$,
  '42501', 'permission denied for table fx_rates',
  'a user cannot delete a dollar rate'
);

SELECT throws_ok(
  $$ INSERT INTO public.prices (symbol, price_date, price, currency, source, quoted_at, fetched_at)
     VALUES ('ETH', (SELECT today FROM day), 3000, 'USD', 'kraken', now(), now()) $$,
  '42501', 'permission denied for table prices',
  'a user cannot insert a price'
);

SELECT throws_ok(
  $$ UPDATE public.prices SET price = 1 $$,
  '42501', 'permission denied for table prices',
  'a user cannot update a price'
);

SELECT throws_ok(
  $$ DELETE FROM public.prices $$,
  '42501', 'permission denied for table prices',
  'a user cannot delete a price'
);

RESET ROLE;

-- ── Enrolled in MFA but signed in with one factor ───────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
                    'aal', 'aal1', 'mfa_enrolled', true)::text, true);
SET LOCAL ROLE authenticated;

SELECT is_empty($$ SELECT 1 FROM public.fx_rates $$, 'the MFA gate hides dollar rates below aal2');
SELECT is_empty($$ SELECT 1 FROM public.prices $$, 'the MFA gate hides prices below aal2');

RESET ROLE;

-- ── anon ────────────────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"role": "anon"}', true);
SET LOCAL ROLE anon;

SELECT throws_ok(
  $$ SELECT 1 FROM public.fx_rates $$,
  '42501', 'permission denied for table fx_rates',
  'anon cannot read dollar rates'
);

SELECT throws_ok(
  $$ SELECT 1 FROM public.prices $$,
  '42501', 'permission denied for table prices',
  'anon cannot read prices'
);

RESET ROLE;

-- ── Column checks ───────────────────────────────────────────────────────────
SELECT throws_ok(
  $$ INSERT INTO public.fx_rates (kind, rate_date, buy, sell, source, quoted_at, fetched_at)
     VALUES ('blue', (SELECT today FROM day), NULL, 0, 'dolarapi', now(), now()) $$,
  '23514', NULL,
  'a selling rate is positive'
);

SELECT throws_ok(
  $$ INSERT INTO public.fx_rates (kind, rate_date, buy, sell, source, quoted_at, fetched_at)
     VALUES ('blue', (SELECT today FROM day), 0, 1200, 'dolarapi', now(), now()) $$,
  '23514', NULL,
  'a buying rate is positive'
);

SELECT throws_ok(
  $$ INSERT INTO public.fx_rates (kind, rate_date, buy, sell, source, quoted_at, fetched_at)
     VALUES ('blue', (SELECT today FROM day), 1201, 1200, 'dolarapi', now(), now()) $$,
  '23514', NULL,
  'buy is never above sell'
);

SELECT throws_ok(
  $$ INSERT INTO public.fx_rates (kind, rate_date, buy, sell, source, quoted_at, fetched_at)
     VALUES ('blue', (SELECT today FROM day), NULL, 1e12, 'dolarapi', now(), now()) $$,
  '22003', NULL,
  'a rate fits 12 integer digits'
);

SELECT throws_ok(
  $$ INSERT INTO public.prices (symbol, price_date, price, currency, source, quoted_at, fetched_at)
     VALUES ('ETH', (SELECT today FROM day), 0, 'USD', 'kraken', now(), now()) $$,
  '23514', NULL,
  'a price is positive'
);

SELECT throws_ok(
  $$ INSERT INTO public.prices (symbol, price_date, price, currency, source, quoted_at, fetched_at)
     VALUES ('ETH', (SELECT today FROM day), 1e12, 'USD', 'kraken', now(), now()) $$,
  '22003', NULL,
  'a price fits 12 integer digits'
);

SELECT throws_ok(
  $$ INSERT INTO public.prices (symbol, price_date, price, currency, source, quoted_at, fetched_at)
     VALUES ('btc', (SELECT today FROM day), 3000, 'USD', 'kraken', now(), now()) $$,
  '23514', NULL,
  'a symbol is upper case letters and digits'
);

SELECT throws_ok(
  $$ INSERT INTO public.prices (symbol, price_date, price, currency, source, quoted_at, fetched_at)
     VALUES ('ABCDEFGHIJKLMNOP', (SELECT today FROM day), 1, 'USD', 'kraken', now(), now()) $$,
  '23514', NULL,
  'a symbol is at most 15 characters'
);

SELECT throws_ok(
  $$ INSERT INTO public.fx_rates (kind, rate_date, buy, sell, source, quoted_at, fetched_at)
     VALUES ('blue', (SELECT today FROM day), NULL, 1, NULL, now(), now()) $$,
  '23502', NULL,
  'a dollar rate names its source'
);

SELECT throws_ok(
  $$ INSERT INTO public.prices (symbol, price_date, price, currency, source, quoted_at, fetched_at)
     VALUES ('ETH', (SELECT today FROM day), 1, 'USD', 'kraken', NULL, now()) $$,
  '23502', NULL,
  'a price says when it was quoted'
);

SELECT ok(
  enum_range(NULL::public.reference_dollar)::text[] <@ enum_range(NULL::public.fx_rate_kind)::text[],
  'every reference dollar a user can pick is a dollar rate kind'
);

SELECT * FROM finish();
ROLLBACK;
