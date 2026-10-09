-- Holders and accounts. A holder is a person whose assets the user tracks
-- besides their own; an account (source_connection) is one institution where
-- the user or a holder keeps assets, with the portfolio its holdings go to by
-- default. Both are archived, never deleted, and share the portfolio setup
-- triggers: the per-user lock, the archive stamp and a guard.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

CREATE TABLE public.holders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80 AND name = btrim(name)),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id)
);

CREATE UNIQUE INDEX holders_user_id_active_name_key
  ON public.holders (user_id, lower(name)) WHERE archived_at IS NULL;
CREATE INDEX holders_user_id_active_idx
  ON public.holders (user_id, created_at DESC, id DESC) WHERE archived_at IS NULL;
CREATE INDEX holders_user_id_archived_idx
  ON public.holders (user_id, archived_at DESC, id DESC) WHERE archived_at IS NOT NULL;

-- The composite foreign keys let an account point only at a portfolio or a
-- holder of its own user; a NULL holder_id is the user and skips its check.
CREATE TABLE public.source_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  institution text NOT NULL
    CHECK (char_length(institution) BETWEEN 1 AND 60 AND institution = btrim(institution)),
  holder_id uuid,
  include_in_tax_report boolean NOT NULL DEFAULT true,
  default_portfolio_id uuid NOT NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  FOREIGN KEY (user_id, default_portfolio_id) REFERENCES public.portfolios (user_id, id),
  FOREIGN KEY (user_id, holder_id) REFERENCES public.holders (user_id, id)
);

CREATE INDEX source_connections_user_id_default_portfolio_id_idx
  ON public.source_connections (user_id, default_portfolio_id);
CREATE INDEX source_connections_user_id_holder_id_idx
  ON public.source_connections (user_id, holder_id);
CREATE INDEX source_connections_user_id_active_idx
  ON public.source_connections (user_id, created_at DESC, id DESC) WHERE archived_at IS NULL;
CREATE INDEX source_connections_user_id_archived_idx
  ON public.source_connections (user_id, archived_at DESC, id DESC) WHERE archived_at IS NOT NULL;

ALTER TABLE public.holders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_connections ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.holders FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.source_connections FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.holders, public.source_connections TO authenticated;
GRANT INSERT (name), UPDATE (name, archived_at) ON TABLE public.holders TO authenticated;
GRANT INSERT (institution, holder_id, include_in_tax_report, default_portfolio_id),
      UPDATE (institution, holder_id, include_in_tax_report, default_portfolio_id, archived_at)
  ON TABLE public.source_connections TO authenticated;

CREATE POLICY holders_owner ON public.holders
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Requires two-factor authentication" ON public.holders
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb)
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb);

CREATE POLICY source_connections_owner ON public.source_connections
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Requires two-factor authentication" ON public.source_connections
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb)
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb);

CREATE TRIGGER holders_set_updated_at
  BEFORE UPDATE ON public.holders
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER source_connections_set_updated_at
  BEFORE UPDATE ON public.source_connections
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

-- ── Guards ──────────────────────────────────────────────────────────────────
-- Like the portfolios guard, these run as the caller after the per-user lock,
-- key on NEW.user_id and raise PT409 with a hint the app maps to its copy
-- (PORTFOLIO_SETUP_GUARD in @plant/shared).

-- An active portfolio that an active account defaults to stays active, after
-- the last-active check. CREATE OR REPLACE keeps the owner and the grants but
-- not the settings, so search_path is restated.
CREATE OR REPLACE FUNCTION private.guard_portfolio_write()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $$
BEGIN
  IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.portfolios p
                   WHERE p.user_id = NEW.user_id AND p.id <> NEW.id AND p.archived_at IS NULL) THEN
      RAISE EXCEPTION 'a user keeps at least one active portfolio'
        USING ERRCODE = 'PT409', HINT = 'last_active_portfolio';
    END IF;
    IF EXISTS (SELECT 1 FROM public.source_connections s
               WHERE s.user_id = NEW.user_id AND s.default_portfolio_id = NEW.id
                 AND s.archived_at IS NULL) THEN
      RAISE EXCEPTION 'an active account defaults to this portfolio'
        USING ERRCODE = 'PT409', HINT = 'portfolio_in_use';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- An active holder that an active account belongs to stays active.
CREATE FUNCTION private.guard_holder_write()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
BEGIN
  IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.source_connections s
                 WHERE s.user_id = NEW.user_id AND s.holder_id = NEW.id
                   AND s.archived_at IS NULL) THEN
    RAISE EXCEPTION 'an active account belongs to this holder'
      USING ERRCODE = 'PT409', HINT = 'holder_in_use';
  END IF;
  RETURN NEW;
END;
$$;

-- An active account points at an active portfolio and holder: checked when it
-- is created, restored, or changes either one. A row this cannot find is left
-- to the foreign key, which fails after these triggers but before commit, so
-- another user's id and a random one answer alike. The guard never replaces
-- the ids it reads.
CREATE FUNCTION private.guard_source_connection_write()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
BEGIN
  IF NEW.archived_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF (TG_OP = 'INSERT' OR OLD.archived_at IS NOT NULL
      OR NEW.default_portfolio_id IS DISTINCT FROM OLD.default_portfolio_id)
     AND EXISTS (SELECT 1 FROM public.portfolios p
                 WHERE p.user_id = NEW.user_id AND p.id = NEW.default_portfolio_id
                   AND p.archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'an active account cannot default to an archived portfolio'
      USING ERRCODE = 'PT409', HINT = 'portfolio_archived';
  END IF;
  IF (TG_OP = 'INSERT' OR OLD.archived_at IS NOT NULL
      OR NEW.holder_id IS DISTINCT FROM OLD.holder_id)
     AND EXISTS (SELECT 1 FROM public.holders h
                 WHERE h.user_id = NEW.user_id AND h.id = NEW.holder_id
                   AND h.archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'an active account cannot belong to an archived holder'
      USING ERRCODE = 'PT409', HINT = 'holder_archived';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_holder_write() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.guard_source_connection_write() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER portfolio_setup_1_lock
  BEFORE INSERT OR UPDATE ON public.holders
  FOR EACH ROW EXECUTE FUNCTION private.lock_portfolio_setup();
CREATE TRIGGER portfolio_setup_2_stamp
  BEFORE UPDATE ON public.holders
  FOR EACH ROW EXECUTE FUNCTION private.stamp_archived_at();
CREATE TRIGGER portfolio_setup_3_guard
  BEFORE UPDATE ON public.holders
  FOR EACH ROW EXECUTE FUNCTION private.guard_holder_write();

CREATE TRIGGER portfolio_setup_1_lock
  BEFORE INSERT OR UPDATE ON public.source_connections
  FOR EACH ROW EXECUTE FUNCTION private.lock_portfolio_setup();
CREATE TRIGGER portfolio_setup_2_stamp
  BEFORE UPDATE ON public.source_connections
  FOR EACH ROW EXECUTE FUNCTION private.stamp_archived_at();
CREATE TRIGGER portfolio_setup_3_guard
  BEFORE INSERT OR UPDATE ON public.source_connections
  FOR EACH ROW EXECUTE FUNCTION private.guard_source_connection_write();
