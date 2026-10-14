-- meet_price_alerts reads a symbol's latest price in the alert's currency;
-- the primary key has no currency, so an alert in one the symbol is never
-- quoted in walked the symbol's whole history. Alone in its file, like every
-- concurrent build.
-- squawk-ignore require-lock-timeout, require-statement-timeout, prefer-robust-stmts
CREATE INDEX CONCURRENTLY prices_symbol_currency_price_date_idx
  ON public.prices (symbol, currency, price_date DESC);
