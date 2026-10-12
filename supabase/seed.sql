-- Local data only: `supabase start` and `pnpm db:reset` load this file;
-- deploys never do. Sign in as test@plantia.io; the code arrives in Mailpit
-- (http://127.0.0.1:54324), which catches every local mail.

-- Auth reads these token columns as strings, so they are '' rather than NULL.
INSERT INTO auth.users (id, instance_id, aud, role, email, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change,
                        email_change_token_new, email_change_token_current,
                        phone_change, phone_change_token, reauthentication_token)
VALUES ('00000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'test@plantia.io', now(),
        '{"provider": "email", "providers": ["email"]}', '{}', now(), now(),
        '', '', '', '', '', '', '', '');

INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider,
                             created_at, updated_at)
VALUES ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000001',
        '{"sub": "00000000-0000-4000-8000-000000000001", "email": "test@plantia.io", "email_verified": true}',
        'email', now(), now());

-- Signup already gave the user "Principal"; a second portfolio shows the list.
INSERT INTO public.portfolios (user_id, name)
VALUES ('00000000-0000-4000-8000-000000000001', 'Largo plazo');

INSERT INTO public.source_connections (user_id, institution, default_portfolio_id)
SELECT p.user_id, c.institution, p.id
FROM public.portfolios p
CROSS JOIN (VALUES ('IOL'), ('Balanz')) AS c (institution)
WHERE p.user_id = '00000000-0000-4000-8000-000000000001' AND p.name = 'Principal';

-- Eight days of quotes up to yesterday in Buenos Aires: a full carry for the
-- assets page, leaving today to the local quotes job. Rows dated before today
-- pass only with the insert guards off; each block turns its guard back on.
BEGIN;
ALTER TABLE public.fx_rates DISABLE TRIGGER fx_rates_guard;
INSERT INTO public.fx_rates (kind, rate_date, buy, sell, source, quoted_at, fetched_at)
SELECT k.kind::public.fx_rate_kind, d.day, k.sell - k.spread + d.n, k.sell + d.n,
       'dolarapi', d.day + time '18:00', d.day + time '18:05'
FROM (VALUES ('mep', 1180, 10), ('ccl', 1220, 10), ('official', 1010, 40))
  AS k (kind, sell, spread)
CROSS JOIN LATERAL (
  SELECT n, (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date - n AS day
  FROM generate_series(1, 8) AS n
) AS d;
ALTER TABLE public.fx_rates ENABLE TRIGGER fx_rates_guard;
COMMIT;

BEGIN;
ALTER TABLE public.prices DISABLE TRIGGER prices_guard;
INSERT INTO public.prices (symbol, price_date, price, currency, source, quoted_at, fetched_at)
SELECT p.symbol, d.day, p.price + d.n * 150, 'USD', 'kraken', d.day + time '20:00', d.day + time '20:05'
FROM (VALUES ('BTC', 64000), ('ETH', 2450)) AS p (symbol, price)
CROSS JOIN LATERAL (
  SELECT n, (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date - n AS day
  FROM generate_series(1, 8) AS n
) AS d;
ALTER TABLE public.prices ENABLE TRIGGER prices_guard;
COMMIT;

-- Ten holdings across the five classes, in both portfolios and both accounts.
WITH ids AS (
  SELECT
    '00000000-0000-4000-8000-000000000001'::uuid AS user_id,
    (SELECT id FROM public.source_connections WHERE institution = 'IOL'
       AND user_id = '00000000-0000-4000-8000-000000000001') AS iol,
    (SELECT id FROM public.source_connections WHERE institution = 'Balanz'
       AND user_id = '00000000-0000-4000-8000-000000000001') AS balanz,
    (SELECT id FROM public.portfolios WHERE name = 'Principal'
       AND user_id = '00000000-0000-4000-8000-000000000001') AS principal,
    (SELECT id FROM public.portfolios WHERE name = 'Largo plazo'
       AND user_id = '00000000-0000-4000-8000-000000000001') AS largo,
    (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS today
)
INSERT INTO public.holdings (user_id, source_connection_id, portfolio_id, asset_class,
                             instrument_symbol, amount, currency, annual_rate,
                             started_on, matures_on, valued_on, label)
SELECT ids.user_id, h.account, h.portfolio, h.asset_class::public.asset_class,
       h.symbol, h.amount, h.currency::public.currency, h.rate,
       h.started_on, h.matures_on, h.valued_on, h.label
FROM ids
CROSS JOIN LATERAL (VALUES
  (ids.iol, ids.principal, 'instrument', 'BTC', 0.35, NULL, NULL::numeric, NULL::date, NULL::date, NULL::date, NULL),
  (ids.iol, ids.principal, 'instrument', 'ETH', 2.5, NULL, NULL, NULL, NULL, NULL, NULL),
  (ids.balanz, ids.largo, 'instrument', 'BTC', 0.12, NULL, NULL, NULL, NULL, NULL, NULL),
  (ids.iol, ids.principal, 'cash', NULL, 2500, 'USD', NULL, NULL, NULL, NULL, NULL),
  (ids.iol, ids.principal, 'cash', NULL, 150000, 'ARS', NULL, NULL, NULL, NULL, 'Pesos para gastos'),
  (ids.balanz, ids.largo, 'cash', NULL, 350000, 'ARS', NULL, NULL, NULL, NULL, NULL),
  (ids.iol, ids.principal, 'fixed_term', NULL, 1000000, 'ARS', 0.32, ids.today - 20, ids.today + 10, NULL, 'Plazo fijo Galicia'),
  (ids.balanz, ids.largo, 'fixed_term', NULL, 5000, 'USD', 0.02, ids.today - 100, ids.today - 10, NULL, NULL),
  (ids.iol, ids.largo, 'real_estate', NULL, 95000, 'USD', NULL, NULL, NULL, '2026-09-01', 'Departamento Palermo'),
  (ids.balanz, ids.principal, 'other', NULL, 12000000, 'ARS', NULL, NULL, NULL, '2026-09-15', 'Auto')
) AS h (account, portfolio, asset_class, symbol, amount, currency, rate, started_on, matures_on, valued_on, label);
