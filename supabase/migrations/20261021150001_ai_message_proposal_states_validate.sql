-- Validates the check the previous migration added NOT VALID.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TABLE public.ai_messages VALIDATE CONSTRAINT ai_messages_proposal_states_check;
