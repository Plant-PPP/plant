import type { ChartTemplate } from "@/lib/charts/templates";
import type { ProposalView, QuestionView } from "./proposals";
import type { Denominator } from "@plant/core";

import { countOf } from "@/lib/format/text";

// The units the assistant answers in.
export const CHAT_UNITS = [
  "ars",
  "usd_mep",
  "usd_ccl",
] as const satisfies readonly Denominator[];
export type ChatUnit = (typeof CHAT_UNITS)[number];

// What a chart can show, each from one of the assistant's tools.
export const CHART_TOPICS = [
  "net_worth",
  "allocation",
  "holdings",
  "income",
  "debts",
] as const;
export type ChartTopic = (typeof CHART_TOPICS)[number];

// The most charts Resumen shows pinned; private.pinned_charts_limit holds
// the same figure (max-pins.test.ts).
export const MAX_PINS = 12;

// What pinning a chart to Resumen came to.
export type PinResult = "pinned" | "already" | "full" | "failed";

export const CHART_KINDS = ["bars", "line"] as const;
export type ChartKind = (typeof CHART_KINDS)[number];

// A chart an answer carries: bars, or a line through points in order, each a
// label and a value in the conversation's unit. Its numbers come from the
// data, never from the text.
export type ChartPart = {
  kind: ChartKind;
  title: string;
  unit: ChatUnit;
  points: { label: string; value: string }[];
  // How it is drawn, when the figures it shows have their own chart.
  template?: ChartTemplate;
  // Which of the assistant's charts it is, when it is one: what Resumen draws
  // again when it is pinned.
  source?: { topic: ChartTopic; portfolioId: string | null };
};

export const barsOf = (
  template: ChartTemplate,
  title: string,
  unit: ChatUnit,
  points: ChartPart["points"],
): ChartPart => ({ kind: "bars", template, title, unit, points });

// The most charts one answer shows, and the most points each draws.
export const MAX_CHARTS = 3;
export const MAX_CHART_POINTS = 12;

// A table an answer carries: a row per item, its day, what it is and its
// value in the conversation's unit.
export type TablePart = {
  title: string;
  unit: ChatUnit;
  rows: { date: string; label: string; value: string | null }[];
};

export type UserMessage = {
  id: string;
  role: "user";
  text: string;
  // The names of the files it attached.
  attachments?: string[];
};

export type AssistantMessage = {
  id: string;
  role: "assistant";
  text: string;
  charts: ChartPart[];
  table: TablePart | null;
  // What it consulted, named for the user.
  sources: string[];
  // The day it was calculated, and the dollar it used when the unit is one.
  asOf: string;
  rate: { label: string; sell: string } | null;
  // What it proposed to load, each with the user's answer, and the question
  // it ended with.
  proposals?: ProposalView[];
  question?: QuestionView | null;
};

export type ChatMessage = UserMessage | AssistantMessage;

export type Conversation = {
  id: string;
  // Its first question, cut short.
  title: string;
  unit: ChatUnit;
  messages: ChatMessage[];
  updatedOn: string;
};

// A conversation as the history lists it.
export type ConversationSummary = {
  id: string;
  title: string;
  unit: ChatUnit;
  updatedOn: string;
  // How many questions it holds.
  questions: number;
};

export const summaryOf = (conversation: Conversation): ConversationSummary => ({
  id: conversation.id,
  title: conversation.title,
  unit: conversation.unit,
  updatedOn: conversation.updatedOn,
  questions: conversation.messages.filter(({ role }) => role === "user").length,
});

// What an answer says under it: the day it was calculated, the dollar of a
// dollar unit, what it read, and whether a figure left something out.
export type AnswerMetadata = {
  asOf: string;
  rate: AssistantMessage["rate"];
  sources: string[];
  complete: boolean;
  // The charts its tools drew, kept with the answer.
  charts?: ChartPart[];
  // A reopened answer's proposals and question, as the chat holds them.
  proposals?: ProposalView[];
  question?: QuestionView | null;
};

// The most questions a month on the beta plan. A question counts once asked,
// even if its conversation is deleted later; the database refuses the next one
// (private.check_assistant_quota).
export const QUESTIONS_PER_MONTH = 30;

export const ANSWER_FAILED = "No pudimos responder. Probá de nuevo.";
export const QUOTA_USED = "Ya usaste las consultas de este mes.";

// Questions the real chat offers first: the ones its tools answer.
export const LIVE_SUGGESTED_QUESTIONS = [
  "¿Cuánto vale mi patrimonio hoy?",
  "¿Cómo me fue este año?",
  "¿Cuánto cobré de dividendos?",
  "¿Cuánto debo?",
  "¿Cómo evolucionó mi patrimonio?",
  "¿Por qué cambió mi patrimonio el mes pasado?",
  "¿Qué pasa si el MEP sube 10 %?",
];

// The prototype also answers about one instrument and what comes in.
export const SUGGESTED_QUESTIONS = [
  ...LIVE_SUGGESTED_QUESTIONS.slice(0, 4),
  "¿Cómo le fue a Apple?",
  "¿Qué cobro este mes?",
  ...LIVE_SUGGESTED_QUESTIONS.slice(4),
];

export const NOT_ADVICE =
  "Plant explica tus datos; no es asesoramiento financiero.";

// Cut by characters, so an emoji is never split in half.
export function titleOf(question: string): string {
  const characters = Array.from(question.trim());
  return characters.length > 48
    ? `${characters.slice(0, 47).join("").trimEnd()}…`
    : characters.join("");
}

// What the assistant says while it reads: the sources it consults, or the
// user's data when it names none.
export function consultingText(sources: readonly string[]): string {
  if (sources.length === 0) return "Consultando tus datos…";
  return `Consultando ${countOf(sources.length, "fuente", "fuentes")}: ${sources.join(", ")}…`;
}

// The prototype's chat: a question is answered whole, and the page waits for
// it.
export type AssistantActions = {
  // Asks in a conversation, a new one when its id is not listed yet; resolves
  // with the answer's id once it is in.
  ask: (
    conversationId: string,
    question: string,
    unit: ChatUnit,
  ) => Promise<string>;
  delete: (conversationId: string) => void;
  // The sources a question will read, named while it waits.
  consults?: (question: string, unit: ChatUnit) => readonly string[];
};
