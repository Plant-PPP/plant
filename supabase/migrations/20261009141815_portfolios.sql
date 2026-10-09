-- Portfolios: a user's named groups of holdings. Every user starts with
-- "Principal" and always keeps at least one active portfolio. Users archive
-- portfolios; a portfolio is deleted only with its account.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- The foreign key to auth.users locks it until commit, so no signup commits
-- between the backfill below and this transaction's commit, when the new
-- signup function takes effect. Keep the foreign key in the CREATE TABLE,
-- before the backfill.
CREATE TABLE public.portfolios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40 AND name = btrim(name)),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- The target of the composite foreign keys that accounts and holdings use,
  -- so a row can only point at a portfolio of its own user.
  UNIQUE (user_id, id)
);

CREATE UNIQUE INDEX portfolios_user_id_active_name_key
  ON public.portfolios (user_id, lower(name)) WHERE archived_at IS NULL;
CREATE INDEX portfolios_user_id_active_idx
  ON public.portfolios (user_id, created_at DESC, id DESC) WHERE archived_at IS NULL;
CREATE INDEX portfolios_user_id_archived_idx
  ON public.portfolios (user_id, archived_at DESC, id DESC) WHERE archived_at IS NOT NULL;

ALTER TABLE public.portfolios ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.portfolios FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.portfolios TO authenticated;
GRANT INSERT (name), UPDATE (name, archived_at) ON TABLE public.portfolios TO authenticated;

CREATE POLICY portfolios_owner ON public.portfolios
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Requires two-factor authentication" ON public.portfolios
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb)
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb);

CREATE TRIGGER portfolios_set_updated_at
  BEFORE UPDATE ON public.portfolios
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

-- Signup also seeds the first portfolio. CREATE OR REPLACE keeps the owner
-- and the grants but not the settings, so SECURITY DEFINER and search_path are
-- restated.
CREATE OR REPLACE FUNCTION private.create_profile_for_new_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  AS $$
BEGIN
  INSERT INTO public.profiles (user_id) VALUES (NEW.id);
  INSERT INTO public.portfolios (user_id, name) VALUES (NEW.id, 'Principal');
  RETURN NEW;
END;
$$;

-- Users who signed up before this migration. It runs before the triggers
-- below exist, so it takes no per-user lock.
INSERT INTO public.portfolios (user_id, name)
SELECT u.id, 'Principal' FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.portfolios p WHERE p.user_id = u.id);

-- ── Portfolio setup triggers ────────────────────────────────────────────────
-- "Portfolio setup" is the user's portfolios, and later their holders and
-- accounts; these triggers are shared by those tables. They run as the caller
-- and never read auth.uid(): the signup function, the seed and the owner write
-- past RLS, so every query keys on NEW.user_id. BEFORE triggers fire in name
-- order: lock, then stamp, then guard.

-- Serializes one user's writes to the portfolio setup, so a guard that counts
-- rows sees every committed write of that user. That needs READ COMMITTED,
-- where each query takes a new snapshot after the lock: under REPEATABLE READ
-- the guard would count from a snapshot taken before it waited. A data migration touching many
-- users' rows disables this trigger around it or batches per user, since each
-- row holds its user's lock until commit.
CREATE FUNCTION private.lock_portfolio_setup()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('plant.portfolio_setup:' || NEW.user_id::text, 0));
  RETURN NEW;
END;
$$;

-- archived_at is the server's time the row was archived, kept when an archived
-- row is archived again: the client only says whether the row is archived.
CREATE FUNCTION private.stamp_archived_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
BEGIN
  IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
    NEW.archived_at := now();
  ELSIF OLD.archived_at IS NOT NULL AND NEW.archived_at IS NOT NULL THEN
    NEW.archived_at := OLD.archived_at;
  END IF;
  RETURN NEW;
END;
$$;

-- The hint is the code the app maps to its copy (PORTFOLIO_SETUP_GUARD in
-- @plant/shared).
CREATE FUNCTION private.guard_portfolio_write()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
BEGIN
  IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.portfolios p
                     WHERE p.user_id = NEW.user_id AND p.id <> NEW.id AND p.archived_at IS NULL) THEN
    RAISE EXCEPTION 'a user keeps at least one active portfolio'
      USING ERRCODE = 'PT409', HINT = 'last_active_portfolio';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.lock_portfolio_setup() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.stamp_archived_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.guard_portfolio_write() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER portfolio_setup_1_lock
  BEFORE INSERT OR UPDATE ON public.portfolios
  FOR EACH ROW EXECUTE FUNCTION private.lock_portfolio_setup();
CREATE TRIGGER portfolio_setup_2_stamp
  BEFORE UPDATE ON public.portfolios
  FOR EACH ROW EXECUTE FUNCTION private.stamp_archived_at();
CREATE TRIGGER portfolio_setup_3_guard
  BEFORE UPDATE ON public.portfolios
  FOR EACH ROW EXECUTE FUNCTION private.guard_portfolio_write();
