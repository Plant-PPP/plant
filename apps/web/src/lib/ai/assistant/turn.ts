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
  keepAttachments,
  replayAttachments,
} from "@/lib/assistant/attachment-files";
import {
  type Attachment,
  type KeptAttachment,
  keptAttachmentsOf,
} from "@/lib/assistant/attachments";
import {
  ANSWER_FAILED,
  type AnswerMetadata,
  type ChartPart,
  type ChatUnit,
  MAX_CHARTS,
  QUOTA_USED,
  titleOf,
} from "@/lib/assistant/chat";
import { SOURCES } from "@/lib/assistant/figures";
import { textOf } from "@/lib/assistant/messages-view";
import {
  isKeptPart,
  proposalsNote,
  questionOf,
} from "@/lib/assistant/proposals";
import type { AssistantStore, StoredMessage } from "@/lib/assistant/store";
import { assistantData } from "@/lib/assistant/tools-data";
import { errorType, serverLog } from "@/lib/log/server-log";
import { contextFields, type ReadContext } from "@/lib/portfolio-setup/read";

import { costedModel, type ModelFactory, telemetryOf } from "../costed-model";
import type { AssistantUIMessage } from "./messages";
import { assistantPrompt } from "./prompt";
import { proposalTools } from "./proposal-tools";
import { assistantTools } from "./tools";

export const ASSISTANT_MODEL = "claude-sonnet-5-5" satisfies PricedModelId;

// The turns of a conversation the model reads again with a new question.
const HISTORY_TURNS = 10;
// The most steps a turn takes, the last of them answering without tools.
const MAX_STEPS = 6;
// Room for a long answer; bounds what one step can cost.
const MAX_OUTPUT_TOKENS = 2_048;
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
  // The question's files kept for the conversation, and those that could
  // not be; an earlier question's read again, missing or failed.
  attachmentsKept?: number;
  attachmentsFailed?: number;
  filesReplayed?: number;
  filesMissing?: number;
  filesFailed?: number;
}) => void;

const newId = createIdGenerator({ prefix: "msg", size: 16 });

// A refusal the chat page shows as it is.
export const plainText = (body: string, status: number) =>
  new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });

export type { Attachment } from "@/lib/assistant/attachments";

// What the model reads of an answer's question: its text and the options it
// offered, which the user's next question may answer.
const questionNote = (parts: readonly unknown[]): string => {
  const asked = questionOf(parts);
  if (!asked) return "";
  const options =
    asked.options.length > 0 ? ` Opciones: ${asked.options.join(" / ")}.` : "";
  return `[Preguntaste: "${asked.text}".${options}]`;
};

// What the model reads of a question's files when it does not read them
// again: their names.
const filesNote = (kept: readonly KeptAttachment[], gone = false) =>
  kept.length === 0
    ? ""
    : `(archivos: ${kept.map((each) => each.filename).join(", ")}${gone ? "; ya no están disponibles" : ""})`;

// What the model reads of a stored turn: its text only, a question as
// untrusted text with the names of its files, and under an answer the
// question it asked and how the user answered its proposals.
const forModel = (
  message: StoredMessage,
  replayed?: { files: readonly Attachment[]; gone: boolean },
): AssistantUIMessage => {
  const note =
    message.role === "assistant"
      ? [
          questionNote(message.parts),
          proposalsNote(message.parts, message.proposalStates ?? {}),
        ]
          .filter(Boolean)
          .join("\n")
      : replayed && replayed.files.length > 0
        ? ""
        : filesNote(
            keptAttachmentsOf(message.metadata),
            replayed?.gone ?? false,
          );
  const body = [textOf(message.parts), note].filter(Boolean).join("\n\n");
  return {
    id: message.id,
    role: message.role,
    parts: [
      {
        type: "text",
        text: message.role === "user" ? neutralizePromptText(body) : body,
      },
      ...(replayed?.files ?? []).map(filePartOf),
    ],
  };
};

const filePartOf = (file: Attachment) => ({
  type: "file" as const,
  mediaType: file.mediaType,
  filename: file.filename,
  url: `data:${file.mediaType};base64,${file.data}`,
});

// Marks the end of what every step of a turn sends alike, for the provider
// to cache: the steps after the first read it again.
const cachedUpTo = (message: AssistantUIMessage): AssistantUIMessage => ({
  ...message,
  parts: message.parts.map((part, index) =>
    index === message.parts.length - 1
      ? {
          ...part,
          providerMetadata: {
            anthropic: { cacheControl: { type: "ephemeral" } },
          },
        }
      : part,
  ) as AssistantUIMessage["parts"],
});

// The most an answer's metadata takes as JSON. Its column keeps 4096 bytes of
// jsonb (ai_messages.metadata), which runs up to about a sixth over the JSON
// text for a chart's many small objects.
const METADATA_BYTES = 3300;
const bytesOf = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length;

// An answer's metadata as kept, its last charts left out until it fits,
// weighed as it would be with every source a turn can add.
function fitted(metadata: AnswerMetadata & { charts: ChartPart[] }) {
  const charts = [...metadata.charts];
  const worst = (kept: ChartPart[]) =>
    bytesOf({
      ...metadata,
      sources: Object.values(SOURCES),
      complete: false,
      charts: kept,
    });
  while (charts.length > 0 && worst(charts) > METADATA_BYTES) charts.pop();
  return { ...metadata, charts };
}

