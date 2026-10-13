import type { Denominator } from "@plant/core";

import { countOf } from "@/lib/format/text";

// The units the assistant answers in.
export const CHAT_UNITS = [
  "ars",
  "usd_mep",
  "usd_ccl",
] as const satisfies readonly Denominator[];
export type ChatUnit = (typeof CHAT_UNITS)[number];

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
};

export const barsOf = (
  title: string,
  unit: ChatUnit,
  points: ChartPart["points"],
): ChartPart => ({ kind: "bars", title, unit, points });

// The most charts one answer shows.
export const MAX_CHARTS = 3;

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

// The most questions a month on the beta plan. A question counts once asked,
// even if its conversation is deleted later.
export const QUESTIONS_PER_MONTH = 30;

export const SUGGESTED_QUESTIONS = [
  "¿Cuánto vale mi patrimonio hoy?",
  "¿Cómo me fue este año?",
  "¿Cuánto cobré de dividendos?",
  "¿Cuánto debo?",
  "¿Cómo le fue a Apple?",
  "¿Qué cobro este mes?",
  "¿Cómo evolucionó mi patrimonio?",
];

export const NOT_ADVICE =
  "Plant explica tus datos; no es asesoramiento financiero.";

export const titleOf = (question: string): string =>
  question.length > 48 ? `${question.slice(0, 47).trimEnd()}…` : question;

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
