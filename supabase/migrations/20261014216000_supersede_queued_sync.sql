-- Fails a user's sync still queued and starts the one asked for in its place,
-- in one transaction: a new sync refused (no key any more, another sync
-- started meanwhile) leaves the queued one as it was. SECURITY INVOKER, so
-- the imports policy, the status guard and the sync guard hold as for the
-- two writes on their own.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

CREATE FUNCTION public.supersede_queued_sync(
  p_queued_id uuid,
  p_source_connection_id uuid,
  p_provider text,
  p_sync_draft text,
  p_sync_from date DEFAULT NULL,
  p_sync_to date DEFAULT NULL
)
  RETURNS uuid
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
DECLARE
  v_id uuid;
BEGIN
  -- Null when the queued sync is not the caller's, not that account's, or
  -- its job started reading it meanwhile.
  UPDATE public.imports SET status = 'failed'
  WHERE id = p_queued_id
    AND user_id = (SELECT auth.uid())
    AND source_connection_id = p_source_connection_id
    AND document_id IS NULL
    AND status = 'queued';
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.imports (source_connection_id, provider, sync_draft, sync_from, sync_to)
  VALUES (p_source_connection_id, p_provider, p_sync_draft, p_sync_from, p_sync_to)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.supersede_queued_sync(uuid, uuid, text, text, date, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supersede_queued_sync(uuid, uuid, text, text, date, date)
  TO authenticated;
