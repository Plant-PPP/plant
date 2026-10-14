-- The official euro (BNA), which values held euros in pesos.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TYPE public.fx_rate_kind ADD VALUE IF NOT EXISTS 'eur' AFTER 'blue';
