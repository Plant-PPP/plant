import "server-only";
import { anthropic } from "@ai-sdk/anthropic";
import {
  type AiCostInsert,
  type Database,
  neutralizePromptText,
  type PricedModelId,
} from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  consumeStream,
  createAgentUIStreamResponse,
  createIdGenerator,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  ToolLoopAgent,
} from "ai";

import { ADVICE_ANSWER, isAdvice } from "@/lib/assistant/advice";
import {
  ANSWER_FAILED,
  type AnswerMetadata,
  type ChatUnit,
  QUOTA_USED,
  titleOf,
} from "@/lib/assistant/chat";
import { textOf } from "@/lib/assistant/messages-view";
import type { AssistantStore, StoredMessage } from "@/lib/assistant/store";
import { assistantData } from "@/lib/assistant/tools-data";
import { errorType, serverLog } from "@/lib/log/server-log";
import { contextFields, type ReadContext } from "@/lib/portfolio-setup/read";

import { costedModel, type ModelFactory, telemetryOf } from "../costed-model";
import type { AssistantUIMessage } from "./messages";
import { assistantPrompt } from "./prompt";
import { assistantTools } from "./tools";

export const ASSISTANT_MODEL = "claude-haiku-4-5" satisfies PricedModelId;

// The turns of a conversation the model reads again with a new question.
const HISTORY_TURNS = 10;
// The most steps a turn takes, the last of them answering without tools.
const MAX_STEPS = 6;
// A turn ends before the chat route's maxDuration would cut it.
const TURN_MS = 50_000;

export type TurnOutcome =
  | "answered"
  | "advice"
  | "quota"
  | "misconfigured"
  | "failed"
  | "aborted"
  | "persist_failed";

// What a turn tells the request's log line as it goes.
export type TurnReport = (fields: {
  outcome?: TurnOutcome;
  steps?: number;
  toolCalls?: number;
  // The answer has finished streaming, kept or not.
  done?: boolean;
  // What failed, by type only.
  errorType?: string;
}) => void;

const newId = createIdGenerator({ prefix: "msg", size: 16 });

// A refusal the chat page shows as it is.
export const plainText = (body: string, status: number) =>
  new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });

// What the model reads of a stored turn: its text only, a question as
// untrusted text.
const forModel = (message: StoredMessage): AssistantUIMessage => {
  const body = textOf(message.parts);
  return {
    id: message.id,
    role: message.role,
    parts: [
      {
        type: "text",
        text: message.role === "user" ? neutralizePromptText(body) : body,
      },
    ],
  };
};

const stored = (message: AssistantUIMessage): StoredMessage => ({
  id: message.id,
  role: message.role === "user" ? "user" : "assistant",
  parts: message.parts.filter((part) => part.type === "text"),
  metadata: message.metadata ?? null,
});

