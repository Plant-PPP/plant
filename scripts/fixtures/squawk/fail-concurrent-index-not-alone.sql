-- squawk: ban-concurrent-index-creation-in-transaction
-- Two statements, so `db push` runs the file as one transaction and the
-- concurrent build fails with SQLSTATE 25001.
SET lock_timeout = '5s';

CREATE INDEX CONCURRENTLY fixture_holdings_user_id_idx ON public.fixture_holdings (user_id, id);
