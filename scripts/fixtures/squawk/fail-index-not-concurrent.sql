-- squawk: require-concurrent-index-creation
SET lock_timeout = '5s';
SET statement_timeout = '5min';

CREATE INDEX fixture_holdings_user_id_idx ON public.fixture_holdings (user_id);
