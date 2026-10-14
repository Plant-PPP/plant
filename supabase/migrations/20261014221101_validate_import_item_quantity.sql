-- Validates the check 20261014221100 added NOT VALID.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TABLE public.import_items VALIDATE CONSTRAINT import_items_quantity_check;
