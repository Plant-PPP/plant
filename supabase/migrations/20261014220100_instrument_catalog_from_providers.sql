-- The catalog grows from the providers: a user who searches
-- for an instrument the catalog lacks picks it from what IOL lists on BYMA or
-- CoinGecko lists as a coin, and the server, after reading it again from that
-- provider, adds it as the service role. No user writes the catalog. The
-- quotes job reads which instruments to quote, so every one added is priced
-- from the next run on.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

GRANT SELECT (symbol, type, currency) ON TABLE public.instruments TO service_role;
GRANT INSERT (symbol, name, type, currency) ON TABLE public.instruments TO service_role;
