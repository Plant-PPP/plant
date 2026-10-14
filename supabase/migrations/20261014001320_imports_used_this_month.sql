-- How many imports the user started this month, as the quota counts them.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- SECURITY DEFINER because authenticated holds nothing on
-- private.import_requests. It counts only the caller's rows, over the same
-- month as private.check_import_quota.
CREATE FUNCTION public.imports_used_this_month()
  RETURNS bigint
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = ''
  AS $$
  SELECT count(*) FROM private.import_requests r
  WHERE r.user_id = (SELECT auth.uid())
    AND r.created_at >= date_trunc('month', now() AT TIME ZONE 'America/Argentina/Buenos_Aires')
                          AT TIME ZONE 'America/Argentina/Buenos_Aires';
$$;

REVOKE ALL ON FUNCTION public.imports_used_this_month() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imports_used_this_month() TO authenticated;
