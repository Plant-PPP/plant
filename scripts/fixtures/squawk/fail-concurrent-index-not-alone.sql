-- squawk: ban-concurrent-index-creation-in-transaction
-- Two statements: `db push` commits the SET before the concurrent build, so the
-- file no longer applies all-or-nothing (.squawk.toml).
SET lock_timeout = '5s';

CREATE INDEX CONCURRENTLY fixture_holdings_user_id_idx ON public.fixture_holdings (user_id, id);
