-- Price alerts (PLA-154): a user asks to be told when an instrument's price or
-- a dollar's sell rate goes above or below a figure. The quotes job checks
-- every waiting alert after it saves the day's quotes; one that is met keeps
-- the day and the quote it was met at, and waits no more. Resumen shows it
-- until the user marks it seen.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

CREATE TABLE public.price_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  subject_kind text NOT NULL
    CONSTRAINT price_alerts_subject_kind CHECK (subject_kind IN ('instrument', 'dollar')),
  subject text NOT NULL,
  direction text NOT NULL
    CONSTRAINT price_alerts_direction CHECK (direction IN ('above', 'below')),
  threshold numeric(20, 8) NOT NULL CHECK (threshold > 0),
  currency public.currency NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  met_on date,
  met_price numeric(20, 8),
  seen_at timestamptz,
  UNIQUE (user_id, id),
  -- An instrument is named by its symbol, a dollar by its kind, priced in pesos.
  CONSTRAINT price_alerts_subject CHECK (
    (subject_kind = 'instrument' AND subject ~ '^[A-Z0-9]{1,15}$')
    OR (subject_kind = 'dollar' AND subject IN ('official', 'mep', 'ccl', 'blue') AND currency = 'ARS')
  ),
  CONSTRAINT price_alerts_met CHECK ((met_on IS NULL) = (met_price IS NULL)),
  CONSTRAINT price_alerts_seen CHECK (seen_at IS NULL OR met_on IS NOT NULL)
);

COMMENT ON COLUMN public.price_alerts.subject IS
  'An instrument symbol, or a dollar kind (official, mep, ccl, blue).';
COMMENT ON COLUMN public.price_alerts.threshold IS
  'The price, in currency, that meets the alert; a dollar''s against its sell rate.';
COMMENT ON COLUMN public.price_alerts.met_on IS
  'The quote''s day the alert was met; null while it waits.';

-- The quotes job reads every waiting alert.
CREATE INDEX price_alerts_waiting_idx ON public.price_alerts (subject_kind, subject)
  WHERE met_on IS NULL;

ALTER TABLE public.price_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.price_alerts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, DELETE ON TABLE public.price_alerts TO authenticated;
GRANT INSERT (subject_kind, subject, direction, threshold, currency)
  ON TABLE public.price_alerts TO authenticated;
GRANT UPDATE (seen_at) ON TABLE public.price_alerts TO authenticated;

CREATE POLICY price_alerts_owner ON public.price_alerts
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Requires two-factor authentication" ON public.price_alerts
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb)
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb);

-- Marks met every waiting alert its subject's latest quote meets, and returns
-- how many. SECURITY DEFINER because it reads and writes every user's alerts;
-- only the service role (the quotes job) may run it. An instrument's latest
-- price counts only in the alert's currency; a dollar's latest sell rate is
-- in pesos.
CREATE FUNCTION public.meet_price_alerts()
  RETURNS integer
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = ''
  AS $$
  WITH latest AS (
    (SELECT DISTINCT ON (p.symbol, p.currency)
       'instrument'::text AS subject_kind, p.symbol AS subject, p.currency,
       p.price, p.price_date AS quoted_on
     FROM public.prices p
     ORDER BY p.symbol, p.currency, p.price_date DESC)
    UNION ALL
    (SELECT DISTINCT ON (f.kind)
       'dollar'::text, f.kind::text, 'ARS'::public.currency, f.sell, f.rate_date
     FROM public.fx_rates f
     WHERE f.kind <> 'uva'
     ORDER BY f.kind, f.rate_date DESC)
  ),
  met AS (
    UPDATE public.price_alerts a
    SET met_on = l.quoted_on, met_price = l.price
    FROM latest l
    WHERE a.met_on IS NULL
      AND a.subject_kind = l.subject_kind
      AND a.subject = l.subject
      AND a.currency = l.currency
      AND ((a.direction = 'above' AND l.price >= a.threshold)
        OR (a.direction = 'below' AND l.price <= a.threshold))
    RETURNING 1
  )
  SELECT count(*)::integer FROM met;
$$;

REVOKE ALL ON FUNCTION public.meet_price_alerts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meet_price_alerts() TO service_role;
