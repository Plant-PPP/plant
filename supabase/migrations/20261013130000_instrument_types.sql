-- CEDEARs, bonds and FCI join crypto as instrument types (PLA-104). A value
-- added to an enum cannot be used in the transaction that adds it, so the
-- instruments that use them are seeded by the next migration.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TYPE public.instrument_type ADD VALUE IF NOT EXISTS 'cedear' AFTER 'crypto';
ALTER TYPE public.instrument_type ADD VALUE IF NOT EXISTS 'bond' AFTER 'cedear';
ALTER TYPE public.instrument_type ADD VALUE IF NOT EXISTS 'fci' AFTER 'bond';
