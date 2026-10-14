-- InvertirOnline quotes CEDEARs, bonds and stocks listed on BYMA (PLA-161).
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TYPE public.quote_source ADD VALUE IF NOT EXISTS 'iol' AFTER 'kraken';
