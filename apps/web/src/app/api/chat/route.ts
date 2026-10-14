import { buenosAiresDate } from "@plant/shared";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { PROMPT_VERSION } from "@/lib/ai/assistant/prompt";
import {
  ASSISTANT_MODEL,
  plainText,
  runAssistantTurn,
  type TurnOutcome,
} from "@/lib/ai/assistant/turn";
import { aiCostSink } from "@/lib/ai/ai-cost-sink";
import { assistantSink } from "@/lib/assistant/assistant-sink";
import { ANSWER_FAILED, CHAT_UNITS } from "@/lib/assistant/chat";
import { textOf } from "@/lib/assistant/messages-view";
import { getSessionClaims } from "@/lib/auth/session-claims";
import { boundedText } from "@/lib/bounded-body";
import { AI_CONSENTS, consentsGiven } from "@/lib/consent-given";
import { isProductionDeployment } from "@/lib/deployment";
import { serverLog } from "@/lib/log/server-log";
import {
  REQUEST_ID_FIELD,
  REQUEST_ID_HEADER,
  requestIdFrom,
} from "@/lib/request-id";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

// The longest question the chat takes, and the largest body it reads.
const QUESTION_LIMIT = 500;
const BODY_LIMIT = 16_384;

const body = z.object({
  conversationId: z.uuid(),
  unit: z.enum(CHAT_UNITS),
  message: z.object({ parts: z.array(z.unknown()).max(20) }),
});

type Outcome =
  TurnOutcome | "disabled" | "bad_request" | "unauthenticated" | "consent";

const LEVEL: Record<Outcome, "info" | "warn" | "error"> = {
  answered: "info",
  advice: "info",
  quota: "info",
  disabled: "info",
  unauthenticated: "info",
  consent: "info",
  bad_request: "warn",
  aborted: "warn",
  misconfigured: "error",
  failed: "error",
  persist_failed: "error",
};

// The assistant's chat: one question in, the answer streamed back. Only in
// production, where the real data is; previews show the prototype.
export async function POST(request: Request): Promise<Response> {
  const started = Date.now();
  const requestId = requestIdFrom(request.headers.get(REQUEST_ID_HEADER));
  const fields: Record<string, string | number | boolean | undefined> = {
    [REQUEST_ID_FIELD]: requestId,
    "gen_ai.request.model": ASSISTANT_MODEL,
    "plant.assistant.prompt_version": PROMPT_VERSION,
  };
  let outcome: Outcome = "failed";
  let status = 500;
  let failure: unknown;
  // One line per question: when its answer has streamed, else as the
  // request returns.
  let streaming = false;
  let logged = false;
  const emit = () => {
    if (logged) return;
    logged = true;
    const line = {
      ...fields,
      "plant.outcome": outcome,
      "http.response.status_code": status,
      "plant.assistant.duration_ms": Date.now() - started,
    };
    const level = LEVEL[outcome];
    if (level === "error") serverLog.error("assistant.turn", line, failure);
    else serverLog[level]("assistant.turn", line);
  };
  try {
    if (!isProductionDeployment()) {
      outcome = "disabled";
      status = 404;
      return plainText("Not found", status);
    }
    outcome = "unauthenticated";
    status = 307;
    const claims = await getSessionClaims();
    fields["enduser.id"] = claims.sub;
    outcome = "bad_request";
    status = 400;
    // A client that aborts midway rejects the body's read.
    const read = await boundedText(request, BODY_LIMIT).catch(() => undefined);
    if (read === undefined) {
      outcome = "aborted";
      return plainText("No pudimos leer tu pregunta.", status);
    }
    const raw = read ?? "";
    const parsed =
      raw !== ""
        ? body.safeParse(
            (() => {
              try {
                return JSON.parse(raw);
              } catch {
                return null;
              }
            })(),
          )
        : null;
    const question = parsed?.success
      ? textOf(parsed.data.message.parts).trim()
      : "";
    if (
      !parsed?.success ||
      question === "" ||
      question.length > QUESTION_LIMIT
    ) {
      return plainText("No pudimos leer tu pregunta.", status);
    }
    fields["plant.assistant.conversation_id"] = parsed.data.conversationId;
    outcome = "failed";
    status = 500;
    const client = await createClient();
    if (!(await consentsGiven(client, AI_CONSENTS))) {
      outcome = "consent";
      status = 403;
      return plainText(
        "Para preguntarle al asistente, aceptá los términos en Cargar.",
        status,
      );
    }
    const response = await runAssistantTurn({
      client,
      store: assistantSink(),
      record: aiCostSink(),
      context: {
        userId: claims.sub,
        requestId,
        page: "/assistant",
        params: {},
      },
      conversationId: parsed.data.conversationId,
      question,
      unit: parsed.data.unit,
      today: buenosAiresDate(new Date()),
      report: (turn) => {
        if (turn.outcome) outcome = turn.outcome;
        if (turn.steps !== undefined) {
          fields["plant.assistant.steps"] = turn.steps;
        }
        if (turn.toolCalls !== undefined) {
          fields["plant.assistant.tool_calls"] = turn.toolCalls;
        }
        if (turn.errorType !== undefined) {
          fields["error.type"] = turn.errorType;
        }
        if (turn.done) emit();
      },
    });
    status = response.status;
    streaming = response.ok && !logged;
    return response;
  } catch (error) {
    // getSessionClaims redirects by throwing; the redirect goes on.
    unstable_rethrow(error);
    outcome = "failed";
    status = 500;
    failure = error;
    return plainText(ANSWER_FAILED, status);
  } finally {
    if (!streaming) emit();
  }
}
