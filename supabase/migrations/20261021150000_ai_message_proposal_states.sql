-- What the user answered to each proposal an assistant answer made, by the
-- proposal's tool call id: confirmed or declined. The user writes it, under
-- the table's owner policy, as they answer a card. 20261021150001 validates
-- the check.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TABLE public.ai_messages
  ADD COLUMN proposal_states jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.ai_messages
  ADD CONSTRAINT ai_messages_proposal_states_check CHECK (
    jsonb_typeof(proposal_states) = 'object'
    AND pg_column_size(proposal_states) <= 4096
  ) NOT VALID;

COMMENT ON COLUMN public.ai_messages.proposal_states IS
  'The user''s answer to each proposal of the message, by tool call id: confirmed or declined.';

GRANT UPDATE (proposal_states) ON TABLE public.ai_messages TO authenticated;
