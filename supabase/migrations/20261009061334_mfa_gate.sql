SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- A user with a verified MFA factor reads and writes their rows only from an
-- aal2 session. mfa_enrolled is the claim private.custom_access_token_hook adds
-- to every access token; a token without it (minted while the hook was off)
-- counts as enrolled. The rule is the truth table in
-- supabase/tests/mfa_gate_test.sql. RESTRICTIVE, so it narrows each table's
-- owner policy and grants nothing by itself. Every new public table copies it
-- (the floor test checks); auth.jwt() runs once per statement, as an initplan.
CREATE POLICY "Requires two-factor authentication" ON public.profiles
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb)
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb);

CREATE POLICY "Requires two-factor authentication" ON public.consents
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb)
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb);

CREATE POLICY "Requires two-factor authentication" ON public.ai_costs
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb)
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb);
