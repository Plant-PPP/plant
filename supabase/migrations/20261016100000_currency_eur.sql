-- Euros are held and owed like pesos and dollars.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TYPE public.currency ADD VALUE IF NOT EXISTS 'EUR' AFTER 'USD';
