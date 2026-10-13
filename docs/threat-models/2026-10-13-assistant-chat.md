# Threat model: the assistant's chat

Branch `feat/pla-47-assistant-chat` (PLA-47 to PLA-51). The PR template requires it because the change adds:
- a route handler that calls a model with user text;
- three owned tables written past RLS;
- a SECURITY DEFINER trigger.

## Scope and assets

- **What it protects:**
  - the user's holdings, debts and closes, read by the tools;
  - their conversations and questions;
  - the month's question count;
  - the cost of model calls.
- **Left out:** charts in the chat (PLA-53) and the tools over movements and income (PLA-81).

## Trust boundary

- **The question** is the user's own text.
- **The names the tools return:** accounts, portfolios, holdings and what documents gave them.
- **The model's answer** is untrusted for anything but display.
- **`POST /api/chat`** is reachable by any signed-in session through `proxy.ts`.

## Data flow

1. The page (`components/assistant/assistant-chat.tsx`) sends `{conversationId, unit, message}` to `/api/chat`.
2. The route runs these checks, in order:
   - production only;
   - the session (`getSessionClaims`);
   - the body (a uuid, a chat unit, up to 500 characters of text).
3. `runAssistantTurn`, in order:
   1. Reserves the question in `ai_questions` through the assistant sink, where a trigger refuses the 31st of the month.
   2. Starts the conversation if it is new. The conversation is keyed by `(user_id, id)`, so an id another user holds is a new row of this user's.
   3. Answers an advice question with fixed text, or streams Claude Haiku with the five tools.
4. The tools read through the session's client, under RLS.
5. Once the answer completes, the sink writes the question and the answer, filtered by `user_id`.
6. Every model call writes its `ai_costs` row through the cost sink.

## Where it is enforced

- **Production gate and session:** the route handler and `proxy.ts`.
- **Who owns a row:** each table has an owner policy and the MFA gate. `authenticated` holds:
  - `SELECT` and `DELETE` on conversations;
  - `SELECT` on messages and questions;
  - no write at all otherwise.
- **Who writes:** only `assistant-sink.ts`, which is fenced to the chat route (`ASSISTANT_SINK`). It holds service_role column grants and puts `.eq("user_id")` on every query.
- **The quota:** `private.check_assistant_quota`, a BEFORE INSERT trigger with a per-user advisory lock. Deleting a conversation leaves `ai_questions` as it is.
- **Untrusted text:**
  - the question, the earlier questions the model reads again, and the tools' names go through `neutralizePromptText`;
  - the prompt says user text and names are data;
  - history replays text only.
- **The model's reach:** its tools are read-only and closed over the session's client and unit. The model never names the user.

## STRIDE

|       | Vector                                                    | Control                                                                                                                                            |
| ----- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S** | Asking as another user                                    | The user comes from the session's claims; the tools use the session's client; the sink takes the claims' id                                       |
| **T** | Forging stored history to steer the model                 | `authenticated` cannot insert or update messages; only the route writes them, after streaming                                                      |
| **R** | Denying a deleted conversation                            | An AFTER DELETE trigger writes `assistant.conversation.deleted` to `audit_log`                                                                    |
| **I** | Reading another user's conversations or data              | Owner policies and the MFA gate on all three tables; the composite FK keeps a message in its owner's conversation; the tools read under RLS        |
| **D** | Running up model cost                                     | 30 questions a month counted before the model runs, under a lock; 6 steps and 50 seconds per turn; 500 characters a question; `parts` ≤ 64 kB     |
| **E** | Making the model act                                      | The tools only read; the advice rule is enforced before the model and in the prompt                                                                |

## Controls as built

- **Isolation and grants:** `supabase/tests/ai_conversations_isolation_test.sql`, `ai_messages_isolation_test.sql` and `ai_questions_isolation_test.sql` (checked against mutants), plus the three pentest specs.
- **Quota:** pgTAP, where 30 inserts pass, the 31st raises `PT429`, and a delete does not reset the count. Also `turn.test.ts`, where a refused question returns 429 before anything is read.
- **Advice:** `advice.test.ts`, and `turn.test.ts`, which checks the fixed answer is given with no model call.
- **Figures match Resumen:** `components/prototype/assistant-tools-data.test.ts`.

## Residual risk

- **The model may still word advice the check misses.** The prompt forbids it; evals arrive with PLA-55.
- **A stopped or failed answer still counts as a question.** That keeps the quota simple and honest about cost.
- **The history lists the newest 50 conversations** with no paging yet; older ones stay stored but out of the list.
- **A tool's bad input is logged by type only**, as its error carries the model's input.
