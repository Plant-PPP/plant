-- Cargar follows each import's status live: Realtime sends an insert or
-- update on public.imports to a subscriber whose RLS (imports_owner and the
-- MFA gate) lets them read the row. Realtime checks no policy on a delete, so
-- the publication sends none.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER PUBLICATION supabase_realtime SET (publish = 'insert, update');
ALTER PUBLICATION supabase_realtime ADD TABLE public.imports;