const stored = (message: AssistantUIMessage): StoredMessage => ({
  id: message.id,
  role: message.role === "user" ? "user" : "assistant",
  parts: message.parts.filter(isKeptPart),
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
  attachments = [],
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
  // What the user attached, read by the model with the question and kept
  // for the conversation: the question keeps their names and paths, and a
  // later turn reads the latest ones again.
  attachments?: readonly Attachment[];
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

  const messageId = newId();
  // Stored while the turn runs; the question names what was kept once saved.
  const keeping =
    attachments.length > 0
      ? keepAttachments(
          client,
          { userId, conversationId, messageId },
          attachments,
        ).then((result) => {
          report({
            attachmentsKept: result.kept.length - result.failed,
            attachmentsFailed: result.failed,
          });
          if (result.failed > 0) {
            serverLog.warn("assistant.attachment", {
              ...logFields,
              "plant.assistant.attachment_step": "keep",
              "error.type": result.errorType,
            });
          }
          return result.kept;
        })
      : Promise.resolve([]);
  const [existing, history] = await Promise.all([
    store.conversation(userId, conversationId),
    store.history(userId, conversationId, HISTORY_TURNS),
  ]);
  const unit = existing?.unit ?? asked;
  const userMessage: StoredMessage = {
    id: messageId,
    role: "user",
    parts: [{ type: "text", text: question }],
    metadata: null,
  };

  const save = async (answer: AssistantUIMessage) => {
    try {
      const kept = await keeping;
      if (kept.length > 0) userMessage.metadata = { attachments: kept };
      // Started with its first saved turn, so a question that fails leaves
      // no empty conversation.
      if (!existing) {
        await store.startConversation(userId, {
          id: conversationId,
          title: titleOf(question),
          unit,
        });
      }
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

  const data = assistantData({ client, context, unit, today });
  // What the answer read, gathered from its tools' results.
  const read: AnswerMetadata & { charts: ChartPart[] } = {
    asOf: today,
    rate: null,
    sources: [],
    complete: true,
    charts: [],
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
    tools: {
      ...assistantTools(data, logFields, () => {
        read.complete = false;
      }),
      ...proposalTools({
        today,
        accounts: async () => {
          const result = await client
            .from("source_connections")
            .select("id, institution, default_portfolio_id")
            .is("archived_at", null);
          return result.data ?? [];
        },
        debts: async () => {
          const result = await client
            .from("liabilities")
            .select("id, kind, label, lender");
          return result.data ?? [];
        },
      }),
    },
    maxOutputTokens: MAX_OUTPUT_TOKENS,
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
        // A chart drawn on the server, at most MAX_CHARTS an answer, and
        // only while the answer's metadata stays within what a message keeps.
        // An empty chart, or one the answer already has, is left out.
        if ("chart" in output && read.charts.length < MAX_CHARTS) {
          const chart = output.chart as ChartPart;
          const drawn = JSON.stringify(chart);
          if (
            chart.points.length > 0 &&
            !read.charts.some((each) => JSON.stringify(each) === drawn)
          ) {
            read.charts = fitted({
              ...read,
              charts: [...read.charts, chart],
            }).charts;
          }
        }
      }
    },
  });

  // A question with no files of its own reads again the latest ones the
  // conversation kept, so an answer to the assistant's question still sees
  // them.
  const replay =
    attachments.length === 0
      ? await replayAttachments(client, { userId, conversationId }, history)
      : null;
  if (replay?.messageId) {
    report({
      filesReplayed: replay.files.length,
      filesMissing: replay.missing,
      filesFailed: replay.failed,
    });
    if (replay.failed > 0) {
      serverLog.warn("assistant.attachment", {
        ...logFields,
        "plant.assistant.attachment_step": "replay",
        "error.type": replay.errorType,
      });
    }
  }

  // An error the stream met, logged once: the SDK calls back twice for one.
  // Only its type is logged, as a tool's bad input carries the model's input.
  let streamError = false;
  try {
    return await createAgentUIStreamResponse({
      agent,
      uiMessages: history
        .map((message) =>
          forModel(
            message,
            message.id === replay?.messageId
              ? {
                  files: replay.files,
                  gone: replay.files.length === 0,
                }
              : undefined,
          ),
        )
        // An answer with nothing to read, as a failed turn's, would be
        // refused by the provider as a turn.
        .filter((message) => textOf(message.parts).trim() !== "")
        .concat(
          cachedUpTo({
            ...forModel(userMessage),
            parts: [
              ...forModel(userMessage).parts,
              ...attachments.map(filePartOf),
            ],
          }),
        ),
      abortSignal: AbortSignal.timeout(TURN_MS),
      generateMessageId: newId,
      messageMetadata: ({ part }) =>
        part.type === "finish" ? fitted(read) : undefined,
      onFinish: async ({ responseMessage, outcome, finishReason }) => {
        const answer = responseMessage as AssistantUIMessage;
        // An answer may be only a proposal's card or a question.
        const kept = answer.parts.filter(isKeptPart);
        if (
          outcome.status === "completed" &&
          finishReason !== "error" &&
          (textOf(answer.parts).trim() !== "" ||
            kept.some((part) => part.type !== "text"))
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
