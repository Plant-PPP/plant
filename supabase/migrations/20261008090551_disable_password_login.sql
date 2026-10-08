SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- Plant signs in with an email code or Google only, so no user may hold a
-- password. A stored one would let whoever set it sign in: a /signup with a
-- password before the real owner confirms the address with a code, or a
-- PUT /user with a stolen access token that outlives sign-out. Auth stores no
-- password as NULL. Passwords come back only if this trigger is dropped,
-- disabled or bypassed by a write with triggers off.
CREATE FUNCTION private.clear_password()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
BEGIN
  NEW.encrypted_password := NULL;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.clear_password() FROM PUBLIC, anon, authenticated;

-- Every update, with no column list: a row written while triggers were off (a
-- data-only restore skips them) loses its password on its next write, such as
-- a sign-in, and a column list would block Auth's own upgrades from altering
-- those columns.
CREATE TRIGGER clear_password
  BEFORE INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION private.clear_password();

UPDATE auth.users SET encrypted_password = NULL WHERE encrypted_password IS NOT NULL;
