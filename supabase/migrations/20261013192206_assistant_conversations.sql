-- The assistant's conversations, their messages and the monthly question
-- quota. Only the chat route writes them, as service_role with only the
-- columns it needs and filtering by the session's user; a user reads their
-- own and deletes a conversation.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- A chat turn is costed apart from reading a statement.
ALTER TYPE public.ai_cost_type ADD VALUE 'assistant_chat' AFTER 'import_column_mapping';

-- The denominator a conversation answers in. Extend-only.
CREATE TYPE public.chat_unit AS ENUM ('ars', 'usd_mep', 'usd_ccl');

-- ── Conversations ───────────────────────────────────────────────────────────
-- The browser mints the id, so the key pairs it with its owner. questions
-- counts the user's messages, for the header.
CREATE TABLE public.ai_conversations (
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 60 AND title = btrim(title)),
  unit public.chat_unit NOT NULL,
  questions bigint NOT NULL DEFAULT 0 CHECK (questions >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

CREATE INDEX ai_conversations_user_id_updated_idx
  ON public.ai_conversations (user_id, updated_at DESC, id DESC);

ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_conversations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, DELETE ON TABLE public.ai_conversations TO authenticated;
-- service_role bypasses RLS: the route filters every call by the user.
GRANT SELECT, INSERT (user_id, id, title, unit), UPDATE (title, questions)
  ON TABLE public.ai_conversations TO service_role;

CREATE POLICY ai_conversations_owner ON public.ai_conversations
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Requires two-factor authentication" ON public.ai_conversations
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb)
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb);

CREATE TRIGGER ai_conversations_set_updated_at
  BEFORE UPDATE ON public.ai_conversations
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

-- ── Messages ────────────────────────────────────────────────────────────────
-- The route mints the id. parts and metadata are the AI SDK's UI message
-- parts and metadata, bounded so one message cannot grow a conversation
-- without limit.
CREATE TABLE public.ai_messages (
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  id text NOT NULL CHECK (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  conversation_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  parts jsonb NOT NULL
    CHECK (jsonb_typeof(parts) = 'array' AND pg_column_size(parts) <= 65536),
  metadata jsonb
    CHECK (metadata IS NULL OR (jsonb_typeof(metadata) = 'object' AND pg_column_size(metadata) <= 4096)),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, conversation_id)
    REFERENCES public.ai_conversations (user_id, id) ON DELETE CASCADE
);

CREATE INDEX ai_messages_user_id_conversation_idx
  ON public.ai_messages (user_id, conversation_id, created_at, id);

ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_messages FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.ai_messages TO authenticated;
GRANT SELECT, INSERT (user_id, id, conversation_id, role, parts, metadata)
  ON TABLE public.ai_messages TO service_role;

CREATE POLICY ai_messages_owner ON public.ai_messages
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Requires two-factor authentication" ON public.ai_messages
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb)
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb);

-- ── The question quota ──────────────────────────────────────────────────────
-- One row per question asked, kept when its conversation is deleted, so
-- deleting one never gives a question back.
CREATE TABLE public.ai_questions (
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  asked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

CREATE INDEX ai_questions_user_id_asked_idx ON public.ai_questions (user_id, asked_at);

ALTER TABLE public.ai_questions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_questions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.ai_questions TO authenticated;
GRANT SELECT, INSERT (user_id) ON TABLE public.ai_questions TO service_role;

CREATE POLICY ai_questions_owner ON public.ai_questions
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Requires two-factor authentication" ON public.ai_questions
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb)
  WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2' OR (SELECT auth.jwt() -> 'mfa_enrolled') = 'false'::jsonb);

-- Every user is on the beta plan: 30 questions a calendar month in Buenos
-- Aires. A lock per user keeps two questions at once from both taking the
-- last one.
CREATE FUNCTION private.check_assistant_quota()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
DECLARE
  v_month_start timestamptz := date_trunc('month', now() AT TIME ZONE 'America/Argentina/Buenos_Aires')
                                 AT TIME ZONE 'America/Argentina/Buenos_Aires';
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('plant.assistant_questions:' || NEW.user_id::text, 0));
  IF (SELECT count(*) FROM public.ai_questions q
      WHERE q.user_id = NEW.user_id AND q.asked_at >= v_month_start) >= 30 THEN
    RAISE EXCEPTION 'the month''s questions are used up'
      USING ERRCODE = 'PT429', HINT = 'assistant_quota';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.check_assistant_quota() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER ai_questions_check_quota
  BEFORE INSERT ON public.ai_questions
  FOR EACH ROW EXECUTE FUNCTION private.check_assistant_quota();

-- ── Deleting a conversation ─────────────────────────────────────────────────
ALTER TYPE private.audit_action ADD VALUE 'assistant.conversation.deleted' AFTER 'imports.file.deleted';

-- SECURITY DEFINER because the user deletes as authenticated, which holds
-- nothing on private.audit_log.
CREATE FUNCTION private.record_conversation_deletion()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  AS $$
BEGIN
  INSERT INTO private.audit_log (user_id, action, outcome, metadata)
  VALUES (OLD.user_id, 'assistant.conversation.deleted', 'success',
          jsonb_build_object('conversation_id', OLD.id));
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.record_conversation_deletion() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER ai_conversations_record_deletion
  AFTER DELETE ON public.ai_conversations
  FOR EACH ROW EXECUTE FUNCTION private.record_conversation_deletion();
