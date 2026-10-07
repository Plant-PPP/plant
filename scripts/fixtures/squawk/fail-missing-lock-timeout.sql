-- squawk: require-lock-timeout
-- The rule fires on a statement that locks an existing table; a CREATE TABLE
-- alone would not trigger it.
SET statement_timeout = '5min';

ALTER TABLE public.fixture_holdings ADD COLUMN note text;
