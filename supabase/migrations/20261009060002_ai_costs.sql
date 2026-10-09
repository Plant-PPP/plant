-- AI costs: one row per model call, written only by the server.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- Extend-only: each feature adds its value with ALTER TYPE ... ADD VALUE.
CREATE TYPE public.ai_cost_type AS ENUM ('import_extraction');

-- The service role inserts each row with the requested model id and the four
-- priced token buckets. input_tokens excludes cached input; output_tokens
-- includes reasoning. user_id has no default: nobody inserts as the user.
CREATE TABLE public.ai_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  cost_type public.ai_cost_type NOT NULL,
  model_id text NOT NULL CHECK (char_length(model_id) BETWEEN 1 AND 100),
  amount_usd numeric(20, 8) NOT NULL CHECK (amount_usd >= 0),
  input_tokens bigint NOT NULL CHECK (input_tokens >= 0),
  cache_read_tokens bigint NOT NULL CHECK (cache_read_tokens >= 0),
  cache_write_tokens bigint NOT NULL CHECK (cache_write_tokens >= 0),
  output_tokens bigint NOT NULL CHECK (output_tokens >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_costs_user_id_created_at_idx
  ON public.ai_costs (user_id, created_at DESC, id DESC);

ALTER TABLE public.ai_costs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ai_costs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.ai_costs TO authenticated;
-- service_role bypasses RLS, so its only privilege is adding rows.
GRANT INSERT (user_id, cost_type, model_id, amount_usd, input_tokens,
              cache_read_tokens, cache_write_tokens, output_tokens)
  ON TABLE public.ai_costs TO service_role;

CREATE POLICY ai_costs_select_own ON public.ai_costs
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
