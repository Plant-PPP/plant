-- The assistant's charts a user pins to Resumen (PLA-69): which chart, by its
-- topic and, for those of one portfolio, which. Resumen draws each again from
-- the data when it opens, so no figure is stored. A chart is pinned once.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

CREATE TABLE public.pinned_charts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  topic text NOT NULL
    CONSTRAINT pinned_charts_topic
    CHECK (topic IN ('net_worth', 'allocation', 'holdings', 'income', 'debts')),
  portfolio_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  UNIQUE NULLS NOT DISTINCT (user_id, topic, portfolio_id),
  -- A chart of a portfolio goes with it.
  FOREIGN KEY (user_id, portfolio_id)
    REFERENCES public.portfolios (user_id, id) ON DELETE CASCADE
);

COMMENT ON COLUMN public.pinned_charts.topic IS
  'The assistant chart pinned: one of its renderChart topics.';
COMMENT ON COLUMN public.pinned_charts.portfolio_id IS
  'The portfolio an allocation or holdings chart is of; null for the whole.';

ALTER TABLE public.pinned_charts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pinned_charts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, DELETE ON TABLE public.pinned_charts TO authenticated;
GRANT INSERT (topic, portfolio_id) ON TABLE public.pinned_charts TO authenticated;

CREATE POLICY pinned_charts_owner ON public.pinned_charts
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Requires two-factor authentication" ON public.pinned_charts
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb)
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb);
