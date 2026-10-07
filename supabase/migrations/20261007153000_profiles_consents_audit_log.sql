-- Base schema: profiles, consents and the audit log.
--
-- With auto_expose_new_tables off, a table postgres creates in public still
-- carries TRUNCATE, REFERENCES, TRIGGER and MAINTAIN for anon, authenticated and
-- service_role by default privilege, so every table starts with REVOKE ALL from
-- the API roles, drops those four from service_role, and then grants only what
-- the app uses.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

-- The trigger and the foreign keys on auth.users lock it against signups and
-- logins until this commits, so a busy auth.users fails the migration fast
-- instead of queueing every auth write behind it.
SET lock_timeout = '5s';
SET statement_timeout = 0;

CREATE TYPE public.reference_dollar AS ENUM ('mep', 'ccl');
CREATE TYPE public.consent_kind AS ENUM ('terms', 'privacy', 'ai_providers');

-- ── profiles ────────────────────────────────────────────────────────────────
-- One row per user, created by the auth.users trigger below. The user edits
-- name and reference dollar; deleting the auth user deletes the row.
CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  display_name text CHECK (char_length(display_name) <= 100),
  reference_dollar public.reference_dollar NOT NULL DEFAULT 'mep',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLE public.profiles FROM service_role;
GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT UPDATE (display_name, reference_dollar) ON TABLE public.profiles TO authenticated;

CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE FUNCTION private.set_updated_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.set_updated_at() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

-- SECURITY DEFINER because the trigger fires as the auth service's role, which
-- has no grant on public.profiles.
CREATE FUNCTION private.create_profile_for_new_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  AS $$
BEGIN
  INSERT INTO public.profiles (user_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.create_profile_for_new_user() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION private.create_profile_for_new_user();

-- Users who signed up before this migration.
INSERT INTO public.profiles (user_id)
SELECT id FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- ── consents ────────────────────────────────────────────────────────────────
-- Append-only history of what the user accepted, by kind and document version.
-- Withdrawing a consent is a new row with granted = false; the latest row per
-- kind is the current state. The user only names kind, version and granted:
-- user_id and accepted_at come from the defaults. clock_timestamp() orders two
-- rows written in the same transaction.
CREATE TABLE public.consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  kind public.consent_kind NOT NULL,
  version text NOT NULL CHECK (char_length(version) BETWEEN 1 AND 50),
  granted boolean NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX consents_user_kind_accepted_at_idx
  ON public.consents (user_id, kind, accepted_at DESC);

ALTER TABLE public.consents ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.consents FROM PUBLIC, anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLE public.consents FROM service_role;
GRANT SELECT ON TABLE public.consents TO authenticated;
GRANT INSERT (kind, version, granted) ON TABLE public.consents TO authenticated;

CREATE POLICY consents_select_own ON public.consents
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY consents_insert_own ON public.consents
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ── audit_log ───────────────────────────────────────────────────────────────
-- Durable audit trail (login, MFA, export, deletion, upload). It lives in
-- private and no API role nor service_role holds any privilege on it; the
-- server writer, its grants and its policies arrive with PLA-21.
-- user_id has no foreign key on purpose: the trail outlives a deleted account.
-- Rows never carry amounts, holdings, CUIT, DNI, CBU or tokens.
CREATE TABLE private.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 100),
  request_id text CHECK (char_length(request_id) <= 100),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX audit_log_user_id_occurred_at_idx
  ON private.audit_log (user_id, occurred_at DESC);

ALTER TABLE private.audit_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.audit_log FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.reject_audit_log_change()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only' USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION private.reject_audit_log_change() FROM PUBLIC, anon, authenticated;

-- Triggers fire for the table owner and for any writer granted later. Only the
-- owner can skip them (DISABLE TRIGGER, or session_replication_role = replica),
-- from any session; that is the Supabase admin.
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON private.audit_log
  FOR EACH ROW EXECUTE FUNCTION private.reject_audit_log_change();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON private.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION private.reject_audit_log_change();
