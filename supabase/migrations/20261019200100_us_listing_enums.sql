-- US-listed ETFs, and Yahoo Finance as the source of US listings' prices.
-- Alone in their migration, as a new enum value is usable only once it
-- commits.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TYPE public.instrument_type ADD VALUE IF NOT EXISTS 'etf' AFTER 'stock';
ALTER TYPE public.quote_source ADD VALUE IF NOT EXISTS 'yahoo' AFTER 'iol';
