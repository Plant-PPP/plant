-- squawk: require-table-schema (included_rules)
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TABLE fixture_holdings ADD COLUMN note text;
