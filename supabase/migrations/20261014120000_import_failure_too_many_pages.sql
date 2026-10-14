-- A PDF longer than the reader takes fails before any model reads it
-- (PLA-152), so an import's cost stays bounded.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TYPE public.import_failure ADD VALUE IF NOT EXISTS 'too_many_pages' AFTER 'extraction_failed';
