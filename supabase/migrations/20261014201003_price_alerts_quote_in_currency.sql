-- An alert's quote is the latest one in its own currency: a price in another
-- currency, even a later one or the user's own of the same day, is not it.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

CREATE OR REPLACE FUNCTION public.meet_price_alerts()
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
      SELECT c.price, c.quoted_on
      FROM (
        (SELECT f.sell, f.rate_date, 0
         FROM public.fx_rates f
         WHERE a.currency = 'ARS'
           AND f.kind = (CASE WHEN a.subject_kind = 'dollar' THEN a.subject END)::public.fx_rate_kind
         ORDER BY f.rate_date DESC LIMIT 1)
        UNION ALL
        (SELECT r.sell, r.rate_date, 1
         FROM public.manual_rates r
         WHERE a.currency = 'ARS'
           AND r.user_id = a.user_id
           AND r.kind = (CASE WHEN a.subject_kind = 'dollar' AND a.subject IN ('mep', 'ccl', 'official')
                              THEN a.subject END)::public.manual_rate_kind
           AND r.rate_date <= (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
         ORDER BY r.rate_date DESC LIMIT 1)
        UNION ALL
        (SELECT p.price, p.price_date, 0
         FROM public.prices p
         WHERE a.subject_kind = 'instrument' AND p.symbol = a.subject AND p.currency = a.currency
         ORDER BY p.price_date DESC LIMIT 1)
        UNION ALL
        (SELECT m.price, m.price_date, 1
         FROM public.manual_prices m
         WHERE a.subject_kind = 'instrument' AND m.user_id = a.user_id AND m.symbol = a.subject
           AND m.currency = a.currency
           AND m.price_date <= (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
         ORDER BY m.price_date DESC LIMIT 1)
      ) AS c (price, quoted_on, manual)
      ORDER BY c.quoted_on DESC, c.manual DESC
      LIMIT 1
    ) q
    WHERE a.met_on IS NULL
      AND a.threshold IS NOT NULL
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
