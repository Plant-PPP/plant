-- Shares listed on BYMA (GGAL, YPFD): priced per unit, as a CEDEAR is. Alone
-- in its migration, as a new enum value is usable only once it commits.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TYPE public.instrument_type ADD VALUE IF NOT EXISTS 'stock' AFTER 'cedear';
