-- CoinGecko as the source of the crypto prices Kraken has no market for.
-- Alone in its migration, as a new enum value is usable only once it
-- commits.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TYPE public.quote_source ADD VALUE IF NOT EXISTS 'coingecko' AFTER 'yahoo';
