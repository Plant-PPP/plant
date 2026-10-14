-- Each named key's latest quote before a day, at any age: a manual price or
-- rate the user stated before it loses to it even when it is too old to value
-- anything. One primary-key probe per key; runs as the caller, so the quotes'
-- RLS and MFA gate apply.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

CREATE FUNCTION public.quotes_before(
  p_before date,
  p_fx_kinds public.fx_rate_kind[],
  p_symbols text[]
)
  RETURNS TABLE (
    kind public.fx_rate_kind,
    symbol text,
    quote_date date,
    amount text,
    currency public.currency
  )
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path = ''
  AS $$
  SELECT k.kind, NULL::text, r.rate_date, r.sell::text, NULL::public.currency
  FROM (SELECT DISTINCT unnest(p_fx_kinds) AS kind) AS k
  CROSS JOIN LATERAL (
    SELECT f.rate_date, f.sell
    FROM public.fx_rates AS f
    WHERE f.kind = k.kind AND f.rate_date < p_before
    ORDER BY f.rate_date DESC
    LIMIT 1
  ) AS r
  UNION ALL
  SELECT NULL::public.fx_rate_kind, s.symbol, r.price_date, r.price::text, r.currency
  FROM (SELECT DISTINCT unnest(p_symbols) AS symbol) AS s
  CROSS JOIN LATERAL (
    SELECT p.price_date, p.price, p.currency
    FROM public.prices AS p
    WHERE p.symbol = s.symbol AND p.price_date < p_before
    ORDER BY p.price_date DESC
    LIMIT 1
  ) AS r;
$$;

REVOKE ALL ON FUNCTION public.quotes_before(date, public.fx_rate_kind[], text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quotes_before(date, public.fx_rate_kind[], text[])
  TO authenticated;