// One question in a conversation: counts it against the month's questions,
// starts the conversation the first time, and answers with the user's own
// data through the tools; a question about what to buy or sell gets the fixed
// answer without a model. The answer streams back and, once complete, is
// kept with its question.
export async function runAssistantTurn({
  client,
  store,
  record,
  model = (id) => anthropic(id),
  context,
  conversationId,
  question,
  unit: asked,
  today,
  report,
}: {
  client: SupabaseClient<Database>;
  store: AssistantStore;
  record: (row: AiCostInsert) => Promise<void>;
  model?: ModelFactory;
  context: ReadContext;
  conversationId: string;
  question: string;
  unit: ChatUnit;
  today: string;
  report: TurnReport;
}): Promise<Response> {
  const { userId } = context;
  const logFields = {
    ...contextFields(context),
    "plant.assistant.conversation_id": conversationId,
  };
  // The fixed answer needs no model.
  if (!isAdvice(question) && !process.env.ANTHROPIC_API_KEY) {
    report({ outcome: "misconfigured" });
    return plainText(ANSWER_FAILED, 503);
  }
  if ((await store.reserveQuestion(userId)) === "quota") {
    report({ outcome: "quota" });
    return plainText(QUOTA_USED, 429);
  }

  const existing = await store.conversation(userId, conversationId);
  const unit = existing?.unit ?? asked;
  if (!existing) {
    await store.startConversation(userId, {
      id: conversationId,
      title: titleOf(question),
      unit,
    });
  }
  const userMessage: StoredMessage = {
    id: newId(),
    role: "user",
    parts: [{ type: "text", text: question }],
    metadata: null,
  };

  const save = async (answer: AssistantUIMessage) => {
    try {
      await store.saveTurn(userId, {
        conversationId,
        messages: [userMessage, stored(answer)],
      });
    } catch (error) {
      report({ outcome: "persist_failed" });
      report({ errorType: errorType(error) });
      serverLog.error("assistant.persist", logFields, error);
    }
  };

  if (isAdvice(question)) {
    report({ outcome: "advice" });
    const metadata: AnswerMetadata = {
      asOf: today,
      rate: null,
      sources: [],
      complete: true,
    };
    const stream = createUIMessageStream<AssistantUIMessage>({
      execute: ({ writer }) => {
        writer.write({
          type: "start",
          messageId: newId(),
          messageMetadata: metadata,
        });
        writer.write({ type: "text-start", id: "advice" });
        writer.write({
          type: "text-delta",
          id: "advice",
          delta: ADVICE_ANSWER,
        });
        writer.write({ type: "text-end", id: "advice" });
        writer.write({ type: "finish", messageMetadata: metadata });
      },
      onFinish: async ({ responseMessage }) => {
        await save(responseMessage);
        report({ done: true });
      },
    });
    return createUIMessageStreamResponse({ stream });
  }

  const history = await store.history(userId, conversationId, HISTORY_TURNS);
  const data = assistantData({ client, context, unit, today });
  // What the answer read, gathered from its tools' results.
  const read: AnswerMetadata = {
    asOf: today,
    rate: null,
    sources: [],
    complete: true,
  };
  let steps = 0;
  let toolCalls = 0;
  const agent = new ToolLoopAgent({
    model: costedModel({
      modelId: ASSISTANT_MODEL,
      model,
      userId,
      costType: "assistant_chat",
      record,
    }),
    instructions: assistantPrompt(unit),
    tools: assistantTools(data, logFields, () => {
      read.complete = false;
    }),
    stopWhen: stepCountIs(MAX_STEPS),
    prepareStep: ({ stepNumber }) =>
      stepNumber >= MAX_STEPS - 1 ? { toolChoice: "none" } : {},
    maxRetries: 1,
    experimental_telemetry: telemetryOf("assistant_chat"),
    onStepFinish: (step) => {
      steps += 1;
      toolCalls += step.toolResults.length;
      report({ steps, toolCalls });
      for (const result of step.toolResults) {
        const output = result.output as Partial<AnswerMetadata> | undefined;
        if (!output || typeof output !== "object") continue;
        for (const source of output.sources ?? []) {
          if (!read.sources.includes(source)) read.sources.push(source);
        }
        // The dollar of the conversation's unit, not of a conversion's.
        if (output.rate && "unit" in output && output.unit === unit) {
          read.rate = output.rate;
        }
        if (output.complete === false) read.complete = false;
      }
    },
  });

  // An error the stream met, logged once: the SDK calls back twice for one.
  // Only its type is logged, as a tool's bad input carries the model's input.
  let streamError = false;
  try {
    return await createAgentUIStreamResponse({
      agent,
      uiMessages: [
        // An answer with no text, as a failed turn's, would be refused by the
        // provider as a turn.
        ...history.filter((message) => textOf(message.parts).trim() !== ""),
        userMessage,
      ].map(forModel),
      abortSignal: AbortSignal.timeout(TURN_MS),
      generateMessageId: newId,
      messageMetadata: ({ part }) =>
        part.type === "finish" ? { ...read } : undefined,
      onFinish: async ({ responseMessage, outcome, finishReason }) => {
        const answer = responseMessage as AssistantUIMessage;
        if (
          outcome.status === "completed" &&
          finishReason !== "error" &&
          textOf(answer.parts).trim() !== ""
        ) {
          report({ outcome: "answered" });
          await save(answer);
        } else {
          report({
            outcome: outcome.status === "aborted" ? "aborted" : "failed",
          });
        }
        report({ done: true });
      },
      consumeSseStream: consumeStream,
      onError: (error) => {
        if (!streamError) {
          streamError = true;
          report({ errorType: errorType(error) });
          serverLog.warn("assistant.stream", {
            ...logFields,
            "error.type": errorType(error),
          });
        }
        return ANSWER_FAILED;
      },
    });
  } catch (error) {
    report({ outcome: "failed" });
    // Only the type: a message rejected here carries the conversation.
    report({ errorType: errorType(error) });
    serverLog.warn("assistant.stream", {
      ...logFields,
      "error.type": errorType(error),
    });
    return plainText(ANSWER_FAILED, 500);
  }
}
