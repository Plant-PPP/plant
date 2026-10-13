-- Confirming an import: every operation the review leaves goes into the
-- account in one transaction with the import marked confirmed, or none does.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- A user moves an import only from ready to confirmed, which confirm_import
-- does; the job moves it along every other step as service_role.
CREATE FUNCTION private.guard_import_status()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
BEGIN
  IF current_user = 'authenticated'
     AND NOT (OLD.status = 'ready' AND NEW.status = 'confirmed') THEN
    RAISE EXCEPTION 'a user only confirms a ready import' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_import_status() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER imports_guard_status
  BEFORE UPDATE OF status ON public.imports
  FOR EACH ROW EXECUTE FUNCTION private.guard_import_status();

GRANT UPDATE (status) ON TABLE public.imports TO authenticated;

-- Writes each operation through write_operation, after marking the import
-- confirmed: a ready import of the caller's, or nothing is written. Each
-- operation is { "parts": [...], "expected": {...} } as write_operation takes
-- them; the operations of one import touch different instruments, so each
-- one's expected revisions are those read before the first.
CREATE FUNCTION public.confirm_import(p_import_id uuid, p_operations jsonb)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $$
DECLARE
  v_user uuid := (SELECT auth.uid());
  v_operation jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'no user' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_operations) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_operations) > 500 THEN
    RAISE EXCEPTION 'an import has at most 500 operations' USING ERRCODE = '22023';
  END IF;

  UPDATE public.imports i SET status = 'confirmed'
    WHERE i.user_id = v_user AND i.id = p_import_id AND i.status = 'ready';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such import ready to confirm' USING ERRCODE = 'PT404', HINT = 'not_found';
  END IF;

  FOR v_operation IN SELECT value FROM jsonb_array_elements(p_operations) LOOP
    PERFORM public.write_operation(NULL, v_operation -> 'parts', v_operation -> 'expected');
  END LOOP;

  RETURN p_import_id;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_import(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_import(uuid, jsonb) TO authenticated;
