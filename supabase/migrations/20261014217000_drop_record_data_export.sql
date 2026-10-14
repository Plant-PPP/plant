-- Unexecutable since 20261014204000_audit_data_export_server_only and called
-- by nothing: the export's audit row goes through audit_data_export.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

DROP FUNCTION public.record_data_export(text, text);
