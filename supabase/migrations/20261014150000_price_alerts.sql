-- Price alerts (PLA-154): a user asks to be told when a dollar's sell rate or
-- an instrument's price goes above or below a figure, or when an instrument
-- they hold gains or loses a percent of its average cost. The quotes job
-- checks every waiting alert after it saves the day's quotes; one that is met
-- keeps the day and the quote it was met at, and waits no more. Resumen shows
-- it until the user marks it seen.
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
  threshold numeric(20, 8) CHECK (threshold > 0),
  currency public.currency NOT NULL,
  gain_percent numeric(9, 4) CHECK (gain_percent > 0),
  cost_price numeric(20, 8) CHECK (cost_price > 0),
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
  -- A price alert has its figure; a gain alert is on an instrument, and its
  -- figure follows the cost the app works out, none while it has none.
  CONSTRAINT price_alerts_kind CHECK (
    (gain_percent IS NULL AND threshold IS NOT NULL AND cost_price IS NULL)
    OR (gain_percent IS NOT NULL AND subject_kind = 'instrument'
        AND (threshold IS NULL) = (cost_price IS NULL))
  ),
  CONSTRAINT price_alerts_met CHECK ((met_on IS NULL) = (met_price IS NULL)),
  CONSTRAINT price_alerts_seen CHECK (seen_at IS NULL OR met_on IS NOT NULL)
);

COMMENT ON COLUMN public.price_alerts.subject IS
  'An instrument symbol, or a dollar kind (official, mep, ccl, blue).';
COMMENT ON COLUMN public.price_alerts.threshold IS
  'The price, in currency, that meets the alert; a dollar''s against its sell rate. A gain alert''s is its cost_price moved by gain_percent.';
COMMENT ON COLUMN public.price_alerts.gain_percent IS
  'A gain alert''s percent over (above) or under (below) the average cost; null on a price alert.';
COMMENT ON COLUMN public.price_alerts.cost_price IS
  'A gain alert''s average cost per unit in currency, as the app last worked it out; null while unknown.';
COMMENT ON COLUMN public.price_alerts.met_on IS
  'The day the alert was met: its quote''s, or the day it was set when the quote is older.';

-- The quotes job reads every waiting alert.
CREATE INDEX price_alerts_waiting_idx ON public.price_alerts (subject_kind, subject)
  WHERE met_on IS NULL;

ALTER TABLE public.price_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.price_alerts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, DELETE ON TABLE public.price_alerts TO authenticated;
GRANT INSERT (subject_kind, subject, direction, threshold, currency, gain_percent, cost_price)
  ON TABLE public.price_alerts TO authenticated;
GRANT UPDATE (seen_at, threshold, cost_price) ON TABLE public.price_alerts TO authenticated;

CREATE POLICY price_alerts_owner ON public.price_alerts
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Requires two-factor authentication" ON public.price_alerts
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb)
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb);

-- A user keeps at most 50 alerts, counted under a lock on the user so two
-- inserts at once cannot both pass. It runs as the user: their own rows are
-- the ones it counts.
CREATE FUNCTION private.price_alerts_limit()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('price_alerts:' || NEW.user_id::text, 0));
  IF (SELECT count(*) FROM public.price_alerts WHERE user_id = NEW.user_id) >= 50 THEN
    RAISE EXCEPTION 'price alerts limit reached' USING ERRCODE = 'P0001', HINT = 'price_alerts_full';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION private.price_alerts_limit() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER price_alerts_limit BEFORE INSERT ON public.price_alerts
  FOR EACH ROW EXECUTE FUNCTION private.price_alerts_limit();

-- Marks met every waiting alert its subject's latest quote meets, and returns
-- how many. SECURITY DEFINER because it reads and writes every user's alerts;
-- only the service role (the quotes job) may run it. A dollar's quote is its
-- latest sell rate, in pesos; an instrument's is its latest price, the user's
-- own manual price winning on its day or later, and counts only in the
-- alert's currency. A gain alert with no figure yet waits.
CREATE FUNCTION public.meet_price_alerts()
  RETURNS integer
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = ''
  AS $$
  WITH quoted AS (
    SELECT a.id, q.price, q.quoted_on, a.created_at
    FROM public.price_alerts a
    CROSS JOIN LATERAL (
      SELECT c.price, c.quoted_on, c.currency
      FROM (
        (SELECT f.sell, f.rate_date, 'ARS'::public.currency, 0
         FROM public.fx_rates f
         WHERE f.kind = (CASE WHEN a.subject_kind = 'dollar' THEN a.subject END)::public.fx_rate_kind
         ORDER BY f.rate_date DESC LIMIT 1)
        UNION ALL
        (SELECT p.price, p.price_date, p.currency, 0
         FROM public.prices p
         WHERE a.subject_kind = 'instrument' AND p.symbol = a.subject
         ORDER BY p.price_date DESC LIMIT 1)
        UNION ALL
        (SELECT m.price, m.price_date, m.currency, 1
         FROM public.manual_prices m
         WHERE a.subject_kind = 'instrument' AND m.user_id = a.user_id AND m.symbol = a.subject
         ORDER BY m.price_date DESC LIMIT 1)
      ) AS c (price, quoted_on, currency, manual)
      ORDER BY c.quoted_on DESC, c.manual DESC
      LIMIT 1
    ) q
    WHERE a.met_on IS NULL
      AND a.threshold IS NOT NULL
      AND q.currency = a.currency
      AND ((a.direction = 'above' AND q.price >= a.threshold)
        OR (a.direction = 'below' AND q.price <= a.threshold))
  ),
  met AS (
    UPDATE public.price_alerts a
    SET met_on = greatest(q.quoted_on, (q.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date),
        met_price = q.price
    FROM quoted q
    WHERE a.id = q.id
    RETURNING 1
  )
  SELECT count(*)::integer FROM met;
$$;

REVOKE ALL ON FUNCTION public.meet_price_alerts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meet_price_alerts() TO service_role;
